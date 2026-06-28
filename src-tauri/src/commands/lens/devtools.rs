//! DevTools panel commands (Chrome DevTools Protocol).

use tauri::{AppHandle, Manager, Position, Size, LogicalPosition, LogicalSize, WebviewBuilder};
use tracing::info;

use super::super::IpcResponse;
use super::LensState;

/// Injected into the DevTools WebView2 for minor UI tweaks.
/// Using devtools_app.html (no screencast module) so no layout hacks needed.
const DEVTOOLS_INIT_SCRIPT: &str = "";

#[cfg(windows)]
pub(super) async fn call_cdp_method_lens(
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
pub(super) async fn call_cdp_method_lens(
    _webview: &tauri::Webview,
    _method: &str,
    _params: &str,
) -> Result<serde_json::Value, String> {
    Err("CDP calls are only supported on Windows (WebView2)".into())
}

/// Query the remote debugging port to find the DevTools frontend URL for the
/// active browser tab. This is a separate command from lens_open_devtools to
/// avoid combining HTTP requests with WebView2 creation in one async call
/// (which caused deadlocks with the WebView2 browser process).
#[tauri::command]
pub async fn lens_find_devtools_url(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    // Get the active tab's URL for target matching
    let tab_url = {
        let active_id = state
            .active_tab_id
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("No active tab")?;
        let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        let tab = tabs.get(&active_id).ok_or("Active tab not found")?;
        let label = tab.webview_label.clone();
        if let Some(wv) = app.get_webview(&label) {
            wv.url().map(|u| u.to_string()).unwrap_or_default()
        } else {
            String::new()
        }
    };

    info!("[lens] Looking up DevTools target for tab URL: {}", tab_url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url = "http://127.0.0.1:9222/json";
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Remote debug port not available: {}", e))?;

    let targets: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse failed: {}", e))?;

    // Helper: build a local DevTools inspector URL from a target's page id.
    // The remote debugging server serves the inspector frontend locally.
    // devtools_app.html does NOT include the screencast module (unlike inspector.html),
    // so there's no floating page preview or SplitWidget layout issues.
    // panel=console: opens the Console tab by default
    let make_inspector_url = |target_id: &str| -> String {
        format!(
            "http://127.0.0.1:9222/devtools/devtools_app.html?panel=console&ws=127.0.0.1:9222/devtools/page/{}",
            target_id
        )
    };

    // Find the page target matching the browser tab's URL (skip the main app webview)
    for target in &targets {
        if target["type"].as_str() == Some("page") {
            if let Some(target_url) = target["url"].as_str() {
                if target_url.starts_with("http://localhost:31420")
                    || target_url.starts_with("https://tauri.localhost")
                {
                    continue;
                }
                if target_url == tab_url {
                    if let Some(id) = target["id"].as_str() {
                        let inspector_url = make_inspector_url(id);
                        info!("[lens] DevTools URL resolved: {}", inspector_url);
                        return Ok(IpcResponse::ok(
                            serde_json::json!({ "url": inspector_url }),
                        ));
                    }
                }
            }
        }
    }

    // Fallback: pick the first non-app page target
    for target in &targets {
        if target["type"].as_str() == Some("page") {
            if let Some(target_url) = target["url"].as_str() {
                if target_url.starts_with("http://localhost:31420")
                    || target_url.starts_with("https://tauri.localhost")
                {
                    continue;
                }
                if let Some(id) = target["id"].as_str() {
                    let inspector_url = make_inspector_url(id);
                    info!("[lens] DevTools URL resolved (fallback): {}", inspector_url);
                    return Ok(IpcResponse::ok(
                        serde_json::json!({ "url": inspector_url }),
                    ));
                }
            }
        }
    }

    Err("No page target found on remote debug port".to_string())
}

/// Open a DevTools side-panel WebView2 connected to the active browser tab.
///
/// The frontend passes the DevTools frontend URL (discovered via fetch to
/// the remote debugging port). This command just creates the WebView2 using
/// the same spawn_blocking + add_child pattern as create_tab_webview.
#[tauri::command]
pub async fn lens_open_devtools(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> Result<IpcResponse, String> {
    // If already open, just return
    {
        let dt = state.devtools_label.lock().map_err(|e| e.to_string())?;
        if dt.is_some() {
            return Ok(IpcResponse::ok(serde_json::json!({ "already_open": true })));
        }
    }

    info!("[lens] Opening DevTools panel at ({}, {}) {}x{} url={}", x, y, width, height, url);

    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("Invalid DevTools URL: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let label = format!("devtools-{}", timestamp);
    let label_clone = label.clone();

    // Use spawn_blocking + add_child — same proven pattern as create_tab_webview
    let app_clone = app.clone();
    let create_result = tokio::task::spawn_blocking(move || {
        let Some(window) = app_clone.get_window("main") else {
            return Err("Main window not found".to_string());
        };

        let builder = WebviewBuilder::new(
            &label_clone,
            tauri::WebviewUrl::External(parsed_url),
        )
        .initialization_script(DEVTOOLS_INIT_SCRIPT);

        match window.add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        ) {
            Ok(_webview) => {
                info!("[lens] DevTools panel webview created: {}", label_clone);
                Ok(label_clone)
            }
            Err(e) => Err(format!("Failed to create DevTools webview: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Spawn blocking failed: {}", e))?
    .map_err(|e| e)?;

    // Store the label
    {
        let mut dt = state.devtools_label.lock().map_err(|e| e.to_string())?;
        *dt = Some(create_result.clone());
    }

    info!("[lens] DevTools panel opened: {}", create_result);

    Ok(IpcResponse::ok(serde_json::json!({ "opened": true })))
}

/// Close the DevTools side-panel WebView2.
#[tauri::command]
pub fn lens_close_devtools(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let label = {
        let mut dt = match state.devtools_label.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        dt.take()
    };

    if let Some(label) = label {
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.close();
        }
        IpcResponse::ok_empty()
    } else {
        IpcResponse::ok_empty()
    }
}

/// Reposition and resize the DevTools side-panel WebView2.
#[tauri::command]
pub fn lens_resize_devtools(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let label = {
        let dt = match state.devtools_label.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        match dt.as_ref() {
            Some(l) => l.clone(),
            None => return IpcResponse::err("No DevTools panel open"),
        }
    };

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.set_position(Position::Logical(LogicalPosition::new(x, y)));
        let _ = webview.set_size(Size::Logical(LogicalSize::new(width, height)));
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("DevTools webview not found")
    }
}

/// Show or hide the DevTools side-panel WebView2.
#[tauri::command]
pub fn lens_set_devtools_visible(
    app: AppHandle,
    visible: bool,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let label = {
        let dt = match state.devtools_label.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        match dt.as_ref() {
            Some(l) => l.clone(),
            None => return IpcResponse::ok_empty(),
        }
    };

    if let Some(webview) = app.get_webview(&label) {
        if visible {
            let _ = webview.show();
        } else {
            let _ = webview.hide();
        }
    }
    IpcResponse::ok_empty()
}
