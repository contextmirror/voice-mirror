//! MCP server configuration for CLI providers.
//!
//! Writes MCP config files so CLI providers (Claude Code, OpenCode)
//! have access to Voice Mirror tools.

use std::path::PathBuf;

use tracing::{info, warn};

/// Write MCP server configuration for CLI providers that support MCP.
///
/// For **Claude Code**: removes stale entries from `~/.claude/settings.json`
/// and writes `{project_root}/.mcp.json` (project-level config).
///
/// For **OpenCode**: merges into `~/.config/opencode/opencode.json` using
/// OpenCode's `mcp` config format (type: "local", command array, environment).
///
/// If `cwd_override` is provided (and differs from `project_root`), also writes
/// `.mcp.json` to that directory so Claude Code finds MCP tools when starting
/// in a non-Voice-Mirror project.
///
/// The `enabled_groups` parameter comes from the user's configured tool profile.
pub fn write_mcp_config(project_root: &std::path::Path, enabled_groups: &str, cwd_override: Option<&PathBuf>) -> Result<(), String> {
    // Resolve the Rust MCP binary
    let mcp_binary = resolve_mcp_binary(project_root)?;
    let binary_path_str = mcp_binary.to_string_lossy().replace('\\', "/");

    // Resolve the MCP data directory — this is where inbox.json, status.json, etc. live.
    let mcp_data_dir = get_mcp_data_dir_for_env();
    let mcp_data_dir_str = mcp_data_dir.to_string_lossy().replace('\\', "/");

    // Build env vars
    let mut env_vars = serde_json::json!({
        "ENABLED_GROUPS": enabled_groups,
        "VOICE_MIRROR_DATA_DIR": mcp_data_dir_str
    });

    // Add pipe name if the pipe server is running
    if let Some(pipe_name) = crate::ipc::get_pipe_name() {
        env_vars["VOICE_MIRROR_PIPE"] = serde_json::json!(pipe_name);
    }

    let voice_mirror_entry = serde_json::json!({
        "command": binary_path_str,
        "args": [],
        "env": env_vars,
        "disabled": false
    });

    // --- 1. Remove voice-mirror from ~/.claude/settings.json ---
    //
    // We used to merge voice-mirror into settings.json, but this caused Claude Code
    // to find the MCP server in BOTH settings.json (global) AND .mcp.json (project).
    // Claude Code starts two MCP binary instances — the second hangs because the
    // pipe server only accepts one client, blocking Claude Code's startup forever.
    //
    // Now we ONLY use .mcp.json in the CWD (written below). Remove any stale entry
    // from settings.json to prevent duplication.
    if let Some(home) = dirs::home_dir() {
        let settings_path = home.join(".claude").join("settings.json");
        if settings_path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&settings_path) {
                if let Ok(mut settings) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if settings["mcpServers"].get("voice-mirror").is_some() {
                        settings["mcpServers"]
                            .as_object_mut()
                            .unwrap()
                            .remove("voice-mirror");
                        if let Ok(s) = serde_json::to_string_pretty(&settings) {
                            let _ = std::fs::write(&settings_path, &s);
                            info!("Removed voice-mirror from {} (using .mcp.json instead)", settings_path.display());
                        }
                    }
                }
            }
        }
    }

    // --- 2. Write {project_root}/.mcp.json (project-level fallback) ---
    let project_mcp = serde_json::json!({
        "mcpServers": {
            "voice-mirror": voice_mirror_entry
        }
    });
    let project_mcp_path = project_root.join(".mcp.json");
    match serde_json::to_string_pretty(&project_mcp) {
        Ok(s) => match std::fs::write(&project_mcp_path, &s) {
            Ok(()) => info!("Wrote project MCP config to {}", project_mcp_path.display()),
            Err(e) => warn!("Failed to write {}: {}", project_mcp_path.display(), e),
        },
        Err(e) => warn!("Failed to serialize .mcp.json: {}", e),
    }

    // --- 3. Write .mcp.json to CWD if it differs from project root ---
    //
    // When Claude Code starts in a non-Voice-Mirror directory, it won't find
    // the project-level .mcp.json. Writing one to the CWD ensures MCP tools
    // are always available regardless of working directory.
    if let Some(cwd) = cwd_override {
        if cwd.exists() {
            let cwd_mcp_path = cwd.join(".mcp.json");
            let cwd_mcp = serde_json::json!({
                "mcpServers": {
                    "voice-mirror": voice_mirror_entry
                }
            });
            match serde_json::to_string_pretty(&cwd_mcp) {
                Ok(s) => match std::fs::write(&cwd_mcp_path, &s) {
                    Ok(()) => info!("Wrote CWD MCP config to {}", cwd_mcp_path.display()),
                    Err(e) => warn!("Failed to write CWD .mcp.json {}: {}", cwd_mcp_path.display(), e),
                },
                Err(e) => warn!("Failed to serialize CWD .mcp.json: {}", e),
            }

            // Also write .claude/settings.local.json to auto-trust the MCP server.
            // Without this, Claude Code prompts "trust this MCP server?" on first run
            // in the directory, blocking startup since the prompt is invisible in
            // the Voice Agent panel.
            ensure_claude_mcp_trust(cwd);
        }
    }

    // Also ensure trust in the project root
    ensure_claude_mcp_trust(project_root);

    // --- 4. Merge into OpenCode config (~/.config/opencode/opencode.json) ---
    //
    // OpenCode (anomalyco/opencode) uses xdg-basedir which resolves to
    // `$HOME/.config/opencode/` on ALL platforms (including Windows).
    // This is NOT the same as `dirs::config_dir()` on Windows (AppData\Roaming).
    //
    // MCP format (schema is strict — no extra properties allowed):
    //   { "mcp": { "voice-mirror": { "type": "local", "command": ["path"], "environment": {...} } } }
    //
    // We merge non-destructively — only the voice-mirror key is touched.
    if let Some(home) = dirs::home_dir() {
        let opencode_dir = home.join(".config").join("opencode");
        if !opencode_dir.exists() {
            let _ = std::fs::create_dir_all(&opencode_dir);
        }

        // OpenCode checks opencode.jsonc, opencode.json, config.json (in that order).
        // We read from existing opencode.json or opencode.jsonc, write to opencode.json.
        let opencode_config_path = opencode_dir.join("opencode.json");
        let existing_path = if opencode_config_path.exists() {
            Some(opencode_config_path.clone())
        } else {
            let jsonc_path = opencode_dir.join("opencode.jsonc");
            let config_path = opencode_dir.join("config.json");
            if jsonc_path.exists() {
                Some(jsonc_path)
            } else if config_path.exists() {
                Some(config_path)
            } else {
                None
            }
        };

        // Read existing OpenCode config (or start fresh)
        let mut oc_config: serde_json::Value = if let Some(ref path) = existing_path {
            let raw = std::fs::read_to_string(path)
                .unwrap_or_else(|_| "{}".to_string());
            // Strip JSONC line comments (// ...) for basic compatibility
            let stripped: String = raw.lines()
                .map(|line| {
                    if let Some(idx) = line.find("//") {
                        // Only strip if // is outside a string (simple heuristic: before any quote)
                        let before = &line[..idx];
                        if before.chars().filter(|&c| c == '"').count() % 2 == 0 {
                            return before;
                        }
                    }
                    line
                })
                .collect::<Vec<_>>()
                .join("\n");
            serde_json::from_str(&stripped).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        // Build OpenCode-format MCP entry (strict schema: only type, command, environment)
        let oc_voice_mirror = serde_json::json!({
            "type": "local",
            "command": [binary_path_str],
            "environment": env_vars
        });

        // Ensure mcp object exists, then upsert voice-mirror
        if !oc_config["mcp"].is_object() {
            oc_config["mcp"] = serde_json::json!({});
        }
        oc_config["mcp"]["voice-mirror"] = oc_voice_mirror;

        match serde_json::to_string_pretty(&oc_config) {
            Ok(s) => match std::fs::write(&opencode_config_path, &s) {
                Ok(()) => info!("Merged MCP config into {}", opencode_config_path.display()),
                Err(e) => warn!("Failed to write {}: {}", opencode_config_path.display(), e),
            },
            Err(e) => warn!("Failed to serialize opencode.json: {}", e),
        }
    }

    Ok(())
}

/// Get the MCP data directory path that the Node.js MCP server should use.
///
/// This matches the path used by `inbox_watcher.rs::get_mcp_data_dir()` —
/// both must agree on where inbox.json lives.
///
/// Currently: `{config_dir}/voice-mirror/data/`
pub fn get_mcp_data_dir_for_env() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror")
        .join("data")
}

/// Resolve the path to the `voice-mirror-mcp` binary.
///
/// Search order:
/// 1. Adjacent to the running executable (production / installed)
/// 2. `target/release/` under the Cargo project root (release build)
/// 3. `target/debug/` under the Cargo project root (dev build)
pub fn resolve_mcp_binary(project_root: &std::path::Path) -> Result<PathBuf, String> {
    let binary_name = if cfg!(windows) {
        "voice-mirror-mcp.exe"
    } else {
        "voice-mirror-mcp"
    };

    // 1. Check adjacent to the running executable (production deployment)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(binary_name);
            if candidate.exists() {
                info!("Found MCP binary adjacent to exe: {}", candidate.display());
                return Ok(candidate);
            }
        }
    }

    // 2. Check Cargo target directories (dev builds)
    let src_tauri = project_root.join("src-tauri");
    for profile in &["release", "debug"] {
        let candidate = src_tauri.join("target").join(profile).join(binary_name);
        if candidate.exists() {
            info!("Found MCP binary in target/{}: {}", profile, candidate.display());
            return Ok(candidate);
        }
    }

    // 3. Also check if we're already inside the src-tauri directory
    for profile in &["release", "debug"] {
        let candidate = PathBuf::from("target").join(profile).join(binary_name);
        if candidate.exists() {
            info!("Found MCP binary in local target/{}: {}", profile, candidate.display());
            return Ok(std::fs::canonicalize(&candidate).unwrap_or(candidate));
        }
    }

    Err(format!(
        "MCP binary '{}' not found. Build it with: cargo build --bin voice-mirror-mcp",
        binary_name
    ))
}

/// Ensure `.claude/settings.local.json` exists in the given directory with
/// MCP trust settings so Claude Code doesn't prompt for approval on startup.
fn ensure_claude_mcp_trust(dir: &std::path::Path) {
    let claude_dir = dir.join(".claude");
    let settings_path = claude_dir.join("settings.local.json");

    // Read existing settings or start fresh
    let mut settings: serde_json::Value = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Check if already configured
    let already_has_trust = settings["enableAllProjectMcpServers"].as_bool() == Some(true);
    let already_has_vm = settings["enabledMcpjsonServers"]
        .as_array()
        .map(|a| a.iter().any(|v| v.as_str() == Some("voice-mirror")))
        .unwrap_or(false);

    if already_has_trust && already_has_vm {
        return;
    }

    settings["enableAllProjectMcpServers"] = serde_json::json!(true);

    // Ensure voice-mirror is in the enabledMcpjsonServers list
    let servers = settings["enabledMcpjsonServers"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if !servers.iter().any(|v| v.as_str() == Some("voice-mirror")) {
        let mut servers = servers;
        servers.push(serde_json::json!("voice-mirror"));
        settings["enabledMcpjsonServers"] = serde_json::json!(servers);
    }

    if !claude_dir.exists() {
        let _ = std::fs::create_dir_all(&claude_dir);
    }

    match serde_json::to_string_pretty(&settings) {
        Ok(s) => match std::fs::write(&settings_path, &s) {
            Ok(()) => info!("Wrote Claude MCP trust to {}", settings_path.display()),
            Err(e) => warn!("Failed to write {}: {}", settings_path.display(), e),
        },
        Err(e) => warn!("Failed to serialize settings.local.json: {}", e),
    }
}
