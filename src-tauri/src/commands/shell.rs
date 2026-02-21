//! Tauri commands for managing independent shell terminal sessions.
//!
//! These commands expose `ShellManager` operations to the frontend,
//! enabling tabbed terminal support alongside the AI agent terminal.

use std::sync::Mutex;

use serde_json::json;
use tauri::State;

use super::IpcResponse;

/// Managed Tauri state wrapping the shell manager.
pub struct ShellManagerState(pub Mutex<crate::shell::ShellManager>);

/// Helper macro for locking the shell manager with clean error handling.
macro_rules! lock_shell {
    ($state:expr) => {
        match $state.0.lock() {
            Ok(guard) => guard,
            Err(e) => return IpcResponse::err(format!("Shell manager lock poisoned: {}", e)),
        }
    };
}

/// Spawn a new shell PTY session.
///
/// Returns `{ "id": "shell-1" }` on success.
#[tauri::command]
pub fn shell_spawn(
    state: State<'_, ShellManagerState>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> IpcResponse {
    let mut manager = lock_shell!(state);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    match manager.spawn(cols, rows, cwd) {
        Ok(id) => IpcResponse::ok(json!({ "id": id })),
        Err(e) => IpcResponse::err(e),
    }
}

/// Send input data to a shell session.
#[tauri::command]
pub fn shell_input(
    state: State<'_, ShellManagerState>,
    id: String,
    data: String,
) -> IpcResponse {
    let mut manager = lock_shell!(state);
    match manager.send_input(&id, data.as_bytes()) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Resize a shell session's PTY.
#[tauri::command]
pub fn shell_resize(
    state: State<'_, ShellManagerState>,
    id: String,
    cols: u16,
    rows: u16,
) -> IpcResponse {
    let mut manager = lock_shell!(state);
    match manager.resize(&id, cols, rows) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Kill a shell session.
#[tauri::command]
pub fn shell_kill(
    state: State<'_, ShellManagerState>,
    id: String,
) -> IpcResponse {
    let mut manager = lock_shell!(state);
    match manager.kill(&id) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// List all active shell session IDs.
#[tauri::command]
pub fn shell_list(
    state: State<'_, ShellManagerState>,
) -> IpcResponse {
    let manager = lock_shell!(state);
    let sessions = manager.list();
    IpcResponse::ok(json!({ "sessions": sessions }))
}
