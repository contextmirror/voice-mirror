use super::IpcResponse;
use crate::util::escape_js_string;
use tauri::{AppHandle, Manager};
use tracing::info;
use serde_json::Value;

/// Design overlay JS module, embedded at compile time.
const DESIGN_JS: &str = include_str!("../assets/design-overlay.js");

/// Dispatch design canvas actions to the active WebView2 browser tab.
///
/// The design overlay JS is injected into the child webview on `enable`,
/// and subsequent actions call methods on `window.vmDesign`.
#[tauri::command]
pub fn design_command(
    app: AppHandle,
    action: String,
    args: serde_json::Value,
    state: tauri::State<'_, super::lens::LensState>,
) -> IpcResponse {
    info!("[design] action={} args={}", action, args);

    // Resolve the active browser tab's webview label
    let label = {
        let active_id = match state.active_tab_id.lock() {
            Ok(guard) => guard.clone(),
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        let active_id = match active_id {
            Some(id) => id,
            None => return IpcResponse::err("No active browser tab"),
        };
        let tabs = match state.tabs.lock() {
            Ok(guard) => guard,
            Err(e) => return IpcResponse::err(format!("Lock error: {}", e)),
        };
        let tab = match tabs.get(&active_id) {
            Some(t) => t,
            None => return IpcResponse::err("Active tab not found"),
        };
        tab.webview_label.clone()
    };

    let webview = match app.get_webview(&label) {
        Some(w) => w,
        None => return IpcResponse::err("WebView not found"),
    };

    let js = match action.as_str() {
        "enable" => {
            // Inject the full design overlay module, then enable it
            format!("{}\nwindow.vmDesign.enable();", DESIGN_JS)
        }
        "disable" => "window.vmDesign.disable();".to_string(),
        "set_tool" => {
            let tool = args
                .get("tool")
                .and_then(|v| v.as_str())
                .unwrap_or("pen");
            format!("window.vmDesign.setTool('{}');", escape_js_string(tool))
        }
        "set_color" => {
            let color = args
                .get("color")
                .and_then(|v| v.as_str())
                .unwrap_or("#ff0000");
            format!("window.vmDesign.setColor('{}');", escape_js_string(color))
        }
        "set_size" => {
            let size = args.get("size").and_then(|v| v.as_f64()).unwrap_or(3.0);
            format!("window.vmDesign.setSize({});", size)
        }
        "undo" => "window.vmDesign.undo();".to_string(),
        "redo" => "window.vmDesign.redo();".to_string(),
        "clear" => "window.vmDesign.clear();".to_string(),
        other => {
            return IpcResponse::err(format!("Unknown design action: {}", other));
        }
    };

    match webview.eval(&js) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to execute design JS: {}", e)),
    }
}

/// Get the selected element data from the design overlay.
/// Uses ExecuteScript (with return value) to read window.vmDesign.getSelectedElement().
#[tauri::command]
pub async fn design_get_element(
    app: AppHandle,
    state: tauri::State<'_, super::lens::LensState>,
) -> Result<IpcResponse, String> {
    let label = {
        let active_id = state
            .active_tab_id
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let active_id = match active_id.as_ref() {
            Some(id) => id.clone(),
            None => return Ok(IpcResponse::err("No active browser tab")),
        };
        let tabs = state
            .tabs
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        match tabs.get(&active_id) {
            Some(t) => t.webview_label.clone(),
            None => return Ok(IpcResponse::err("Active tab not found")),
        }
    };

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "WebView not found".to_string())?;

    let js = "JSON.stringify(window.vmDesign ? window.vmDesign.getSelectedElement() : null)";

    match crate::services::browser_bridge::evaluate_js_with_result(
        &app,
        &webview,
        js,
        std::time::Duration::from_secs(5),
    )
    .await
    {
        Ok(data) => {
            if data.is_null() {
                Ok(IpcResponse::err("No element selected"))
            } else {
                // data is a JSON string from JSON.stringify — parse the inner value
                match data.as_str() {
                    Some(json_str) => match serde_json::from_str::<Value>(json_str) {
                        Ok(Value::Null) => Ok(IpcResponse::err("No element selected")),
                        Ok(parsed) => Ok(IpcResponse::ok(parsed)),
                        Err(_) => Ok(IpcResponse::ok(data)),
                    },
                    None => Ok(IpcResponse::ok(data)),
                }
            }
        }
        Err(e) => Ok(IpcResponse::err(format!("ExecuteScript failed: {}", e))),
    }
}
