use super::IpcResponse;
use tauri::{AppHandle, Emitter, Manager};
use tauri::{LogicalPosition, LogicalSize, Position, Size, WebviewBuilder};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tracing::{info, warn};

static DOWNLOAD_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadEntry {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub total_bytes: i64,
    pub received_bytes: i64,
    pub state: String, // "downloading", "completed", "interrupted"
    pub path: String,
    pub timestamp: u128,
}

/// Maximum number of browser tabs allowed.
const MAX_TABS: usize = 8;

/// Maximum number of device preview webviews allowed.
const MAX_DEVICE_WEBVIEWS: usize = 3;

/// A single browser tab backed by a native WebView2 instance.
pub struct BrowserTab {
    pub webview_label: String,
    pub zoom_factor: f64,
}

/// A device-preview webview tied to a responsive-design preset.
pub struct DeviceWebview {
    pub preset_id: String,
    pub webview_label: String,
}

/// Managed state tracking all browser tabs, the active tab, and shared bounds.
pub struct LensState {
    pub tabs: Mutex<HashMap<String, BrowserTab>>,
    pub active_tab_id: Mutex<Option<String>>,
    /// Last-known webview bounds (x, y, width, height) in logical pixels.
    pub bounds: Mutex<Option<(f64, f64, f64, f64)>>,
    /// Device-preview webviews for responsive design mode.
    pub device_webviews: Mutex<Vec<DeviceWebview>>,
    /// In-memory download tracker. Arc allows cloning into COM handler closures.
    pub downloads: Arc<Mutex<Vec<DownloadEntry>>>,
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
            }} else if ((e.ctrlKey || e.metaKey) && lower === 'f') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'find' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && (key === '+' || key === '=')) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-in' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && key === '-') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-out' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && key === '0') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-reset' + '?t=' + Date.now();
                }} catch(err) {{}}
            }}
        }}, true);"#,
        shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base
    )
}

/// Evaluate `document.title` in a child webview via the native WebView2 COM API
/// and emit a `lens-title-changed` Tauri event with the result.
///
/// This must be done via COM because:
/// 1. Tauri's `webview.eval()` is fire-and-forget (no return value)
/// 2. Custom URI schemes (`register_uri_scheme_protocol`) don't intercept
///    requests from child webviews — only the main app webview
///
/// Uses `std::thread::spawn` because `on_page_load` runs on the main Win32 GUI
/// thread which has no tokio runtime context.
fn report_page_title(app: &AppHandle, webview: &tauri::Webview, tab_id: String) {
    let app = app.clone();
    let webview = webview.clone();

    std::thread::spawn(move || {
        // Brief delay to let the page title settle (some pages set title via JS after load)
        std::thread::sleep(std::time::Duration::from_millis(150));

        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

        let eval_result = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;

                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(_) => {
                            let _ = tx.send(None);
                            return;
                        }
                    };

                    let js = HSTRING::from("document.title");
                    let handler =
                        ExecuteScriptCompletedHandler::create(Box::new(move |hresult, result| {
                            if hresult.is_ok() {
                                // ExecuteScript returns JSON-serialized string, e.g. "\"Google\""
                                let title = result.trim_matches('"').to_string();
                                if !title.is_empty() && title != "null" {
                                    let _ = tx.send(Some(title));
                                } else {
                                    let _ = tx.send(None);
                                }
                            } else {
                                let _ = tx.send(None);
                            }
                            Ok(())
                        }));

                    if let Err(_) = core_webview.ExecuteScript(&js, &handler) {
                        // handler was moved, tx is gone — nothing to do
                    }
                }

                #[cfg(not(windows))]
                {
                    let _ = tx.send(None);
                }
            }
        });

        if eval_result.is_err() {
            return;
        }

        // Wait up to 2s for the COM callback
        let title = match rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(Some(t)) => t,
            _ => return,
        };
        info!("[lens] Page title (tab {}): {}", tab_id, title);
        let _ = app.emit(
            "lens-title-changed",
            serde_json::json!({ "tabId": tab_id, "title": title }),
        );
    });
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

/// Console hook initialization script for child WebView2 instances.
///
/// Intercepts `console.log/warn/error/info/debug` and sends each call to the
/// `lens-console` custom URI scheme via `new Image().src` (fire-and-forget GET).
/// Rust handles these in `lib.rs` and emits a `lens-console-message` Tauri event
/// that the frontend can route to the appropriate project output channel.
///
/// The original console method is always called so DevTools still work normally.
/// Arguments are serialized: objects → JSON, errors → stack trace, primitives → String.
///
/// URL format (Windows): `https://lens-console.localhost/{level}?m={encoded_message}`
/// URL format (others):  `lens-console://localhost/{level}?m={encoded_message}`
const CONSOLE_HOOK_SCRIPT: &str = r#"
(function() {
    if (window.__voiceMirrorConsoleHook) return;
    window.__voiceMirrorConsoleHook = true;
    var base = (navigator.platform && navigator.platform.indexOf('Win') !== -1)
        ? 'https://lens-console.localhost/'
        : 'lens-console://localhost/';
    var methods = ['log','warn','error','info','debug'];
    methods.forEach(function(method) {
        var orig = console[method];
        console[method] = function() {
            try {
                var args = Array.prototype.slice.call(arguments);
                var parts = [];
                for (var i = 0; i < args.length; i++) {
                    var a = args[i];
                    if (a === null) { parts.push('null'); continue; }
                    if (a === undefined) { parts.push('undefined'); continue; }
                    if (a instanceof Error) { parts.push(a.stack || a.toString()); continue; }
                    if (typeof a === 'object') {
                        try { parts.push(JSON.stringify(a, null, 2)); }
                        catch(e) { parts.push(String(a)); }
                        continue;
                    }
                    parts.push(String(a));
                }
                var msg = parts.join(' ');
                if (msg.length > 4000) msg = msg.substring(0, 4000) + '...(truncated)';
                new Image().src = base + method + '?m=' + encodeURIComponent(msg) + '&t=' + Date.now();
            } catch(e) {}
            orig.apply(console, arguments);
        };
    });
})();
"#;

/// Hook the WebView2 `DownloadStarting` event so file downloads are tracked
/// and progress is emitted to the frontend.  Called once per newly-created
/// child webview.
///
/// `SetHandled(false)` lets WebView2 use its built-in Save-As dialog while we
/// still receive state-change and progress callbacks.
fn register_download_handler(
    app: &AppHandle,
    webview: &tauri::Webview,
    downloads: Arc<Mutex<Vec<DownloadEntry>>>,
) {
    let app_handle = app.clone();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{
                DownloadStartingEventHandler,
                StateChangedEventHandler,
                BytesReceivedChangedEventHandler,
                take_pwstr,
            };
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for download handler: {:?}", e);
                        return;
                    }
                };

                let wv4: ICoreWebView2_4 = match core_webview.cast() {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("[lens] Failed to cast to ICoreWebView2_4: {:?}", e);
                        return;
                    }
                };

                let downloads_for_handler = downloads.clone();
                let app_for_handler = app_handle.clone();

                let handler = DownloadStartingEventHandler::create(Box::new(
                    move |_sender, args| {
                        let args = match args {
                            Some(a) => a,
                            None => return Ok(()),
                        };

                        // Get download operation
                        let download_op = args.DownloadOperation()?;

                        // Get result file path from args (where WebView2 will save)
                        let mut result_path_pwstr = windows_core::PWSTR::null();
                        args.ResultFilePath(&mut result_path_pwstr)?;
                        let result_path = take_pwstr(result_path_pwstr);

                        // Extract filename from the path
                        let filename = std::path::Path::new(&result_path)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "download".to_string());

                        // Get URI from download operation
                        let mut uri_pwstr = windows_core::PWSTR::null();
                        download_op.Uri(&mut uri_pwstr)?;
                        let uri = take_pwstr(uri_pwstr);

                        // Get total bytes
                        let mut total_bytes: i64 = -1;
                        let _ = download_op.TotalBytesToReceive(&mut total_bytes);

                        // Generate unique download ID
                        let dl_id = format!("dl-{}", DOWNLOAD_COUNTER.fetch_add(1, Ordering::Relaxed));

                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();

                        let entry = DownloadEntry {
                            id: dl_id.clone(),
                            filename: filename.clone(),
                            url: uri.clone(),
                            total_bytes,
                            received_bytes: 0,
                            state: "downloading".to_string(),
                            path: result_path.clone(),
                            timestamp,
                        };

                        // Store entry
                        if let Ok(mut guard) = downloads_for_handler.lock() {
                            guard.push(entry.clone());
                        }

                        // Emit start event
                        let _ = app_for_handler.emit(
                            "lens-download-started",
                            serde_json::json!({
                                "id": dl_id,
                                "filename": filename,
                                "url": uri,
                                "totalBytes": total_bytes,
                                "path": result_path,
                                "timestamp": timestamp,
                            }),
                        );

                        info!("[lens] Download started: {} -> {}", filename, result_path);

                        // Let WebView2 use its default Save-As dialog
                        args.SetHandled(false)?;

                        // Register BytesReceivedChanged handler for progress updates
                        {
                            let dl_id_progress = dl_id.clone();
                            let app_progress = app_for_handler.clone();
                            let downloads_progress = downloads_for_handler.clone();

                            let progress_handler = BytesReceivedChangedEventHandler::create(
                                Box::new(move |sender, _args| {
                                    let op = match sender {
                                        Some(ref op) => op,
                                        None => return Ok(()),
                                    };

                                    let mut received: i64 = 0;
                                    let _ = op.BytesReceived(&mut received);
                                    let mut total: i64 = -1;
                                    let _ = op.TotalBytesToReceive(&mut total);

                                    // Update in-memory entry
                                    if let Ok(mut guard) = downloads_progress.lock() {
                                        if let Some(entry) = guard.iter_mut().find(|e| e.id == dl_id_progress) {
                                            entry.received_bytes = received;
                                            if total > 0 {
                                                entry.total_bytes = total;
                                            }
                                        }
                                    }

                                    let _ = app_progress.emit(
                                        "lens-download-progress",
                                        serde_json::json!({
                                            "id": dl_id_progress,
                                            "receivedBytes": received,
                                            "totalBytes": total,
                                        }),
                                    );

                                    Ok(())
                                }),
                            );

                            let mut progress_token: i64 = 0;
                            let _ = download_op.add_BytesReceivedChanged(
                                &progress_handler,
                                &mut progress_token,
                            );
                        }

                        // Register StateChanged handler for completion/interruption
                        {
                            let dl_id_state = dl_id.clone();
                            let app_state = app_for_handler.clone();
                            let downloads_state = downloads_for_handler.clone();

                            let state_handler = StateChangedEventHandler::create(Box::new(
                                move |sender, _args| {
                                    let op = match sender {
                                        Some(ref op) => op,
                                        None => return Ok(()),
                                    };

                                    let mut download_state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
                                    op.State(&mut download_state)?;

                                    let mut received: i64 = 0;
                                    let _ = op.BytesReceived(&mut received);
                                    let mut total: i64 = -1;
                                    let _ = op.TotalBytesToReceive(&mut total);

                                    // Get the final result file path (may differ from initial)
                                    let mut final_path_pwstr = windows_core::PWSTR::null();
                                    let _ = op.ResultFilePath(&mut final_path_pwstr);
                                    let final_path = take_pwstr(final_path_pwstr);

                                    let state_str = match download_state {
                                        COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED => "completed",
                                        COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED => "interrupted",
                                        _ => "downloading",
                                    };

                                    // Update in-memory entry
                                    if let Ok(mut guard) = downloads_state.lock() {
                                        if let Some(entry) = guard.iter_mut().find(|e| e.id == dl_id_state) {
                                            entry.state = state_str.to_string();
                                            entry.received_bytes = received;
                                            if total > 0 {
                                                entry.total_bytes = total;
                                            }
                                            if !final_path.is_empty() {
                                                entry.path = final_path.clone();
                                            }
                                        }
                                    }

                                    let _ = app_state.emit(
                                        "lens-download-progress",
                                        serde_json::json!({
                                            "id": dl_id_state,
                                            "receivedBytes": received,
                                            "totalBytes": total,
                                            "state": state_str,
                                            "path": final_path,
                                        }),
                                    );

                                    if state_str != "downloading" {
                                        info!("[lens] Download {}: {} ({})", state_str, dl_id_state, final_path);
                                    }

                                    Ok(())
                                },
                            ));

                            let mut state_token: i64 = 0;
                            let _ = download_op.add_StateChanged(
                                &state_handler,
                                &mut state_token,
                            );
                        }

                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = wv4.add_DownloadStarting(&handler, &mut token) {
                    warn!("[lens] Failed to register download handler: {:?}", e);
                } else {
                    info!("[lens] Download handler registered (token={})", token);
                }
            }
        }
    });
}

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
    downloads: Arc<Mutex<Vec<DownloadEntry>>>,
) -> Result<String, String> {
    let parsed_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let label = format!("lens-{}", timestamp);

    let app_clone = app.clone();
    let app_for_download = app.clone();
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
                .initialization_script(CONSOLE_HOOK_SCRIPT)
                .on_page_load(move |webview, payload| {
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        let url_str = payload.url().to_string();
                        info!("[lens] Page load finished (tab {}): {}", tab_id_for_handler, url_str);
                        let _ = app_for_handler.emit(
                            "lens-url-changed",
                            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
                        );
                        let _ = app_for_handler.emit(
                            "lens-history-entry",
                            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
                        );
                        // Extract page title via COM API and emit lens-title-changed event
                        report_page_title(&app_for_handler, &webview, tab_id_for_handler.clone());
                    }
                });

        info!("[lens] Calling window.add_child for {} (tab {})", label_clone, tab_id_clone);

        match window.add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        ) {
            Ok(webview_ref) => {
                info!("[lens] Webview created successfully: {} (tab {})", label_clone, tab_id_clone);
                register_download_handler(&app_for_download, &webview_ref, downloads);
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

    // Get old active and verify new tab exists
    let (old_label, new_label) = {
        let tabs = state.tabs.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let new_tab = tabs.get(tab_id)
            .ok_or_else(|| format!("Tab {} not found", tab_id))?;
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

// ---------------------------------------------------------------------------
// Device Preview webviews (responsive design mode)
// ---------------------------------------------------------------------------

/// Create a device-preview webview for a responsive-design preset.
/// Each preset gets its own WebView2 child window sized to the device dimensions.
/// Caps at `MAX_DEVICE_WEBVIEWS`.
#[tauri::command]
pub async fn lens_create_device_webview(
    app: AppHandle,
    preset_id: String,
    url: String,
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    info!(
        "[lens] Creating device webview preset={} at ({},{}) {}x{} url={}",
        preset_id, x, y, width, height, url
    );

    // Check limits and duplicates
    {
        let devices = state
            .device_webviews
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if devices.len() >= MAX_DEVICE_WEBVIEWS {
            return Ok(IpcResponse::err(format!(
                "Maximum {} device webviews reached",
                MAX_DEVICE_WEBVIEWS
            )));
        }
        if devices.iter().any(|d| d.preset_id == preset_id) {
            return Ok(IpcResponse::err(format!(
                "Device webview for preset '{}' already exists",
                preset_id
            )));
        }
    }

    let webview_label = format!("device-{}", preset_id);

    // Create the WebView2 instance using the shared helper
    let downloads_arc = state.downloads.clone();
    let label = create_tab_webview(&app, &webview_label, &url, x, y, width, height, downloads_arc).await?;

    // Store in device_webviews vec
    {
        let mut devices = state
            .device_webviews
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        devices.push(DeviceWebview {
            preset_id: preset_id.clone(),
            webview_label: label.clone(),
        });
    }

    Ok(IpcResponse::ok(serde_json::json!({
        "label": label,
        "presetId": preset_id,
    })))
}

/// Close a single device-preview webview by its label.
#[tauri::command]
pub fn lens_close_device_webview(
    app: AppHandle,
    label: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    info!("[lens] Closing device webview: {}", label);

    let mut devices = match state.device_webviews.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
    };

    let idx = match devices.iter().position(|d| d.webview_label == label) {
        Some(i) => i,
        None => return IpcResponse::err(format!("Device webview '{}' not found", label)),
    };

    devices.remove(idx);

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
    }

    IpcResponse::ok_empty()
}

/// Close all device-preview webviews and clear the list.
#[tauri::command]
pub fn lens_close_all_device_webviews(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    info!("[lens] Closing all device webviews");

    let labels: Vec<String> = {
        let mut devices = match state.device_webviews.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        let labels: Vec<String> = devices.iter().map(|d| d.webview_label.clone()).collect();
        devices.clear();
        labels
    };

    for label in &labels {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.close();
        }
    }

    IpcResponse::ok_empty()
}

/// Reposition and resize a device-preview webview.
#[tauri::command]
pub fn lens_resize_device_webview(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    // Verify the label exists in our tracked device webviews
    {
        let devices = match state.device_webviews.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        if !devices.iter().any(|d| d.webview_label == label) {
            return IpcResponse::err(format!("Device webview '{}' not found", label));
        }
    }

    let webview = match app.get_webview(&label) {
        Some(w) => w,
        None => return IpcResponse::err(format!("Webview '{}' not found", label)),
    };

    if let Err(e) = webview.set_position(Position::Logical(LogicalPosition::new(x, y))) {
        return IpcResponse::err(format!("Failed to set position: {}", e));
    }

    match webview.set_size(Size::Logical(LogicalSize::new(width, height))) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set size: {}", e)),
    }
}

/// Call a Chrome DevTools Protocol method on a lens/device webview.
/// Windows-only — uses the WebView2 COM API.
#[cfg(windows)]
async fn call_cdp_method_lens(
    webview: &tauri::Webview,
    method: &str,
    params: &str,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let method_owned = method.to_string();
    let params_owned = params.to_string();

    webview
        .with_webview(move |platform_webview| {
            use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
            use windows_core::HSTRING;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        let _ = tx.send(Err(format!("CoreWebView2 failed: {:?}", e)));
                        return;
                    }
                };

                let method_h = HSTRING::from(method_owned.as_str());
                let params_h = HSTRING::from(params_owned.as_str());
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(
                    Box::new(move |hresult, result| {
                        if hresult.is_ok() {
                            let _ = tx.send(Ok(result));
                        } else {
                            let _ = tx.send(Err(format!("CDP call failed: {:?}", hresult)));
                        }
                        Ok(())
                    }),
                );

                if let Err(e) = core_webview.CallDevToolsProtocolMethod(
                    &method_h,
                    &params_h,
                    &handler,
                ) {
                    tracing::error!("[lens] CDP dispatch failed: {:?}", e);
                }
            }
        })
        .map_err(|e| format!("with_webview failed: {}", e))?;

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(Ok(result_str))) => {
            serde_json::from_str(&result_str)
                .or_else(|_| Ok(serde_json::json!({ "raw": result_str })))
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("CDP channel closed unexpectedly".into()),
        Err(_) => Err("CDP call timed out".into()),
    }
}

/// Stub for non-Windows platforms.
#[cfg(not(windows))]
async fn call_cdp_method_lens(
    _webview: &tauri::Webview,
    _method: &str,
    _params: &str,
) -> Result<serde_json::Value, String> {
    Err("CDP calls are only supported on Windows (WebView2)".into())
}

/// Set CDP device emulation on a device-preview webview.
/// Calls Emulation.setDeviceMetricsOverride, Network.setUserAgentOverride,
/// and (for mobile) Emulation.setTouchEmulationEnabled.
#[tauri::command]
pub async fn lens_set_device_emulation(
    app: AppHandle,
    label: String,
    width: u32,
    height: u32,
    device_scale_factor: f64,
    mobile: bool,
    user_agent: String,
    scale: Option<f64>,
) -> Result<String, String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    // 1. Override device metrics (viewport size, DPR, mobile flag, scale)
    // The `scale` parameter tells the rendering engine to render at the logical
    // viewport size (e.g. 360x800) and then scale the output down to fit the
    // physical window. Without it, the page lays out at the logical size but
    // overflows the smaller physical window, causing scrollbars.
    let mut metrics = serde_json::json!({
        "width": width,
        "height": height,
        "deviceScaleFactor": device_scale_factor,
        "mobile": mobile
    });
    if let Some(s) = scale {
        metrics["scale"] = serde_json::json!(s);
    }
    call_cdp_method_lens(&webview, "Emulation.setDeviceMetricsOverride", &metrics.to_string()).await?;

    // 2. Override user agent
    if !user_agent.is_empty() {
        let ua_params = serde_json::json!({
            "userAgent": user_agent
        });
        call_cdp_method_lens(&webview, "Network.setUserAgentOverride", &ua_params.to_string()).await?;
    }

    // 3. Enable touch emulation for mobile devices
    if mobile {
        let touch_params = serde_json::json!({
            "enabled": true,
            "maxTouchPoints": 5
        });
        call_cdp_method_lens(&webview, "Emulation.setTouchEmulationEnabled", &touch_params.to_string()).await?;
    }

    info!("[lens] Device emulation set for {}: {}x{} dpr={} mobile={}", label, width, height, device_scale_factor, mobile);
    Ok("ok".to_string())
}

/// Evaluate JavaScript in a specific device-preview webview (fire-and-forget).
/// Used for injecting the interaction sync script and replaying events on sibling devices.
#[tauri::command]
pub async fn lens_eval_device_js(
    app: AppHandle,
    label: String,
    js: String,
    state: tauri::State<'_, LensState>,
) -> Result<String, String> {
    let exists = {
        let devices = state.device_webviews.lock().map_err(|e| e.to_string())?;
        devices.iter().any(|d| d.webview_label == label)
    };

    if !exists {
        return Err(format!("Device webview '{}' not found", label));
    }

    if let Some(webview) = app.get_webview(&label) {
        webview.eval(&js).map_err(|e| e.to_string())?;
        Ok("ok".to_string())
    } else {
        Err(format!("Webview '{}' not found in app", label))
    }
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

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
    let tabs = state.tabs.lock().unwrap();
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

        let mut tabs = state.tabs.lock().unwrap();
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
    let tabs = state.tabs.lock().unwrap();
    match tabs.get(&tab_id) {
        Some(tab) => IpcResponse::ok(serde_json::json!({ "zoomFactor": tab.zoom_factor })),
        None => IpcResponse::err("Tab not found"),
    }
}

// ---------------------------------------------------------------------------
// Find on Page
// ---------------------------------------------------------------------------

/// Find text on the current page using `window.find()` (Chromium non-standard API).
/// Highlights the first match and returns `{ found: true/false }`.
/// Wraps around (`wrapAround=true`) and searches inside frames (`searchInFrames=true`).
#[tauri::command]
pub fn lens_find_on_page(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        // window.find(query, caseSensitive, backwards, wrapAround, wholeWord, searchInFrames, showDialog)
        let js = format!(
            "window.find({}, false, false, true, false, true, false)",
            serde_json::to_string(&query).unwrap_or_default()
        );
        let (tx, rx) = std::sync::mpsc::channel();

        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;
                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(e) => { let _ = tx.send(Err(format!("{:?}", e))); return; }
                    };
                    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, result| {
                        if hr.is_ok() {
                            let _ = tx.send(Ok(result));
                        } else {
                            let _ = tx.send(Err(format!("HRESULT {:?}", hr)));
                        }
                        Ok(())
                    }));
                    let _ = core_webview.ExecuteScript(&HSTRING::from(js.as_str()), &handler);
                }
            }
        });

        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(result)) => IpcResponse::ok(serde_json::json!({ "found": result == "true" })),
            Ok(Err(e)) => IpcResponse::err(&e),
            Err(_) => IpcResponse::err("Find timed out"),
        }
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Find the next occurrence of the last searched query (forward).
#[tauri::command]
pub fn lens_find_next(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        let js = format!(
            "window.find({}, false, false, true, false, true, false)",
            serde_json::to_string(&query).unwrap_or_default()
        );
        let (tx, rx) = std::sync::mpsc::channel();

        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;
                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(e) => { let _ = tx.send(Err(format!("{:?}", e))); return; }
                    };
                    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, result| {
                        if hr.is_ok() {
                            let _ = tx.send(Ok(result));
                        } else {
                            let _ = tx.send(Err(format!("HRESULT {:?}", hr)));
                        }
                        Ok(())
                    }));
                    let _ = core_webview.ExecuteScript(&HSTRING::from(js.as_str()), &handler);
                }
            }
        });

        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(result)) => IpcResponse::ok(serde_json::json!({ "found": result == "true" })),
            Ok(Err(e)) => IpcResponse::err(&e),
            Err(_) => IpcResponse::err("Find timed out"),
        }
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Find the previous occurrence (backwards=true).
#[tauri::command]
pub fn lens_find_previous(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        // backwards=true (3rd param)
        let js = format!(
            "window.find({}, false, true, true, false, true, false)",
            serde_json::to_string(&query).unwrap_or_default()
        );
        let (tx, rx) = std::sync::mpsc::channel();

        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;
                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(e) => { let _ = tx.send(Err(format!("{:?}", e))); return; }
                    };
                    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, result| {
                        if hr.is_ok() {
                            let _ = tx.send(Ok(result));
                        } else {
                            let _ = tx.send(Err(format!("HRESULT {:?}", hr)));
                        }
                        Ok(())
                    }));
                    let _ = core_webview.ExecuteScript(&HSTRING::from(js.as_str()), &handler);
                }
            }
        });

        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(result)) => IpcResponse::ok(serde_json::json!({ "found": result == "true" })),
            Ok(Err(e)) => IpcResponse::err(&e),
            Err(_) => IpcResponse::err("Find timed out"),
        }
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Clear the find selection (remove all highlighted matches).
#[tauri::command]
pub fn lens_close_find(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.eval("window.getSelection().removeAllRanges()");
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("Webview not found")
    }
}

// ---------------------------------------------------------------------------
// Browser History
// ---------------------------------------------------------------------------

/// Maximum number of history entries retained in browser-history.json.
const MAX_HISTORY_ENTRIES: usize = 200;

fn history_path() -> std::path::PathBuf {
    crate::services::platform::get_data_dir().join("browser-history.json")
}

fn read_history() -> Vec<serde_json::Value> {
    let path = history_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn write_history(entries: &[serde_json::Value]) {
    let path = history_path();
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(path, json);
    }
}

/// Add a history entry (newest-first, deduplicated against the last entry).
/// Skips empty URLs and "about:blank".
#[tauri::command]
pub fn lens_add_history_entry(url: String, title: String) -> IpcResponse {
    if url.is_empty() || url == "about:blank" {
        return IpcResponse::ok_empty();
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let mut entries = read_history();

    // Dedup: skip if the last entry has the same URL
    if let Some(last) = entries.first() {
        if last.get("url").and_then(|v| v.as_str()) == Some(&url) {
            return IpcResponse::ok_empty();
        }
    }

    // Prepend new entry (newest first)
    entries.insert(0, serde_json::json!({
        "url": url,
        "title": title,
        "timestamp": timestamp,
    }));

    // Truncate to max
    entries.truncate(MAX_HISTORY_ENTRIES);

    write_history(&entries);
    IpcResponse::ok_empty()
}

/// Return all history entries (newest first).
#[tauri::command]
pub fn lens_get_history() -> IpcResponse {
    let entries = read_history();
    IpcResponse::ok(serde_json::json!({ "entries": entries }))
}

/// Clear all browser history.
#[tauri::command]
pub fn lens_clear_history() -> IpcResponse {
    write_history(&[]);
    IpcResponse::ok_empty()
}

/// Delete a single history entry by its timestamp.
#[tauri::command]
pub fn lens_delete_history_entry(timestamp: u128) -> IpcResponse {
    let mut entries = read_history();
    entries.retain(|e| {
        e.get("timestamp")
            .and_then(|v| v.as_u64())
            .map(|t| t as u128)
            != Some(timestamp)
    });
    write_history(&entries);
    IpcResponse::ok_empty()
}

// ─── Download Manager ────────────────────────────────────────────────────────

/// Return all tracked downloads.
#[tauri::command]
pub fn lens_get_downloads(
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let downloads = state.downloads.lock().unwrap();
    IpcResponse::ok(serde_json::json!({ "downloads": downloads.clone() }))
}

/// Clear completed and interrupted downloads from the list.
/// In-progress downloads are kept.
#[tauri::command]
pub fn lens_clear_downloads(
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let mut downloads = state.downloads.lock().unwrap();
    downloads.retain(|d| d.state == "downloading");
    IpcResponse::ok_empty()
}

/// Open a downloaded file with the OS default handler.
#[tauri::command]
pub fn lens_open_download(path: String) -> IpcResponse {
    if let Err(e) = opener::open(&path) {
        return IpcResponse::err(format!("Failed to open: {}", e));
    }
    IpcResponse::ok_empty()
}

/// Open the folder containing a downloaded file.
#[tauri::command]
pub fn lens_open_download_folder(path: String) -> IpcResponse {
    let parent = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if let Err(e) = opener::open(&parent) {
        return IpcResponse::err(format!("Failed to open folder: {}", e));
    }
    IpcResponse::ok_empty()
}
