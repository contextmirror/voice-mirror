//! Navigation and webview lifecycle commands.

use tauri::{AppHandle, Emitter, Manager, Position, Size, LogicalPosition, LogicalSize};
use tracing::{info, warn};

use super::super::IpcResponse;
use super::{LensState, get_lens_webview};

/// Navigate the active lens webview to a new URL.
#[tauri::command]
pub fn lens_navigate(
    app: AppHandle,
    url: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    // Read active tab ID before getting webview (separate lock scopes)
    let active_id = state.active_tab_id.lock()
        .map(|g| g.clone())
        .unwrap_or(None);

    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    let parsed_url = match url.parse::<tauri::Url>() {
        Ok(u) => u,
        Err(e) => return IpcResponse::err(format!("Invalid URL: {}", e)),
    };

    match webview.navigate(parsed_url) {
        Ok(()) => {
            let _ = app.emit("lens-url-changed", serde_json::json!({ "url": url, "tabId": active_id }));
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to navigate: {}", e)),
    }
}

/// Navigate the lens webview back in history.
#[tauri::command]
pub fn lens_go_back(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let active_id = state.active_tab_id.lock()
        .map(|g| g.clone())
        .unwrap_or(None);

    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    // Inject a script that navigates back and then reports the new URL
    // so the frontend can clear the loading state.
    let notify_script = format!(
        r#"history.back(); setTimeout(function(){{ try {{ (new Image()).src = '{}url-changed?url=' + encodeURIComponent(location.href); }} catch(e){{}} }}, 300);"#,
        if cfg!(target_os = "windows") { "https://lens-shortcut.localhost/" } else { "lens-shortcut://localhost/" }
    );
    match webview.eval(&notify_script) {
        Ok(()) => {
            // Also emit immediately so loading clears even if the image trick fails
            let _ = app.emit("lens-url-changed", serde_json::json!({ "tabId": active_id }));
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to go back: {}", e)),
    }
}

/// Navigate the lens webview forward in history.
#[tauri::command]
pub fn lens_go_forward(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let active_id = state.active_tab_id.lock()
        .map(|g| g.clone())
        .unwrap_or(None);

    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    let notify_script = format!(
        r#"history.forward(); setTimeout(function(){{ try {{ (new Image()).src = '{}url-changed?url=' + encodeURIComponent(location.href); }} catch(e){{}} }}, 300);"#,
        if cfg!(target_os = "windows") { "https://lens-shortcut.localhost/" } else { "lens-shortcut://localhost/" }
    );
    match webview.eval(&notify_script) {
        Ok(()) => {
            let _ = app.emit("lens-url-changed", serde_json::json!({ "tabId": active_id }));
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to go forward: {}", e)),
    }
}

/// Reload the lens webview.
#[tauri::command]
pub fn lens_reload(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let active_id = state.active_tab_id.lock()
        .map(|g| g.clone())
        .unwrap_or(None);

    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    match webview.eval("location.reload()") {
        Ok(()) => {
            // Emit event so frontend clears loading state
            let _ = app.emit("lens-url-changed", serde_json::json!({ "tabId": active_id }));
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to reload: {}", e)),
    }
}

/// Reposition and resize the lens webview.
#[tauri::command]
pub fn lens_resize_webview(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    if let Err(e) = webview.set_position(Position::Logical(LogicalPosition::new(x, y))) {
        return IpcResponse::err(format!("Failed to set position: {}", e));
    }

    match webview.set_size(Size::Logical(LogicalSize::new(width, height))) {
        Ok(()) => {
            // Store the updated bounds for screenshot cropping
            if let Ok(mut bounds_guard) = state.bounds.lock() {
                *bounds_guard = Some((x, y, width, height));
            }
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to set size: {}", e)),
    }
}

/// Close all lens webviews and clear state.
/// Backward-compatible entry point that closes all tabs.
#[tauri::command]
pub fn lens_close_webview(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    super::tabs::lens_close_all_tabs(app, state)
}

/// Show or hide the lens webview(s).
/// When visible=true, only the active tab's webview is shown (others stay hidden).
/// When visible=false, all tab webviews are hidden.
#[tauri::command]
pub fn lens_set_visible(
    app: AppHandle,
    visible: bool,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let active_id = state.active_tab_id.lock()
        .map(|g| g.clone())
        .unwrap_or(None);

    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
    };

    if tabs.is_empty() {
        return IpcResponse::err("No browser tabs active");
    }

    for (tid, tab) in tabs.iter() {
        if let Some(webview) = app.get_webview(&tab.webview_label) {
            if visible && active_id.as_deref() == Some(tid.as_str()) {
                let _ = webview.show();
            } else {
                let _ = webview.hide();
            }
        }
    }

    IpcResponse::ok_empty()
}

/// Hard-refresh the lens webview by clearing all browsing data and reloading.
/// This forces the browser to bypass all caches (disk, memory, service workers)
/// and reload completely fresh content.
#[tauri::command]
pub fn lens_hard_refresh(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let active_id = state.active_tab_id.lock()
        .map(|g| g.clone())
        .unwrap_or(None);

    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    // Clear all browsing data (disk cache, cookies, localStorage, IndexedDB)
    // before reloading to guarantee fresh content.
    if let Err(e) = webview.clear_all_browsing_data() {
        warn!("[lens] Failed to clear browsing data on hard refresh: {}", e);
    }

    match webview.eval("location.reload()") {
        Ok(()) => {
            let _ = app.emit("lens-url-changed", serde_json::json!({ "tabId": active_id }));
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to hard refresh: {}", e)),
    }
}

/// Clear all browsing data (cache, cookies, localStorage, IndexedDB) for the
/// lens webview. Called before navigating to a new dev server URL on project
/// switch to prevent stale content from a previously-cached localhost port.
#[tauri::command]
pub fn lens_clear_cache(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    match webview.clear_all_browsing_data() {
        Ok(()) => {
            info!("[lens] Browsing data cleared");
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to clear browsing data: {}", e)),
    }
}
