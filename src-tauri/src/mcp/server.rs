//! MCP JSON-RPC protocol handler over stdio.
//!
//! Reads JSON-RPC requests from stdin, routes tool calls to the appropriate
//! handler, and sends JSON-RPC responses to stdout. Implements the MCP protocol
//! methods: `initialize`, `initialized`, `tools/list`, `tools/call`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::{error, info};

use super::handlers;
use super::handlers::McpToolResult;
use super::tools::ToolRegistry;

use crate::ipc::pipe_client::PipeClient;

// ---------------------------------------------------------------------------
// JSON-RPC message types
// ---------------------------------------------------------------------------

/// Incoming JSON-RPC request.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// Outgoing JSON-RPC response.
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

/// JSON-RPC error object.
#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

/// Outgoing JSON-RPC notification (no id).
/// Used for sending tools/list_changed notifications.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct JsonRpcNotification {
    jsonrpc: String,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

impl JsonRpcResponse {
    fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/// Shared server state.
pub struct McpServerState {
    registry: ToolRegistry,
    data_dir: std::path::PathBuf,
    /// Optional named pipe client for fast IPC with the Tauri app.
    pipe: Option<Arc<PipeClient>>,
}

/// Run the MCP server on stdin/stdout.
///
/// This is the main entry point. It reads JSON-RPC messages line-by-line from
/// stdin, dispatches them, and writes responses to stdout. Diagnostic logs go
/// to stderr.
///
/// The optional `pipe` parameter enables fast named-pipe IPC for voice_send/voice_listen.
/// When `None`, the server falls back to file-based IPC (inbox.json).
pub async fn run_server(
    data_dir: std::path::PathBuf,
    pipe: Option<Arc<PipeClient>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure data directory exists
    tokio::fs::create_dir_all(&data_dir).await?;

    let state = Arc::new(Mutex::new(McpServerState {
        registry: ToolRegistry::new(),
        data_dir,
        pipe,
    }));

    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let reader = BufReader::new(stdin);
    let mut writer = stdout;
    let mut lines = reader.lines();

    eprintln!("Voice Mirror MCP server (Rust) running");

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        // Parse JSON-RPC request
        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                let resp = JsonRpcResponse::error(
                    Value::Null,
                    -32700, // Parse error
                    format!("Invalid JSON: {}", e),
                );
                write_response(&mut writer, &resp).await;
                continue;
            }
        };

        // Validate JSON-RPC version
        if request.jsonrpc != "2.0" {
            if let Some(id) = request.id {
                let resp = JsonRpcResponse::error(id, -32600, "Invalid JSON-RPC version");
                write_response(&mut writer, &resp).await;
            }
            continue;
        }

        let _id = request.id.clone().unwrap_or(Value::Null);
        let response = handle_request(state.clone(), &request).await;

        // Notifications (no id) don't get a response
        if request.id.is_none() {
            continue;
        }

        match response {
            Some(resp) => {
                write_response(&mut writer, &resp).await;
            }
            None => {
                // Method handled as notification, no response needed
            }
        }
    }

    eprintln!("MCP server stdin closed, shutting down");
    Ok(())
}

/// Handle a single JSON-RPC request and return a response.
async fn handle_request(
    state: Arc<Mutex<McpServerState>>,
    request: &JsonRpcRequest,
) -> Option<JsonRpcResponse> {
    let id = request.id.clone().unwrap_or(Value::Null);

    match request.method.as_str() {
        "initialize" => Some(handle_initialize(id)),
        "initialized" => {
            info!("[MCP] Client sent 'initialized' notification");
            None // notification, no response
        }
        "tools/list" => {
            let state = state.lock().await;
            Some(handle_tools_list(id, &state))
        }
        "tools/call" => {
            let response = handle_tools_call(state.clone(), id.clone(), &request.params).await;
            Some(response)
        }
        "notifications/cancelled" => {
            // Client cancelled a request -- just log it
            info!("[MCP] Request cancelled: {:?}", request.params);
            None
        }
        _ => Some(JsonRpcResponse::error(
            id,
            -32601, // Method not found
            format!("Unknown method: {}", request.method),
        )),
    }
}

/// Handle `initialize` -- return server capabilities.
fn handle_initialize(id: Value) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {
                    "listChanged": true
                }
            },
            "serverInfo": {
                "name": "voice-mirror-electron",
                "version": "1.0.0"
            }
        }),
    )
}

/// Handle `tools/list` -- return currently loaded tool definitions.
fn handle_tools_list(id: Value, state: &McpServerState) -> JsonRpcResponse {
    let tools = state.registry.list_tools();
    let tool_values: Vec<Value> = tools
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.input_schema,
            })
        })
        .collect();

    JsonRpcResponse::success(id, json!({ "tools": tool_values }))
}

/// Handle `tools/call` -- dispatch to the appropriate tool handler.
async fn handle_tools_call(
    state: Arc<Mutex<McpServerState>>,
    id: Value,
    params: &Value,
) -> JsonRpcResponse {
    let tool_name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    if tool_name.is_empty() {
        return JsonRpcResponse::error(id, -32602, "Missing tool name in params");
    }

    // Record tool call and get data_dir + pipe
    let (data_dir, is_destructive, pipe) = {
        let mut state = state.lock().await;
        state.registry.record_tool_call(&tool_name);
        (
            state.data_dir.clone(),
            state.registry.is_destructive(&tool_name),
            state.pipe.clone(),
        )
    };

    // Check destructive tool confirmation
    if is_destructive {
        let confirmed = args.get("confirmed").and_then(|v| v.as_bool()).unwrap_or(false);
        if !confirmed {
            let result = McpToolResult::text(format!(
                "CONFIRMATION REQUIRED: \"{}\" is a destructive operation.\n\
                 Ask the user for voice confirmation before proceeding.\n\
                 To execute, call {} again with confirmed: true in the arguments.",
                tool_name, tool_name
            ));
            return JsonRpcResponse::success(id, serde_json::to_value(&result).unwrap());
        }
    }

    // Route to handler
    let result = route_tool_call(&tool_name, &args, &data_dir, state.clone(), pipe.as_ref()).await;

    // After tool execution, check for idle groups
    {
        let mut state = state.lock().await;
        let unloaded = state.registry.auto_unload_idle();
        if !unloaded.is_empty() {
            // In a full implementation we'd send a tools/list_changed notification here.
            // For now, just log it.
            info!("[MCP] Auto-unloaded idle groups: {:?}", unloaded);
        }
    }

    JsonRpcResponse::success(id, serde_json::to_value(&result).unwrap())
}

/// Route a tool call to the appropriate handler module.
async fn route_tool_call(
    name: &str,
    args: &Value,
    data_dir: &std::path::Path,
    state: Arc<Mutex<McpServerState>>,
    pipe: Option<&Arc<PipeClient>>,
) -> McpToolResult {
    match name {
        // ---- Meta tools ----
        "load_tools" => {
            let group = args.get("group").and_then(|v| v.as_str()).unwrap_or("");
            if group.is_empty() {
                return McpToolResult::error("Error: group is required");
            }
            let mut state = state.lock().await;
            match state.registry.load_group(group) {
                Ok(tool_names) => McpToolResult::text(format!(
                    "Loaded tool group \"{}\" ({} tools):\n{}",
                    group,
                    tool_names.len(),
                    tool_names.join(", ")
                )),
                Err(e) => McpToolResult::error(e),
            }
        }
        "unload_tools" => {
            let group = args.get("group").and_then(|v| v.as_str()).unwrap_or("");
            if group.is_empty() {
                return McpToolResult::error("Error: group is required");
            }
            let mut state = state.lock().await;
            match state.registry.unload_group(group) {
                Ok(count) => McpToolResult::text(format!(
                    "Unloaded tool group \"{}\". {} tools removed from context.",
                    group, count
                )),
                Err(e) => McpToolResult::error(e),
            }
        }
        "list_tool_groups" => {
            let state = state.lock().await;
            let groups = state.registry.list_groups();
            let mut lines = vec!["=== Tool Groups ===".to_string(), String::new()];
            for g in &groups {
                lines.push(format!(
                    "[{}] {} ({} tools) -- {}",
                    g.status, g.name, g.tool_count, g.description
                ));
                lines.push(format!("  Tools: {}", g.tool_names.join(", ")));
                lines.push(String::new());
            }
            McpToolResult::text(lines.join("\n"))
        }

        // ---- Core tools ----
        "voice_send" => handlers::core::handle_voice_send(args, data_dir, pipe).await,
        "voice_inbox" => {
            let result = handlers::core::handle_voice_inbox(args, data_dir).await;
            // Auto-load by intent based on inbox messages
            // (For simplicity, we do this after returning the result.
            //  The Node.js version does it inline.)
            result
        }
        "voice_listen" => handlers::core::handle_voice_listen(args, data_dir, pipe).await,
        "voice_status" => handlers::core::handle_voice_status(args, data_dir).await,

        // ---- Memory tools ----
        "memory_search" => handlers::memory::handle_memory_search(args, data_dir).await,
        "memory_get" => handlers::memory::handle_memory_get(args, data_dir).await,
        "memory_remember" => handlers::memory::handle_memory_remember(args, data_dir).await,
        "memory_forget" => handlers::memory::handle_memory_forget(args, data_dir).await,
        "memory_stats" => handlers::memory::handle_memory_stats(args, data_dir).await,
        "memory_flush" => handlers::memory::handle_memory_flush(args, data_dir).await,

        // ---- Screen tools ----
        "capture_screen" => handlers::screen::handle_capture_screen(args, data_dir).await,

        // ---- Browser tools ----
        "browser_start" => handlers::browser::handle_browser_start(args, data_dir).await,
        "browser_stop" => handlers::browser::handle_browser_stop(args, data_dir).await,
        "browser_status" => handlers::browser::handle_browser_status(args, data_dir).await,
        "browser_tabs" => handlers::browser::handle_browser_tabs(args, data_dir).await,
        "browser_open" => handlers::browser::handle_browser_open(args, data_dir).await,
        "browser_close_tab" => handlers::browser::handle_browser_close_tab(args, data_dir).await,
        "browser_focus" => handlers::browser::handle_browser_focus(args, data_dir).await,
        "browser_navigate" => handlers::browser::handle_browser_navigate(args, data_dir).await,
        "browser_screenshot" => handlers::browser::handle_browser_screenshot(args, data_dir).await,
        "browser_snapshot" => handlers::browser::handle_browser_snapshot(args, data_dir).await,
        "browser_act" => handlers::browser::handle_browser_act(args, data_dir).await,
        "browser_console" => handlers::browser::handle_browser_console(args, data_dir).await,
        "browser_search" => handlers::browser::handle_browser_search(args, data_dir).await,
        "browser_fetch" => handlers::browser::handle_browser_fetch(args, data_dir).await,
        "browser_cookies" => handlers::browser::handle_browser_cookies(args, data_dir).await,
        "browser_storage" => handlers::browser::handle_browser_storage(args, data_dir).await,

        // ---- n8n tools ----
        "n8n_list_workflows" => handlers::n8n::handle_n8n_list_workflows(args, data_dir).await,
        "n8n_get_workflow" => handlers::n8n::handle_n8n_get_workflow(args, data_dir).await,
        "n8n_create_workflow" => handlers::n8n::handle_n8n_create_workflow(args, data_dir).await,
        "n8n_update_workflow" => handlers::n8n::handle_n8n_update_workflow(args, data_dir).await,
        "n8n_delete_workflow" => handlers::n8n::handle_n8n_delete_workflow(args, data_dir).await,
        "n8n_validate_workflow" => handlers::n8n::handle_n8n_validate_workflow(args, data_dir).await,
        "n8n_trigger_workflow" => handlers::n8n::handle_n8n_trigger_workflow(args, data_dir).await,
        "n8n_deploy_template" => handlers::n8n::handle_n8n_deploy_template(args, data_dir).await,
        "n8n_get_executions" => handlers::n8n::handle_n8n_get_executions(args, data_dir).await,
        "n8n_get_execution" => handlers::n8n::handle_n8n_get_execution(args, data_dir).await,
        "n8n_delete_execution" => handlers::n8n::handle_n8n_delete_execution(args, data_dir).await,
        "n8n_retry_execution" => handlers::n8n::handle_n8n_retry_execution(args, data_dir).await,
        "n8n_list_credentials" => handlers::n8n::handle_n8n_list_credentials(args, data_dir).await,
        "n8n_create_credential" => handlers::n8n::handle_n8n_create_credential(args, data_dir).await,
        "n8n_delete_credential" => handlers::n8n::handle_n8n_delete_credential(args, data_dir).await,
        "n8n_get_credential_schema" => handlers::n8n::handle_n8n_get_credential_schema(args, data_dir).await,
        "n8n_search_nodes" => handlers::n8n::handle_n8n_search_nodes(args, data_dir).await,
        "n8n_get_node" => handlers::n8n::handle_n8n_get_node(args, data_dir).await,
        "n8n_list_tags" => handlers::n8n::handle_n8n_list_tags(args, data_dir).await,
        "n8n_create_tag" => handlers::n8n::handle_n8n_create_tag(args, data_dir).await,
        "n8n_delete_tag" => handlers::n8n::handle_n8n_delete_tag(args, data_dir).await,
        "n8n_list_variables" => handlers::n8n::handle_n8n_list_variables(args, data_dir).await,

        // ---- Diagnostic tools ----
        "pipeline_trace" => handlers::diagnostic::handle_pipeline_trace(args, data_dir).await,

        // ---- Facade tools (voice mode) ----
        "memory_manage" => handlers::facades::handle_memory_manage(args, data_dir).await,
        "n8n_manage" => handlers::facades::handle_n8n_manage(args, data_dir).await,
        "browser_manage" => handlers::facades::handle_browser_manage(args, data_dir).await,

        // ---- Voice clone tools ----
        "clone_voice" => handlers::voice_clone::handle_clone_voice(args, data_dir).await,
        "clear_voice_clone" => handlers::voice_clone::handle_clear_voice_clone(args, data_dir).await,
        "list_voice_clones" => handlers::voice_clone::handle_list_voice_clones(args, data_dir).await,

        _ => McpToolResult::error(format!("Unknown tool: {}", name)),
    }
}

/// Write a JSON-RPC response to stdout (one line).
async fn write_response<W: AsyncWriteExt + Unpin>(writer: &mut W, response: &JsonRpcResponse) {
    match serde_json::to_string(response) {
        Ok(json) => {
            let line = format!("{}\n", json);
            if let Err(e) = writer.write_all(line.as_bytes()).await {
                error!("[MCP] Failed to write response: {}", e);
            }
            if let Err(e) = writer.flush().await {
                error!("[MCP] Failed to flush stdout: {}", e);
            }
        }
        Err(e) => {
            error!("[MCP] Failed to serialize response: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_rpc_response_success() {
        let resp = JsonRpcResponse::success(json!(1), json!({"result": "ok"}));
        let serialized = serde_json::to_string(&resp).unwrap();
        assert!(serialized.contains("\"result\""));
        assert!(!serialized.contains("\"error\""));
    }

    #[test]
    fn test_json_rpc_response_error() {
        let resp = JsonRpcResponse::error(json!(1), -32600, "bad request");
        let serialized = serde_json::to_string(&resp).unwrap();
        assert!(serialized.contains("\"error\""));
        assert!(serialized.contains("-32600"));
    }

    #[test]
    fn test_handle_initialize() {
        let resp = handle_initialize(json!(1));
        let result = resp.result.unwrap();
        assert_eq!(result["serverInfo"]["name"], "voice-mirror-electron");
        assert!(result["capabilities"]["tools"]["listChanged"].as_bool().unwrap());
    }

    #[test]
    fn test_handle_tools_list() {
        let state = McpServerState {
            registry: ToolRegistry::new(),
            data_dir: std::path::PathBuf::from("/tmp/test"),
            pipe: None,
        };
        let resp = handle_tools_list(json!(1), &state);
        let result = resp.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        // Default: core (4) + meta (3) = 7
        assert_eq!(tools.len(), 7);
    }

    #[test]
    fn test_parse_json_rpc_request() {
        let json = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.method, "tools/list");
        assert_eq!(req.id, Some(json!(1)));
    }
}
