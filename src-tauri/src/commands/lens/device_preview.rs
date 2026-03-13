//! Device preview (responsive design) commands.

use tauri::{AppHandle, Manager, Position, Size, LogicalPosition, LogicalSize};
use tracing::info;

use super::super::IpcResponse;
use super::{LensState, DeviceWebview};
use super::devtools::call_cdp_method_lens;
use super::webview_setup::create_tab_webview;

const MAX_DEVICE_WEBVIEWS: usize = 3;

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
