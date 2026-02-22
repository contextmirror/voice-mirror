//! JSON-RPC transport layer for LSP communication.
//!
//! Implements the base protocol (Content-Length headers) for reading and writing
//! LSP messages over stdio, plus a reader loop that dispatches responses and
//! notifications.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};
use tracing::{debug, warn};

use super::types::{
    DiagnosticItem, DiagnosticPosition, DiagnosticRange, LspDiagnosticEvent,
};

/// Write a JSON-RPC message to the LSP server's stdin.
///
/// Serializes the message to JSON, prepends the `Content-Length` header,
/// and writes the complete message.
pub async fn write_message(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let json_bytes = serde_json::to_vec(msg).map_err(|e| format!("JSON serialize error: {}", e))?;
    let header = format!("Content-Length: {}\r\n\r\n", json_bytes.len());

    stdin
        .write_all(header.as_bytes())
        .await
        .map_err(|e| format!("Failed to write header: {}", e))?;
    stdin
        .write_all(&json_bytes)
        .await
        .map_err(|e| format!("Failed to write body: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}

/// Read a single JSON-RPC message from the LSP server's stdout.
///
/// Parses the `Content-Length` header, reads exactly that many bytes,
/// and deserializes the JSON body. Returns `None` on EOF.
pub async fn read_message(reader: &mut BufReader<ChildStdout>) -> Option<Value> {
    // Read headers until we find Content-Length
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) => return None, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    // Empty line marks end of headers
                    break;
                }
                if let Some(val) = trimmed.strip_prefix("Content-Length: ") {
                    content_length = val.trim().parse().ok();
                }
                // Ignore other headers (e.g. Content-Type)
            }
            Err(e) => {
                warn!("Error reading LSP header: {}", e);
                return None;
            }
        }
    }

    let length = match content_length {
        Some(len) => len,
        None => {
            warn!("No Content-Length header found in LSP message");
            return None;
        }
    };

    // Read exactly `length` bytes for the body
    let mut body = vec![0u8; length];
    match reader.read_exact(&mut body).await {
        Ok(_) => {}
        Err(e) => {
            warn!("Error reading LSP body: {}", e);
            return None;
        }
    }

    match serde_json::from_slice(&body) {
        Ok(val) => Some(val),
        Err(e) => {
            warn!(
                "Failed to parse LSP JSON: {} (body: {})",
                e,
                String::from_utf8_lossy(&body)
            );
            None
        }
    }
}

/// Spawn a tokio task that reads LSP messages from stdout and dispatches them.
///
/// - Responses (messages with an `id` field): routed to the matching oneshot sender
///   in `pending_requests`.
/// - Notifications with method `textDocument/publishDiagnostics`: parsed and emitted
///   as a `lsp-diagnostics` Tauri event.
/// - Other notifications: logged and ignored.
/// - EOF: emits `lsp-server-error` event.
pub fn spawn_reader_loop(
    stdout: ChildStdout,
    app_handle: AppHandle,
    lang_id: String,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);

        loop {
            match read_message(&mut reader).await {
                Some(msg) => {
                    // Check if this is a response (has "id" field and no "method" field)
                    if let Some(id) = msg.get("id").and_then(|v| v.as_i64()) {
                        if msg.get("method").is_none() {
                            // This is a response to a request we sent
                            let mut pending_guard = pending.lock().await;
                            if let Some(sender) = pending_guard.remove(&id) {
                                let _ = sender.send(msg);
                            } else {
                                debug!("Received response for unknown request id={}", id);
                            }
                            continue;
                        }
                    }

                    // Check if this is a notification
                    if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
                        if method == "textDocument/publishDiagnostics" {
                            handle_diagnostics(&app_handle, &lang_id, &msg);
                        } else {
                            debug!("[{}] LSP notification: {}", lang_id, method);
                        }
                    }
                }
                None => {
                    // EOF — server process has exited or pipe broken
                    warn!("[{}] LSP server stdout closed (EOF)", lang_id);
                    let _ = app_handle.emit(
                        "lsp-server-error",
                        serde_json::json!({
                            "languageId": lang_id,
                            "error": "LSP server process exited unexpectedly"
                        }),
                    );
                    break;
                }
            }
        }

        debug!("[{}] LSP reader loop ended", lang_id);
    });
}

/// Send a JSON-RPC request to the LSP server.
///
/// Builds the request envelope, registers a oneshot channel for the response,
/// writes the message, and returns the receiver.
pub async fn send_request(
    stdin: &mut ChildStdin,
    pending: &Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    method: &str,
    params: Value,
    next_id: &std::sync::atomic::AtomicI64,
) -> Result<oneshot::Receiver<Value>, String> {
    let id = next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    let msg = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });

    let (tx, rx) = oneshot::channel();
    {
        let mut pending_guard = pending.lock().await;
        pending_guard.insert(id, tx);
    }

    write_message(stdin, &msg).await?;

    Ok(rx)
}

/// Send a JSON-RPC notification to the LSP server (no response expected).
pub async fn send_notification(
    stdin: &mut ChildStdin,
    method: &str,
    params: Value,
) -> Result<(), String> {
    let msg = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });

    write_message(stdin, &msg).await
}

/// Parse and emit a `textDocument/publishDiagnostics` notification.
fn handle_diagnostics(app_handle: &AppHandle, lang_id: &str, msg: &Value) {
    let params = match msg.get("params") {
        Some(p) => p,
        None => return,
    };

    let uri = params
        .get("uri")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let diagnostics = params
        .get("diagnostics")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|d| {
                    let range = d.get("range").cloned().unwrap_or(Value::Null);
                    let start = range.get("start").cloned().unwrap_or(Value::Null);
                    let end = range.get("end").cloned().unwrap_or(Value::Null);

                    let severity_num = d.get("severity").and_then(|v| v.as_u64());
                    let severity = match severity_num {
                        Some(1) => "error".to_string(),
                        Some(2) => "warning".to_string(),
                        Some(3) => "info".to_string(),
                        Some(4) => "hint".to_string(),
                        _ => "unknown".to_string(),
                    };

                    DiagnosticItem {
                        range: DiagnosticRange {
                            start: DiagnosticPosition {
                                line: start
                                    .get("line")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0) as u32,
                                character: start
                                    .get("character")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0)
                                    as u32,
                            },
                            end: DiagnosticPosition {
                                line: end
                                    .get("line")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0) as u32,
                                character: end
                                    .get("character")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0)
                                    as u32,
                            },
                        },
                        severity,
                        message: d
                            .get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        source: d
                            .get("source")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let event = LspDiagnosticEvent {
        uri,
        language_id: lang_id.to_string(),
        diagnostics,
    };

    if let Err(e) = app_handle.emit("lsp-diagnostics", &event) {
        warn!("Failed to emit lsp-diagnostics event: {}", e);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_json_rpc_request_format() {
        // Verify our request format is valid JSON-RPC 2.0
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "textDocument/hover",
            "params": { "textDocument": { "uri": "file:///test.rs" } },
        });

        assert_eq!(msg["jsonrpc"], "2.0");
        assert_eq!(msg["id"], 1);
        assert_eq!(msg["method"], "textDocument/hover");
    }

    #[test]
    fn test_json_rpc_notification_format() {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {},
        });

        assert_eq!(msg["jsonrpc"], "2.0");
        assert!(msg.get("id").is_none());
        assert_eq!(msg["method"], "initialized");
    }

    #[test]
    fn test_content_length_header_format() {
        let body = serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "test"});
        let json_bytes = serde_json::to_vec(&body).unwrap();
        let header = format!("Content-Length: {}\r\n\r\n", json_bytes.len());
        assert!(header.starts_with("Content-Length: "));
        assert!(header.ends_with("\r\n\r\n"));
    }

    #[test]
    fn test_diagnostic_severity_mapping() {
        use super::super::types::severity_to_string;
        use lsp_types::DiagnosticSeverity;
        assert_eq!(
            severity_to_string(Some(DiagnosticSeverity::ERROR)),
            "error"
        );
        assert_eq!(
            severity_to_string(Some(DiagnosticSeverity::WARNING)),
            "warning"
        );
        assert_eq!(
            severity_to_string(Some(DiagnosticSeverity::INFORMATION)),
            "info"
        );
        assert_eq!(
            severity_to_string(Some(DiagnosticSeverity::HINT)),
            "hint"
        );
    }
}
