//! Onboarding: unified AI-provider detection for the first-run welcome wizard.
//!
//! Reports, for each supported CLI provider, whether it is installed (+version
//! +path) and an auth heuristic. Auth detection is **passive** — it inspects
//! known credential files only and never invokes the CLI (which could burn API
//! quota or pop a browser). Phase 1 uses cheap file-existence checks; a later
//! phase adds reliable live probes for the providers that need them.

use std::path::PathBuf;

use serde::Serialize;

use super::IpcResponse;
use crate::commands::tools::detect_tool;
use crate::providers::cli::get_cli_config;

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
        if oauth.and_then(|o| o.get("accessToken")).is_some() {
            return AuthState::LoggedIn;
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
