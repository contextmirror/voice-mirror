use super::IpcResponse;
use tauri::{AppHandle, Manager};

/// Get the current window position.
#[tauri::command]
pub fn get_window_position(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    match window.outer_position() {
        Ok(pos) => IpcResponse::ok(serde_json::json!({
            "x": pos.x,
            "y": pos.y,
        })),
        Err(e) => IpcResponse::err(format!("Failed to get position: {}", e)),
    }
}

/// Set the window position.
#[tauri::command]
pub fn set_window_position(app: AppHandle, x: f64, y: f64) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    let position = tauri::PhysicalPosition::new(x as i32, y as i32);
    match window.set_position(tauri::Position::Physical(position)) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set position: {}", e)),
    }
}

/// Save current window position and size to config.
#[tauri::command]
pub fn save_window_bounds(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    // Read current position
    let position = match window.outer_position() {
        Ok(pos) => pos,
        Err(e) => return IpcResponse::err(format!("Failed to get position: {}", e)),
    };

    // Read current size
    let size = match window.outer_size() {
        Ok(s) => s,
        Err(e) => return IpcResponse::err(format!("Failed to get size: {}", e)),
    };

    // Build a config patch for the window section
    let patch = serde_json::json!({
        "window": {
            "orbX": position.x as f64,
            "orbY": position.y as f64,
        }
    });

    // Use the set_config command logic to persist
    // We import the persistence and platform modules directly to avoid
    // circular dependencies with the config command's static CONFIG.
    use crate::config::persistence;
    use crate::services::platform;

    let config_dir = platform::get_config_dir();
    let current_config = persistence::load_config(&config_dir);

    let current_val = match serde_json::to_value(&current_config) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Serialize error: {}", e)),
    };

    let merged = persistence::deep_merge(current_val, patch);

    let updated: crate::config::schema::AppConfig = match serde_json::from_value(merged) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(format!("Invalid config: {}", e)),
    };

    if let Err(e) = persistence::save_config(&config_dir, &updated) {
        return IpcResponse::err(e);
    }

    IpcResponse::ok(serde_json::json!({
        "x": position.x,
        "y": position.y,
        "width": size.width,
        "height": size.height,
    }))
}

/// Minimize the window.
#[tauri::command]
pub fn minimize_window(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    match window.minimize() {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to minimize: {}", e)),
    }
}

/// Maximize or unmaximize the window (toggle).
#[tauri::command]
pub fn maximize_window(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    let is_max = window.is_maximized().unwrap_or(false);
    let result = if is_max {
        window.unmaximize()
    } else {
        window.maximize()
    };

    match result {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to toggle maximize: {}", e)),
    }
}

/// Set the window size.
#[tauri::command]
pub fn set_window_size(app: AppHandle, width: f64, height: f64) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    let size = tauri::PhysicalSize::new(width as u32, height as u32);
    match window.set_size(tauri::Size::Physical(size)) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set size: {}", e)),
    }
}

/// Set always-on-top state.
#[tauri::command]
pub fn set_always_on_top(app: AppHandle, value: bool) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    match window.set_always_on_top(value) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set always-on-top: {}", e)),
    }
}

/// Set whether the window is resizable.
#[tauri::command]
pub fn set_resizable(app: AppHandle, value: bool) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    match window.set_resizable(value) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set resizable: {}", e)),
    }
}

/// Quit the application.
#[tauri::command]
pub fn quit_app(app: AppHandle) -> IpcResponse {
    app.exit(0);
    IpcResponse::ok_empty()
}
