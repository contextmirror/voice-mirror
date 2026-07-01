use tauri::{AppHandle, Emitter, Manager, Position, Size, LogicalPosition, LogicalSize};
use tracing::info;
use super::super::IpcResponse;
use super::{LensState, BrowserTab};
use super::webview_setup::{create_tab_webview, MAX_TABS};

/// Park a webview off-screen and hide it so it cannot paint over the DOM.
///
/// Lens tab webviews are native child WebView2 windows layered *above* the DOM;
/// they ignore CSS visibility, and `webview.hide()` alone can leave a ghost
/// rectangle that covers whatever is behind it (notably the bottom terminal
/// panel — the black-void regression). Moving the webview to (-9999, -9999) with
/// size 0 guarantees it cannot cover any UI even if `hide()` is a no-op for the
/// platform webview. This mirrors the off-screen trick the frontend uses in
/// `syncBounds` for CSS-hidden containers.
fn park_webview_offscreen(app: &AppHandle, label: &str) {
    if let Some(webview) = app.get_webview(label) {
        let _ = webview.set_position(Position::Logical(LogicalPosition::new(-9999.0, -9999.0)));
        let _ = webview.set_size(Size::Logical(LogicalSize::new(0.0, 0.0)));
        let _ = webview.hide();
    }
}

#[tauri::command]
pub async fn lens_create_tab(
    app: AppHandle,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    info!("[lens] Creating tab {} at ({}, {}) {}x{} url={}", tab_id, x, y, width, height, url);

    // Check tab cap
    {
        let tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if tabs.len() >= MAX_TABS {
            return Ok(IpcResponse::err(format!("Maximum {} browser tabs reached", MAX_TABS)));
        }
    }

    // Park every existing tab's webview off-screen so none can paint over the
    // DOM (e.g. the bottom terminal panel) once the new tab becomes active.
    // Enforces the invariant: only the active tab's webview is ever on-screen.
    {
        let tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        for tab in tabs.values() {
            park_webview_offscreen(&app, &tab.webview_label);
        }
    }

    // Create the WebView2 instance
    let downloads_arc = state.downloads.clone();
    let label = create_tab_webview(&app, &tab_id, &url, x, y, width, height, downloads_arc).await?;

    // Store the tab and set as active
    {
        let mut tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        tabs.insert(tab_id.clone(), BrowserTab { webview_label: label.clone(), zoom_factor: 1.0 });
    }
    {
        let mut active = state.active_tab_id.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *active = Some(tab_id.clone());
    }
    {
        let mut bounds_guard = state.bounds.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *bounds_guard = Some((x, y, width, height));
    }

    let _ = app.emit("lens-url-changed", serde_json::json!({ "url": url, "tabId": tab_id }));

    Ok(IpcResponse::ok(serde_json::json!({ "label": label, "tabId": tab_id })))
}

/// Close a browser tab and its WebView2 instance.
/// Does NOT auto-switch to a neighbor — the frontend controls which tab becomes
/// active by calling `lens_switch_tab` after this returns. This avoids a
/// disagreement between Rust's HashMap iteration order and the frontend's
/// deterministic neighbor selection (left→right→first).
/// Refuses to close the last tab.
#[tauri::command]
pub fn lens_close_tab(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    info!("[lens] Closing tab {}", tab_id);

    let webview_label = {
        let mut tabs = match state.tabs.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };

        if tabs.len() <= 1 {
            return IpcResponse::err("Cannot close the last browser tab");
        }

        let tab = match tabs.remove(&tab_id) {
            Some(t) => t,
            None => return IpcResponse::err(format!("Tab {} not found", tab_id)),
        };

        tab.webview_label
    };

    // Close the WebView2
    if let Some(webview) = app.get_webview(&webview_label) {
        let _ = webview.close();
    }

    // Clear active_tab_id if it pointed to the closed tab (frontend will set it via lens_switch_tab)
    {
        let mut active = match state.active_tab_id.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        if active.as_deref() == Some(&tab_id) {
            *active = None;
        }
    }

    IpcResponse::ok_empty()
}

/// Core tab switching logic — hides old webview, shows new one, updates active ID.
/// Callable from both Tauri commands and the browser bridge.
pub fn switch_tab_impl(
    app: &AppHandle,
    tab_id: &str,
    state: &LensState,
) -> Result<(), String> {
    info!("[lens] Switching to tab {}", tab_id);

    // Verify the target tab exists and collect every tab's webview label.
    let (all_labels, new_label) = {
        let tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let new_label = tabs.get(tab_id)
            .ok_or_else(|| format!("Tab {} not found", tab_id))?
            .webview_label.clone();
        let all_labels: Vec<String> = tabs.values().map(|t| t.webview_label.clone()).collect();
        (all_labels, new_label)
    };

    // Park every non-active tab's webview off-screen + hidden. Native child
    // WebView2 windows ignore CSS visibility, so an inactive tab left at real
    // bounds would cover the DOM behind it (the bottom terminal panel). Parking
    // ALL other tabs (not just the previously-active one) makes the invariant
    // "exactly one visible Lens webview" hold regardless of prior state.
    for label in &all_labels {
        if *label != new_label {
            park_webview_offscreen(app, label);
        }
    }

    // Apply bounds and show new webview
    if let Some(webview) = app.get_webview(&new_label) {
        if let Ok(bounds_guard) = state.bounds.lock() {
            if let Some((bx, by, bw, bh)) = *bounds_guard {
                let _ = webview.set_position(Position::Logical(LogicalPosition::new(bx, by)));
                let _ = webview.set_size(Size::Logical(LogicalSize::new(bw, bh)));
            }
        }
        let _ = webview.show();
    }

    // Update active tab ID
    {
        let mut active = state.active_tab_id.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *active = Some(tab_id.to_string());
    }

    Ok(())
}

/// Switch to a different browser tab. Hides the old active webview, shows the new one.
#[tauri::command]
pub fn lens_switch_tab(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    match switch_tab_impl(&app, &tab_id, &state) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Close all browser tabs and their WebView2 instances. Called on component unmount.
#[tauri::command]
pub fn lens_close_all_tabs(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    info!("[lens] Closing all tabs");

    // Drain all tabs
    let labels: Vec<String> = {
        let mut tabs = match state.tabs.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        let labels: Vec<String> = tabs.values().map(|t| t.webview_label.clone()).collect();
        tabs.clear();
        labels
    };

    // Close all WebView2 instances
    for label in &labels {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.close();
        }
    }

    // Clear active tab and bounds
    {
        let mut active = match state.active_tab_id.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        *active = None;
    }
    {
        let mut bounds = match state.bounds.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        *bounds = None;
    }

    IpcResponse::ok_empty()
}

/// Create a new embedded browser webview as a child of the main window.
/// Backward-compatible entry point: closes all existing tabs first, then creates
/// a single tab. Frontend migration path: use `lens_create_tab` instead.
///
/// This command is async because `window.add_child()` blocks while WebView2
/// initializes on Windows. Running it as an async command keeps it on the
/// tokio runtime, allowing the main thread event loop to stay responsive.
#[tauri::command]
pub async fn lens_create_webview(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    info!("[lens] Creating webview (compat) at ({}, {}) {}x{} url={}", x, y, width, height, url);

    // Close any existing tabs first
    {
        let mut tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        for tab in tabs.values() {
            if let Some(webview) = app.get_webview(&tab.webview_label) {
                let _ = webview.close();
            }
        }
        tabs.clear();
    }
    {
        let mut active = state.active_tab_id.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *active = None;
    }

    // Generate a tab_id and create via the shared helper
    let tab_id = format!("btab-compat-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let downloads_arc = state.downloads.clone();
    let label = create_tab_webview(&app, &tab_id, &url, x, y, width, height, downloads_arc).await?;

    // Store the tab and set as active
    {
        let mut tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        tabs.insert(tab_id.clone(), BrowserTab { webview_label: label.clone(), zoom_factor: 1.0 });
    }
    {
        let mut active = state.active_tab_id.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *active = Some(tab_id.clone());
    }
    {
        let mut bounds_guard = state.bounds.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *bounds_guard = Some((x, y, width, height));
    }

    let _ = app.emit("lens-url-changed", serde_json::json!({ "url": url, "tabId": tab_id }));

    Ok(IpcResponse::ok(serde_json::json!({ "label": label })))
}
