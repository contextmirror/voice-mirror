//! MCP server management commands — write, delete.

use super::IpcResponse;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use tracing::info;

// ── Write/upsert an MCP server to a config file ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpWriteParams {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
    /// "global" or an absolute project path
    pub scope: String,
}

#[tauri::command]
pub fn mcp_write_server(params: McpWriteParams) -> IpcResponse {
    let path = resolve_config_path(&params.scope);

    let mut config = match read_config_file(&path) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(e),
    };

    if !config["mcpServers"].is_object() {
        config["mcpServers"] = serde_json::json!({});
    }

    let mut entry = serde_json::json!({
        "command": params.command,
    });
    if !params.args.is_empty() {
        entry["args"] = serde_json::json!(params.args);
    }
    if let Some(ref env) = params.env {
        if !env.is_empty() {
            entry["env"] = serde_json::json!(env);
        }
    }

    config["mcpServers"][&params.name] = entry;

    match write_config_file(&path, &config) {
        Ok(()) => {
            info!("Wrote MCP server '{}' to {}", params.name, path.display());
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(e),
    }
}

// ── Delete an MCP server from a config file ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDeleteParams {
    pub name: String,
    pub scope: String,
}

#[tauri::command]
pub fn mcp_delete_server(params: McpDeleteParams) -> IpcResponse {
    let path = resolve_config_path(&params.scope);

    if !path.exists() {
        return IpcResponse::err(format!("Config file not found: {}", path.display()));
    }

    let mut config = match read_config_file(&path) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(e),
    };

    if let Some(servers) = config["mcpServers"].as_object_mut() {
        if servers.remove(&params.name).is_none() {
            return IpcResponse::err(format!(
                "Server '{}' not found in {}",
                params.name,
                path.display()
            ));
        }
    } else {
        return IpcResponse::err(format!("No mcpServers in {}", path.display()));
    }

    match write_config_file(&path, &config) {
        Ok(()) => {
            info!(
                "Deleted MCP server '{}' from {}",
                params.name,
                path.display()
            );
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(e),
    }
}

// ── Helpers ──

fn resolve_config_path(scope: &str) -> std::path::PathBuf {
    if scope == "global" {
        dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(".claude")
            .join("settings.json")
    } else {
        Path::new(scope).join(".mcp.json")
    }
}

fn read_config_file(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Could not parse {}. Please fix it manually: {}", path.display(), e))
}

fn write_config_file(path: &Path, config: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
        }
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(path, &json)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(())
}
