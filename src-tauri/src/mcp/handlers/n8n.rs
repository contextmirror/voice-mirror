//! n8n workflow management handlers.
//!
//! Port of `mcp-server/handlers/n8n.js`.
//!
//! Provides 22 tools for managing n8n workflows, executions, credentials,
//! tags, and templates via the n8n REST API.
//!
//! Key patterns:
//! - Node type formats differ: `nodes-base.*` (search) vs `n8n-nodes-base.*` (workflows)
//! - Connections use node NAMES not IDs
//! - n8n API runs at `http://localhost:5678`
//! - API key from `~/.config/n8n/api_key` or `N8N_API_KEY` env var

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::{json, Value};
use tracing::warn;

use super::McpToolResult;

// ============================================
// Configuration
// ============================================

const N8N_API_URL: &str = "http://localhost:5678";
const API_KEY_CACHE_TTL_SECS: u64 = 300; // 5 minutes

/// Cached API key with TTL.
static API_KEY_CACHE: Lazy<Mutex<(Option<String>, Instant)>> =
    Lazy::new(|| Mutex::new((None, Instant::now())));

/// Get the n8n API key file path.
fn api_key_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("n8n")
        .join("api_key")
}

/// Get the n8n API key from file or environment variable, with caching.
fn get_api_key() -> Option<String> {
    let mut cache = API_KEY_CACHE.lock().unwrap_or_else(|e| e.into_inner());

    // Check cache freshness
    if cache.0.is_some() && cache.1.elapsed() < Duration::from_secs(API_KEY_CACHE_TTL_SECS) {
        return cache.0.clone();
    }

    // Try file first
    let key_path = api_key_file_path();
    if let Ok(content) = fs::read_to_string(&key_path) {
        let key = content.trim().to_string();
        if !key.is_empty() {
            *cache = (Some(key.clone()), Instant::now());
            return Some(key);
        }
    }

    // Fall back to environment variable
    if let Ok(key) = std::env::var("N8N_API_KEY") {
        if !key.is_empty() {
            *cache = (Some(key.clone()), Instant::now());
            return Some(key);
        }
    }

    *cache = (None, Instant::now());
    None
}

// ============================================
// HTTP Client
// ============================================

/// Make an API request to the n8n REST API.
async fn api_request(endpoint: &str, method: &str, body: Option<Value>) -> Result<Value, String> {
    let api_key = get_api_key()
        .ok_or_else(|| "n8n API key not configured. Set in ~/.config/n8n/api_key or N8N_API_KEY env var.".to_string())?;

    let url = format!("{}/api/v1{}", N8N_API_URL, endpoint);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut req_builder = match method {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => client.get(&url),
    };

    req_builder = req_builder
        .header("X-N8N-API-KEY", &api_key)
        .header("Content-Type", "application/json");

    if let Some(data) = body {
        req_builder = req_builder.json(&data);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Cannot connect to n8n. Is it running?".to_string()
            } else if e.is_timeout() {
                "Request timed out".to_string()
            } else {
                format!("HTTP request failed: {}", e)
            }
        })?;

    let status = response.status();

    if status.is_success() {
        let text = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
        if text.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_str(&text).map_err(|_| text)
        }
    } else {
        let body_text = response.text().await.unwrap_or_default();
        Err(format!("API error: {} - {}", status.as_u16(), body_text))
    }
}

/// Make a raw HTTP request (for webhooks / external URLs).
async fn raw_request(
    url: &str,
    method: &str,
    body: Option<Value>,
    timeout_secs: u64,
) -> Result<Value, String> {
    // Enforce HTTPS for non-localhost URLs
    let parsed: url::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
    let is_localhost = matches!(
        parsed.host_str().unwrap_or(""),
        "localhost" | "127.0.0.1" | "::1"
    );
    if !is_localhost && parsed.scheme() != "https" {
        return Err(format!(
            "HTTPS required for non-localhost URL: {}",
            parsed.host_str().unwrap_or("")
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut req_builder = match method {
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        _ => client.get(url),
    };

    req_builder = req_builder.header("Content-Type", "application/json");

    if let Some(data) = body {
        req_builder = req_builder.json(&data);
    }

    let response = req_builder.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = response.status();

    if status.is_success() {
        let text = response.text().await.map_err(|e| format!("Failed to read: {}", e))?;
        if text.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_str(&text).unwrap_or(Ok(Value::String(text)))
        }
    } else {
        Err(format!("HTTP {}", status.as_u16()))
    }
}

// ============================================
// MCP response helpers
// ============================================

fn ok_result(result: Value) -> McpToolResult {
    let text = serde_json::to_string_pretty(&result).unwrap_or_else(|_| format!("{:?}", result));
    McpToolResult::text(text)
}

fn err_result(message: &str) -> McpToolResult {
    let error_json = json!({ "success": false, "error": message });
    let text = serde_json::to_string_pretty(&error_json).unwrap_or_else(|_| message.to_string());
    McpToolResult::error(text)
}

// ============================================
// Node Knowledge Base
// ============================================

/// Common n8n node types with search metadata.
#[derive(Debug, Clone, Serialize)]
struct NodeInfo {
    #[serde(rename = "nodeType")]
    node_type: &'static str,
    #[serde(rename = "workflowNodeType")]
    workflow_node_type: &'static str,
    description: &'static str,
    operations: Vec<&'static str>,
}

/// Get the common nodes knowledge base.
fn common_nodes() -> Vec<(&'static str, NodeInfo)> {
    vec![
        ("gmail", NodeInfo {
            node_type: "nodes-base.gmail",
            workflow_node_type: "n8n-nodes-base.gmail",
            description: "Read/send Gmail messages, manage labels",
            operations: vec!["message.get", "message.getMany", "message.send", "label.create"],
        }),
        ("webhook", NodeInfo {
            node_type: "nodes-base.webhook",
            workflow_node_type: "n8n-nodes-base.webhook",
            description: "Trigger workflow via HTTP request",
            operations: vec!["receive HTTP requests"],
        }),
        ("http", NodeInfo {
            node_type: "nodes-base.httpRequest",
            workflow_node_type: "n8n-nodes-base.httpRequest",
            description: "Make HTTP requests to any API",
            operations: vec!["GET", "POST", "PUT", "DELETE", "PATCH"],
        }),
        ("slack", NodeInfo {
            node_type: "nodes-base.slack",
            workflow_node_type: "n8n-nodes-base.slack",
            description: "Send messages, manage channels",
            operations: vec!["message.send", "channel.create"],
        }),
        ("discord", NodeInfo {
            node_type: "nodes-base.discord",
            workflow_node_type: "n8n-nodes-base.discord",
            description: "Send messages to Discord channels/users",
            operations: vec!["message.send", "webhook"],
        }),
        ("github", NodeInfo {
            node_type: "nodes-base.github",
            workflow_node_type: "n8n-nodes-base.github",
            description: "Manage repos, issues, PRs",
            operations: vec!["issue.create", "pr.get", "repo.get"],
        }),
        ("code", NodeInfo {
            node_type: "nodes-base.code",
            workflow_node_type: "n8n-nodes-base.code",
            description: "Run custom JavaScript or Python code",
            operations: vec!["javascript", "python"],
        }),
        ("set", NodeInfo {
            node_type: "nodes-base.set",
            workflow_node_type: "n8n-nodes-base.set",
            description: "Set or modify data values",
            operations: vec!["set values", "transform data"],
        }),
        ("if", NodeInfo {
            node_type: "nodes-base.if",
            workflow_node_type: "n8n-nodes-base.if",
            description: "Conditional branching",
            operations: vec!["true branch", "false branch"],
        }),
        ("switch", NodeInfo {
            node_type: "nodes-base.switch",
            workflow_node_type: "n8n-nodes-base.switch",
            description: "Multi-way branching based on rules",
            operations: vec!["route to different outputs"],
        }),
        ("schedule", NodeInfo {
            node_type: "nodes-base.scheduleTrigger",
            workflow_node_type: "n8n-nodes-base.scheduleTrigger",
            description: "Trigger on schedule (cron)",
            operations: vec!["interval", "cron"],
        }),
        ("google", NodeInfo {
            node_type: "nodes-base.googleSheets",
            workflow_node_type: "n8n-nodes-base.googleSheets",
            description: "Read/write Google Sheets",
            operations: vec!["read", "append", "update"],
        }),
        ("calendar", NodeInfo {
            node_type: "nodes-base.googleCalendar",
            workflow_node_type: "n8n-nodes-base.googleCalendar",
            description: "Manage Google Calendar events",
            operations: vec!["event.create", "event.get", "event.update"],
        }),
        ("respond", NodeInfo {
            node_type: "nodes-base.respondToWebhook",
            workflow_node_type: "n8n-nodes-base.respondToWebhook",
            description: "Send response back to webhook caller",
            operations: vec!["respond with data"],
        }),
    ]
}

// ============================================
// Node Discovery Handlers
// ============================================

pub async fn handle_n8n_search_nodes(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let query = args_val
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let limit = args_val
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .min(100)
        .max(1) as usize;

    let nodes = common_nodes();
    let results: Vec<&NodeInfo> = nodes
        .iter()
        .filter(|(key, node)| {
            query.contains(key)
                || key.contains(&query.as_str())
                || node.description.to_lowercase().contains(&query)
        })
        .map(|(_, node)| node)
        .take(limit)
        .collect();

    if !results.is_empty() {
        ok_result(json!({
            "success": true,
            "results": results,
            "hint": "Use workflowNodeType when creating workflows, nodeType for validation"
        }))
    } else {
        ok_result(json!({
            "success": true,
            "results": [],
            "hint": format!("No common nodes match '{}'. Try: gmail, webhook, http, slack, discord, github, code, set, if, switch, schedule", query)
        }))
    }
}

pub async fn handle_n8n_get_node(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let node_type = match args_val.get("node_type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return err_result("node_type required"),
    };

    // Check knowledge base for known node configs
    // Simplified: return basic info for known types
    let workflow_type = node_type.replace("nodes-base.", "n8n-nodes-base.");

    ok_result(json!({
        "success": true,
        "nodeType": node_type,
        "workflowNodeType": workflow_type,
        "hint": "Use n8n_search_nodes to find available nodes"
    }))
}

// ============================================
// Workflow Management Handlers
// ============================================

pub async fn handle_n8n_list_workflows(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let active_only = args_val
        .get("active_only")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    match api_request("/workflows", "GET", None).await {
        Ok(result) => {
            let workflows = result
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();

            let filtered: Vec<Value> = workflows
                .into_iter()
                .filter(|w| {
                    if active_only {
                        w.get("active").and_then(|a| a.as_bool()).unwrap_or(false)
                    } else {
                        true
                    }
                })
                .map(|w| {
                    json!({
                        "id": w.get("id"),
                        "name": w.get("name"),
                        "active": w.get("active"),
                        "createdAt": w.get("createdAt"),
                        "updatedAt": w.get("updatedAt"),
                    })
                })
                .collect();

            ok_result(json!({
                "success": true,
                "count": filtered.len(),
                "workflows": filtered,
            }))
        }
        Err(e) => err_result(&e),
    }
}

pub async fn handle_n8n_get_workflow(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let workflow_id = match args_val.get("workflow_id").and_then(|v| v.as_str().or_else(|| v.as_u64().map(|_| ""))) {
        Some(_) => args_val.get("workflow_id").unwrap().to_string().trim_matches('"').to_string(),
        None => return err_result("workflow_id required"),
    };

    match api_request(&format!("/workflows/{}", workflow_id), "GET", None).await {
        Ok(result) => {
            ok_result(json!({
                "success": true,
                "workflow": {
                    "id": result.get("id"),
                    "name": result.get("name"),
                    "active": result.get("active"),
                    "nodes": result.get("nodes").unwrap_or(&json!([])),
                    "connections": result.get("connections").unwrap_or(&json!({})),
                    "settings": result.get("settings").unwrap_or(&json!({})),
                }
            }))
        }
        Err(e) => {
            if e.contains("404") {
                err_result("Workflow not found")
            } else {
                err_result(&e)
            }
        }
    }
}

pub async fn handle_n8n_create_workflow(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let name = match args_val.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return err_result("name required"),
    };

    let nodes = match args_val.get("nodes") {
        Some(n) => n.clone(),
        None => return err_result("nodes required"),
    };

    let connections = args_val.get("connections").cloned().unwrap_or(json!({}));

    let body = json!({
        "name": name,
        "nodes": nodes,
        "connections": connections,
        "settings": { "executionOrder": "v1" },
    });

    match api_request("/workflows", "POST", Some(body)).await {
        Ok(result) => {
            ok_result(json!({
                "success": true,
                "workflow_id": result.get("id"),
                "name": result.get("name"),
                "hint": "Workflow created but inactive. Use n8n_update_workflow with activateWorkflow operation to enable."
            }))
        }
        Err(e) => err_result(&format!("Create failed: {}", e)),
    }
}

pub async fn handle_n8n_update_workflow(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let workflow_id = match extract_string_or_number(&args_val, "workflow_id") {
        Some(id) => id,
        None => return err_result("workflow_id required"),
    };

    // Mode 1: Full workflow update
    if let Some(workflow_data) = args_val.get("workflow_data") {
        // Fetch existing workflow first
        let existing = match api_request(&format!("/workflows/{}", workflow_id), "GET", None).await {
            Ok(e) => e,
            Err(e) => return err_result(&format!("Cannot fetch workflow: {}", e)),
        };

        let body = json!({
            "name": workflow_data.get("name").or_else(|| existing.get("name")),
            "nodes": workflow_data.get("nodes").or_else(|| existing.get("nodes")).unwrap_or(&json!([])),
            "connections": workflow_data.get("connections").or_else(|| existing.get("connections")).unwrap_or(&json!({})),
            "settings": workflow_data.get("settings").or_else(|| existing.get("settings")).unwrap_or(&json!({})),
        });

        return match api_request(&format!("/workflows/{}", workflow_id), "PUT", Some(body)).await {
            Ok(result) => {
                let node_count = result.get("nodes").and_then(|n| n.as_array()).map(|a| a.len()).unwrap_or(0);
                ok_result(json!({
                    "success": true,
                    "message": "Workflow updated",
                    "workflow_id": result.get("id"),
                    "name": result.get("name"),
                    "nodeCount": node_count,
                }))
            }
            Err(e) => err_result(&format!("Update failed: {}", e)),
        };
    }

    // Mode 2: Operations
    let operations = match args_val.get("operations").and_then(|v| v.as_array()) {
        Some(ops) if !ops.is_empty() => ops.clone(),
        _ => return err_result("Either operations or workflow_data required"),
    };

    // Fetch existing workflow
    let existing = match api_request(&format!("/workflows/{}", workflow_id), "GET", None).await {
        Ok(e) => e,
        Err(e) => return err_result(&format!("Cannot fetch workflow: {}", e)),
    };

    let mut nodes: Vec<Value> = existing
        .get("nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let mut connections: Value = existing
        .get("connections")
        .cloned()
        .unwrap_or(json!({}));

    let mut modified = false;

    for op in &operations {
        let op_type = op.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match op_type {
            "activateWorkflow" => {
                return match api_request(&format!("/workflows/{}/activate", workflow_id), "POST", None).await {
                    Ok(_) => ok_result(json!({ "success": true, "message": "Workflow activated", "active": true })),
                    Err(e) => err_result(&format!("Activation failed: {}", e)),
                };
            }
            "deactivateWorkflow" => {
                return match api_request(&format!("/workflows/{}/deactivate", workflow_id), "POST", None).await {
                    Ok(_) => ok_result(json!({ "success": true, "message": "Workflow deactivated", "active": false })),
                    Err(e) => err_result(&format!("Deactivation failed: {}", e)),
                };
            }
            "updateNode" => {
                let node_name = op.get("nodeName").and_then(|v| v.as_str()).unwrap_or("");
                if let Some(idx) = nodes.iter().position(|n| n.get("name").and_then(|v| v.as_str()) == Some(node_name)) {
                    if let Some(params) = op.get("parameters") {
                        if let Some(existing_params) = nodes[idx].get("parameters").cloned() {
                            let mut merged = existing_params;
                            if let (Some(m), Some(p)) = (merged.as_object_mut(), params.as_object()) {
                                for (k, v) in p {
                                    m.insert(k.clone(), v.clone());
                                }
                            }
                            nodes[idx]["parameters"] = merged;
                        } else {
                            nodes[idx]["parameters"] = params.clone();
                        }
                    }
                    modified = true;
                } else {
                    return err_result(&format!("Node '{}' not found", node_name));
                }
            }
            "updateNodeCode" => {
                let node_name = op.get("nodeName").and_then(|v| v.as_str()).unwrap_or("");
                let js_code = match op.get("jsCode").and_then(|v| v.as_str()) {
                    Some(c) => c,
                    None => return err_result("jsCode required for updateNodeCode"),
                };

                if let Some(idx) = nodes.iter().position(|n| n.get("name").and_then(|v| v.as_str()) == Some(node_name)) {
                    let node_type = nodes[idx].get("type").and_then(|v| v.as_str()).unwrap_or("");
                    if !node_type.to_lowercase().contains("code") {
                        return err_result(&format!("Node '{}' is not a code node", node_name));
                    }
                    nodes[idx]["parameters"]["jsCode"] = Value::String(js_code.to_string());
                    modified = true;
                } else {
                    return err_result(&format!("Node '{}' not found", node_name));
                }
            }
            "addNode" => {
                if let Some(node) = op.get("node") {
                    nodes.push(node.clone());
                    modified = true;
                } else {
                    return err_result("node required for addNode");
                }
            }
            "removeNode" => {
                let node_name = op.get("nodeName").and_then(|v| v.as_str()).unwrap_or("");
                let orig_len = nodes.len();
                nodes.retain(|n| n.get("name").and_then(|v| v.as_str()) != Some(node_name));
                if nodes.len() == orig_len {
                    return err_result(&format!("Node '{}' not found", node_name));
                }

                // Remove connections to/from this node
                if let Some(conn_map) = connections.as_object_mut() {
                    conn_map.remove(node_name);
                    for (_, targets) in conn_map.iter_mut() {
                        if let Some(main) = targets.get_mut("main").and_then(|m| m.as_array_mut()) {
                            for output in main.iter_mut() {
                                if let Some(arr) = output.as_array_mut() {
                                    arr.retain(|c| c.get("node").and_then(|v| v.as_str()) != Some(node_name));
                                }
                            }
                        }
                    }
                }
                modified = true;
            }
            "addConnection" => {
                let from_node = op.get("fromNode").and_then(|v| v.as_str()).unwrap_or("");
                let to_node = op.get("toNode").and_then(|v| v.as_str()).unwrap_or("");
                let from_index = op.get("fromIndex").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let to_index = op.get("toIndex").and_then(|v| v.as_u64()).unwrap_or(0);

                let conn_map = connections.as_object_mut().unwrap();
                if !conn_map.contains_key(from_node) {
                    conn_map.insert(from_node.to_string(), json!({ "main": [[]] }));
                }

                let main = conn_map
                    .get_mut(from_node)
                    .unwrap()
                    .get_mut("main")
                    .and_then(|m| m.as_array_mut())
                    .unwrap();

                while main.len() <= from_index {
                    main.push(json!([]));
                }

                if let Some(arr) = main[from_index].as_array_mut() {
                    arr.push(json!({ "node": to_node, "type": "main", "index": to_index }));
                }
                modified = true;
            }
            "removeConnection" => {
                let from_node = op.get("fromNode").and_then(|v| v.as_str()).unwrap_or("");
                let to_node = op.get("toNode").and_then(|v| v.as_str()).unwrap_or("");

                if let Some(conn_map) = connections.as_object_mut() {
                    if let Some(source) = conn_map.get_mut(from_node) {
                        if let Some(main) = source.get_mut("main").and_then(|m| m.as_array_mut()) {
                            for output in main.iter_mut() {
                                if let Some(arr) = output.as_array_mut() {
                                    arr.retain(|c| c.get("node").and_then(|v| v.as_str()) != Some(to_node));
                                }
                            }
                        }
                    }
                }
                modified = true;
            }
            _ => {
                warn!("Unknown n8n operation type: {}", op_type);
            }
        }
    }

    if modified {
        let body = json!({
            "name": existing.get("name"),
            "nodes": nodes,
            "connections": connections,
            "settings": existing.get("settings").unwrap_or(&json!({})),
        });

        match api_request(&format!("/workflows/{}", workflow_id), "PUT", Some(body)).await {
            Ok(result) => {
                let node_count = result.get("nodes").and_then(|n| n.as_array()).map(|a| a.len()).unwrap_or(0);
                ok_result(json!({
                    "success": true,
                    "message": "Workflow updated",
                    "workflow_id": result.get("id"),
                    "nodeCount": node_count,
                }))
            }
            Err(e) => err_result(&format!("Update failed: {}", e)),
        }
    } else {
        ok_result(json!({ "success": true, "message": "No changes made" }))
    }
}

pub async fn handle_n8n_delete_workflow(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let workflow_id = match extract_string_or_number(&args_val, "workflow_id") {
        Some(id) => id,
        None => return err_result("workflow_id required"),
    };

    match api_request(&format!("/workflows/{}", workflow_id), "DELETE", None).await {
        Ok(result) => {
            ok_result(json!({
                "success": true,
                "message": format!("Workflow {} deleted", workflow_id),
                "deleted_workflow": {
                    "id": result.get("id"),
                    "name": result.get("name"),
                }
            }))
        }
        Err(e) => {
            if e.contains("404") {
                err_result("Workflow not found")
            } else {
                err_result(&format!("Delete failed: {}", e))
            }
        }
    }
}

pub async fn handle_n8n_validate_workflow(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let (nodes, connections) = if let Some(id) = extract_string_or_number(&args_val, "workflow_id") {
        match api_request(&format!("/workflows/{}", id), "GET", None).await {
            Ok(result) => {
                let n = result.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                let c = result.get("connections").cloned().unwrap_or(json!({}));
                (n, c)
            }
            Err(e) => return err_result(&e),
        }
    } else if let Some(wf_json) = args_val.get("workflow_json") {
        let n = wf_json.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let c = wf_json.get("connections").cloned().unwrap_or(json!({}));
        (n, c)
    } else {
        return err_result("Either workflow_id or workflow_json required");
    };

    let mut errors: Vec<String> = vec![];
    let mut warnings: Vec<String> = vec![];

    if nodes.is_empty() {
        errors.push("Workflow has no nodes".into());
    }

    let has_trigger = nodes.iter().any(|n| {
        n.get("type")
            .and_then(|v| v.as_str())
            .map(|t| t.to_lowercase().contains("trigger"))
            .unwrap_or(false)
    });
    if !has_trigger {
        warnings.push("No trigger node found. Workflow won't start automatically.".into());
    }

    // Validate connections reference valid nodes
    let node_names: std::collections::HashSet<&str> = nodes
        .iter()
        .filter_map(|n| n.get("name").and_then(|v| v.as_str()))
        .collect();

    if let Some(conn_map) = connections.as_object() {
        for (source, targets) in conn_map {
            if !node_names.contains(source.as_str()) {
                errors.push(format!("Connection from unknown node: {}", source));
            }
            if let Some(main) = targets.get("main").and_then(|m| m.as_array()) {
                for output in main {
                    if let Some(arr) = output.as_array() {
                        for conn in arr {
                            if let Some(target_node) = conn.get("node").and_then(|v| v.as_str()) {
                                if !node_names.contains(target_node) {
                                    errors.push(format!("Connection to unknown node: {}", target_node));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    ok_result(json!({
        "success": errors.is_empty(),
        "errors": errors,
        "warnings": warnings,
        "nodeCount": nodes.len(),
        "connectionCount": connections.as_object().map(|m| m.len()).unwrap_or(0),
    }))
}

pub async fn handle_n8n_trigger_workflow(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let workflow_id = extract_string_or_number(&args_val, "workflow_id");
    let mut webhook_path = args_val.get("webhook_path").and_then(|v| v.as_str()).map(|s| s.to_string());
    let data = args_val.get("data").cloned().unwrap_or(json!({}));

    if workflow_id.is_none() && webhook_path.is_none() {
        return err_result("Either workflow_id or webhook_path required");
    }

    // If no webhook_path, try to find it from the workflow
    if webhook_path.is_none() {
        let wf_id = workflow_id.as_ref().unwrap();
        match api_request(&format!("/workflows/{}", wf_id), "GET", None).await {
            Ok(result) => {
                let nodes = result.get("nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
                let webhook_nodes: Vec<&Value> = nodes
                    .iter()
                    .filter(|n| {
                        n.get("type")
                            .and_then(|v| v.as_str())
                            .map(|t| t.to_lowercase().contains("webhook"))
                            .unwrap_or(false)
                    })
                    .collect();

                if webhook_nodes.is_empty() {
                    return err_result("No webhook node found in workflow");
                }

                webhook_path = webhook_nodes[0]
                    .get("parameters")
                    .and_then(|p| p.get("path"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if webhook_path.is_none() {
                    return err_result("Webhook node has no path configured");
                }
            }
            Err(e) => return err_result(&e),
        }
    }

    let url = format!("{}/webhook/{}", N8N_API_URL, webhook_path.unwrap());

    match raw_request(&url, "POST", Some(data), 60).await {
        Ok(result) => ok_result(json!({ "success": true, "response": result })),
        Err(e) => {
            if e.contains("404") {
                err_result("Webhook not found. Is the workflow active?")
            } else {
                err_result(&e)
            }
        }
    }
}

pub async fn handle_n8n_deploy_template(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let template_id = match extract_string_or_number(&args_val, "template_id") {
        Some(id) => id,
        None => return err_result("template_id required"),
    };

    let template_url = format!("https://api.n8n.io/api/templates/workflows/{}", template_id);

    let template = match raw_request(&template_url, "GET", None, 30).await {
        Ok(t) => t,
        Err(e) => return err_result(&format!("Failed to fetch template: {}", e)),
    };

    let outer_workflow = template.get("workflow").cloned().unwrap_or(json!({}));
    let workflow_data = outer_workflow.get("workflow").cloned().unwrap_or(json!({}));

    if workflow_data.get("nodes").is_none() {
        return err_result("Template has no workflow data");
    }

    let workflow_name = args_val
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| outer_workflow.get("name").and_then(|v| v.as_str()))
        .unwrap_or(&format!("Template {}", template_id))
        .to_string();

    let create_args = json!({
        "name": workflow_name,
        "nodes": workflow_data.get("nodes").unwrap_or(&json!([])),
        "connections": workflow_data.get("connections").unwrap_or(&json!({})),
    });

    handle_n8n_create_workflow(&create_args, _data_dir).await
}

// ============================================
// Execution Management Handlers
// ============================================

pub async fn handle_n8n_get_executions(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let limit = args_val
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .min(100)
        .max(1);

    let mut params = vec![format!("limit={}", limit)];
    if let Some(wf_id) = extract_string_or_number(&args_val, "workflow_id") {
        params.push(format!("workflowId={}", wf_id));
    }
    if let Some(status) = args_val.get("status").and_then(|v| v.as_str()) {
        params.push(format!("status={}", status));
    }

    let endpoint = format!("/executions?{}", params.join("&"));

    match api_request(&endpoint, "GET", None).await {
        Ok(result) => {
            let executions = result
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();

            let mapped: Vec<Value> = executions
                .iter()
                .map(|e| {
                    json!({
                        "id": e.get("id"),
                        "workflowId": e.get("workflowId"),
                        "status": e.get("status"),
                        "startedAt": e.get("startedAt"),
                        "stoppedAt": e.get("stoppedAt"),
                        "mode": e.get("mode"),
                    })
                })
                .collect();

            ok_result(json!({
                "success": true,
                "count": mapped.len(),
                "executions": mapped,
            }))
        }
        Err(e) => err_result(&e),
    }
}

pub async fn handle_n8n_get_execution(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let execution_id = match extract_string_or_number(&args_val, "execution_id") {
        Some(id) => id,
        None => return err_result("execution_id required"),
    };

    let include_data = args_val
        .get("include_data")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let endpoint = if include_data {
        format!("/executions/{}?includeData=true", execution_id)
    } else {
        format!("/executions/{}", execution_id)
    };

    match api_request(&endpoint, "GET", None).await {
        Ok(result) => {
            let mut execution = json!({
                "id": result.get("id"),
                "workflowId": result.get("workflowId"),
                "status": result.get("status"),
                "finished": result.get("finished"),
                "mode": result.get("mode"),
                "startedAt": result.get("startedAt"),
                "stoppedAt": result.get("stoppedAt"),
                "workflowData": result.get("workflowData"),
            });

            if include_data {
                execution["data"] = result.get("data").cloned().unwrap_or(Value::Null);
            }

            ok_result(json!({
                "success": true,
                "execution": execution,
            }))
        }
        Err(e) => {
            if e.contains("404") {
                err_result("Execution not found")
            } else {
                err_result(&e)
            }
        }
    }
}

pub async fn handle_n8n_delete_execution(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let execution_id = match extract_string_or_number(&args_val, "execution_id") {
        Some(id) => id,
        None => return err_result("execution_id required"),
    };

    match api_request(&format!("/executions/{}", execution_id), "DELETE", None).await {
        Ok(_) => ok_result(json!({ "success": true, "message": format!("Execution {} deleted", execution_id) })),
        Err(e) => {
            if e.contains("404") {
                err_result("Execution not found")
            } else {
                err_result(&format!("Delete failed: {}", e))
            }
        }
    }
}

pub async fn handle_n8n_retry_execution(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let execution_id = match extract_string_or_number(&args_val, "execution_id") {
        Some(id) => id,
        None => return err_result("execution_id required"),
    };

    let load_workflow = args_val
        .get("load_workflow")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let body = json!({ "loadWorkflow": load_workflow });

    match api_request(&format!("/executions/{}/retry", execution_id), "POST", Some(body)).await {
        Ok(result) => ok_result(json!({
            "success": true,
            "message": format!("Execution {} retried", execution_id),
            "new_execution": result,
        })),
        Err(e) => {
            if e.contains("404") {
                err_result("Execution not found")
            } else {
                err_result(&format!("Retry failed: {}", e))
            }
        }
    }
}

// ============================================
// Credentials Management Handlers
// ============================================

pub async fn handle_n8n_list_credentials(_args: &Value, _data_dir: &Path) -> McpToolResult {
    ok_result(json!({
        "success": false,
        "error": "n8n public API does not support listing credentials",
        "hint": "Use the n8n UI at http://localhost:5678 to view credentials.",
        "available_operations": [
            "n8n_create_credential - Create a new credential",
            "n8n_delete_credential - Delete by ID",
            "n8n_get_credential_schema - Get schema for a credential type"
        ]
    }))
}

pub async fn handle_n8n_create_credential(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();

    let name = match args_val.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return err_result("name required"),
    };

    let cred_type = match args_val.get("type").and_then(|v| v.as_str()) {
        Some(t) => t.to_string(),
        None => return err_result("type required (e.g., 'slackApi', 'gmailOAuth2')"),
    };

    let data = args_val.get("data").cloned().unwrap_or(json!({}));

    let body = json!({
        "name": name,
        "type": cred_type,
        "data": data,
    });

    match api_request("/credentials", "POST", Some(body)).await {
        Ok(result) => {
            ok_result(json!({
                "success": true,
                "credential_id": result.get("id"),
                "name": result.get("name"),
                "type": result.get("type"),
                "hint": "Credential created. Note: OAuth credentials may need manual browser auth."
            }))
        }
        Err(e) => err_result(&format!("Create failed: {}", e)),
    }
}

pub async fn handle_n8n_delete_credential(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let credential_id = match extract_string_or_number(&args_val, "credential_id") {
        Some(id) => id,
        None => return err_result("credential_id required"),
    };

    match api_request(&format!("/credentials/{}", credential_id), "DELETE", None).await {
        Ok(_) => ok_result(json!({ "success": true, "message": format!("Credential {} deleted", credential_id) })),
        Err(e) => {
            if e.contains("404") {
                err_result("Credential not found")
            } else {
                err_result(&format!("Delete failed: {}", e))
            }
        }
    }
}

pub async fn handle_n8n_get_credential_schema(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let credential_type = match args_val.get("credential_type").and_then(|v| v.as_str()) {
        Some(t) => t.to_string(),
        None => return err_result("credential_type required (e.g., 'gmailOAuth2', 'slackApi')"),
    };

    match api_request(&format!("/credentials/schema/{}", credential_type), "GET", None).await {
        Ok(result) => {
            let required = result.get("required").cloned().unwrap_or(json!([]));
            ok_result(json!({
                "success": true,
                "credential_type": credential_type,
                "schema": result,
                "required_fields": required,
            }))
        }
        Err(e) => {
            if e.contains("404") {
                err_result(&format!("Unknown credential type: {}", credential_type))
            } else {
                err_result(&e)
            }
        }
    }
}

// ============================================
// Tags Management Handlers
// ============================================

pub async fn handle_n8n_list_tags(_args: &Value, _data_dir: &Path) -> McpToolResult {
    match api_request("/tags", "GET", None).await {
        Ok(result) => {
            let tags = if result.is_array() {
                result.as_array().cloned().unwrap_or_default()
            } else {
                result
                    .get("data")
                    .and_then(|d| d.as_array())
                    .cloned()
                    .unwrap_or_default()
            };

            let mapped: Vec<Value> = tags
                .iter()
                .map(|t| {
                    json!({
                        "id": t.get("id"),
                        "name": t.get("name"),
                        "createdAt": t.get("createdAt"),
                        "updatedAt": t.get("updatedAt"),
                    })
                })
                .collect();

            ok_result(json!({
                "success": true,
                "count": mapped.len(),
                "tags": mapped,
            }))
        }
        Err(e) => err_result(&e),
    }
}

pub async fn handle_n8n_create_tag(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let name = match args_val.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return err_result("name required"),
    };

    let body = json!({ "name": name });

    match api_request("/tags", "POST", Some(body)).await {
        Ok(result) => {
            ok_result(json!({
                "success": true,
                "tag_id": result.get("id"),
                "name": result.get("name"),
            }))
        }
        Err(e) => err_result(&format!("Create failed: {}", e)),
    }
}

pub async fn handle_n8n_delete_tag(args: &Value, _data_dir: &Path) -> McpToolResult {
    let args_val = args.clone();
    let tag_id = match extract_string_or_number(&args_val, "tag_id") {
        Some(id) => id,
        None => return err_result("tag_id required"),
    };

    match api_request(&format!("/tags/{}", tag_id), "DELETE", None).await {
        Ok(_) => ok_result(json!({ "success": true, "message": format!("Tag {} deleted", tag_id) })),
        Err(e) => {
            if e.contains("404") {
                err_result("Tag not found")
            } else {
                err_result(&format!("Delete failed: {}", e))
            }
        }
    }
}

// ============================================
// Variables Handler
// ============================================

pub async fn handle_n8n_list_variables(_args: &Value, _data_dir: &Path) -> McpToolResult {
    ok_result(json!({
        "success": false,
        "error": "Variables require n8n Enterprise license",
        "hint": "The Variables feature is only available on paid n8n plans."
    }))
}

// ============================================
// Utility
// ============================================

/// Extract a string or numeric field from a JSON value as a String.
/// Handles both `"123"` and `123` formats.
fn extract_string_or_number(val: &Value, key: &str) -> Option<String> {
    val.get(key).and_then(|v| {
        if let Some(s) = v.as_str() {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        } else if let Some(n) = v.as_u64() {
            Some(n.to_string())
        } else if let Some(n) = v.as_i64() {
            Some(n.to_string())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_key_file_path() {
        let path = api_key_file_path();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("n8n"));
        assert!(path_str.contains("api_key"));
    }

    #[test]
    fn test_extract_string_or_number_string() {
        let val = json!({ "id": "123" });
        assert_eq!(extract_string_or_number(&val, "id"), Some("123".into()));
    }

    #[test]
    fn test_extract_string_or_number_number() {
        let val = json!({ "id": 456 });
        assert_eq!(extract_string_or_number(&val, "id"), Some("456".into()));
    }

    #[test]
    fn test_extract_string_or_number_missing() {
        let val = json!({});
        assert_eq!(extract_string_or_number(&val, "id"), None);
    }

    #[test]
    fn test_extract_string_or_number_empty() {
        let val = json!({ "id": "" });
        assert_eq!(extract_string_or_number(&val, "id"), None);
    }

    #[test]
    fn test_common_nodes_not_empty() {
        let nodes = common_nodes();
        assert!(!nodes.is_empty());
        assert!(nodes.len() >= 10);
    }
}
