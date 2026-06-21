//! WebView2 creation and initialization internals.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Position, Size, LogicalPosition, LogicalSize, WebviewBuilder};
use tracing::{info, warn};
use super::DownloadEntry;

static DOWNLOAD_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Maximum number of browser tabs allowed.
pub(super) const MAX_TABS: usize = 8;

/// Build the shortcut interception script for child WebView2 instances.
/// Child WebView2 instances are separate processes (NOT iframes), so
/// window.top.postMessage() doesn't reach the parent. Instead we fire a
/// request to a custom Tauri URI scheme (`lens-shortcut://`) which is handled
/// in lib.rs and re-emitted as a Tauri event the frontend can listen to.
pub(super) fn build_shortcut_script() -> String {
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
pub(super) const CACHE_SCRIPT: &str = r#"
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
pub(super) const CONSOLE_HOOK_SCRIPT: &str = r#"
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

/// Register `WebResourceRequested` filters on a child WebView2 so that
/// `lens-shortcut` and `lens-console` custom URI scheme requests are intercepted
/// at the COM level.  `register_uri_scheme_protocol` on the Tauri Builder only
/// intercepts requests from the **main app webview**, not from child webviews.
///
/// For each matching request we emit the corresponding Tauri event (same logic
/// as lib.rs) and return a 1×1 transparent GIF so the `new Image().src` load
/// succeeds silently.
pub(super) fn register_custom_scheme_handler(app: &AppHandle, webview: &tauri::Webview) {
    let app_handle = app.clone();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::WebResourceRequestedEventHandler;
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::{HSTRING, Interface};

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for scheme handler: {:?}", e);
                        return;
                    }
                };

                // Filter for both custom schemes
                let _ = core_webview.AddWebResourceRequestedFilter(
                    &HSTRING::from("https://lens-shortcut.localhost/*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                );
                let _ = core_webview.AddWebResourceRequestedFilter(
                    &HSTRING::from("https://lens-console.localhost/*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                );

                // Get ICoreWebView2_2 for Environment() access
                let core_wv2: ICoreWebView2_2 = match core_webview.cast() {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("[lens] Failed to cast to ICoreWebView2_2: {:?}", e);
                        return;
                    }
                };
                let env = match core_wv2.Environment() {
                    Ok(e) => e,
                    Err(e) => {
                        warn!("[lens] Failed to get environment: {:?}", e);
                        return;
                    }
                };

                let app_for_events = app_handle.clone();
                let handler = WebResourceRequestedEventHandler::create(Box::new(
                    move |_sender, args| {
                        let args = match args {
                            Some(a) => a,
                            None => return Ok(()),
                        };

                        let request = args.Request()?;
                        let mut uri_pwstr = windows_core::PWSTR::null();
                        request.Uri(&mut uri_pwstr)?;
                        let uri = if uri_pwstr.is_null() {
                            String::new()
                        } else {
                            uri_pwstr.to_string().unwrap_or_default()
                        };

                        // Parse the URI — same logic as lib.rs handlers
                        let path = uri
                            .split("localhost")
                            .nth(1)
                            .unwrap_or("")
                            .trim_start_matches('/')
                            .trim_start_matches(':');

                        if uri.contains("lens-shortcut") {
                            let key = path
                                .split('?')
                                .next()
                                .unwrap_or("")
                                .trim_matches('/');

                            if key == "hard-refresh" {
                                let _ = app_for_events.emit("lens-hard-refresh", serde_json::json!({}));
                            } else if key == "url-changed" {
                                let query = path.split('?').nth(1).unwrap_or("");
                                let url_param = query
                                    .split('&')
                                    .find_map(|pair| pair.strip_prefix("url="))
                                    .unwrap_or("");
                                let decoded_url = percent_encoding::percent_decode_str(url_param)
                                    .decode_utf8_lossy()
                                    .to_string();
                                let _ = app_for_events.emit(
                                    "lens-url-changed",
                                    serde_json::json!({ "url": decoded_url }),
                                );
                            } else if key == "element-selected" {
                                let _ = app_for_events.emit("element-selected", serde_json::json!({}));
                            } else if key == "element-deselected" {
                                let _ = app_for_events.emit("element-deselected", serde_json::json!({}));
                            } else if !key.is_empty() {
                                info!("[lens-shortcut] Child webview forwarding: {}", key);
                                let _ = app_for_events.emit("lens-shortcut", serde_json::json!({ "key": key }));
                            }
                        } else if uri.contains("lens-console") {
                            let level_part = path
                                .split('?')
                                .next()
                                .unwrap_or("")
                                .trim_matches('/');
                            let query = path.split('?').nth(1).unwrap_or("");
                            let encoded_msg = query
                                .split('&')
                                .find_map(|pair| pair.strip_prefix("m="))
                                .unwrap_or("");
                            let message = percent_encoding::percent_decode_str(encoded_msg)
                                .decode_utf8_lossy()
                                .to_string();
                            if !message.is_empty() {
                                let log_level = match level_part {
                                    "error" => "ERROR",
                                    "warn" => "WARN",
                                    "debug" => "DEBUG",
                                    "info" => "INFO",
                                    _ => "INFO",
                                };
                                let _ = app_for_events.emit(
                                    "lens-console-message",
                                    serde_json::json!({ "level": log_level, "message": message }),
                                );
                            }
                        }

                        // Return empty 200 response so the Image() load doesn't error
                        let response = env.CreateWebResourceResponse(
                            None,
                            200,
                            &HSTRING::from("OK"),
                            &HSTRING::from("Access-Control-Allow-Origin: *"),
                        )?;
                        args.SetResponse(&response)?;

                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = core_webview.add_WebResourceRequested(&handler, &mut token) {
                    warn!("[lens] Failed to register WebResourceRequested: {:?}", e);
                } else {
                    info!("[lens] Registered custom scheme handler for child webview");
                }
            }
        }
    });
}

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
                                "receivedBytes": 0,
                                "state": "downloading",
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
pub(super) async fn create_tab_webview(
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
                register_custom_scheme_handler(&app_for_download, &webview_ref);
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
