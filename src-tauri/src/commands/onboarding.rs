//! Onboarding: unified AI-provider detection for the first-run welcome wizard.
//!
//! Reports, for each supported CLI provider, whether it is installed (+version
//! +path) and an auth heuristic. Auth detection is **passive** — it inspects
//! known credential files only and never invokes the CLI (which could burn API
//! quota or pop a browser). Phase 1 uses cheap file-existence checks; a later
//! phase adds reliable live probes for the providers that need them.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::IpcResponse;
use crate::commands::tools::detect_tool;
use crate::providers::cli::{get_cli_config, is_cli_available};

/// Best-effort login state for a provider, derived from its credential files.
#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    /// Credentials present and (where checkable) unexpired.
    LoggedIn,
    /// No credentials found.
    LoggedOut,
    /// Credentials present but expired.
    Expired,
    /// Can't tell cheaply (e.g. gcloud-based, or provider not installed).
    Unknown,
}

/// Detection result for one provider, consumed by the welcome wizard.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider_type: String,
    pub display_name: String,
    pub command: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub auth_state: AuthState,
    /// installed AND looks authenticated — safe to auto-connect.
    pub ready: bool,
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Passive auth heuristic — credential files only, never runs the CLI.
fn detect_auth(provider_type: &str, installed: bool) -> AuthState {
    if !installed {
        return AuthState::Unknown;
    }
    match provider_type {
        "claude" => claude_auth(),
        "codex" => codex_auth(),
        "opencode" => opencode_auth(),
        // gemini-cli (gcloud/ADC) and kimi-cli need a live probe — Phase 3.
        _ => AuthState::Unknown,
    }
}

/// Claude Code: `~/.claude/.credentials.json` (or env tokens). The OAuth blob
/// carries `expiresAt` (epoch ms) so we can distinguish expired from valid.
fn claude_auth() -> AuthState {
    if std::env::var("ANTHROPIC_API_KEY").is_ok()
        || std::env::var("CLAUDE_CODE_OAUTH_TOKEN").is_ok()
    {
        return AuthState::LoggedIn;
    }
    let Some(path) = home().map(|h| h.join(".claude").join(".credentials.json")) else {
        return AuthState::Unknown;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return AuthState::LoggedOut;
    };
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
        let oauth = json.get("claudeAiOauth");
        if let Some(exp) = oauth
            .and_then(|o| o.get("expiresAt"))
            .and_then(|v| v.as_i64())
        {
            return if now_ms() < exp {
                AuthState::LoggedIn
            } else {
                AuthState::Expired
            };
        }
        if let Some(tok) = oauth
            .and_then(|o| o.get("accessToken"))
            .and_then(|v| v.as_str())
        {
            if !tok.is_empty() {
                return AuthState::LoggedIn;
            }
        }
    }
    AuthState::LoggedOut
}

/// Codex: `~/.codex/auth.json` (OAuth tokens) or env `OPENAI_API_KEY`.
fn codex_auth() -> AuthState {
    if std::env::var("OPENAI_API_KEY").is_ok() {
        return AuthState::LoggedIn;
    }
    let Some(path) = home().map(|h| h.join(".codex").join("auth.json")) else {
        return AuthState::Unknown;
    };
    match std::fs::read_to_string(&path) {
        Ok(t) if t.contains("access_token") || t.contains("OPENAI_API_KEY") => AuthState::LoggedIn,
        Ok(_) => AuthState::LoggedOut,
        Err(_) => AuthState::LoggedOut,
    }
}

/// OpenCode: a single auth.json holding one or more provider credentials.
/// Windows: `%LOCALAPPDATA%\opencode\auth.json`; Unix: `~/.local/share/opencode/auth.json`.
fn opencode_auth() -> AuthState {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(d) = dirs::data_local_dir() {
        candidates.push(d.join("opencode").join("auth.json"));
    }
    if let Some(h) = home() {
        candidates.push(
            h.join(".local")
                .join("share")
                .join("opencode")
                .join("auth.json"),
        );
    }
    for p in candidates {
        if let Ok(meta) = std::fs::metadata(&p) {
            // An empty {} file is ~2 bytes; real credentials are larger.
            if meta.len() > 2 {
                return AuthState::LoggedIn;
            }
        }
    }
    AuthState::LoggedOut
}

/// Detect every supported AI provider: installed?, version, path, and a passive
/// auth heuristic. Drives the adaptive welcome wizard.
#[tauri::command]
pub fn detect_providers() -> IpcResponse {
    let mut providers = Vec::new();
    for &ptype in crate::providers::CLI_PROVIDERS {
        let Some(cfg) = get_cli_config(ptype) else {
            continue;
        };
        let tool = detect_tool(cfg.command);
        let installed = tool.available;
        let auth_state = detect_auth(ptype, installed);
        let ready = installed && auth_state == AuthState::LoggedIn;
        providers.push(ProviderStatus {
            provider_type: ptype.to_string(),
            display_name: cfg.display_name.to_string(),
            command: cfg.command.to_string(),
            installed,
            version: tool.version,
            path: tool.path,
            auth_state,
            ready,
        });
    }
    IpcResponse::ok(serde_json::json!({ "providers": providers }))
}

// ---------------------------------------------------------------------------
// Live auth probe (Phase 3)
// ---------------------------------------------------------------------------

/// Run a read-only status command and capture (success, combined output).
/// stdin is nulled so a misbehaving CLI can't hang waiting for input.
fn run_capture(cmdline: &str) -> Option<(bool, String)> {
    let output = if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", cmdline])
            .stdin(std::process::Stdio::null());
        crate::util::hidden(&mut cmd);
        cmd.output()
    } else {
        std::process::Command::new("sh")
            .args(["-c", cmdline])
            .stdin(std::process::Stdio::null())
            .output()
    }
    .ok()?;
    let mut s = String::from_utf8_lossy(&output.stdout).to_string();
    s.push_str(&String::from_utf8_lossy(&output.stderr));
    Some((output.status.success(), s))
}

/// Reliable per-provider auth check via the CLI's own read-only `status`
/// subcommand (verified to exist + be non-interactive). Unlike the file
/// heuristic, this catches expired/refreshed tokens accurately. Still safe:
/// `status` never opens a browser or spends quota.
fn probe_auth(provider_type: &str) -> AuthState {
    match provider_type {
        "claude" => probe_claude(),
        "codex" => probe_codex(),
        "opencode" => probe_opencode(),
        // gemini (gcloud/ADC) and kimi: no verified non-interactive probe yet.
        _ => AuthState::Unknown,
    }
}

fn probe_claude() -> AuthState {
    let Some((_ok, out)) = run_capture("claude auth status --json") else {
        return AuthState::Unknown;
    };
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(out.trim()) {
        if let Some(b) = json.get("loggedIn").and_then(|v| v.as_bool()) {
            return if b { AuthState::LoggedIn } else { AuthState::LoggedOut };
        }
    }
    if out.contains("\"loggedIn\": true") || out.contains("\"loggedIn\":true") {
        AuthState::LoggedIn
    } else if out.contains("loggedIn") {
        AuthState::LoggedOut
    } else {
        AuthState::Unknown
    }
}

fn probe_codex() -> AuthState {
    let Some((ok, out)) = run_capture("codex login status") else {
        return AuthState::Unknown;
    };
    let low = out.to_lowercase();
    // Check the negatives FIRST: "not logged in" contains the substring
    // "logged in", so a naive positive check would misfire.
    if low.contains("not logged in")
        || low.contains("not authenticated")
        || low.contains("unauthorized")
    {
        AuthState::LoggedOut
    } else if low.contains("logged in") {
        AuthState::LoggedIn
    } else if ok {
        AuthState::LoggedIn
    } else {
        AuthState::LoggedOut
    }
}

fn probe_opencode() -> AuthState {
    let Some((ok, out)) = run_capture("opencode auth list") else {
        return AuthState::Unknown;
    };
    if !ok {
        return AuthState::LoggedOut;
    }
    let low = out.to_lowercase();
    if low.contains("anthropic")
        || low.contains("openai")
        || low.contains("openrouter")
        || low.contains("credentials")
    {
        AuthState::LoggedIn
    } else {
        AuthState::LoggedOut
    }
}

/// Live-probe a single provider's auth state (slower than the file heuristic;
/// the wizard calls this lazily, in parallel, to refine the initial detection).
#[tauri::command]
pub async fn probe_provider_auth(params: InstallProviderParams) -> IpcResponse {
    let ptype = params.provider_type;
    let state = tokio::task::spawn_blocking(move || probe_auth(&ptype))
        .await
        .unwrap_or(AuthState::Unknown);
    IpcResponse::ok(serde_json::json!({ "authState": state }))
}

// ---------------------------------------------------------------------------
// One-click install (Phase 2)
// ---------------------------------------------------------------------------

/// How to install a given provider's CLI.
enum InstallMethod {
    /// `npm install -g <package>`
    Npm(&'static str),
    /// `pip install <package>`
    Pip(&'static str),
}

fn install_spec(provider_type: &str) -> Option<InstallMethod> {
    match provider_type {
        "claude" => Some(InstallMethod::Npm("@anthropic-ai/claude-code")),
        "opencode" => Some(InstallMethod::Npm("opencode-ai")),
        "codex" => Some(InstallMethod::Npm("@openai/codex")),
        "gemini-cli" => Some(InstallMethod::Npm("@google/gemini-cli")),
        "kimi-cli" => Some(InstallMethod::Pip("kimi-cli")),
        _ => None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProviderParams {
    pub provider_type: String,
}

/// Install a provider's CLI via its package manager, then re-detect it.
///
/// Output is logged to the Output system (MCP/App channel) so it's inspectable.
/// NOTE on PATH: installing a package into an *existing* global bin dir (the
/// common case) is detectable immediately, since that dir is already on PATH.
/// Only if the package manager itself was just installed would a restart be
/// needed — the `detected` flag in the response tells the UI which case it is.
#[tauri::command]
pub async fn install_provider(params: InstallProviderParams) -> IpcResponse {
    let ptype = params.provider_type;
    let Some(spec) = install_spec(&ptype) else {
        return IpcResponse::err(format!("No install method known for '{}'", ptype));
    };
    let Some(cfg) = get_cli_config(&ptype) else {
        return IpcResponse::err(format!("Unknown provider '{}'", ptype));
    };
    let command = cfg.command.to_string();

    let (tool, pkg): (&str, &str) = match spec {
        InstallMethod::Npm(p) => ("npm", p),
        InstallMethod::Pip(p) => ("pip", p),
    };

    // Require the package manager up front, with an actionable message.
    if !is_cli_available(tool) {
        let req = if tool == "npm" { "Node.js (npm)" } else { "Python (pip)" };
        return IpcResponse::err(format!(
            "{} is required to install {}. Install it first, then try again.",
            req, cfg.display_name
        ));
    }

    let ptype_log = ptype.clone();
    let tool_owned = tool.to_string();
    let pkg_owned = pkg.to_string();

    // Run the (potentially slow) installer off the async runtime.
    let output = tokio::task::spawn_blocking(move || {
        let install_args = if tool_owned == "npm" {
            format!("{} install -g {}", tool_owned, pkg_owned)
        } else {
            format!("{} install {}", tool_owned, pkg_owned)
        };
        // npm/pip are shims on Windows → must run through cmd.
        if cfg!(target_os = "windows") {
            let mut cmd = std::process::Command::new("cmd");
            cmd.args(["/C", &install_args]);
            crate::util::hidden(&mut cmd);
            cmd.output()
        } else {
            std::process::Command::new("sh")
                .args(["-c", &install_args])
                .output()
        }
    })
    .await;

    let output = match output {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return IpcResponse::err(format!("Failed to launch installer: {}", e)),
        Err(e) => return IpcResponse::err(format!("Install task failed: {}", e)),
    };

    let mut combined = String::from_utf8_lossy(&output.stdout).to_string();
    combined.push_str(&String::from_utf8_lossy(&output.stderr));
    for line in combined.lines() {
        tracing::info!(target: "voice_mirror_lib::mcp::install", "[install {}] {}", ptype_log, line);
    }

    let success = output.status.success();
    // Re-detect: usually succeeds immediately (existing global bin dir on PATH).
    let detected = detect_tool(&command).available;
    // Last few lines as a tail for the UI.
    let tail: String = combined
        .lines()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    if !success {
        return IpcResponse::err(if tail.is_empty() {
            format!("Install of {} failed.", cfg.display_name)
        } else {
            format!("Install of {} failed:\n{}", cfg.display_name, tail)
        });
    }

    IpcResponse::ok(serde_json::json!({
        "success": true,
        "detected": detected,
        "message": tail,
    }))
}
