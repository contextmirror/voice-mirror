//! Browser tab zoom commands.

use tauri::{AppHandle, Manager};

use super::super::IpcResponse;
use super::LensState;

/// Set the zoom level of a browser tab's WebView2 instance.
/// Uses `ICoreWebView2Controller::SetZoomFactor` (synchronous COM call).
/// The factor is clamped to [0.25, 2.0].
#[tauri::command]
pub fn lens_set_zoom(
    app: AppHandle,
    tab_id: String,
    factor: f64,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    let factor_clamped = factor.clamp(0.25, 2.0);

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            unsafe {
                let controller = platform_webview.controller();
                let _ = controller.SetZoomFactor(factor_clamped);
            }
        });

        let mut tabs = match state.tabs.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
        };
        if let Some(tab) = tabs.get_mut(&tab_id) {
            tab.zoom_factor = factor_clamped;
        }
        IpcResponse::ok(serde_json::json!({ "zoomFactor": factor_clamped }))
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Get the current zoom factor for a browser tab.
#[tauri::command]
pub fn lens_get_zoom(
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    match tabs.get(&tab_id) {
        Some(tab) => IpcResponse::ok(serde_json::json!({ "zoomFactor": tab.zoom_factor })),
        None => IpcResponse::err("Tab not found"),
    }
}
