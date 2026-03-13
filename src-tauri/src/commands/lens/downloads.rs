//! Download manager query commands.

use super::super::IpcResponse;
use super::LensState;

/// Return all tracked downloads.
#[tauri::command]
pub fn lens_get_downloads(
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let downloads = match state.downloads.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("downloads mutex poisoned: {e}")),
    };
    IpcResponse::ok(serde_json::json!({ "downloads": downloads.clone() }))
}

/// Clear completed and interrupted downloads from the list.
/// In-progress downloads are kept.
#[tauri::command]
pub fn lens_clear_downloads(
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let mut downloads = match state.downloads.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("downloads mutex poisoned: {e}")),
    };
    downloads.retain(|d| d.state == "downloading");
    IpcResponse::ok_empty()
}

/// Open a downloaded file with the OS default handler.
/// Validates that the path exists in the tracked downloads list to prevent
/// arbitrary file execution.
#[tauri::command]
pub fn lens_open_download(
    path: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let downloads = match state.downloads.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("downloads mutex poisoned: {e}")),
    };
    let found = downloads.iter().any(|d| d.path == path);
    if !found {
        return IpcResponse::err("Path not found in downloads list".to_string());
    }
    drop(downloads);
    if let Err(e) = opener::open(&path) {
        return IpcResponse::err(format!("Failed to open: {}", e));
    }
    IpcResponse::ok_empty()
}

/// Open the folder containing a downloaded file.
/// Validates that the resolved parent directory exists on disk.
#[tauri::command]
pub fn lens_open_download_folder(path: String) -> IpcResponse {
    let parent = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if parent.is_empty() || !std::path::Path::new(&parent).is_dir() {
        return IpcResponse::err("Directory does not exist".to_string());
    }
    if let Err(e) = opener::open(&parent) {
        return IpcResponse::err(format!("Failed to open folder: {}", e));
    }
    IpcResponse::ok_empty()
}
