//! Browser bridge: processes MCP BrowserRequest messages using the native
//! Tauri webview (Lens).
//!
//! For actions that need return values from JavaScript (snapshot, act, cookies,
//! storage), we use WebView2's native `ExecuteScript` COM API with a callback.
//! This bypasses Tauri's fire-and-forget `eval()` and gives us direct access
//! to the JS evaluation result.
//!
//! For screenshots, we use WebView2's `CapturePreview` API which renders the
//! webview content to a PNG image via an IStream, then base64-encode it.
//!
//! On Windows, we access the ICoreWebView2 interface via `webview.with_webview()`
//! → `controller.CoreWebView2()` → `ExecuteScript()` / `CapturePreview()`.
//! Results are routed back to the caller through oneshot channels.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::lens::LensState;

// ---------------------------------------------------------------------------
// Screenshot capture (via native WebView2 CapturePreview COM API)
// ---------------------------------------------------------------------------

/// Capture a PNG screenshot of the lens webview content.
///
/// Uses `ICoreWebView2::CapturePreview` which renders the current page to
/// an IStream as PNG. Returns the raw PNG bytes.
#[cfg(windows)]
async fn capture_screenshot_png(
    webview: &tauri::Webview,
) -> Result<Vec<u8>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();

    webview
        .with_webview(move |platform_webview| {
            use webview2_com::CapturePreviewCompletedHandler;
            use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
            use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
            use windows::Win32::Foundation::HGLOBAL;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        let _ = tx.send(Err(format!("Failed to get CoreWebView2: {:?}", e)));
                        return;
                    }
                };

                // Create an auto-managed IStream (default HGLOBAL = auto-allocate,
                // fDeleteOnRelease = true so stream owns the memory)
                let stream = match CreateStreamOnHGlobal(HGLOBAL::default(), true) {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = tx.send(Err(format!("Failed to create IStream: {:?}", e)));
                        return;
                    }
                };

                let stream_for_read = stream.clone();

                let handler = CapturePreviewCompletedHandler::create(Box::new(
                    move |hresult| {
                        if hresult.is_err() {
                            let _ = tx.send(Err(format!(
                                "CapturePreview failed: {:?}",
                                hresult
                            )));
                            return Ok(());
                        }

                        // Read the PNG bytes from the stream
                        let bytes = read_stream_bytes(&stream_for_read);
                        let _ = tx.send(bytes);
                        Ok(())
                    },
                ));

                if let Err(e) = core_webview.CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                    &stream,
                    &handler,
                ) {
                    tracing::error!(
                        "[browser_bridge] CapturePreview dispatch failed: {:?}",
                        e
                    );
                }
            }
        })
        .map_err(|e| format!("with_webview failed: {}", e))?;

    // Wait for the capture with a generous timeout (large pages take time)
    match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Screenshot channel closed unexpectedly".into()),
        Err(_) => Err("Screenshot capture timed out".into()),
    }
}

/// Read all bytes from a COM IStream. Seeks to end to get size, then reads.
///
/// # Safety
/// The stream must be a valid, readable IStream with data written to it.
#[cfg(windows)]
unsafe fn read_stream_bytes(
    stream: &windows::Win32::System::Com::IStream,
) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STREAM_SEEK_SET, STREAM_SEEK_END};

    // Seek to end to find stream size
    let mut size: u64 = 0;
    stream
        .Seek(0, STREAM_SEEK_END, Some(&mut size))
        .map_err(|e| format!("Stream seek to end failed: {:?}", e))?;

    if size == 0 {
        return Err("Screenshot stream is empty".into());
    }

    // Seek back to start
    stream
        .Seek(0, STREAM_SEEK_SET, None)
        .map_err(|e| format!("Stream seek to start failed: {:?}", e))?;

    // Read all bytes
    let mut buf = vec![0u8; size as usize];
    let mut bytes_read: u32 = 0;
    let hr = stream.Read(
        buf.as_mut_ptr() as *mut _,
        size as u32,
        Some(&mut bytes_read),
    );
    if hr.is_err() {
        return Err(format!("Stream read failed: {:?}", hr));
    }

    buf.truncate(bytes_read as usize);
    Ok(buf)
}

#[cfg(not(windows))]
async fn capture_screenshot_png(
    _webview: &tauri::Webview,
) -> Result<Vec<u8>, String> {
    Err("Screenshot capture is only available on Windows".into())
}

// ---------------------------------------------------------------------------
// JS eval with result (via native WebView2 ExecuteScript COM API)
// ---------------------------------------------------------------------------

/// Evaluate JavaScript in the lens webview and return the result.
///
/// Uses the native WebView2 `ICoreWebView2::ExecuteScript` API which provides
/// a completion callback with the result. This is the same API that wry uses
/// internally, but we call it directly on the child webview because Tauri's
/// `webview.eval()` is fire-and-forget with no return value.
///
/// The JS expression is evaluated as-is. `ExecuteScript` returns the result
/// as a JSON-serialized string (the last expression value).
async fn evaluate_js_with_result(
    _app: &AppHandle,
    webview: &tauri::Webview,
    js_expression: &str,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();

    let js_owned = js_expression.to_string();

    webview
        .with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;

                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(e) => {
                            let _ = tx.send(Err(format!("Failed to get CoreWebView2: {:?}", e)));
                            return;
                        }
                    };

                    let js = HSTRING::from(js_owned.as_str());
                    let handler =
                        ExecuteScriptCompletedHandler::create(Box::new(move |hresult, result| {
                            if hresult.is_ok() {
                                let _ = tx.send(Ok(result));
                            } else {
                                let _ = tx.send(Err(format!(
                                    "ExecuteScript failed: HRESULT {:?}",
                                    hresult
                                )));
                            }
                            Ok(())
                        }));

                    if let Err(e) = core_webview.ExecuteScript(&js, &handler) {
                        // tx is already moved into handler, can't send here.
                        // This error means the call itself failed to dispatch.
                        tracing::error!("[browser_bridge] ExecuteScript dispatch failed: {:?}", e);
                    }
                }

                #[cfg(not(windows))]
                {
                    let _ = tx.send(Err(
                        "ExecuteScript is only available on Windows".to_string(),
                    ));
                }
            }
        })
        .map_err(|e| format!("with_webview failed: {}", e))?;

    // Wait for the result with timeout
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(Ok(result_str))) => {
            // ExecuteScript returns JSON-serialized result. The string "null"
            // means the expression returned undefined/null in JS.
            if result_str == "null" {
                Ok(json!(null))
            } else {
                // Try to parse as JSON; fall back to wrapping as raw string
                serde_json::from_str(&result_str)
                    .or_else(|_| Ok(json!({ "raw": result_str })))
            }
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("JS eval channel closed unexpectedly".into()),
        Err(_) => Err("JS eval timed out".into()),
    }
}

// ---------------------------------------------------------------------------
// Helper: get active webview
// ---------------------------------------------------------------------------

fn get_webview(
    app: &AppHandle,
    state: &tauri::State<'_, LensState>,
) -> Result<tauri::Webview, String> {
    let label = state
        .webview_label
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone()
        .ok_or("No browser webview active. Open the Lens tab first.")?;
    app.get_webview(&label)
        .ok_or_else(|| "Lens webview not found".into())
}

/// Escape a string for safe inclusion in JavaScript single-quoted strings.
fn escape_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

// ---------------------------------------------------------------------------
// Snapshot JS
// ---------------------------------------------------------------------------

/// JavaScript that builds a lightweight DOM tree snapshot.
/// ExecuteScript evaluates the last expression value, so this IIFE returns
/// the JSON string directly (no `return` keyword needed at the top level).
const SNAPSHOT_JS: &str = r#"
(function() {
    function buildTree(el, depth) {
        if (depth > 10) return null;
        var tag = (el.tagName || '').toLowerCase();
        var role = (el.getAttribute && el.getAttribute('role')) || '';
        var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
        var text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
            ? (el.childNodes[0].textContent || '').trim().slice(0, 100) : '';
        var interactive = ['a','button','input','select','textarea'].indexOf(tag) >= 0
            || role === 'button' || role === 'link';
        var node = { tag: tag };
        if (role) node.role = role;
        if (aria) node.label = aria;
        if (text) node.text = text;
        if (el.id) node.id = el.id;
        if (interactive) {
            node.interactive = true;
            if (el.href) node.href = el.href;
            if (el.type) node.type = el.type;
            if (el.value !== undefined && el.value !== '') node.value = el.value;
            if (el.placeholder) node.placeholder = el.placeholder;
        }
        var children = [];
        var kids = el.children || [];
        for (var i = 0; i < kids.length; i++) {
            var c = buildTree(kids[i], depth + 1);
            if (c) children.push(c);
        }
        if (children.length) node.children = children;
        if (!interactive && !text && !aria && !children.length) return null;
        return node;
    }
    var tree = buildTree(document.body, 0);
    return JSON.stringify({
        title: document.title,
        url: location.href,
        tree: tree
    });
})()
"#;

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/// Process a browser action and return the result.
pub async fn handle_browser_action(
    app: &AppHandle,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    let state = app.state::<LensState>();

    match action {
        "navigate" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("URL is required")?;
            let webview = get_webview(app, &state)?;
            let parsed = url
                .parse::<tauri::Url>()
                .map_err(|e| format!("Invalid URL: {}", e))?;
            webview
                .navigate(parsed)
                .map_err(|e| format!("Navigation failed: {}", e))?;
            // Notify frontend so URL bar updates
            let _ = app.emit("lens-url-changed", json!({ "url": url }));
            Ok(json!({ "ok": true, "url": url }))
        }

        "open" => {
            // Same as navigate for single-webview model
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("URL is required")?;
            let webview = get_webview(app, &state)?;
            let parsed = url
                .parse::<tauri::Url>()
                .map_err(|e| format!("Invalid URL: {}", e))?;
            webview
                .navigate(parsed)
                .map_err(|e| format!("Navigation failed: {}", e))?;
            // Notify frontend so URL bar updates
            let _ = app.emit("lens-url-changed", json!({ "url": url }));
            Ok(json!({ "ok": true, "url": url }))
        }

        "status" => {
            let has_webview = state
                .webview_label
                .lock()
                .map(|g| g.is_some())
                .unwrap_or(false);
            let bounds = state.bounds.lock().ok().and_then(|g| *g);
            Ok(json!({
                "active": has_webview,
                "bounds": bounds.map(|(x,y,w,h)| json!({"x":x,"y":y,"width":w,"height":h})),
            }))
        }

        "tabs" => {
            let label = state
                .webview_label
                .lock()
                .map(|g| g.clone())
                .unwrap_or(None);
            match label {
                Some(l) => Ok(json!([{ "targetId": l, "type": "page", "active": true }])),
                None => Ok(json!([])),
            }
        }

        "screenshot" => {
            let webview = get_webview(app, &state)?;

            // Get page metadata via ExecuteScript
            let meta = evaluate_js_with_result(
                app,
                &webview,
                r#"JSON.stringify({
                    title: document.title,
                    url: location.href,
                    width: window.innerWidth,
                    height: window.innerHeight
                })"#,
                std::time::Duration::from_secs(10),
            )
            .await
            .unwrap_or(json!(null));

            // Capture the actual screenshot via CapturePreview
            match capture_screenshot_png(&webview).await {
                Ok(png_bytes) => {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
                    // Return in the format browser.rs expects: { base64, contentType }
                    // browser.rs will convert this to an MCP image content block
                    Ok(json!({
                        "base64": b64,
                        "contentType": "image/png",
                        "size_bytes": png_bytes.len(),
                        "page": meta,
                    }))
                }
                Err(e) => {
                    // Fall back to metadata-only if capture fails
                    tracing::warn!("[browser_bridge] Screenshot capture failed: {}", e);
                    Ok(json!({
                        "error": e,
                        "note": "Screenshot capture failed. Use capture_screen tool as fallback.",
                        "page": meta,
                    }))
                }
            }
        }

        "snapshot" => {
            let webview = get_webview(app, &state)?;
            evaluate_js_with_result(
                app,
                &webview,
                SNAPSHOT_JS,
                std::time::Duration::from_secs(30),
            )
            .await
        }

        "act" => {
            let request = args.get("request").ok_or("request object is required")?;
            let kind = request
                .get("kind")
                .and_then(|v| v.as_str())
                .ok_or("request.kind is required")?;

            let webview = get_webview(app, &state)?;

            // ExecuteScript evaluates the expression and returns the last value
            // as a JSON string. IIFEs with `return` work fine.
            let js = match kind {
                "click" => {
                    let selector = request
                        .get("selector")
                        .or_else(|| request.get("ref"))
                        .and_then(|v| v.as_str())
                        .ok_or("selector or ref required for click")?;
                    format!(
                        r#"(function() {{
                            var el = document.querySelector('{}');
                            if (!el) return JSON.stringify({{ error: 'Element not found: {}' }});
                            el.click();
                            return JSON.stringify({{ ok: true, action: 'click', selector: '{}' }});
                        }})()"#,
                        escape_js(selector),
                        escape_js(selector),
                        escape_js(selector)
                    )
                }
                "fill" | "type" => {
                    let selector = request
                        .get("selector")
                        .or_else(|| request.get("ref"))
                        .and_then(|v| v.as_str())
                        .ok_or("selector or ref required for fill")?;
                    let text = request
                        .get("text")
                        .or_else(|| request.get("value"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    format!(
                        r#"(function() {{
                            var el = document.querySelector('{}');
                            if (!el) return JSON.stringify({{ error: 'Element not found: {}' }});
                            el.focus();
                            el.value = '{}';
                            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            return JSON.stringify({{ ok: true, action: 'fill', selector: '{}' }});
                        }})()"#,
                        escape_js(selector),
                        escape_js(selector),
                        escape_js(text),
                        escape_js(selector)
                    )
                }
                "key" | "press" => {
                    let key = request
                        .get("key")
                        .and_then(|v| v.as_str())
                        .ok_or("key is required for press")?;
                    format!(
                        r#"(function() {{
                            document.activeElement.dispatchEvent(
                                new KeyboardEvent('keydown', {{ key: '{}', bubbles: true }})
                            );
                            document.activeElement.dispatchEvent(
                                new KeyboardEvent('keyup', {{ key: '{}', bubbles: true }})
                            );
                            return JSON.stringify({{ ok: true, action: 'press', key: '{}' }});
                        }})()"#,
                        escape_js(key),
                        escape_js(key),
                        escape_js(key)
                    )
                }
                "evaluate" | "javascript" => {
                    let expression = request
                        .get("expression")
                        .and_then(|v| v.as_str())
                        .ok_or("expression is required for evaluate")?;
                    format!(
                        r#"(function() {{
                            try {{
                                var result = eval({});
                                return JSON.stringify({{ ok: true, result: result }});
                            }} catch(e) {{
                                return JSON.stringify({{ error: e.message }});
                            }}
                        }})()"#,
                        serde_json::to_string(expression).unwrap_or_default()
                    )
                }
                "scroll" => {
                    let x = request.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let y = request.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    format!(
                        r#"(function() {{
                            window.scrollBy({}, {});
                            return JSON.stringify({{ ok: true, action: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY }});
                        }})()"#,
                        x, y
                    )
                }
                other => {
                    return Err(format!("Unknown action kind: {}", other));
                }
            };

            evaluate_js_with_result(
                app,
                &webview,
                &js,
                std::time::Duration::from_secs(30),
            )
            .await
        }

        "console" => {
            Err(
                "Console capture requires initialization script injection at webview creation. \
                 This feature is not yet implemented."
                    .into(),
            )
        }

        "go_back" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("history.back()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        "go_forward" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("history.forward()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        "reload" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("location.reload()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        "close_tab" | "focus" => {
            // Single-tab model -- these are no-ops
            Ok(json!({ "ok": true, "note": "Single-tab browser model" }))
        }

        "cookies" => {
            let webview = get_webview(app, &state)?;
            let action_type = args
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("list");
            let js = match action_type {
                "list" => "JSON.stringify({ cookies: document.cookie })".to_string(),
                "clear" => {
                    "document.cookie.split(';').forEach(function(c) { \
                     document.cookie = c.trim().split('=')[0] + \
                     '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; }); \
                     JSON.stringify({ ok: true })"
                        .to_string()
                }
                _ => format!(
                    "JSON.stringify({{ error: 'Cookie action {} not supported via JS' }})",
                    action_type
                ),
            };
            evaluate_js_with_result(
                app,
                &webview,
                &js,
                std::time::Duration::from_secs(10),
            )
            .await
        }

        "storage" => {
            let webview = get_webview(app, &state)?;
            let raw_type = args
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("localStorage");
            // Whitelist storage types to prevent JS injection
            let storage_type = match raw_type {
                "localStorage" | "sessionStorage" => raw_type,
                _ => return Err(format!("Invalid storage type: '{}'. Must be 'localStorage' or 'sessionStorage'.", raw_type)),
            };
            let action_type = args
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("get");
            let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");

            let js = match action_type {
                "get" => format!(
                    "JSON.stringify({{ value: {}.getItem('{}') }})",
                    storage_type,
                    escape_js(key)
                ),
                "set" => format!(
                    "{}.setItem('{}', '{}'); JSON.stringify({{ ok: true }})",
                    storage_type,
                    escape_js(key),
                    escape_js(value)
                ),
                "delete" => format!(
                    "{}.removeItem('{}'); JSON.stringify({{ ok: true }})",
                    storage_type,
                    escape_js(key)
                ),
                "clear" => format!(
                    "{}.clear(); JSON.stringify({{ ok: true }})",
                    storage_type
                ),
                _ => format!(
                    "JSON.stringify({{ error: 'Unknown action: {}' }})",
                    action_type
                ),
            };
            evaluate_js_with_result(
                app,
                &webview,
                &js,
                std::time::Duration::from_secs(10),
            )
            .await
        }

        _ => Err(format!("Unknown browser action: {}", action)),
    }
}
