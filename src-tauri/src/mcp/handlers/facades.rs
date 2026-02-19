//! Facade tool handlers for voice mode.
//!
//! Port of `mcp-server/handlers/facades.js`.
//!
//! Each facade consolidates an entire tool group into a single tool with an
//! `action` parameter. This reduces token overhead from ~9,400 to ~2,200
//! while preserving full functionality.
//!
//! Destructive sub-actions (forget, delete) check `args.confirmed` inside
//! the facade rather than in the global DESTRUCTIVE_TOOLS set, so non-
//! destructive actions on the same facade are never blocked.

use std::path::Path;
use serde_json::{json, Value};

use super::McpToolResult;
use super::browser;
use super::n8n;

// ============================================
// Confirmation gate helper
// ============================================

fn confirmation_required(tool_name: &str) -> McpToolResult {
    McpToolResult::text(format!(
        "\u{26a0}\u{fe0f} CONFIRMATION REQUIRED: \"{}\" is a destructive operation.\n\
         Ask the user for voice confirmation before proceeding.\n\
         To execute, call {} again with confirmed: true in the arguments.",
        tool_name, tool_name
    ))
}

// ============================================
// memory_manage facade
// ============================================

/// `memory_manage` -- combined memory tool for voice mode.
///
/// Actions: search, remember, forget, stats, flush
pub async fn handle_memory_manage(args: &Value, data_dir: &Path) -> McpToolResult {
    let action = match args.get("action").and_then(|v| v.as_str()) {
        Some(a) => a.to_string(),
        None => {
            return McpToolResult::error(
                "Error: action is required. Valid actions: search, remember, forget, stats, flush",
            );
        }
    };

    match action.as_str() {
        "search" => {
            super::memory::handle_memory_search(args, data_dir).await
        }
        "remember" => {
            super::memory::handle_memory_remember(args, data_dir).await
        }
        "forget" => {
            let confirmed = args
                .get("confirmed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !confirmed {
                return confirmation_required("memory_manage(forget)");
            }
            super::memory::handle_memory_forget(args, data_dir).await
        }
        "stats" => {
            super::memory::handle_memory_stats(args, data_dir).await
        }
        "flush" => {
            super::memory::handle_memory_flush(args, data_dir).await
        }
        _ => McpToolResult::error(format!(
            "Unknown memory action: \"{}\". Valid actions: search, remember, forget, stats, flush",
            action
        )),
    }
}

// ============================================
// n8n_manage facade
// ============================================

/// `n8n_manage` -- combined n8n tool for voice mode.
///
/// Actions: list, get, create, trigger, status, delete
pub async fn handle_n8n_manage(args: &Value, data_dir: &Path) -> McpToolResult {
    let action = match args.get("action").and_then(|v| v.as_str()) {
        Some(a) => a.to_string(),
        None => {
            return McpToolResult::error(
                "Error: action is required. Valid actions: list, get, create, trigger, status, delete",
            );
        }
    };

    match action.as_str() {
        "list" => n8n::handle_n8n_list_workflows(args, data_dir).await,
        "get" => n8n::handle_n8n_get_workflow(args, data_dir).await,
        "create" => n8n::handle_n8n_create_workflow(args, data_dir).await,
        "trigger" => n8n::handle_n8n_trigger_workflow(args, data_dir).await,
        "status" => n8n::handle_n8n_get_executions(args, data_dir).await,
        "delete" => {
            let confirmed = args
                .get("confirmed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !confirmed {
                return confirmation_required("n8n_manage(delete)");
            }
            n8n::handle_n8n_delete_workflow(args, data_dir).await
        }
        _ => McpToolResult::error(format!(
            "Unknown n8n action: \"{}\". Valid actions: list, get, create, trigger, status, delete",
            action
        )),
    }
}

// ============================================
// browser_manage facade
// ============================================

/// `browser_manage` -- combined browser tool for voice mode.
///
/// Actions: search, open, fetch, snapshot, screenshot, click, type, tabs, navigate, start, stop
pub async fn handle_browser_manage(args: &Value, data_dir: &Path) -> McpToolResult {
    let action = match args.get("action").and_then(|v| v.as_str()) {
        Some(a) => a.to_string(),
        None => {
            return McpToolResult::error(
                "Error: action is required. Valid actions: search, open, fetch, snapshot, screenshot, click, type, tabs, navigate, start, stop",
            );
        }
    };

    match action.as_str() {
        "search" => browser::handle_browser_search(args, data_dir).await,
        "fetch" => browser::handle_browser_fetch(args, data_dir).await,
        "open" => browser::handle_browser_control("open", args, data_dir).await,
        "snapshot" => browser::handle_browser_control("snapshot", args, data_dir).await,
        "screenshot" => browser::handle_browser_control("screenshot", args, data_dir).await,
        "click" => {
            // Construct act request with kind=click
            let mut act_args = args.clone();
            if let Some(obj) = act_args.as_object_mut() {
                let ref_val = obj.get("ref").cloned().unwrap_or(Value::Null);
                let existing_request = obj.get("request").cloned().unwrap_or(json!({}));

                let mut request = json!({ "kind": "click" });
                if !ref_val.is_null() {
                    request["ref"] = ref_val;
                }
                // Merge existing request fields
                if let Some(req_obj) = existing_request.as_object() {
                    if let Some(r) = request.as_object_mut() {
                        for (k, v) in req_obj {
                            r.insert(k.clone(), v.clone());
                        }
                    }
                }
                obj.insert("request".into(), request);
            }
            browser::handle_browser_control("act", &act_args, data_dir).await
        }
        "type" => {
            // Construct act request with kind=type
            let mut act_args = args.clone();
            if let Some(obj) = act_args.as_object_mut() {
                let ref_val = obj.get("ref").cloned().unwrap_or(Value::Null);
                let text_val = obj.get("text").cloned().unwrap_or(Value::Null);
                let existing_request = obj.get("request").cloned().unwrap_or(json!({}));

                let mut request = json!({ "kind": "type" });
                if !ref_val.is_null() {
                    request["ref"] = ref_val;
                }
                if !text_val.is_null() {
                    request["text"] = text_val;
                }
                // Merge existing request fields
                if let Some(req_obj) = existing_request.as_object() {
                    if let Some(r) = request.as_object_mut() {
                        for (k, v) in req_obj {
                            r.insert(k.clone(), v.clone());
                        }
                    }
                }
                obj.insert("request".into(), request);
            }
            browser::handle_browser_control("act", &act_args, data_dir).await
        }
        "tabs" => browser::handle_browser_control("tabs", args, data_dir).await,
        "navigate" => browser::handle_browser_control("navigate", args, data_dir).await,
        "start" => browser::handle_browser_control("start", args, data_dir).await,
        "stop" => browser::handle_browser_control("stop", args, data_dir).await,
        _ => McpToolResult::error(format!(
            "Unknown browser action: \"{}\". Valid actions: search, open, fetch, snapshot, screenshot, click, type, tabs, navigate, start, stop",
            action
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_confirmation_required_format() {
        let result = confirmation_required("memory_manage(forget)");
        // Just verify it doesn't panic and returns a text result
        assert!(!result.is_error);
    }
}
