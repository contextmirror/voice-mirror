//! Tauri commands for managing independent terminal sessions.
//!
//! These commands expose `TerminalManager` operations to the frontend,
//! enabling tabbed terminal support alongside the AI agent terminal.

use std::sync::Mutex;

use serde_json::json;
use tauri::State;

use super::IpcResponse;

/// Managed Tauri state wrapping the terminal manager.
pub struct TerminalManagerState(pub Mutex<crate::terminal::TerminalManager>);

/// Helper macro for locking the terminal manager with clean error handling.
macro_rules! lock_terminal {
    ($state:expr) => {
        match $state.0.lock() {
            Ok(guard) => guard,
            Err(e) => return IpcResponse::err(format!("Terminal manager lock poisoned: {}", e)),
        }
    };
}

/// Spawn a new terminal PTY session.
///
/// Returns `{ "id": "terminal-1" }` on success.
#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, TerminalManagerState>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    match manager.spawn(cols, rows, cwd) {
        Ok(id) => IpcResponse::ok(json!({ "id": id })),
        Err(e) => IpcResponse::err(e),
    }
}

/// Send input data to a terminal session.
#[tauri::command]
pub fn terminal_input(
    state: State<'_, TerminalManagerState>,
    id: String,
    data: String,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    match manager.send_input(&id, data.as_bytes()) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Resize a terminal session's PTY.
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalManagerState>,
    id: String,
    cols: u16,
    rows: u16,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    match manager.resize(&id, cols, rows) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Kill a terminal session.
#[tauri::command]
pub fn terminal_kill(
    state: State<'_, TerminalManagerState>,
    id: String,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    match manager.kill(&id) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// List all active terminal session IDs.
#[tauri::command]
pub fn terminal_list(
    state: State<'_, TerminalManagerState>,
) -> IpcResponse {
    let manager = lock_terminal!(state);
    let sessions = manager.list();
    IpcResponse::ok(json!({ "sessions": sessions }))
}
