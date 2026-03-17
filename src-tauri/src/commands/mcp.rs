//! MCP server management commands — write, delete, test connection.

use super::IpcResponse;
use serde::{Deserialize, Serialize};
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

// ── Test MCP server connection ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestParams {
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpTestResult {
    success: bool,
    tool_count: Option<u32>,
    server_name: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn mcp_test_connection(params: McpTestParams) -> IpcResponse {
    use std::io::{BufRead, Write};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    let mut cmd = Command::new(&params.command);
    cmd.args(&params.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref env) = params.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let result = McpTestResult {
                success: false,
                tool_count: None,
                server_name: None,
                error: Some(format!("Failed to start '{}': {}", params.command, e)),
            };
            return IpcResponse::ok(serde_json::to_value(result).unwrap());
        }
    };

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    let handle = std::thread::spawn(move || -> McpTestResult {
        let mut stdin = stdin;
        let mut reader = std::io::BufReader::new(stdout);

        let send = |stdin: &mut dyn Write, msg: &serde_json::Value| -> Result<(), String> {
            let s = serde_json::to_string(msg).map_err(|e| e.to_string())?;
            stdin.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
            stdin.write_all(b"\n").map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
            Ok(())
        };

        let recv =
            |reader: &mut std::io::BufReader<std::process::ChildStdout>| -> Result<serde_json::Value, String> {
                let mut line = String::new();
                reader.read_line(&mut line).map_err(|e| e.to_string())?;
                if line.is_empty() {
                    return Err("Server closed stdout".to_string());
                }
                serde_json::from_str(&line).map_err(|e| format!("Invalid JSON: {}", e))
            };

        // 1. Send initialize
        let init_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "voice-mirror-test", "version": "1.0" }
            }
        });
        if let Err(e) = send(&mut stdin, &init_req) {
            return McpTestResult {
                success: false,
                tool_count: None,
                server_name: None,
                error: Some(format!("Send initialize failed: {}", e)),
            };
        }

        // 2. Read initialize response
        let init_resp = match recv(&mut reader) {
            Ok(v) => v,
            Err(e) => {
                return McpTestResult {
                    success: false,
                    tool_count: None,
                    server_name: None,
                    error: Some(format!("Read initialize response failed: {}", e)),
                }
            }
        };

        let server_name = init_resp["result"]["serverInfo"]["name"]
            .as_str()
            .map(|s| s.to_string());

        // 3. Send initialized notification (required by MCP protocol)
        let initialized = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        if let Err(e) = send(&mut stdin, &initialized) {
            return McpTestResult {
                success: false,
                tool_count: None,
                server_name,
                error: Some(format!("Send initialized failed: {}", e)),
            };
        }

        // 4. Send tools/list
        let tools_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        });
        if let Err(e) = send(&mut stdin, &tools_req) {
            return McpTestResult {
                success: false,
                tool_count: None,
                server_name,
                error: Some(format!("Send tools/list failed: {}", e)),
            };
        }

        // 5. Read tools/list response
        let tools_resp = match recv(&mut reader) {
            Ok(v) => v,
            Err(e) => {
                return McpTestResult {
                    success: false,
                    tool_count: None,
                    server_name,
                    error: Some(format!("Read tools/list response failed: {}", e)),
                }
            }
        };

        let tool_count = tools_resp["result"]["tools"]
            .as_array()
            .map(|a| a.len() as u32);

        McpTestResult {
            success: true,
            tool_count,
            server_name,
            error: None,
        }
    });

    // Wait with 5s timeout
    let timeout = Duration::from_secs(5);
    let start = std::time::Instant::now();
    loop {
        if handle.is_finished() {
            break;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let result = McpTestResult {
                success: false,
                tool_count: None,
                server_name: None,
                error: Some("Server did not respond within 5 seconds".to_string()),
            };
            return IpcResponse::ok(serde_json::to_value(result).unwrap());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let _ = child.kill();
    let result = handle.join().unwrap_or_else(|_| McpTestResult {
        success: false,
        tool_count: None,
        server_name: None,
        error: Some("Test thread panicked".to_string()),
    });

    IpcResponse::ok(serde_json::to_value(result).unwrap())
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
