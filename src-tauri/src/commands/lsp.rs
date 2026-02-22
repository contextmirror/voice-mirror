//! Tauri commands for LSP (Language Server Protocol) integration.
//!
//! Exposes LSP manager operations to the frontend: opening/closing files,
//! requesting completions, hover info, definitions, and managing server lifecycle.

use serde_json::json;
use tauri::{AppHandle, State};

use super::IpcResponse;
use crate::lsp::detection;
use crate::lsp::types;
use crate::lsp::LspManagerState;

/// Extract a file extension from a path string.
fn extension_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .extension()
        .map(|ext| ext.to_string_lossy().to_string())
}

/// Open a file in the LSP server for the appropriate language.
///
/// Detects the language from the file extension, ensures the server is running,
/// and sends a `textDocument/didOpen` notification.
#[tauri::command]
pub async fn lsp_open_file(
    path: String,
    content: String,
    project_root: String,
    state: State<'_, LspManagerState>,
    _app: AppHandle,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;

    if let Err(e) = manager.ensure_server(&lang_id, &project_root).await {
        return Ok(IpcResponse::err(e));
    }

    match manager.open_document(&uri, &lang_id, &content).await {
        Ok(()) => Ok(IpcResponse::ok(json!({ "languageId": lang_id, "uri": uri }))),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Close a file in the LSP server.
///
/// Sends a `textDocument/didClose` notification. If no more documents are open
/// for the language, the server is shut down.
#[tauri::command]
pub async fn lsp_close_file(
    path: String,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::ok_empty()),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager.close_document(&uri, &lang_id).await {
        Ok(()) => Ok(IpcResponse::ok_empty()),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Notify the LSP server of file content changes.
#[tauri::command]
pub async fn lsp_change_file(
    path: String,
    content: String,
    version: i32,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::ok_empty()),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager
        .change_document(&uri, &lang_id, &content, version)
        .await
    {
        Ok(()) => Ok(IpcResponse::ok_empty()),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Notify the LSP server that a file was saved.
#[tauri::command]
pub async fn lsp_save_file(
    path: String,
    content: String,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::ok_empty()),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager.save_document(&uri, &lang_id, &content).await {
        Ok(()) => Ok(IpcResponse::ok_empty()),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request completion items at a position in a file.
#[tauri::command]
pub async fn lsp_request_completion(
    path: String,
    line: u32,
    character: u32,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager
        .request_completion(&uri, &lang_id, line, character)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request hover information at a position in a file.
#[tauri::command]
pub async fn lsp_request_hover(
    path: String,
    line: u32,
    character: u32,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager
        .request_hover(&uri, &lang_id, line, character)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request go-to-definition at a position in a file.
#[tauri::command]
pub async fn lsp_request_definition(
    path: String,
    line: u32,
    character: u32,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let ext = match extension_from_path(&path) {
        Some(e) => e,
        None => return Ok(IpcResponse::err("Could not determine file extension")),
    };

    let lang_id = match detection::language_id_for_extension(&ext) {
        Some(id) => id.to_string(),
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager
        .request_definition(&uri, &lang_id, line, character)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Get the status of all running LSP servers.
#[tauri::command]
pub async fn lsp_get_status(
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let manager = state.0.lock().await;
    let servers = manager.get_status();
    Ok(IpcResponse::ok(json!({ "servers": servers })))
}

/// Shut down all running LSP servers.
#[tauri::command]
pub async fn lsp_shutdown(
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let mut manager = state.0.lock().await;
    manager.shutdown_all().await;
    Ok(IpcResponse::ok_empty())
}
