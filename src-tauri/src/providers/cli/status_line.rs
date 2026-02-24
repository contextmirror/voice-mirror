//! Claude-Pulse status line configuration for Claude Code.

use tracing::{info, warn};

/// Configure claude-pulse status line for Claude Code.
///
/// Writes the `statusLine` entry to `~/.claude/settings.json` so Claude Code
/// shows usage bars in the terminal. Also installs `/pulse` and `/setup` slash commands.
///
/// Configure the Claude Code status line for Voice Mirror integration.
pub fn configure_status_line(project_root: &std::path::Path) {
    let script_path = project_root
        .join("vendor")
        .join("claude-pulse")
        .join("claude_status.py");

    if !script_path.exists() {
        info!("claude-pulse script not found at {}, skipping status line config", script_path.display());
        return;
    }

    // Use system Python
    let python_exe = if cfg!(target_os = "windows") { "python" } else { "python3" };

    // Normalize path for the JSON command string (forward slashes work everywhere)
    let script_path_str = script_path.to_string_lossy().replace('\\', "/");

    let Some(home) = dirs::home_dir() else {
        warn!("Could not determine home directory for status line config");
        return;
    };

    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    // Read existing settings
    let mut settings: serde_json::Value = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Check if statusLine already points to a claude_status.py
    let already_configured = settings["statusLine"]["command"]
        .as_str()
        .map(|c| c.contains("claude_status.py"))
        .unwrap_or(false);

    let mut changed = false;

    if already_configured {
        info!("claude-pulse status line already configured, skipping");
    } else {
        // Write full statusLine config (no quotes around path — simple format works on all platforms)
        settings["statusLine"] = serde_json::json!({
            "type": "command",
            "command": format!("COLUMNS=200 {} {}", python_exe, script_path_str)
        });
        changed = true;
        info!("claude-pulse status line configured");
    }

    if changed {
        match serde_json::to_string_pretty(&settings) {
            Ok(s) => {
                if let Err(e) = std::fs::write(&settings_path, &s) {
                    warn!("Failed to write settings.json for status line: {}", e);
                }
            }
            Err(e) => warn!("Failed to serialize settings.json: {}", e),
        }
    }

    // Install slash commands (if not already present)
    let commands_dir = claude_dir.join("commands");
    let _ = std::fs::create_dir_all(&commands_dir);

    let commands_src_dir = project_root
        .join("vendor")
        .join("claude-pulse")
        .join("commands");

    for cmd_file in &["pulse.md", "setup.md"] {
        let dest = commands_dir.join(cmd_file);
        if !dest.exists() {
            let src = commands_src_dir.join(cmd_file);
            if src.exists() {
                if let Err(e) = std::fs::copy(&src, &dest) {
                    warn!("Failed to install slash command {}: {}", cmd_file, e);
                } else {
                    info!("Installed slash command: {}", cmd_file);
                }
            }
        }
    }
}
