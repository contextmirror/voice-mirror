//! Find on page commands.

use tauri::{AppHandle, Manager};

use super::super::IpcResponse;
use super::LensState;

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

/// Execute JavaScript in a browser tab's child WebView2 (fire-and-forget).
#[tauri::command]
pub fn lens_eval_tab_js(
    app: AppHandle,
    tab_id: String,
    js: String,
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

    if let Some(webview) = app.get_webview(&label) {
        match webview.eval(&js) {
            Ok(()) => IpcResponse::ok_empty(),
            Err(e) => IpcResponse::err(&format!("{:?}", e)),
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

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.eval("window.getSelection().removeAllRanges()");
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("Webview not found")
    }
}
