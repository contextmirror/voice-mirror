use crate::config::migration;
use crate::config::persistence;
use crate::config::schema::AppConfig;
use crate::services::platform;
use super::IpcResponse;

use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde_json::Value;

/// Global config state, protected by a mutex.
/// Loaded once on first access, then kept in memory.
pub(crate) static CONFIG: Lazy<Mutex<AppConfig>> = Lazy::new(|| {
    let config_dir = platform::get_config_dir();
    Mutex::new(persistence::load_config(&config_dir))
});

/// Get a snapshot of the current config (cloned).
/// Used by other modules (e.g., providers) that need config values.
pub(crate) fn get_config_snapshot() -> AppConfig {
    CONFIG.lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// Get the full config.
#[tauri::command]
pub fn get_config() -> IpcResponse {
    let guard = match CONFIG.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock config: {}", e)),
    };
    match serde_json::to_value(&*guard) {
        Ok(val) => IpcResponse::ok(val),
        Err(e) => IpcResponse::err(format!("Serialize error: {}", e)),
    }
}

/// Update config with a partial patch (deep merge).
#[tauri::command]
pub fn set_config(patch: Value) -> IpcResponse {
    let mut guard = match CONFIG.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock config: {}", e)),
    };

    // Serialize current to Value, merge patch, deserialize back
    let current = match serde_json::to_value(&*guard) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Serialize error: {}", e)),
    };

    let merged = persistence::deep_merge(current, patch);

    let updated: AppConfig = match serde_json::from_value(merged.clone()) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(format!("Invalid config: {}", e)),
    };

    let config_dir = platform::get_config_dir();
    if let Err(e) = persistence::save_config(&config_dir, &updated) {
        return IpcResponse::err(e);
    }

    *guard = updated;
    IpcResponse::ok(merged)
}

/// Reset config to defaults.
#[tauri::command]
pub fn reset_config() -> IpcResponse {
    let mut guard = match CONFIG.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock config: {}", e)),
    };
    let default = AppConfig::default();

    let config_dir = platform::get_config_dir();
    if let Err(e) = persistence::save_config(&config_dir, &default) {
        return IpcResponse::err(e);
    }

    *guard = default;

    match serde_json::to_value(&*guard) {
        Ok(val) => IpcResponse::ok(val),
        Err(e) => IpcResponse::err(format!("Serialize error: {}", e)),
    }
}

/// Get platform information (OS, arch, directory paths).
#[tauri::command]
pub fn get_platform_info() -> IpcResponse {
    IpcResponse::ok(serde_json::json!({
        "os": platform::get_os_name(),
        "arch": platform::get_arch(),
        "configDir": platform::get_config_dir().to_string_lossy(),
        "dataDir": platform::get_data_dir().to_string_lossy(),
        "logDir": platform::get_log_dir().to_string_lossy(),
        "cacheDir": platform::get_cache_dir().to_string_lossy(),
    }))
}

/// Migrate config from the old Electron app.
///
/// Checks if an Electron config exists, reads and maps it to the Tauri
/// config format. Returns the migrated config for user confirmation --
/// does NOT auto-apply.
#[tauri::command]
pub fn migrate_electron_config() -> IpcResponse {
    match migration::migrate_electron_config() {
        Ok(Some(config)) => {
            match serde_json::to_value(&config) {
                Ok(val) => IpcResponse::ok(serde_json::json!({
                    "found": true,
                    "config": val
                })),
                Err(e) => IpcResponse::err(format!("Serialize error: {}", e)),
            }
        }
        Ok(None) => {
            IpcResponse::ok(serde_json::json!({
                "found": false,
                "config": null
            }))
        }
        Err(e) => IpcResponse::err(e),
    }
}
