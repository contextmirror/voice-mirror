use super::IpcResponse;
use tauri::{AppHandle, Emitter, Manager};
use tauri::{LogicalPosition, LogicalSize, Position, Size, WebviewBuilder};
use std::sync::Mutex;
use tracing::{info, warn};

/// Managed state tracking the active lens webview label and bounds.
pub struct LensState {
    pub webview_label: Mutex<Option<String>>,
    /// Last-known webview bounds (x, y, width, height) in logical pixels.
    pub bounds: Mutex<Option<(f64, f64, f64, f64)>>,
}

/// Get the active lens webview from state, or return an IpcResponse error.
fn get_lens_webview(
    app: &AppHandle,
    state: &tauri::State<'_, LensState>,
) -> Result<tauri::Webview, IpcResponse> {
    let label_guard = state
        .webview_label
        .lock()
        .map_err(|e| IpcResponse::err(format!("Lock error: {}", e)))?;
    let label = label_guard
        .as_ref()
        .ok_or_else(|| IpcResponse::err("No lens webview active"))?;
    app.get_webview(label)
        .ok_or_else(|| IpcResponse::err("Lens webview not found"))
}

/// Create a new embedded browser webview as a child of the main window.
/// Closes any existing lens webview first.
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
    info!("[lens] Creating webview at ({}, {}) {}x{} url={}", x, y, width, height, url);

    // Close any existing lens webview first
    {
        let mut label_guard = state.webview_label.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(ref old_label) = *label_guard {
            info!("[lens] Closing old webview: {}", old_label);
            if let Some(webview) = app.get_webview(old_label) {
                let _ = webview.close();
            }
            *label_guard = None;
        }
    }

    let parsed_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let label = format!("lens-{}", timestamp);

    // Clone values needed for the blocking task
    let app_clone = app.clone();
    let label_clone = label.clone();
    let pos_x = x;
    let pos_y = y;
    let w = width;
    let h = height;

    // Build the shortcut interception script.  Child WebView2 instances are
    // separate processes (NOT iframes), so window.top.postMessage() doesn't
    // reach the parent.  Instead we fire a request to a custom Tauri URI
    // scheme (`lens-shortcut://`) which is handled in lib.rs and re-emitted
    // as a Tauri event the frontend can listen to.
    let shortcut_base = if cfg!(target_os = "windows") {
        "https://lens-shortcut.localhost/"
    } else {
        "lens-shortcut://localhost/"
    };
    let shortcut_script = format!(
        r#"document.addEventListener('keydown', function(e) {{
            var key = e.key;
            var lower = key.toLowerCase();
            if (key === 'F1') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'F1' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && ['n','t',','].includes(lower)) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + lower + '?t=' + Date.now();
                }} catch(err) {{}}
            }}
        }}, true);"#,
        shortcut_base, shortcut_base
    );

    // Run WebView2 creation on a blocking thread to prevent hanging the
    // tokio runtime. WebView2 initialization on Windows can block for
    // several hundred milliseconds while the browser process starts.
    let create_result = tokio::task::spawn_blocking(move || {
        let Some(window) = app_clone.get_window("main") else {
            return Err("Main window not found".to_string());
        };

        let builder =
            WebviewBuilder::new(&label_clone, tauri::WebviewUrl::External(parsed_url))
                .initialization_script(&shortcut_script);

        info!("[lens] Calling window.add_child for {}", label_clone);

        match window.add_child(
            builder,
            Position::Logical(LogicalPosition::new(pos_x, pos_y)),
            Size::Logical(LogicalSize::new(w, h)),
        ) {
            Ok(_webview) => {
                info!("[lens] Webview created successfully: {}", label_clone);
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

    // Store the label and initial bounds
    {
        let mut label_guard = state.webview_label.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *label_guard = Some(create_result.clone());
    }
    {
        let mut bounds_guard = state.bounds.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *bounds_guard = Some((x, y, width, height));
    }

    let _ = app.emit("lens-url-changed", serde_json::json!({ "url": url }));

    Ok(IpcResponse::ok(serde_json::json!({ "label": create_result })))
}

/// Navigate the active lens webview to a new URL.
#[tauri::command]
pub fn lens_navigate(
    app: AppHandle,
    url: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
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
            let _ = app.emit("lens-url-changed", serde_json::json!({ "url": url }));
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
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    match webview.eval("history.back()") {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to go back: {}", e)),
    }
}

/// Navigate the lens webview forward in history.
#[tauri::command]
pub fn lens_go_forward(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    match webview.eval("history.forward()") {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to go forward: {}", e)),
    }
}

/// Reload the lens webview.
#[tauri::command]
pub fn lens_reload(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    match webview.eval("location.reload()") {
        Ok(()) => IpcResponse::ok_empty(),
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

/// Close the active lens webview and clear state.
#[tauri::command]
pub fn lens_close_webview(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    match webview.close() {
        Ok(()) => {
            let mut label_guard = match state.webview_label.lock() {
                Ok(g) => g,
                Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
            };
            *label_guard = None;
            if let Ok(mut bounds_guard) = state.bounds.lock() {
                *bounds_guard = None;
            }
            info!("[lens] Webview closed");
            IpcResponse::ok_empty()
        }
        Err(e) => IpcResponse::err(format!("Failed to close webview: {}", e)),
    }
}

/// Show or hide the lens webview.
#[tauri::command]
pub fn lens_set_visible(
    app: AppHandle,
    visible: bool,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let webview = match get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(e) => return e,
    };

    let result = if visible {
        webview.show()
    } else {
        webview.hide()
    };

    match result {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!(
            "Failed to {} lens: {}",
            if visible { "show" } else { "hide" },
            e
        )),
    }
}
