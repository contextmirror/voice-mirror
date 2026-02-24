use super::IpcResponse;
use tauri::{AppHandle, Manager};
use tracing::info;

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

/// Escape a string for safe embedding inside a JS single-quoted string literal.
fn escape_js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
