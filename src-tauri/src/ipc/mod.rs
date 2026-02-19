//! Named pipe IPC for fast communication between the MCP binary and the Tauri app.
//!
//! Replaces file-based IPC (inbox.json polling) with direct named pipe/UDS messaging
//! for sub-millisecond latency on the voice_send/voice_listen hot path.

pub mod pipe_client;
pub mod pipe_server;
pub mod protocol;

use once_cell::sync::OnceCell;

/// Global pipe name, set once during app setup.
/// Read by the CLI provider when writing MCP config.
static PIPE_NAME: OnceCell<String> = OnceCell::new();

/// Set the global pipe name (called once during Tauri setup).
pub fn set_pipe_name(name: String) {
    let _ = PIPE_NAME.set(name);
}

/// Get the global pipe name (returns None if pipe server wasn't started).
pub fn get_pipe_name() -> Option<&'static str> {
    PIPE_NAME.get().map(|s| s.as_str())
}
