//! Named pipe client for the MCP binary.
//!
//! Connects to the Tauri app's named pipe server and provides
//! send/receive methods using the length-prefixed protocol.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tracing::{info, warn};

use super::protocol::{self, AppToMcp, McpToApp};

// ---------------------------------------------------------------------------
// Platform-specific stream types
// ---------------------------------------------------------------------------

#[cfg(windows)]
type PipeStream = tokio::net::windows::named_pipe::NamedPipeClient;

#[cfg(unix)]
type PipeStream = tokio::net::UnixStream;

// ---------------------------------------------------------------------------
// PipeClient
// ---------------------------------------------------------------------------

/// Client-side named pipe connection for the MCP binary.
pub struct PipeClient {
    /// Split reader half (protected by mutex for concurrent recv).
    reader: Mutex<tokio::io::ReadHalf<PipeStream>>,
    /// Split writer half (protected by mutex for concurrent send).
    writer: Mutex<tokio::io::WriteHalf<PipeStream>>,
}

impl PipeClient {
    /// Wrap a connected stream into a PipeClient.
    fn from_stream(stream: PipeStream) -> Self {
        let (reader, writer) = tokio::io::split(stream);
        Self {
            reader: Mutex::new(reader),
            writer: Mutex::new(writer),
        }
    }

    /// Send a message from the MCP binary to the Tauri app.
    pub async fn send(&self, msg: &McpToApp) -> Result<(), std::io::Error> {
        let mut writer = self.writer.lock().await;
        protocol::write_message(&mut *writer, msg).await
    }

    /// Receive a message from the Tauri app.
    ///
    /// Returns `None` if the pipe was closed.
    pub async fn recv(&self) -> Result<Option<AppToMcp>, std::io::Error> {
        let mut reader = self.reader.lock().await;
        protocol::read_message(&mut *reader).await
    }
}

// ---------------------------------------------------------------------------
// Connection function
// ---------------------------------------------------------------------------

/// Connect to the named pipe/UDS, retrying up to `max_retries` times.
///
/// Returns an `Arc<PipeClient>` for shared use, or an error if all retries fail.
pub async fn connect_to_pipe(
    pipe_name: &str,
    max_retries: u32,
) -> Result<Arc<PipeClient>, String> {
    for attempt in 0..max_retries {
        match try_connect(pipe_name).await {
            Ok(stream) => {
                info!("[PipeClient] Connected to pipe: {}", pipe_name);
                let client = Arc::new(PipeClient::from_stream(stream));

                // Send Ready handshake
                if let Err(e) = client.send(&McpToApp::Ready).await {
                    warn!("[PipeClient] Failed to send Ready handshake: {}", e);
                    // Still return the client — it might recover
                }

                return Ok(client);
            }
            Err(e) => {
                if attempt < max_retries - 1 {
                    warn!(
                        "[PipeClient] Connection attempt {}/{} failed: {}. Retrying in 200ms...",
                        attempt + 1,
                        max_retries,
                        e
                    );
                    tokio::time::sleep(Duration::from_millis(200)).await;
                } else {
                    return Err(format!(
                        "Failed to connect to pipe '{}' after {} attempts: {}",
                        pipe_name, max_retries, e
                    ));
                }
            }
        }
    }

    Err(format!("Failed to connect to pipe '{}'", pipe_name))
}

/// Platform-specific connection attempt.
#[cfg(windows)]
async fn try_connect(pipe_name: &str) -> Result<PipeStream, std::io::Error> {
    use tokio::net::windows::named_pipe::ClientOptions;
    ClientOptions::new().open(pipe_name)
}

#[cfg(unix)]
async fn try_connect(socket_path: &str) -> Result<PipeStream, std::io::Error> {
    tokio::net::UnixStream::connect(socket_path).await
}
