//! Tauri commands for LSP (Language Server Protocol) integration.
//!
//! Exposes LSP manager operations to the frontend: opening/closing files,
//! requesting completions, hover info, definitions, and managing server lifecycle.
//!
//! Note: Async Tauri commands that take `State<'_>` (a reference) must return
//! `Result<T, E>` due to Tauri's `AsyncCommandMustReturnResult` constraint.

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

    match manager.open_document(&uri, &lang_id, &content, &project_root).await {
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
    match manager.close_document(&uri, &lang_id, &project_root).await {
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
        .change_document(&uri, &lang_id, &content, version, &project_root)
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
    match manager.save_document(&uri, &lang_id, &content, &project_root).await {
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
        .request_completion(&uri, &lang_id, line, character, &project_root)
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
        .request_hover(&uri, &lang_id, line, character, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request signature help at a position in a file.
#[tauri::command]
pub async fn lsp_request_signature_help(
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
        .request_signature_help(&uri, &lang_id, line, character, &project_root)
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
        .request_definition(&uri, &lang_id, line, character, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request document symbols (outline) for a file.
#[tauri::command]
pub async fn lsp_request_document_symbols(
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
        None => return Ok(IpcResponse::err(format!("No LSP support for .{} files", ext))),
    };

    let uri = types::file_uri(&path, &project_root);

    let mut manager = state.0.lock().await;
    match manager
        .request_document_symbols(&uri, &lang_id, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request all references to a symbol at a position.
#[tauri::command]
pub async fn lsp_request_references(
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
        .request_references(&uri, &lang_id, line, character, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request code actions for a range in a file.
#[tauri::command]
pub async fn lsp_request_code_actions(
    path: String,
    range_start_line: u32,
    range_start_char: u32,
    range_end_line: u32,
    range_end_char: u32,
    diagnostics: serde_json::Value,
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
        .request_code_actions(
            &uri,
            &lang_id,
            range_start_line,
            range_start_char,
            range_end_line,
            range_end_char,
            diagnostics,
            &project_root,
        )
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Prepare a rename operation (check if symbol is renameable).
#[tauri::command]
pub async fn lsp_prepare_rename(
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
        .request_prepare_rename(&uri, &lang_id, line, character, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Perform a rename operation across the workspace.
#[tauri::command]
pub async fn lsp_rename(
    path: String,
    line: u32,
    character: u32,
    new_name: String,
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
        .request_rename(&uri, &lang_id, line, character, &new_name, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request document formatting for an entire file.
#[tauri::command]
pub async fn lsp_request_formatting(
    path: String,
    tab_size: u32,
    insert_spaces: bool,
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
        .request_formatting(&uri, &lang_id, tab_size, insert_spaces, &project_root)
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Request formatting for a range within a file.
#[tauri::command]
pub async fn lsp_request_range_formatting(
    path: String,
    range_start_line: u32,
    range_start_char: u32,
    range_end_line: u32,
    range_end_char: u32,
    tab_size: u32,
    insert_spaces: bool,
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
        .request_range_formatting(
            &uri,
            &lang_id,
            range_start_line,
            range_start_char,
            range_end_line,
            range_end_char,
            tab_size,
            insert_spaces,
            &project_root,
        )
        .await
    {
        Ok(result) => Ok(IpcResponse::ok(result)),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Apply a workspace edit (multi-file text edits from rename or code actions).
///
/// Parses a WorkspaceEdit's `changes` map (uri -> TextEdit[]), reads each file,
/// applies edits in reverse position order to avoid offset shifts, and writes back.
#[tauri::command]
pub async fn lsp_apply_workspace_edit(
    edits: serde_json::Value,
    project_root: String,
) -> IpcResponse {
    let changes = match edits.get("changes").and_then(|c| c.as_object()) {
        Some(c) => c,
        None => return IpcResponse::ok(json!({ "filesChanged": [] })),
    };

    let mut files_changed: Vec<String> = Vec::new();

    for (uri, text_edits) in changes {
        let rel_path = match types::uri_to_relative_path(uri, &project_root) {
            Some(p) => p,
            None => {
                return IpcResponse::err(format!(
                    "Cannot resolve URI to project path: {}",
                    uri
                ));
            }
        };

        let full_path = std::path::Path::new(&project_root).join(&rel_path);

        // Read the current file content
        let content = match tokio::fs::read_to_string(&full_path).await {
            Ok(c) => c,
            Err(e) => {
                return IpcResponse::err(format!(
                    "Failed to read {}: {}",
                    rel_path, e
                ));
            }
        };

        let lines: Vec<&str> = content.lines().collect();

        // Parse and sort edits in reverse position order (bottom-to-top, right-to-left)
        // so that applying one edit doesn't shift the positions of subsequent edits
        let mut edit_list: Vec<(u32, u32, u32, u32, String)> = match text_edits.as_array() {
            Some(arr) => arr
                .iter()
                .filter_map(|edit| {
                    let range = edit.get("range")?;
                    let start = range.get("start")?;
                    let end = range.get("end")?;
                    let new_text = edit.get("newText")?.as_str()?.to_string();
                    Some((
                        start.get("line")?.as_u64()? as u32,
                        start.get("character")?.as_u64()? as u32,
                        end.get("line")?.as_u64()? as u32,
                        end.get("character")?.as_u64()? as u32,
                        new_text,
                    ))
                })
                .collect(),
            None => continue,
        };

        // Sort in reverse order: by end line descending, then end character descending
        edit_list.sort_by(|a, b| {
            b.2.cmp(&a.2)
                .then_with(|| b.3.cmp(&a.3))
                .then_with(|| b.0.cmp(&a.0))
                .then_with(|| b.1.cmp(&a.1))
        });

        // Convert lines to owned strings for mutation
        let mut owned_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();

        // Apply each edit
        for (start_line, start_char, end_line, end_char, new_text) in &edit_list {
            let sl = *start_line as usize;
            let sc = *start_char as usize;
            let el = *end_line as usize;
            let ec = *end_char as usize;

            if sl >= owned_lines.len() {
                continue;
            }

            // Build the new content: prefix of start line + new_text + suffix of end line
            let prefix = if sc <= owned_lines[sl].len() {
                &owned_lines[sl][..sc]
            } else {
                &owned_lines[sl]
            };

            let suffix = if el < owned_lines.len() {
                if ec <= owned_lines[el].len() {
                    &owned_lines[el][ec..]
                } else {
                    ""
                }
            } else {
                ""
            };

            let replacement = format!("{}{}{}", prefix, new_text, suffix);

            // Replace the range of lines with the new content
            let new_lines: Vec<String> = replacement.lines().map(|l| l.to_string()).collect();

            // Handle the case where replacement ends with a newline
            let range_end = std::cmp::min(el + 1, owned_lines.len());
            owned_lines.splice(sl..range_end, new_lines);
        }

        // Write the file back
        let new_content = owned_lines.join("\n");
        // Preserve trailing newline if original had one
        let final_content = if content.ends_with('\n') && !new_content.ends_with('\n') {
            format!("{}\n", new_content)
        } else {
            new_content
        };

        if let Err(e) = tokio::fs::write(&full_path, &final_content).await {
            return IpcResponse::err(format!(
                "Failed to write {}: {}",
                rel_path, e
            ));
        }

        files_changed.push(rel_path);
    }

    IpcResponse::ok(json!({ "filesChanged": files_changed }))
}

/// Scan project files for a language and send didOpen to the LSP server.
///
/// This enables project-wide diagnostics by opening matching files in the
/// background. Files are tracked separately from user-opened documents.
#[tauri::command]
pub async fn lsp_scan_project(
    lang_id: String,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let mut manager = state.0.lock().await;
    match manager.scan_project_files(&lang_id, &project_root).await {
        Ok(count) => Ok(IpcResponse::ok(json!({"scanned": count}))),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Get a list of all known LSP servers from the manifest with install status.
///
/// Returns an array of server objects (id, languageId, binary, installed).
/// Does not require LspManagerState -- reads the manifest and checks PATH.
#[tauri::command]
pub async fn lsp_get_server_list(
    _app: AppHandle,
) -> Result<IpcResponse, ()> {
    let servers = detection::detect_all();
    let list: Vec<serde_json::Value> = servers
        .iter()
        .map(|s| {
            json!({
                "id": s.server_id,
                "languageId": s.language_id,
                "binary": s.binary,
                "installed": s.installed,
            })
        })
        .collect();
    Ok(IpcResponse::ok(json!(list)))
}

/// Manually trigger installation of a specific LSP server by ID.
///
/// Loads the manifest, finds the server entry, and runs the appropriate
/// install method (npm or github-release).
/// Emits `lsp-install-status` events for progress tracking.
#[tauri::command]
pub async fn lsp_install_server(
    app: AppHandle,
    server_id: String,
) -> Result<IpcResponse, ()> {
    let manifest = match crate::lsp::manifest::load_manifest() {
        Ok(m) => m,
        Err(e) => return Ok(IpcResponse::err(format!("Failed to load manifest: {}", e))),
    };

    let entry = match manifest.servers.get(&server_id) {
        Some(e) => e,
        None => return Ok(IpcResponse::err(format!("Unknown server: {}", server_id))),
    };

    let lsp_dir = match crate::lsp::installer::get_lsp_servers_dir() {
        Ok(d) => d,
        Err(e) => return Ok(IpcResponse::err(e)),
    };

    let result = match entry.install.install_type.as_str() {
        "npm" => {
            crate::lsp::installer::install_server(
                &server_id,
                &entry.install.packages,
                &entry.install.version,
                &lsp_dir,
                Some(&app),
            )
            .await
        }
        "github-release" => {
            crate::lsp::installer::install_github_release(
                &server_id,
                &entry.install.repo,
                &entry.install.asset_pattern,
                &entry.install.version,
                &lsp_dir,
                Some(&app),
            )
            .await
        }
        other => Err(format!("Unknown install type: {}", other)),
    };

    match result {
        Ok(()) => Ok(IpcResponse::ok(json!({ "ok": true, "server": server_id }))),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Toggle a server enabled/disabled in the user config.
///
/// Updates the `lspServers` config field and persists to disk using the
/// same mechanism as `set_config`.
#[tauri::command]
pub fn lsp_set_server_enabled(
    server_id: String,
    enabled: bool,
) -> IpcResponse {
    use crate::commands::config::CONFIG;
    use crate::config::persistence;
    use crate::services::platform;

    let mut guard = match CONFIG.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock config: {}", e)),
    };

    // Update the lsp_servers map
    let override_val = guard
        .lsp_servers
        .entry(server_id.clone())
        .or_insert_with(|| json!({}));

    if let Some(obj) = override_val.as_object_mut() {
        obj.insert("enabled".to_string(), json!(enabled));
    } else {
        // Value is not an object -- replace it
        *override_val = json!({ "enabled": enabled });
    }

    // Persist to disk
    let config_dir = platform::get_config_dir();
    if let Err(e) = persistence::save_config(&config_dir, &guard) {
        return IpcResponse::err(e);
    }

    IpcResponse::ok(json!({ "ok": true, "server": server_id, "enabled": enabled }))
}

/// Restart a specific LSP server (shut down + re-launch).
#[tauri::command]
pub async fn lsp_restart_server(
    lang_id: String,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let mut manager = state.0.lock().await;
    manager.shutdown_server(&lang_id, &project_root).await.ok();
    match manager.ensure_server(&lang_id, &project_root).await {
        Ok(()) => Ok(IpcResponse::ok(json!({"restarted": true}))),
        Err(e) => Ok(IpcResponse::err(e)),
    }
}

/// Get detailed information about a specific running LSP server.
///
/// Returns full stderr buffer, open document URIs, crash count, etc.
#[tauri::command]
pub async fn lsp_get_server_detail(
    lang_id: String,
    project_root: String,
    state: State<'_, LspManagerState>,
) -> Result<IpcResponse, ()> {
    let manager = state.0.lock().await;
    let key = crate::lsp::server_key(&lang_id, &project_root);
    match manager.servers.get(&key) {
        Some(server) => {
            let stderr = server
                .stderr_lines
                .try_lock()
                .map(|buf| buf.clone())
                .unwrap_or_default();
            Ok(IpcResponse::ok(json!({
                "languageId": server.language_id,
                "binary": server.binary,
                "state": server.state,
                "projectRoot": server.project_root,
                "version": server.version,
                "serverName": server.server_name,
                "crashCount": server.crash_count,
                "lastError": server.last_error,
                "openDocs": server.open_docs.iter().collect::<Vec<_>>(),
                "stderrLines": stderr,
                "pid": server.process.id(),
            })))
        }
        None => Ok(IpcResponse::err(format!(
            "No server found for {} in {}",
            lang_id, project_root
        ))),
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
