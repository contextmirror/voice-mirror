//! Sandbox MCP tool handlers.
//!
//! Lets the in-terminal Claude Code see and drive an app *being built* (a Tauri
//! app launched with `--remote-debugging-port`) over CDP, at its true window
//! size. Requests are routed through the named pipe to the Tauri **app** process
//! (like `capture_browser`), so they execute where `services::sandbox`'s static
//! `@ref` store lives — a `sandbox_snapshot` and its follow-up `sandbox_click`
//! must resolve refs in the same process.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tracing::info;

use super::capture::{generate_request_id, pipe_capture_request, require_pipe};
use super::{McpContent, McpToolResult};
use crate::mcp::pipe_router::PipeRouter;

/// Shared front of every handler: ensure the pipe is up and round-trip the
/// request to the app, returning the parsed JSON (or an error result).
async fn run(
    pipe: Option<&Arc<PipeRouter>>,
    action: &str,
    args: &Value,
    timeout: Duration,
) -> Result<Value, McpToolResult> {
    let pipe = require_pipe(pipe)?;
    let request_id = generate_request_id();
    pipe_capture_request(pipe, &request_id, action, args.clone(), timeout)
        .await
        .map_err(McpToolResult::error)
}

/// `sandbox_snapshot` -- accessibility-tree snapshot of the running app as `@ref`
/// element handles (call this before click/type).
pub async fn handle_sandbox_snapshot(
    args: &Value,
    _data_dir: &Path,
    pipe: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    info!("[sandbox_snapshot] snapshotting app over CDP");
    match run(pipe, "sandbox_snapshot", args, Duration::from_secs(15)).await {
        Err(e) => e,
        Ok(resp) => {
            let tree = resp.get("tree").and_then(|v| v.as_str()).unwrap_or("");
            let page_url = resp.get("pageUrl").and_then(|v| v.as_str()).unwrap_or("");
            let ref_count = resp.get("refCount").and_then(|v| v.as_i64()).unwrap_or(0);
            let windows = resp
                .get("windows")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|w| w.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            if tree.is_empty() {
                McpToolResult::text(
                    serde_json::to_string_pretty(&resp).unwrap_or_else(|_| format!("{:?}", resp)),
                )
            } else {
                let windows_line = if windows.is_empty() {
                    String::new()
                } else {
                    format!(
                        "\nApp windows (snapshot again with `window` to target one): {}",
                        windows
                    )
                };
                McpToolResult::text(format!(
                    "Sandbox snapshot of {} ({} interactive refs).{}\n\
                     Use these @refs with sandbox_click / sandbox_type.\n\n{}",
                    page_url, ref_count, windows_line, tree
                ))
            }
        }
    }
}

/// `sandbox_screenshot` -- screenshot of the running app at its true window size.
pub async fn handle_sandbox_screenshot(
    args: &Value,
    _data_dir: &Path,
    pipe: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    info!("[sandbox_screenshot] capturing app over CDP");
    match run(pipe, "sandbox_screenshot", args, Duration::from_secs(30)).await {
        Err(e) => e,
        Ok(resp) => {
            if let Some(base64) = resp.get("base64").and_then(|v| v.as_str()) {
                let content_type = resp
                    .get("contentType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("image/jpeg");
                let mut result =
                    McpToolResult::image(base64.to_string(), content_type.to_string());
                result.content.push(McpContent::Text {
                    text: "The app you are building, at its true window size.".into(),
                });
                result
            } else {
                McpToolResult::error(format!(
                    "Sandbox screenshot returned no image: {}",
                    serde_json::to_string(&resp).unwrap_or_default()
                ))
            }
        }
    }
}

/// `sandbox_click` -- click an element by its `@ref` from the last snapshot.
pub async fn handle_sandbox_click(
    args: &Value,
    _data_dir: &Path,
    pipe: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    if args.get("element_ref").and_then(|v| v.as_str()).is_none() {
        return McpToolResult::error("sandbox_click requires `element_ref` (an @ref from sandbox_snapshot)");
    }
    info!("[sandbox_click] clicking element over CDP");
    match run(pipe, "sandbox_click", args, Duration::from_secs(15)).await {
        Err(e) => e,
        Ok(resp) => McpToolResult::text(format!(
            "Clicked. {}",
            serde_json::to_string(&resp).unwrap_or_default()
        )),
    }
}

/// `sandbox_type` -- type text into an element by its `@ref`.
pub async fn handle_sandbox_type(
    args: &Value,
    _data_dir: &Path,
    pipe: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    if args.get("element_ref").and_then(|v| v.as_str()).is_none() {
        return McpToolResult::error("sandbox_type requires `element_ref` (an @ref from sandbox_snapshot)");
    }
    info!("[sandbox_type] typing text over CDP");
    match run(pipe, "sandbox_type", args, Duration::from_secs(15)).await {
        Err(e) => e,
        Ok(resp) => McpToolResult::text(format!(
            "Typed. {}",
            serde_json::to_string(&resp).unwrap_or_default()
        )),
    }
}
