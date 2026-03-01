//! Named pipe server for the Tauri app.
//!
//! Creates a named pipe (Windows) or Unix domain socket (Unix) and listens for
//! a single MCP binary client. Incoming `McpToApp` messages are dispatched as
//! Tauri events. Outgoing `AppToMcp` messages (user chat input) are forwarded
//! to the MCP binary for instant delivery to `voice_listen`.

use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

use super::protocol::{self, AppToMcp, McpToApp};
use crate::services::inbox_watcher::InboxEvent;

// ---------------------------------------------------------------------------
// Pipe name generation
// ---------------------------------------------------------------------------

/// Generate a unique pipe name for this process.
#[cfg(windows)]
pub fn generate_pipe_name() -> String {
    let pid = std::process::id();
    format!(r"\\.\pipe\voice-mirror-{}", pid)
}

#[cfg(unix)]
pub fn generate_pipe_name() -> String {
    let pid = std::process::id();
    let dir = std::env::temp_dir();
    dir.join(format!("voice-mirror-{}.sock", pid))
        .to_string_lossy()
        .to_string()
}

// ---------------------------------------------------------------------------
// PipeServerState (Tauri managed state)
// ---------------------------------------------------------------------------

/// Tauri-managed state for the pipe server.
pub struct PipeServerState {
    /// The pipe name (passed to MCP binary via env var).
    pub pipe_name: String,
    /// Channel for sending messages to the connected MCP binary.
    pub tx: mpsc::UnboundedSender<AppToMcp>,
    /// Whether a client is currently connected.
    pub connected: Arc<Mutex<bool>>,
}

impl PipeServerState {
    /// Send a message to the MCP binary (if connected).
    pub fn send(&self, msg: AppToMcp) -> Result<(), String> {
        self.tx
            .send(msg)
            .map_err(|e| format!("Pipe send failed: {}", e))
    }

    /// Check if a client is connected.
    pub async fn is_connected(&self) -> bool {
        *self.connected.lock().await
    }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/// Start the named pipe server. Returns the managed state.
///
/// Spawns a background tokio task that:
/// 1. Creates the pipe/socket
/// 2. Accepts one client connection
/// 3. Runs a read loop dispatching `McpToApp` messages as Tauri events
/// 4. Runs a write loop forwarding `AppToMcp` messages to the client
pub fn start_pipe_server(
    app_handle: AppHandle,
    pipe_name: &str,
) -> Result<PipeServerState, String> {
    let (tx, rx) = mpsc::unbounded_channel::<AppToMcp>();
    let connected = Arc::new(Mutex::new(false));
    let pipe_name_owned = pipe_name.to_string();
    let connected_clone = Arc::clone(&connected);

    // Spawn the server task
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            run_pipe_server(app_handle, &pipe_name_owned, rx, connected_clone).await
        {
            error!("[PipeServer] Server error: {}", e);
        }
    });

    Ok(PipeServerState {
        pipe_name: pipe_name.to_string(),
        tx,
        connected,
    })
}

/// Internal: run the pipe server loop.
async fn run_pipe_server(
    app_handle: AppHandle,
    pipe_name: &str,
    rx: mpsc::UnboundedReceiver<AppToMcp>,
    connected: Arc<Mutex<bool>>,
) -> Result<(), String> {
    info!("[PipeServer] Starting on: {}", pipe_name);

    // Platform-specific accept
    let stream = accept_connection(pipe_name)
        .await
        .map_err(|e| format!("Accept failed: {}", e))?;

    info!("[PipeServer] Client connected");
    *connected.lock().await = true;

    // Split stream for concurrent read/write
    let (reader, writer) = tokio::io::split(stream);

    // Spawn write loop
    let write_handle = tokio::spawn(write_loop(writer, rx));

    // Run read loop (blocking until disconnect)
    read_loop(reader, &app_handle).await;

    // Client disconnected — clear any listener lock the MCP binary held.
    // The lock file persists on disk and blocks new AI instances from listening.
    // Since the MCP binary is gone, its lock is now stale.
    {
        let lock_path = crate::services::inbox_watcher::get_mcp_data_dir()
            .join("listener_lock.json");
        match tokio::fs::remove_file(&lock_path).await {
            Ok(()) => info!("[PipeServer] Cleared listener lock (client disconnected)"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {} // no lock to clear
            Err(e) => warn!("[PipeServer] Failed to clear listener lock: {}", e),
        }
    }

    *connected.lock().await = false;
    info!("[PipeServer] Client disconnected");

    // Abort write loop
    write_handle.abort();

    Ok(())
}

/// Read loop: receive McpToApp messages and dispatch as Tauri events.
async fn read_loop<R: AsyncRead + Unpin>(mut reader: R, app_handle: &AppHandle) {
    loop {
        match protocol::read_message::<_, McpToApp>(&mut reader).await {
            Ok(Some(msg)) => dispatch_message(msg, app_handle),
            Ok(None) => {
                info!("[PipeServer] Pipe closed by client (EOF)");
                break;
            }
            Err(e) => {
                warn!("[PipeServer] Read error: {}", e);
                break;
            }
        }
    }
}

/// Write loop: forward AppToMcp messages from the channel to the pipe.
async fn write_loop<W: AsyncWrite + Unpin>(
    mut writer: W,
    mut rx: mpsc::UnboundedReceiver<AppToMcp>,
) {
    while let Some(msg) = rx.recv().await {
        if let Err(e) = protocol::write_message(&mut writer, &msg).await {
            warn!("[PipeServer] Write error: {}", e);
            break;
        }
    }
}

/// Dispatch a received MCP message as a Tauri event.
fn dispatch_message(msg: McpToApp, app_handle: &AppHandle) {
    match msg {
        McpToApp::VoiceSend {
            from,
            message,
            thread_id,
            reply_to,
            message_id,
            timestamp,
        } => {
            // voice_send is always called by an AI provider, never a user.
            // Use "ai_message" regardless of instance_id so all providers
            // (Claude Code, OpenCode, etc.) trigger TTS + chat card.
            let event = InboxEvent {
                kind: "ai_message".to_string(),
                text: message,
                from,
                id: message_id,
                timestamp,
                thread_id,
                reply_to,
            };

            if let Err(e) = app_handle.emit("mcp-inbox-message", &event) {
                warn!("[PipeServer] Failed to emit mcp-inbox-message: {}", e);
            }
        }
        McpToApp::ListenStart {
            instance_id,
            from_sender,
            thread_id,
        } => {
            info!(
                "[PipeServer] AI {} listening for messages from {} (thread: {:?})",
                instance_id, from_sender, thread_id
            );
            // The pipe server doesn't need to act on this — it just means the MCP
            // binary is now waiting for AppToMcp::UserMessage on the pipe.
        }
        McpToApp::Ready => {
            info!("[PipeServer] MCP binary ready (pipe handshake complete)");
        }
        McpToApp::BrowserRequest { request_id, action, args } => {
            info!(
                "[PipeServer] Browser request: id={}, action={}",
                request_id, action
            );

            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let result = crate::services::browser_bridge::handle_browser_action(
                    &app, &action, &args,
                )
                .await;

                let response = match result {
                    Ok(value) => AppToMcp::BrowserResponse {
                        request_id,
                        success: true,
                        result: Some(value),
                        error: None,
                    },
                    Err(e) => AppToMcp::BrowserResponse {
                        request_id,
                        success: false,
                        result: None,
                        error: Some(e),
                    },
                };

                // Send response back through the pipe via PipeServerState
                use tauri::Manager;
                if let Some(pipe_state) = app.try_state::<PipeServerState>() {
                    if let Err(e) = pipe_state.send(response) {
                        warn!("[PipeServer] Failed to send browser response: {}", e);
                    }
                } else {
                    warn!("[PipeServer] PipeServerState not available for browser response");
                }
            });
        }
        McpToApp::CaptureRequest { request_id, action, args } => {
            info!(
                "[PipeServer] Capture request: id={}, action={}",
                request_id, action
            );

            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let result = handle_capture_action(&app, &action, &args).await;

                let response = match result {
                    Ok(value) => AppToMcp::CaptureResponse {
                        request_id,
                        success: true,
                        result: Some(value),
                        error: None,
                    },
                    Err(e) => AppToMcp::CaptureResponse {
                        request_id,
                        success: false,
                        result: None,
                        error: Some(e),
                    },
                };

                use tauri::Manager;
                if let Some(pipe_state) = app.try_state::<PipeServerState>() {
                    if let Err(e) = pipe_state.send(response) {
                        warn!("[PipeServer] Failed to send capture response: {}", e);
                    }
                } else {
                    warn!("[PipeServer] PipeServerState not available for capture response");
                }
            });
        }
        McpToApp::GetLogs { request_id, channel, level, last, search } => {
            info!("[PipeServer] GetLogs request: id={}, channel={:?}", request_id, channel);
            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;
                let text = if let Some(store) = app.try_state::<std::sync::Arc<crate::services::output::OutputStore>>() {
                    match &channel {
                        Some(ch_str) => {
                            if let Some(ch) = crate::services::output::Channel::from_str(ch_str) {
                                let (entries, total) = store.query(
                                    ch,
                                    level.as_deref(),
                                    last.or(Some(100)),
                                    search.as_deref(),
                                );
                                let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                                let count = lines.len();
                                let mut result = lines.join("\n");
                                result.push_str(&format!("\n\n--- {} entries (filtered from {} total) ---", count, total));
                                result
                            } else {
                                // Try project channel
                                let (entries, total) = store.query_project(
                                    ch_str,
                                    level.as_deref(),
                                    last.or(Some(100)),
                                    search.as_deref(),
                                );
                                if total > 0 {
                                    let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                                    let count = lines.len();
                                    let mut result = lines.join("\n");
                                    result.push_str(&format!(
                                        "\n\n--- {} entries (filtered from {} total, project channel) ---",
                                        count, total
                                    ));
                                    result
                                } else {
                                    let project_labels: Vec<String> = store.project_summary()
                                        .iter()
                                        .map(|ps| ps.label.clone())
                                        .collect();
                                    let available = if project_labels.is_empty() {
                                        String::new()
                                    } else {
                                        format!(" Project: {}", project_labels.join(", "))
                                    };
                                    format!(
                                        "Unknown channel: {}. System: app, cli, voice, mcp, browser, frontend.{}",
                                        ch_str, available
                                    )
                                }
                            }
                        }
                        None => {
                            let summaries = store.summary();
                            let mut text = String::from("Output Channels:\n");
                            for s in &summaries {
                                text.push_str(&format!(
                                    "  {:<10} {:>4} entries ({} error, {} warn, {} info)\n",
                                    format!("{}:", s.channel),
                                    s.total, s.error, s.warn, s.info
                                ));
                            }

                            let project_summaries = store.project_summary();
                            if !project_summaries.is_empty() {
                                text.push_str("\nProject Channels:\n");
                                for ps in &project_summaries {
                                    text.push_str(&format!(
                                        "  {} ({} entries, {} error, {} warn)\n",
                                        ps.label, ps.total, ps.error, ps.warn
                                    ));
                                }
                            }
                            text
                        }
                    }
                } else {
                    "OutputStore not available".into()
                };

                if let Some(pipe_state) = app.try_state::<PipeServerState>() {
                    let _ = pipe_state.send(AppToMcp::LogEntries { request_id, text });
                }
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Capture action handler
// ---------------------------------------------------------------------------

/// Handle a window capture action dispatched from the MCP binary.
async fn handle_capture_action(
    _app: &AppHandle,
    action: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    match action {
        "list_windows" => {
            let filter = args
                .get("filter")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            tokio::task::spawn_blocking(move || {
                #[cfg(target_os = "windows")]
                {
                    // Use metadata-only variant (no thumbnails/icons) to keep
                    // MCP response under Claude Code's 30KB limit.
                    let mut windows = crate::commands::screenshot::list_visible_windows_metadata()?;
                    if let Some(ref f) = filter {
                        let f_lower = f.to_lowercase();
                        windows.retain(|w| {
                            w.title.to_lowercase().contains(&f_lower)
                                || w.process_name.to_lowercase().contains(&f_lower)
                        });
                    }
                    serde_json::to_value(&windows).map_err(|e| format!("Serialize error: {}", e))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = filter;
                    Err("Window capture is Windows-only".into())
                }
            })
            .await
            .map_err(|e| format!("Task panicked: {}", e))?
        }
        "capture_window" => {
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let hwnd = args.get("hwnd").and_then(|v| v.as_i64());
            tokio::task::spawn_blocking(move || {
                #[cfg(target_os = "windows")]
                {
                    let target_hwnd = if let Some(h) = hwnd {
                        h
                    } else if let Some(ref t) = title {
                        let windows = crate::commands::screenshot::list_visible_windows_metadata()?;
                        let t_lower = t.to_lowercase();
                        windows
                            .iter()
                            .find(|w| w.title.to_lowercase().contains(&t_lower))
                            .map(|w| w.hwnd)
                            .ok_or_else(|| format!("No window found matching: {}", t))?
                    } else {
                        return Err("Either 'title' or 'hwnd' required".into());
                    };
                    let (base64_png, width, height) =
                        crate::commands::screenshot::capture_window_as_base64(target_hwnd)?;
                    Ok(serde_json::json!({
                        "base64": base64_png,
                        "contentType": "image/png",
                        "width": width,
                        "height": height
                    }))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = (title, hwnd);
                    Err("Window capture is Windows-only".into())
                }
            })
            .await
            .map_err(|e| format!("Task panicked: {}", e))?
        }
        _ => Err(format!("Unknown capture action: {}", action)),
    }
}

// ---------------------------------------------------------------------------
// Platform-specific accept
// ---------------------------------------------------------------------------

/// Unified stream type for cross-platform support.
#[cfg(windows)]
type ServerStream = tokio::net::windows::named_pipe::NamedPipeServer;

#[cfg(unix)]
type ServerStream = tokio::net::UnixStream;

#[cfg(windows)]
async fn accept_connection(pipe_name: &str) -> Result<ServerStream, std::io::Error> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(pipe_name)?;

    info!("[PipeServer] Waiting for client connection on {}", pipe_name);
    server.connect().await?;
    Ok(server)
}

#[cfg(unix)]
async fn accept_connection(socket_path: &str) -> Result<ServerStream, std::io::Error> {
    // Clean up stale socket file
    let _ = std::fs::remove_file(socket_path);

    let listener = tokio::net::UnixListener::bind(socket_path)?;
    info!(
        "[PipeServer] Waiting for client connection on {}",
        socket_path
    );
    let (stream, _) = listener.accept().await?;
    Ok(stream)
}
