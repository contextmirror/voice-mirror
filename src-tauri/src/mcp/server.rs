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

use crate::mcp::pipe_router::PipeRouter;

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
    /// Optional pipe router for fast IPC with the Tauri app.
    /// Handles concurrent message routing (browser responses, user messages).
    router: Option<Arc<PipeRouter>>,
    /// Flag set when tool list changes (load/unload/auto-unload).
    /// The main loop checks this after each request to send notifications.
    tools_changed: bool,
}

/// Run the MCP server on stdin/stdout.
///
/// This is the main entry point. It reads JSON-RPC messages line-by-line from
/// stdin, dispatches them, and writes responses to stdout. Diagnostic logs go
/// to stderr.
///
/// The optional `router` parameter enables fast named-pipe IPC for voice_send/voice_listen
/// and browser tool requests. When `None`, the server falls back to file-based IPC (inbox.json).
///
/// The optional `enabled_groups` parameter (comma-separated group names from
/// `ENABLED_GROUPS` env var) pre-loads tool groups at startup so they appear
/// in the initial `tools/list` response.
pub async fn run_server(
    data_dir: std::path::PathBuf,
    router: Option<Arc<PipeRouter>>,
    enabled_groups: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure data directory exists
    tokio::fs::create_dir_all(&data_dir).await?;

    let mut registry = ToolRegistry::new();

    // Pre-load groups from ENABLED_GROUPS env var so they appear in
    // the initial tools/list handshake (BUG-005 Fix 1).
    if let Some(ref groups_str) = enabled_groups {
        registry.apply_enabled_groups(groups_str);
    }

    let state = Arc::new(Mutex::new(McpServerState {
        registry,
        data_dir,
        router,
        tools_changed: false,
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

        // Send tools/list_changed notification if tool list was modified
        // (BUG-005 Fix 2). This tells the MCP client to re-fetch tools/list.
        {
            let mut st = state.lock().await;
            if st.tools_changed {
                st.tools_changed = false;
                let notification = JsonRpcNotification {
                    jsonrpc: "2.0".into(),
                    method: "notifications/tools/list_changed".into(),
                    params: None,
                };
                write_notification(&mut writer, &notification).await;
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
                "name": "voice-mirror",
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

    // Record tool call and get data_dir + router
    let (data_dir, is_destructive, router) = {
        let mut state = state.lock().await;
        state.registry.record_tool_call(&tool_name);
        (
            state.data_dir.clone(),
            state.registry.is_destructive(&tool_name),
            state.router.clone(),
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
    let result = route_tool_call(&tool_name, &args, &data_dir, state.clone(), router.as_ref()).await;

    // After tool execution, check for idle groups
    {
        let mut state = state.lock().await;
        let unloaded = state.registry.auto_unload_idle();
        if !unloaded.is_empty() {
            state.tools_changed = true;
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
    _state: Arc<Mutex<McpServerState>>,
    router: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    match name {
        // ---- Core tools ----
        "voice_send" => handlers::core::handle_voice_send(args, data_dir, router).await,
        "voice_inbox" => {
            let result = handlers::core::handle_voice_inbox(args, data_dir).await;
            // Auto-load by intent based on inbox messages
            // (For simplicity, we do this after returning the result.
            //  The Node.js version does it inline.)
            result
        }
        "voice_listen" => handlers::core::handle_voice_listen(args, data_dir, router).await,
        "voice_status" => handlers::core::handle_voice_status(args, data_dir).await,
        "get_logs" => handlers::core::handle_get_logs(args, data_dir, router).await,

        // ---- Memory tools ----
        "memory_search" => handlers::memory::handle_memory_search(args, data_dir).await,
        "memory_get" => handlers::memory::handle_memory_get(args, data_dir).await,
        "memory_remember" => handlers::memory::handle_memory_remember(args, data_dir).await,
        "memory_forget" => handlers::memory::handle_memory_forget(args, data_dir).await,
        "memory_stats" => handlers::memory::handle_memory_stats(args, data_dir).await,
        "memory_flush" => handlers::memory::handle_memory_flush(args, data_dir).await,

        // ---- Browser control (unified tool) ----
        "browser_action" => {
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            if action.is_empty() {
                McpToolResult::error("'action' parameter is required for browser_action")
            } else {
                match action {
                    "search" => handlers::browser::handle_browser_search(&args, data_dir).await,
                    "fetch" => handlers::browser::handle_browser_fetch(&args, data_dir).await,
                    _ => handlers::browser::handle_browser_control(action, &args, data_dir, router).await,
                }
            }
        }

        // ---- Capture tools ----
        "capture_list_windows" => handlers::capture::handle_capture_list_windows(args, data_dir, router).await,
        "capture_window" => handlers::capture::handle_capture_window(args, data_dir, router).await,

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

/// Write a JSON-RPC notification to stdout (no id, no response expected).
async fn write_notification<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    notification: &JsonRpcNotification,
) {
    match serde_json::to_string(notification) {
        Ok(json) => {
            let line = format!("{}\n", json);
            if let Err(e) = writer.write_all(line.as_bytes()).await {
                error!("[MCP] Failed to write notification: {}", e);
            }
            if let Err(e) = writer.flush().await {
                error!("[MCP] Failed to flush stdout: {}", e);
            }
            info!("[MCP] Sent tools/list_changed notification");
        }
        Err(e) => {
            error!("[MCP] Failed to serialize notification: {}", e);
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
        assert_eq!(result["serverInfo"]["name"], "voice-mirror");
        assert!(result["capabilities"]["tools"]["listChanged"].as_bool().unwrap());
    }

    #[test]
    fn test_handle_tools_list() {
        let state = McpServerState {
            registry: ToolRegistry::new(),
            data_dir: std::path::PathBuf::from("/tmp/test"),
            router: None,
            tools_changed: false,
        };
        let resp = handle_tools_list(json!(1), &state);
        let result = resp.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        // Default: core (5) + capture (2) = 7 always-loaded tools
        assert_eq!(tools.len(), 7);
    }

    #[test]
    fn test_parse_json_rpc_request() {
        let json = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.method, "tools/list");
        assert_eq!(req.id, Some(json!(1)));
    }

    #[test]
    fn test_enabled_groups_loads_tools_at_startup() {
        // BUG-005 Fix 1: ENABLED_GROUPS should pre-load tool groups
        let mut registry = ToolRegistry::new();
        // Default: always-loaded groups = core (5) + capture (2) = 7
        assert_eq!(registry.list_tools().len(), 7);

        // Apply enabled groups (simulating ENABLED_GROUPS env var)
        // always_loaded groups (core, capture) are always included
        registry.apply_enabled_groups("core,memory");
        let tools = registry.list_tools();

        // Should have core (5) + memory (6) + capture (2) = 13
        assert_eq!(tools.len(), 13);
        let tool_names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(tool_names.contains(&"memory_search"));
        assert!(tool_names.contains(&"capture_window"));
    }

    #[test]
    fn test_enabled_groups_in_tools_list() {
        // Verify that tools/list returns all enabled-group tools
        let mut registry = ToolRegistry::new();
        registry.apply_enabled_groups("core,browser");

        let state = McpServerState {
            registry,
            data_dir: std::path::PathBuf::from("/tmp/test"),
            router: None,
            tools_changed: false,
        };
        let resp = handle_tools_list(json!(1), &state);
        let result = resp.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        // core (5) + capture (2) + browser (1) = 8
        assert!(tools.len() > 7, "Should have more than default 7 tools");
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"browser_action"));
    }

    #[test]
    fn test_notification_serialization() {
        // BUG-005 Fix 2: verify notification JSON format
        let notification = JsonRpcNotification {
            jsonrpc: "2.0".into(),
            method: "notifications/tools/list_changed".into(),
            params: None,
        };
        let json = serde_json::to_string(&notification).unwrap();
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"method\":\"notifications/tools/list_changed\""));
        // params should be omitted (skip_serializing_if)
        assert!(!json.contains("\"params\""));
    }
}
