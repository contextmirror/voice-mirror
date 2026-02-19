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
use crate::services::inbox_watcher::{classify_sender_pub, InboxEvent};

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
            let kind = classify_sender_pub(&from);
            let event = InboxEvent {
                kind: kind.to_string(),
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
