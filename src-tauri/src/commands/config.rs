use crate::config::persistence;
use crate::config::schema::AppConfig;
use crate::services::platform;
use super::IpcResponse;

use std::sync::{LazyLock, Mutex};

use serde_json::Value;

/// Global config state, protected by a mutex.
/// Loaded once on first access, then kept in memory.
pub(crate) static CONFIG: LazyLock<Mutex<AppConfig>> = LazyLock::new(|| {
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

/// Get the full config with API keys masked for safety.
///
/// API keys are replaced with `"sk-ant-•••••c123"` style masks so they
/// don't leak if the config object is logged or visible on stream.
/// Use `get_api_key(provider)` to retrieve the full plaintext key.
#[tauri::command]
pub fn get_config() -> IpcResponse {
    let guard = match CONFIG.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock config: {}", e)),
    };
    let mut val = match serde_json::to_value(&*guard) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Serialize error: {}", e)),
    };

    // Mask API keys in the response
    use crate::config::crypto::mask_api_key;
    if let Some(ai) = val.get_mut("ai") {
        if let Some(keys) = ai.get_mut("apiKeys") {
            if let Some(obj) = keys.as_object_mut() {
                for (_provider, v) in obj.iter_mut() {
                    if let Some(key_str) = v.as_str() {
                        *v = match mask_api_key(key_str) {
                            Some(masked) => serde_json::Value::String(masked),
                            None => serde_json::Value::Null,
                        };
                    }
                }
            }
        }
    }
    if let Some(voice) = val.get_mut("voice") {
        for field in &["ttsApiKey", "sttApiKey"] {
            if let Some(v) = voice.get_mut(*field) {
                if let Some(key_str) = v.as_str() {
                    *v = match mask_api_key(key_str) {
                        Some(masked) => serde_json::Value::String(masked),
                        None => serde_json::Value::Null,
                    };
                }
            }
        }
    }

    IpcResponse::ok(val)
}

/// Get the full plaintext API key for a specific provider.
///
/// Only used by the Settings UI to populate the edit field.
#[tauri::command]
pub fn get_api_key(provider: String) -> IpcResponse {
    let guard = match CONFIG.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock config: {}", e)),
    };
    let key = guard.ai.api_keys
        .get(&provider)
        .and_then(|v| v.as_deref())
        .unwrap_or("");
    IpcResponse::ok(serde_json::json!({ "key": key }))
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

