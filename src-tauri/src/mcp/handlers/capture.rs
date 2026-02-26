//! Window capture MCP tool handlers.
//!
//! Routes capture requests through the named pipe to the Tauri app,
//! which performs native Win32 capture (PrintWindow, BitBlt).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::Value;
use tracing::info;

use super::McpToolResult;
use crate::ipc::protocol::{AppToMcp, McpToApp};
use crate::mcp::pipe_router::PipeRouter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Monotonic counter to ensure unique request IDs even under concurrent calls.
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a unique request ID using timestamp + atomic counter.
fn generate_request_id() -> String {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let n = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("cap-{}-{}", ts, n)
}

/// Get the pipe client or return an error result.
fn require_pipe(pipe: Option<&Arc<PipeRouter>>) -> Result<&Arc<PipeRouter>, McpToolResult> {
    pipe.ok_or_else(|| {
        McpToolResult::error(
            "Capture tools require the named pipe connection to the Voice Mirror app. \
             Ensure the app is running and the MCP binary was launched with PIPE_NAME set.",
        )
    })
}

/// Send a capture request through the named pipe and wait for the response.
async fn pipe_capture_request(
    router: &Arc<PipeRouter>,
    request_id: &str,
    action: &str,
    args: Value,
    timeout: Duration,
) -> Result<Value, String> {
    // Register a waiter BEFORE sending the request to avoid race conditions
    let rx = router.wait_for_browser_response(request_id).await;

    let msg = McpToApp::CaptureRequest {
        request_id: request_id.to_string(),
        action: action.to_string(),
        args,
    };
    router
        .send(&msg)
        .await
        .map_err(|e| format!("Failed to send capture request: {}", e))?;

    // Wait for the response with timeout
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(AppToMcp::CaptureResponse {
            success,
            result,
            error,
            ..
        })) => {
            if success {
                Ok(result.unwrap_or(Value::Null))
            } else {
                Err(error.unwrap_or_else(|| "Unknown capture error".into()))
            }
        }
        Ok(Ok(_)) => Err("Unexpected message type in capture response channel".into()),
        Ok(Err(_)) => Err("Capture response channel closed unexpectedly".into()),
        Err(_) => {
            // Clean up the stale waiter to prevent memory leaks
            router.remove_waiter(request_id).await;
            Err(format!(
                "Capture {} timed out after {:?}",
                action, timeout
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/// `capture_list_windows` -- list all visible windows on the desktop.
pub async fn handle_capture_list_windows(
    args: &Value,
    _data_dir: &Path,
    pipe: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    let pipe = match require_pipe(pipe) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let request_id = generate_request_id();
    info!("[capture_list_windows] Listing desktop windows");

    match pipe_capture_request(
        pipe,
        &request_id,
        "list_windows",
        args.clone(),
        Duration::from_secs(15),
    )
    .await
    {
        Ok(response) => {
            let text = if response.is_string() {
                response.as_str().unwrap_or("").to_string()
            } else {
                serde_json::to_string_pretty(&response)
                    .unwrap_or_else(|_| format!("{:?}", response))
            };
            McpToolResult::text(text)
        }
        Err(e) => McpToolResult::error(e),
    }
}

/// `capture_window` -- take a screenshot of a specific desktop window.
pub async fn handle_capture_window(
    args: &Value,
    _data_dir: &Path,
    pipe: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    let pipe = match require_pipe(pipe) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let request_id = generate_request_id();

    let target = if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
        format!("title=\"{}\"", title)
    } else if let Some(hwnd) = args.get("hwnd").and_then(|v| v.as_u64()) {
        format!("hwnd={}", hwnd)
    } else {
        "foreground window".to_string()
    };

    info!("[capture_window] Capturing {}", target);

    match pipe_capture_request(
        pipe,
        &request_id,
        "capture_window",
        args.clone(),
        Duration::from_secs(30),
    )
    .await
    {
        Ok(response) => {
            // Response contains base64 and contentType fields
            if let Some(base64) = response.get("base64").and_then(|v| v.as_str()) {
                let content_type = response
                    .get("contentType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("image/png");
                McpToolResult::image(base64.to_string(), content_type.to_string())
            } else {
                // Fallback: return as text if no image data
                let text = serde_json::to_string_pretty(&response)
                    .unwrap_or_else(|_| format!("{:?}", response));
                McpToolResult::error(format!(
                    "Capture succeeded but no image data returned: {}",
                    text
                ))
            }
        }
        Err(e) => McpToolResult::error(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_request_id() {
        let id = generate_request_id();
        assert!(id.starts_with("cap-"));
        assert!(id.len() > 4);
    }

    #[test]
    fn test_generate_request_id_unique() {
        let id1 = generate_request_id();
        let id2 = generate_request_id();
        assert!(id1.starts_with("cap-"));
        assert!(id2.starts_with("cap-"));
        // Counter ensures uniqueness even at same ms
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_require_pipe_none() {
        let result = require_pipe(None);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_capture_list_windows_no_pipe() {
        let args = serde_json::json!({});
        let result =
            handle_capture_list_windows(&args, Path::new("/tmp"), None).await;
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn test_capture_window_no_pipe() {
        let args = serde_json::json!({"title": "Notepad"});
        let result =
            handle_capture_window(&args, Path::new("/tmp"), None).await;
        assert!(result.is_error);
    }
}
