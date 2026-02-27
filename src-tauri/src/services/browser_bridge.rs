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
//! For accessibility tree snapshots, we use WebView2's
//! `CallDevToolsProtocolMethod` to call `Accessibility.getFullAXTree` via CDP.
//! The tree is parsed into a ref map (`@eN`) that subsequent actions can target.
//!
//! On Windows, we access the ICoreWebView2 interface via `webview.with_webview()`
//! → `controller.CoreWebView2()` → `ExecuteScript()` / `CapturePreview()` /
//! `CallDevToolsProtocolMethod()`.
//! Results are routed back to the caller through oneshot channels.

use std::collections::HashMap;
use std::sync::RwLock;

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::lens::LensState;
use crate::services::cdp::{self, RefEntry};
use crate::util::escape_js_string as escape_js;

/// Shared ref map populated by snapshot, used by click/fill/etc.
/// Maps "e1", "e2", etc. to RefEntry values.
static REF_MAP: Lazy<RwLock<HashMap<String, RefEntry>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

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
pub async fn evaluate_js_with_result(
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

/// Unwrap double-encoded JSON from ExecuteScript.
///
/// When JS does `return JSON.stringify({...})`, ExecuteScript JSON-serializes the
/// string result again, so `evaluate_js_with_result` returns `Value::String("{...}")`.
/// This helper detects that case and parses the inner JSON object.
fn unwrap_js_result(val: Value) -> Value {
    if let Some(s) = val.as_str() {
        serde_json::from_str::<Value>(s).unwrap_or(val)
    } else {
        val
    }
}

// ---------------------------------------------------------------------------
// CDP call (via native WebView2 CallDevToolsProtocolMethod COM API)
// ---------------------------------------------------------------------------

/// Call a Chrome DevTools Protocol method on the lens webview.
#[cfg(windows)]
async fn call_cdp_method(
    webview: &tauri::Webview,
    method: &str,
    params: &str,
) -> Result<Value, String> {
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
                    tracing::error!("[browser_bridge] CDP dispatch failed: {:?}", e);
                }
            }
        })
        .map_err(|e| format!("with_webview failed: {}", e))?;

    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(Ok(result_str))) => {
            serde_json::from_str(&result_str)
                .or_else(|_| Ok(json!({ "raw": result_str })))
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("CDP channel closed unexpectedly".into()),
        Err(_) => Err("CDP call timed out".into()),
    }
}

#[cfg(not(windows))]
async fn call_cdp_method(
    _webview: &tauri::Webview,
    _method: &str,
    _params: &str,
) -> Result<Value, String> {
    Err("CDP is only available on Windows".into())
}

// ---------------------------------------------------------------------------
// Helper: get active webview
// ---------------------------------------------------------------------------

fn get_webview(
    app: &AppHandle,
    state: &tauri::State<'_, LensState>,
) -> Result<tauri::Webview, String> {
    let active_id = state
        .active_tab_id
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone()
        .ok_or("No browser webview active. Open the Lens tab first.")?;
    let tabs = state
        .tabs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let tab = tabs
        .get(&active_id)
        .ok_or("Active tab not found")?;
    app.get_webview(&tab.webview_label)
        .ok_or_else(|| "Lens webview not found".into())
}

// ---------------------------------------------------------------------------
// Element targeting: resolve @eN ref or CSS selector
// ---------------------------------------------------------------------------

/// Resolve an @eN ref or CSS selector to a JS expression that finds the element.
fn resolve_element_target(args: &Value) -> Result<String, String> {
    if let Some(ref_str) = args.get("ref").and_then(|v| v.as_str()) {
        let ref_id = ref_str.trim_start_matches('@');
        let map = REF_MAP.read().map_err(|_| "Ref map lock error".to_string())?;
        let entry = map
            .get(ref_id)
            .ok_or_else(|| format!("Ref @{} not found. Run snapshot first to discover elements.", ref_id))?;
        return Ok(cdp::build_js_selector(entry));
    }
    if let Some(selector) = args.get("selector").and_then(|v| v.as_str()) {
        return Ok(format!(
            "document.querySelector('{}')",
            selector.replace('\'', "\\'")
        ));
    }
    Err("Either 'ref' (@e1) or 'selector' (CSS) is required to target an element".into())
}

// ---------------------------------------------------------------------------
// Auth vault actions
// ---------------------------------------------------------------------------

/// Handle auth vault actions (save, login, list, delete).
async fn handle_auth_action(
    app: &AppHandle,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    use crate::services::auth_vault;

    let data_dir = dirs::data_dir()
        .ok_or("Could not find app data directory")?
        .join("voice-mirror")
        .join("auth");

    match action {
        "auth_save" => {
            let name = args.get("name").and_then(|v| v.as_str()).ok_or("name is required")?;
            let url = args.get("url").and_then(|v| v.as_str()).ok_or("url is required")?;
            let username = args.get("username").and_then(|v| v.as_str()).ok_or("username is required")?;
            let password = args.get("password").and_then(|v| v.as_str()).ok_or("password is required")?;
            let key = auth_vault::ensure_key(&data_dir)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let profile = auth_vault::AuthProfile {
                name: name.into(),
                url: url.into(),
                username: username.into(),
                password: password.into(),
                selectors: None,
                created_at: now.to_string(),
                last_login_at: None,
            };
            auth_vault::save_profile(&data_dir, &profile, &key)?;
            Ok(json!({ "ok": true, "name": name }))
        }
        "auth_login" => {
            let name = args.get("name").and_then(|v| v.as_str()).ok_or("profile name is required")?;
            let key = auth_vault::ensure_key(&data_dir)?;
            let profile = auth_vault::load_profile(&data_dir, name, &key)?;
            let state = app.state::<LensState>();
            let webview = get_webview(app, &state)?;
            let username_js = escape_js(&profile.username);
            let password_js = escape_js(&profile.password);
            let fill_js = format!(
                r#"(function() {{
                    var inputs = document.querySelectorAll('input');
                    var userField = null, passField = null;
                    for (var i = 0; i < inputs.length; i++) {{
                        var t = (inputs[i].type || '').toLowerCase();
                        var n = (inputs[i].name || '').toLowerCase();
                        var a = (inputs[i].autocomplete || '').toLowerCase();
                        if (t === 'password') passField = inputs[i];
                        else if (!userField && (t === 'email' || t === 'text' || a === 'username' || n.includes('user') || n.includes('email'))) {{
                            userField = inputs[i];
                        }}
                    }}
                    if (userField) {{
                        userField.focus();
                        userField.value = '{username_js}';
                        userField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        userField.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                    if (passField) {{
                        passField.focus();
                        passField.value = '{password_js}';
                        passField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        passField.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                    return JSON.stringify({{ ok: true, filledUsername: !!userField, filledPassword: !!passField }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &fill_js, std::time::Duration::from_secs(10)).await
        }
        "auth_list" => {
            let names = auth_vault::list_profiles(&data_dir).unwrap_or_default();
            Ok(json!({ "ok": true, "profiles": names }))
        }
        "auth_delete" => {
            let name = args.get("name").and_then(|v| v.as_str()).ok_or("profile name is required")?;
            auth_vault::delete_profile(&data_dir, name)?;
            Ok(json!({ "ok": true, "deleted": name }))
        }
        _ => Err(format!("Unknown auth action: {}", action)),
    }
}

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
        // -----------------------------------------------------------------
        // Navigation
        // -----------------------------------------------------------------

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

        "back" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("history.back()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true, "action": "back" }))
        }

        "forward" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("history.forward()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true, "action": "forward" }))
        }

        "reload" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("location.reload()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true, "action": "reload" }))
        }

        "url" => {
            let webview = get_webview(app, &state)?;
            evaluate_js_with_result(
                app,
                &webview,
                "JSON.stringify({ url: location.href })",
                std::time::Duration::from_secs(5),
            )
            .await
        }

        "title" => {
            let webview = get_webview(app, &state)?;
            evaluate_js_with_result(
                app,
                &webview,
                "JSON.stringify({ title: document.title })",
                std::time::Duration::from_secs(5),
            )
            .await
        }

        // -----------------------------------------------------------------
        // Page inspection
        // -----------------------------------------------------------------

        "snapshot" => {
            let webview = get_webview(app, &state)?;

            // Call CDP for full accessibility tree
            let cdp_result = call_cdp_method(&webview, "Accessibility.getFullAXTree", "{}").await?;

            // Parse into tree + ref map
            let (tree_text, new_refs) = cdp::parse_ax_tree(&cdp_result);
            let ref_count = new_refs.len();

            // Update shared ref map
            if let Ok(mut map) = REF_MAP.write() {
                *map = new_refs;
            }

            // Get page metadata
            let meta_raw = evaluate_js_with_result(
                app,
                &webview,
                r#"JSON.stringify({ title: document.title, url: location.href })"#,
                std::time::Duration::from_secs(5),
            )
            .await
            .unwrap_or(json!(null));
            let meta = unwrap_js_result(meta_raw);

            let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let url = meta.get("url").and_then(|v| v.as_str()).unwrap_or("");

            Ok(json!({
                "title": title,
                "url": url,
                "tree": tree_text,
                "refs": ref_count,
                "note": format!("{} elements with refs (@e1-@e{}). Use ref to target.", ref_count, ref_count),
            }))
        }

        "screenshot" => {
            let webview = get_webview(app, &state)?;
            let annotate = args
                .get("annotate")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if annotate {
                // --- Annotated screenshot ---
                // 1. Ensure ref map is populated (auto-snapshot if empty)
                let ref_count = REF_MAP.read().map(|m| m.len()).unwrap_or(0);
                if ref_count == 0 {
                    let cdp_result = call_cdp_method(&webview, "Accessibility.getFullAXTree", "{}").await?;
                    let (_, new_refs) = cdp::parse_ax_tree(&cdp_result);
                    if let Ok(mut map) = REF_MAP.write() {
                        *map = new_refs;
                    }
                }

                // 2. Collect bounding boxes for each ref
                let refs_snapshot: Vec<(String, RefEntry)> = {
                    let map = REF_MAP.read().map_err(|_| "Ref map lock error".to_string())?;
                    map.iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect()
                };

                // Build a single batched JS call that resolves all bounding boxes at once.
                // This avoids N sequential evaluate calls (one per ref) which is slow
                // and can silently fail on complex pages.
                let mut finders = String::from("[");
                for (i, (ref_key, entry)) in refs_snapshot.iter().enumerate() {
                    if i > 0 { finders.push(','); }
                    let selector_js = cdp::build_js_selector(entry);
                    finders.push_str(&format!(
                        r#"{{ ref: "{ref_key}", role: "{role}", name: {name_json}, el: {selector_js} }}"#,
                        ref_key = ref_key,
                        role = entry.role,
                        name_json = serde_json::to_string(&entry.name).unwrap_or_default(),
                        selector_js = selector_js,
                    ));
                }
                finders.push(']');

                let batch_js = format!(
                    r#"(function() {{
                        var items = {finders};
                        var results = [];
                        for (var i = 0; i < items.length; i++) {{
                            var item = items[i];
                            if (!item.el) continue;
                            var r = item.el.getBoundingClientRect();
                            var x = Math.round(r.x), y = Math.round(r.y);
                            var w = Math.round(r.width), h = Math.round(r.height);
                            if (w > 0 && h > 0) {{
                                results.push({{ ref: '@' + item.ref, role: item.role, name: item.name, box: {{ x: x, y: y, w: w, h: h }} }});
                            }}
                        }}
                        return JSON.stringify(results);
                    }})()"#
                );

                let annotations: Vec<Value> = if let Ok(raw) = evaluate_js_with_result(
                    app,
                    &webview,
                    &batch_js,
                    std::time::Duration::from_secs(15),
                )
                .await
                {
                    let parsed = unwrap_js_result(raw);
                    if let Some(arr) = parsed.as_array() {
                        arr.clone()
                    } else {
                        tracing::warn!("[browser_bridge] Annotation batch returned non-array: {:?}", parsed);
                        Vec::new()
                    }
                } else {
                    tracing::warn!("[browser_bridge] Annotation batch JS eval failed");
                    Vec::new()
                };

                // 3. Inject overlay DOM with annotation boxes
                let mut overlay_html = String::from(
                    r#"<div id="__vm_overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;">"#,
                );
                for ann in &annotations {
                    let bx = &ann["box"];
                    let x = bx.get("x").and_then(|v| v.as_i64()).unwrap_or(0);
                    let y = bx.get("y").and_then(|v| v.as_i64()).unwrap_or(0);
                    let w = bx.get("w").and_then(|v| v.as_i64()).unwrap_or(0);
                    let h = bx.get("h").and_then(|v| v.as_i64()).unwrap_or(0);
                    let ref_label = ann.get("ref").and_then(|v| v.as_str()).unwrap_or("");
                    // Strip the @ for the label number
                    let num = ref_label.trim_start_matches('@');
                    overlay_html.push_str(&format!(
                        r#"<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;border:2px solid red;box-sizing:border-box;"><span style="position:absolute;top:-14px;left:0;background:red;color:#fff;font-size:10px;padding:0 3px;line-height:14px;font-family:sans-serif;">{num}</span></div>"#,
                    ));
                }
                overlay_html.push_str("</div>");

                let inject_js = format!(
                    r#"(function() {{
                        var existing = document.getElementById('__vm_overlay');
                        if (existing) existing.remove();
                        var d = document.createElement('div');
                        d.innerHTML = '{}';
                        document.body.appendChild(d.firstChild);
                        return JSON.stringify({{ ok: true }});
                    }})()"#,
                    overlay_html.replace('\'', "\\'").replace('\n', "")
                );
                let _ = evaluate_js_with_result(
                    app,
                    &webview,
                    &inject_js,
                    std::time::Duration::from_secs(5),
                )
                .await;

                // 4. Capture screenshot with overlays
                let screenshot_result = capture_screenshot_png(&webview).await;

                // 5. Remove overlay
                let _ = evaluate_js_with_result(
                    app,
                    &webview,
                    r#"(function() { var el = document.getElementById('__vm_overlay'); if (el) el.remove(); return JSON.stringify({ ok: true }); })()"#,
                    std::time::Duration::from_secs(5),
                )
                .await;

                // 6. Return result
                match screenshot_result {
                    Ok(png_bytes) => {
                        use base64::Engine;
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
                        Ok(json!({
                            "base64": b64,
                            "contentType": "image/png",
                            "size_bytes": png_bytes.len(),
                            "annotated": true,
                            "annotations": annotations,
                        }))
                    }
                    Err(e) => {
                        tracing::warn!("[browser_bridge] Annotated screenshot capture failed: {}", e);
                        Ok(json!({
                            "error": e,
                            "annotated": true,
                            "annotations": annotations,
                            "note": "Screenshot capture failed, but annotations were collected.",
                        }))
                    }
                }
            } else {
                // --- Standard screenshot (unchanged) ---
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
                        Ok(json!({
                            "base64": b64,
                            "contentType": "image/png",
                            "size_bytes": png_bytes.len(),
                            "page": meta,
                        }))
                    }
                    Err(e) => {
                        tracing::warn!("[browser_bridge] Screenshot capture failed: {}", e);
                        Ok(json!({
                            "error": e,
                            "note": "Screenshot capture failed. Use capture_screen tool as fallback.",
                            "page": meta,
                        }))
                    }
                }
            }
        }

        "status" => {
            let has_tabs = state
                .tabs
                .lock()
                .map(|g| !g.is_empty())
                .unwrap_or(false);
            let active_id = state.active_tab_id.lock()
                .map(|g| g.clone())
                .unwrap_or(None);
            let bounds = state.bounds.lock().ok().and_then(|g| *g);
            Ok(json!({
                "active": has_tabs,
                "activeTabId": active_id,
                "bounds": bounds.map(|(x,y,w,h)| json!({"x":x,"y":y,"width":w,"height":h})),
            }))
        }

        // -----------------------------------------------------------------
        // Element interactions
        // -----------------------------------------------------------------

        "click" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    el.scrollIntoView({{ block: 'center', behavior: 'instant' }});
                    el.click();
                    return JSON.stringify({{ ok: true, action: 'click' }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "dblclick" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    el.scrollIntoView({{ block: 'center', behavior: 'instant' }});
                    el.dispatchEvent(new MouseEvent('dblclick', {{ bubbles: true, cancelable: true }}));
                    return JSON.stringify({{ ok: true, action: 'dblclick' }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "fill" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let value_js = escape_js(value);
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    el.focus();
                    el.value = '{value_js}';
                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return JSON.stringify({{ ok: true, action: 'fill' }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "type" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let text = args
                .get("text")
                .or_else(|| args.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let text_js = escape_js(text);
            // Character-by-character key events for React/Vue/Angular compat
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    el.focus();
                    var text = '{text_js}';
                    for (var i = 0; i < text.length; i++) {{
                        var ch = text[i];
                        el.dispatchEvent(new KeyboardEvent('keydown', {{ key: ch, bubbles: true }}));
                        el.dispatchEvent(new KeyboardEvent('keypress', {{ key: ch, bubbles: true }}));
                        if (el.value !== undefined) {{
                            el.value += ch;
                        }}
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        el.dispatchEvent(new KeyboardEvent('keyup', {{ key: ch, bubbles: true }}));
                    }}
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return JSON.stringify({{ ok: true, action: 'type', length: text.length }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(30)).await
        }

        "hover" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    el.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
                    el.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
                    return JSON.stringify({{ ok: true, action: 'hover' }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "focus" => {
            // Element focus when ref or selector provided
            if args.get("ref").is_some() || args.get("selector").is_some() {
                let webview = get_webview(app, &state)?;
                let target = resolve_element_target(args)?;
                let js = format!(
                    r#"(function() {{
                        var el = {target};
                        if (!el) return JSON.stringify({{ error: 'Element not found' }});
                        el.focus();
                        return JSON.stringify({{ ok: true, action: 'focus' }});
                    }})()"#
                );
                evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
            } else {
                // Tab focus (existing behavior)
                let tab_id = args.get("tabId").or_else(|| args.get("targetId"))
                    .and_then(|v| v.as_str()).unwrap_or("");
                if tab_id.is_empty() {
                    return Err("tabId or ref/selector is required for focus".into());
                }
                let _ = app.emit("lens-focus-tab", json!({ "tabId": tab_id }));
                Ok(json!({ "ok": true, "tabId": tab_id }))
            }
        }

        "select" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let value_js = escape_js(value);
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    el.value = '{value_js}';
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return JSON.stringify({{ ok: true, action: 'select', value: el.value }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "check" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    if (!el.checked) {{
                        el.checked = true;
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    }}
                    return JSON.stringify({{ ok: true, action: 'check', checked: el.checked }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "uncheck" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    if (el.checked) {{
                        el.checked = false;
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    }}
                    return JSON.stringify({{ ok: true, action: 'uncheck', checked: el.checked }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "scroll" => {
            let webview = get_webview(app, &state)?;
            let x = args.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = args.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);

            // If a ref/selector is provided, scroll that element; otherwise scroll page
            if args.get("ref").is_some() || args.get("selector").is_some() {
                let target = resolve_element_target(args)?;
                let js = format!(
                    r#"(function() {{
                        var el = {target};
                        if (!el) return JSON.stringify({{ error: 'Element not found' }});
                        el.scrollBy({x}, {y});
                        return JSON.stringify({{ ok: true, action: 'scroll', scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }});
                    }})()"#
                );
                evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
            } else {
                let js = format!(
                    r#"(function() {{
                        window.scrollBy({x}, {y});
                        return JSON.stringify({{ ok: true, action: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY }});
                    }})()"#
                );
                evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
            }
        }

        // -----------------------------------------------------------------
        // Element queries
        // -----------------------------------------------------------------

        "gettext" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    var text = ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) ? el.value : (el.textContent || '').trim();
                    return JSON.stringify({{ ok: true, text: text }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "content" => {
            let webview = get_webview(app, &state)?;
            let max_len = args.get("maxLength").and_then(|v| v.as_u64()).unwrap_or(50000);
            if args.get("ref").is_some() || args.get("selector").is_some() {
                let target = resolve_element_target(args)?;
                let js = format!(
                    r#"(function() {{
                        var el = {target};
                        if (!el) return JSON.stringify({{ error: 'Element not found' }});
                        var html = el.outerHTML;
                        var truncated = html.length > {max_len};
                        if (truncated) html = html.slice(0, {max_len});
                        return JSON.stringify({{ ok: true, html: html, truncated: truncated }});
                    }})()"#
                );
                evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
            } else {
                let js = format!(
                    r#"(function() {{
                        var html = document.documentElement.outerHTML;
                        var truncated = html.length > {max_len};
                        if (truncated) html = html.slice(0, {max_len});
                        return JSON.stringify({{ ok: true, html: html, truncated: truncated }});
                    }})()"#
                );
                evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
            }
        }

        "boundingbox" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    var r = el.getBoundingClientRect();
                    return JSON.stringify({{ ok: true, x: r.x, y: r.y, width: r.width, height: r.height }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "isvisible" => {
            let webview = get_webview(app, &state)?;
            let target = resolve_element_target(args)?;
            let js = format!(
                r#"(function() {{
                    var el = {target};
                    if (!el) return JSON.stringify({{ error: 'Element not found' }});
                    var r = el.getBoundingClientRect();
                    var style = window.getComputedStyle(el);
                    var visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    return JSON.stringify({{ ok: true, visible: visible, width: r.width, height: r.height }});
                }})()"#
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        // -----------------------------------------------------------------
        // JavaScript evaluation
        // -----------------------------------------------------------------

        "evaluate" => {
            let webview = get_webview(app, &state)?;
            let expression = args
                .get("expression")
                .and_then(|v| v.as_str())
                .ok_or("expression is required for evaluate")?;
            let js = format!(
                r#"(function() {{
                    try {{
                        var result = eval({});
                        return JSON.stringify({{ ok: true, result: result }});
                    }} catch(e) {{
                        return JSON.stringify({{ error: e.message }});
                    }}
                }})()"#,
                serde_json::to_string(expression).unwrap_or_default()
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(30)).await
        }

        "addscript" => {
            let webview = get_webview(app, &state)?;
            // Accept "url" for external scripts, "content" or "value" for inline scripts
            let js = if let Some(url) = args.get("url").and_then(|v| v.as_str()) {
                let url_js = escape_js(url);
                format!(
                    r#"(function() {{
                        var s = document.createElement('script');
                        s.src = '{url_js}';
                        document.head.appendChild(s);
                        return JSON.stringify({{ ok: true, action: 'addscript', src: '{url_js}' }});
                    }})()"#
                )
            } else if let Some(content) = args.get("content")
                .or_else(|| args.get("value"))
                .and_then(|v| v.as_str()) {
                let content_json = serde_json::to_string(content).unwrap_or_default();
                format!(
                    r#"(function() {{
                        var s = document.createElement('script');
                        s.textContent = {content_json};
                        document.head.appendChild(s);
                        return JSON.stringify({{ ok: true, action: 'addscript', inline: true }});
                    }})()"#
                )
            } else {
                return Err("Either 'url' (external script) or 'value' (inline script content) is required for addscript".into());
            };
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        // -----------------------------------------------------------------
        // Waiting
        // -----------------------------------------------------------------

        "wait" => {
            let timeout_ms = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(30000);

            // Pure delay mode: no ref/selector → just sleep for the timeout duration
            let has_ref = args.get("ref").and_then(|v| v.as_str()).is_some();
            let has_selector = args.get("selector").and_then(|v| v.as_str()).is_some();
            if !has_ref && !has_selector {
                tokio::time::sleep(std::time::Duration::from_millis(timeout_ms)).await;
                return Ok(json!({ "ok": true, "action": "wait", "elapsed_ms": timeout_ms }));
            }

            // Element wait mode: poll until element appears
            let webview = get_webview(app, &state)?;
            let poll_ms = args.get("poll").and_then(|v| v.as_u64()).unwrap_or(200);
            let target = resolve_element_target(args)?;

            let start = std::time::Instant::now();
            let deadline = std::time::Duration::from_millis(timeout_ms);

            loop {
                let check_js = format!(
                    r#"(function() {{
                        var el = {target};
                        return JSON.stringify({{ found: !!el }});
                    }})()"#
                );
                if let Ok(result) = evaluate_js_with_result(
                    app,
                    &webview,
                    &check_js,
                    std::time::Duration::from_secs(5),
                )
                .await
                {
                    let parsed = unwrap_js_result(result);
                    if parsed.get("found").and_then(|v| v.as_bool()).unwrap_or(false) {
                        return Ok(json!({ "ok": true, "action": "wait", "elapsed_ms": start.elapsed().as_millis() as u64 }));
                    }
                }

                if start.elapsed() >= deadline {
                    return Err(format!("wait: element not found within {}ms", timeout_ms));
                }

                tokio::time::sleep(std::time::Duration::from_millis(poll_ms)).await;
            }
        }

        "waitforurl" => {
            let webview = get_webview(app, &state)?;
            let pattern = args.get("pattern")
                .or_else(|| args.get("value"))
                .and_then(|v| v.as_str())
                .ok_or("'pattern' (or 'value') is required for waitforurl — provide a regex to match against the URL")?;
            let timeout_ms = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(30000);
            let poll_ms = args.get("poll").and_then(|v| v.as_u64()).unwrap_or(500);

            // Escape for embedding in a JS single-quoted string.
            // Don't use serde_json::to_string — it re-encodes backslashes, breaking
            // regex patterns like `example\.com` which become `example\\.com` in JS.
            let pattern_js = escape_js(pattern);

            let start = std::time::Instant::now();
            let deadline = std::time::Duration::from_millis(timeout_ms);

            loop {
                let check_js = format!(
                    r#"(function() {{
                        try {{
                            var re = new RegExp('{pattern_js}');
                            return JSON.stringify({{ url: location.href, matched: re.test(location.href) }});
                        }} catch(e) {{
                            return JSON.stringify({{ url: location.href, matched: false, error: e.message }});
                        }}
                    }})()"#
                );
                match evaluate_js_with_result(
                    app,
                    &webview,
                    &check_js,
                    std::time::Duration::from_secs(5),
                )
                .await
                {
                    Ok(result) => {
                        let parsed = unwrap_js_result(result);
                        if parsed.get("matched").and_then(|v| v.as_bool()).unwrap_or(false) {
                            let url = parsed.get("url").and_then(|v| v.as_str()).unwrap_or("");
                            return Ok(json!({ "ok": true, "action": "waitforurl", "url": url, "elapsed_ms": start.elapsed().as_millis() as u64 }));
                        }
                    }
                    Err(e) => {
                        tracing::debug!("[browser_bridge] waitforurl JS eval failed: {}", e);
                    }
                }

                if start.elapsed() >= deadline {
                    return Err(format!("waitforurl: URL did not match '{}' within {}ms", pattern, timeout_ms));
                }

                tokio::time::sleep(std::time::Duration::from_millis(poll_ms)).await;
            }
        }

        "waitforloadstate" => {
            let webview = get_webview(app, &state)?;
            let load_state = args.get("state").and_then(|v| v.as_str()).unwrap_or("load");
            let timeout_ms = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(30000);
            let poll_ms = args.get("poll").and_then(|v| v.as_u64()).unwrap_or(200);

            let check_prop = match load_state {
                "domcontentloaded" => "document.readyState !== 'loading'",
                _ => "document.readyState === 'complete'",
            };

            let start = std::time::Instant::now();
            let deadline = std::time::Duration::from_millis(timeout_ms);

            loop {
                let check_js = format!(
                    r#"(function() {{
                        return JSON.stringify({{ ready: {check_prop}, readyState: document.readyState }});
                    }})()"#
                );
                if let Ok(result) = evaluate_js_with_result(
                    app,
                    &webview,
                    &check_js,
                    std::time::Duration::from_secs(5),
                )
                .await
                {
                    let parsed = unwrap_js_result(result);
                    if parsed.get("ready").and_then(|v| v.as_bool()).unwrap_or(false) {
                        return Ok(json!({ "ok": true, "action": "waitforloadstate", "readyState": parsed.get("readyState") }));
                    }
                }

                if start.elapsed() >= deadline {
                    return Err(format!("waitforloadstate: page did not reach '{}' within {}ms", load_state, timeout_ms));
                }

                tokio::time::sleep(std::time::Duration::from_millis(poll_ms)).await;
            }
        }

        // -----------------------------------------------------------------
        // Tab management
        // -----------------------------------------------------------------

        "open" | "tab_new" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("URL is required")?;
            let _ = app.emit("lens-open-tab", json!({ "url": url }));
            Ok(json!({ "ok": true, "url": url, "note": "Tab creation delegated to frontend" }))
        }

        "tabs" | "tab_list" => {
            let active_id = state.active_tab_id.lock()
                .map(|g| g.clone())
                .unwrap_or(None);
            let tabs = state.tabs.lock()
                .map_err(|e| format!("Lock error: {}", e))?;
            let tab_list: Vec<Value> = tabs.iter().map(|(tid, tab)| {
                json!({
                    "targetId": tab.webview_label,
                    "tabId": tid,
                    "type": "page",
                    "active": active_id.as_deref() == Some(tid.as_str()),
                })
            }).collect();
            Ok(json!(tab_list))
        }

        "tab_switch" => {
            let tab_id = args
                .get("tabId")
                .or_else(|| args.get("targetId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if tab_id.is_empty() {
                return Err("tabId is required for tab_switch".into());
            }

            // Verify tab exists and get the old active tab's webview label
            let old_label = {
                let tabs = state.tabs.lock().map_err(|e| format!("Lock error: {}", e))?;
                if !tabs.contains_key(tab_id) {
                    return Err(format!("Tab {} not found", tab_id));
                }
                let active = state.active_tab_id.lock()
                    .map(|g| g.clone()).unwrap_or(None);
                active.and_then(|aid| tabs.get(&aid).map(|t| t.webview_label.clone()))
            };

            // Update active tab on the Rust side so get_webview() targets the right tab
            {
                let mut active = state.active_tab_id.lock()
                    .map_err(|e| format!("Lock error: {}", e))?;
                *active = Some(tab_id.to_string());
            }

            // Hide old tab's native webview, show new tab's webview at current bounds
            {
                use tauri::{LogicalPosition, LogicalSize, Position, Size};
                let tabs = state.tabs.lock().map_err(|e| format!("Lock error: {}", e))?;

                // Hide old
                if let Some(ref old_lbl) = old_label {
                    if let Some(new_tab) = tabs.get(tab_id) {
                        if *old_lbl != new_tab.webview_label {
                            if let Some(old_wv) = app.get_webview(old_lbl) {
                                let _ = old_wv.hide();
                            }
                        }
                    }
                }

                // Show + position new
                if let Some(tab) = tabs.get(tab_id) {
                    if let Some(webview) = app.get_webview(&tab.webview_label) {
                        if let Ok(bounds_guard) = state.bounds.lock() {
                            if let Some((bx, by, bw, bh)) = *bounds_guard {
                                let _ = webview.set_position(Position::Logical(LogicalPosition::new(bx, by)));
                                let _ = webview.set_size(Size::Logical(LogicalSize::new(bw, bh)));
                            }
                        }
                        let _ = webview.show();
                    }
                }
            }

            // Notify frontend to update tab bar UI
            let _ = app.emit("lens-focus-tab", json!({ "tabId": tab_id }));

            Ok(json!({ "ok": true, "tabId": tab_id }))
        }

        "close_tab" | "tab_close" => {
            let tab_id = args
                .get("tabId")
                .or_else(|| args.get("targetId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if tab_id.is_empty() {
                return Err("tabId is required for close_tab".into());
            }

            // Remove from Rust-side tab state
            let webview_label = {
                let mut tabs = state.tabs.lock().map_err(|e| format!("Lock error: {}", e))?;
                let label = tabs.get(tab_id).map(|t| t.webview_label.clone());
                tabs.remove(tab_id);
                label
            };

            // Clear active_tab_id if it pointed to the closed tab
            {
                let mut active = state.active_tab_id.lock()
                    .map_err(|e| format!("Lock error: {}", e))?;
                if active.as_deref() == Some(tab_id) {
                    // Pick another tab if available, or set to None
                    let tabs = state.tabs.lock().map_err(|e| format!("Lock error: {}", e))?;
                    *active = tabs.keys().next().cloned();
                }
            }

            // Destroy the native webview
            if let Some(label) = webview_label {
                if let Some(webview) = app.get_webview(&label) {
                    // Hiding before close prevents visual flash
                    let _ = webview.hide();
                    let _ = webview.close();
                }
            }

            // Notify frontend
            let _ = app.emit("lens-close-tab", json!({ "tabId": tab_id }));
            Ok(json!({ "ok": true, "tabId": tab_id }))
        }

        // -----------------------------------------------------------------
        // Cookies / Storage
        // -----------------------------------------------------------------

        "cookies" | "cookies_get" => {
            let webview = get_webview(app, &state)?;
            let js = "JSON.stringify({ cookies: document.cookie })".to_string();
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "cookies_set" => {
            let webview = get_webview(app, &state)?;
            let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let js = format!(
                "document.cookie = '{}={}; path=/'; JSON.stringify({{ ok: true }})",
                escape_js(key), escape_js(value)
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "cookies_clear" => {
            let webview = get_webview(app, &state)?;
            let js = "document.cookie.split(';').forEach(function(c) { \
                     document.cookie = c.trim().split('=')[0] + \
                     '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; }); \
                     JSON.stringify({ ok: true })".to_string();
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "storage" | "storage_get" => {
            let webview = get_webview(app, &state)?;
            let raw_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("localStorage");
            let storage_type = match raw_type {
                "localStorage" | "sessionStorage" => raw_type,
                _ => return Err(format!("Invalid storage type: '{}'. Must be 'localStorage' or 'sessionStorage'.", raw_type)),
            };
            let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let js = if key.is_empty() {
                // No key = dump all entries
                format!(
                    "(function() {{ var s = {}; var o = {{}}; for (var i = 0; i < s.length; i++) {{ var k = s.key(i); o[k] = s.getItem(k); }} return JSON.stringify(o); }})()",
                    storage_type
                )
            } else {
                format!(
                    "JSON.stringify({{ value: {}.getItem('{}') }})",
                    storage_type, escape_js(key)
                )
            };
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        "storage_set" => {
            let webview = get_webview(app, &state)?;
            let raw_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("localStorage");
            let storage_type = match raw_type {
                "localStorage" | "sessionStorage" => raw_type,
                _ => return Err(format!("Invalid storage type: '{}'. Must be 'localStorage' or 'sessionStorage'.", raw_type)),
            };
            let key = args.get("key").and_then(|v| v.as_str())
                .ok_or("'key' is required for storage_set")?;
            let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let js = format!(
                "{}.setItem('{}', '{}'); JSON.stringify({{ ok: true }})",
                storage_type, escape_js(key), escape_js(value)
            );
            evaluate_js_with_result(app, &webview, &js, std::time::Duration::from_secs(10)).await
        }

        // -----------------------------------------------------------------
        // Auth vault
        // -----------------------------------------------------------------

        "auth_save" | "auth_login" | "auth_list" | "auth_delete" => {
            handle_auth_action(app, action, args).await
        }

        // -----------------------------------------------------------------
        // HTTP actions (handled in server.rs, fallback error here)
        // -----------------------------------------------------------------

        "search" => {
            Err("search action should be handled by MCP server dispatch, not browser bridge".into())
        }

        "fetch" => {
            Err("fetch action should be handled by MCP server dispatch, not browser bridge".into())
        }

        _ => Err(format!("Unknown browser action: {}", action)),
    }
}
