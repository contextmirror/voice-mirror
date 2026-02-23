use super::IpcResponse;
use tauri::{AppHandle, Emitter, Manager};
use tauri::{LogicalPosition, LogicalSize, Position, Size, WebviewBuilder};
use std::collections::HashMap;
use std::sync::Mutex;
use tracing::{info, warn};

/// Maximum number of browser tabs allowed.
const MAX_TABS: usize = 8;

/// A single browser tab backed by a native WebView2 instance.
pub struct BrowserTab {
    pub webview_label: String,
}

/// Managed state tracking all browser tabs, the active tab, and shared bounds.
pub struct LensState {
    pub tabs: Mutex<HashMap<String, BrowserTab>>,
    pub active_tab_id: Mutex<Option<String>>,
    /// Last-known webview bounds (x, y, width, height) in logical pixels.
    pub bounds: Mutex<Option<(f64, f64, f64, f64)>>,
}

/// Get the active lens webview from state, or return an IpcResponse error.
fn get_lens_webview(
    app: &AppHandle,
    state: &tauri::State<'_, LensState>,
) -> Result<tauri::Webview, IpcResponse> {
    let active_id = state
        .active_tab_id
        .lock()
        .map_err(|e| IpcResponse::err(format!("Lock error: {}", e)))?
        .clone()
        .ok_or_else(|| IpcResponse::err("No active browser tab"))?;
    let tabs = state
        .tabs
        .lock()
        .map_err(|e| IpcResponse::err(format!("Lock error: {}", e)))?;
    let tab = tabs
        .get(&active_id)
        .ok_or_else(|| IpcResponse::err("Active tab not found"))?;
    app.get_webview(&tab.webview_label)
        .ok_or_else(|| IpcResponse::err("Lens webview not found"))
}

/// Get the current active tab ID (cloned out of the lock).
fn get_active_tab_id(
    state: &tauri::State<'_, LensState>,
) -> Result<Option<String>, String> {
    state
        .active_tab_id
        .lock()
        .map(|g| g.clone())
        .map_err(|e| format!("Lock error: {}", e))
}

/// Build the shortcut interception script for child WebView2 instances.
/// Child WebView2 instances are separate processes (NOT iframes), so
/// window.top.postMessage() doesn't reach the parent. Instead we fire a
/// request to a custom Tauri URI scheme (`lens-shortcut://`) which is handled
/// in lib.rs and re-emitted as a Tauri event the frontend can listen to.
fn build_shortcut_script() -> String {
    let shortcut_base = if cfg!(target_os = "windows") {
        "https://lens-shortcut.localhost/"
    } else {
        "lens-shortcut://localhost/"
    };
    format!(
        r#"document.addEventListener('keydown', function(e) {{
            var key = e.key;
            var lower = key.toLowerCase();
            if (key === 'F1') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'F1' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && lower === 'r') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'hard-refresh' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && ['n','t',','].includes(lower)) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + lower + '?t=' + Date.now();
                }} catch(err) {{}}
            }}
        }}, true);"#,
        shortcut_base, shortcut_base, shortcut_base
    )
}

/// Localhost-only dev-mode cache-busting script.
/// 1. Unregisters all service workers (they intercept Vite HMR and cause stale/blank pages).
/// 2. Overrides fetch() and XMLHttpRequest to bypass HTTP cache for dev servers.
/// Only activates when the page hostname is localhost or 127.0.0.1.
const CACHE_SCRIPT: &str = r#"
(function() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
                regs.forEach(function(reg) { reg.unregister(); });
            });
        }
        var originalFetch = window.fetch;
        window.fetch = function(url, opts) {
            opts = opts || {};
            opts.cache = 'no-store';
            return originalFetch.call(this, url, opts);
        };
        var originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {
            var result = originalOpen.apply(this, arguments);
            try { this.setRequestHeader('Cache-Control', 'no-cache, no-store'); } catch(e) {}
            return result;
        };
    }
})();
"#;

/// Internal helper: create a WebView2 child webview for a browser tab.
/// Returns the webview label on success.
async fn create_tab_webview(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let parsed_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let label = format!("lens-{}", timestamp);

    let app_clone = app.clone();
    let label_clone = label.clone();
    let tab_id_clone = tab_id.to_string();
    let shortcut_script = build_shortcut_script();

    // Run WebView2 creation on a blocking thread to prevent hanging the
    // tokio runtime. WebView2 initialization on Windows can block for
    // several hundred milliseconds while the browser process starts.
    let create_result = tokio::task::spawn_blocking(move || {
        let Some(window) = app_clone.get_window("main") else {
            return Err("Main window not found".to_string());
        };

        let app_for_handler = app_clone.clone();
        let tab_id_for_handler = tab_id_clone.clone();
        let builder =
            WebviewBuilder::new(&label_clone, tauri::WebviewUrl::External(parsed_url))
                .initialization_script(&shortcut_script)
                .initialization_script(CACHE_SCRIPT)
                .on_page_load(move |_webview, payload| {
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        let url_str = payload.url().to_string();
                        info!("[lens] Page load finished (tab {}): {}", tab_id_for_handler, url_str);
                        let _ = app_for_handler.emit(
                            "lens-url-changed",
                            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
                        );
                    }
                });

        info!("[lens] Calling window.add_child for {} (tab {})", label_clone, tab_id_clone);

        match window.add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        ) {
            Ok(_webview) => {
                info!("[lens] Webview created successfully: {} (tab {})", label_clone, tab_id_clone);
                Ok(label_clone)
            }
            Err(e) => {
                warn!("[lens] Failed to create webview: {}", e);
                Err(format!("Failed to create webview: {}", e))
            }
        }
    })
    .await
    .map_err(|e| format!("Spawn blocking failed: {}", e))?
    .map_err(|e| e)?;

    Ok(create_result)
}

/// Create a new browser tab with its own WebView2 instance.
/// Hides the previously active tab (doesn't close it). Caps at MAX_TABS.
///
/// This command is async because `window.add_child()` blocks while WebView2
/// initializes on Windows.
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

    // Hide the currently active tab's webview (don't close it)
    {
        let active_id = get_active_tab_id(&state)?;
        if let Some(ref aid) = active_id {
            let tabs = state.tabs.lock()
                .map_err(|e| format!("Lock error: {}", e))?;
            if let Some(tab) = tabs.get(aid) {
                if let Some(webview) = app.get_webview(&tab.webview_label) {
                    let _ = webview.hide();
                }
            }
        }
    }

    // Create the WebView2 instance
    let label = create_tab_webview(&app, &tab_id, &url, x, y, width, height).await?;

    // Store the tab and set as active
    {
        let mut tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        tabs.insert(tab_id.clone(), BrowserTab { webview_label: label.clone() });
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

/// Switch to a different browser tab. Hides the old active webview, shows the new one.
#[tauri::command]
pub fn lens_switch_tab(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    info!("[lens] Switching to tab {}", tab_id);

    // Get old active and verify new tab exists
    let (old_label, new_label) = {
        let tabs = match state.tabs.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };

        let new_tab = match tabs.get(&tab_id) {
            Some(t) => t,
            None => return IpcResponse::err(format!("Tab {} not found", tab_id)),
        };
        let new_label = new_tab.webview_label.clone();

        let active_id = state.active_tab_id.lock()
            .map(|g| g.clone())
            .unwrap_or(None);

        let old_label = active_id.and_then(|aid| {
            tabs.get(&aid).map(|t| t.webview_label.clone())
        });

        (old_label, new_label)
    };

    // Hide old active webview
    if let Some(ref old_lbl) = old_label {
        if *old_lbl != new_label {
            if let Some(webview) = app.get_webview(old_lbl) {
                let _ = webview.hide();
            }
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
        let mut active = match state.active_tab_id.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        *active = Some(tab_id);
    }

    IpcResponse::ok_empty()
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

    let label = create_tab_webview(&app, &tab_id, &url, x, y, width, height).await?;

    // Store the tab and set as active
    {
        let mut tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        tabs.insert(tab_id.clone(), BrowserTab { webview_label: label.clone() });
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
    lens_close_all_tabs(app, state)
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
