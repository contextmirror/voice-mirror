use std::fs;
use std::path::Path;

use serde_json::Value;

use super::schema::AppConfig;

/// Load config from disk, falling back to defaults.
///
/// Reads `config.json` from the given directory. If the file exists, its
/// contents are deep-merged on top of `AppConfig::default()` so that any
/// newly-added config keys automatically get their default values.
///
/// If the main config is corrupt or missing, tries `config.json.bak`.
/// If both fail, returns `AppConfig::default()`.
pub fn load_config(config_dir: &Path) -> AppConfig {
    let config_path = config_dir.join("config.json");
    let backup_path = config_dir.join("config.json.bak");

    // Try main config first, then backup
    for path in &[&config_path, &backup_path] {
        if path.exists() {
            if let Ok(text) = fs::read_to_string(path) {
                if let Ok(saved) = serde_json::from_str::<Value>(&text) {
                    let default_val = match serde_json::to_value(AppConfig::default()) {
                        Ok(v) => v,
                        Err(_) => return AppConfig::default(),
                    };
                    let merged = deep_merge(default_val, saved);
                    if let Ok(config) = serde_json::from_value::<AppConfig>(merged) {
                        return config;
                    }
                }
            }
        }
    }

    AppConfig::default()
}

/// Save config to disk with atomic write.
///
/// Strategy: write to `.tmp`, backup existing to `.bak`, rename `.tmp` to final.
/// This ensures the config file is never in a partially-written state.
pub fn save_config(config_dir: &Path, config: &AppConfig) -> Result<(), String> {
    // Ensure config directory exists
    fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let config_path = config_dir.join("config.json");
    let tmp_path = config_dir.join("config.json.tmp");
    let backup_path = config_dir.join("config.json.bak");

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialize error: {}", e))?;

    // Step 1: Write to temp file
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("Write error: {}", e))?;

    // Step 2: Backup existing config (best-effort)
    if config_path.exists() {
        let _ = fs::copy(&config_path, &backup_path);
    }

    // Step 3: Atomic rename tmp -> config
    fs::rename(&tmp_path, &config_path)
        .map_err(|e| format!("Rename error: {}", e))?;

    Ok(())
}

/// Deep merge two JSON values.
///
/// Recursively merges `patch` into `base`. For objects, keys from `patch`
/// are merged recursively; for all other types, `patch` replaces `base`.
/// Arrays are replaced, not concatenated (matching JS behavior).
pub fn deep_merge(base: Value, patch: Value) -> Value {
    match (base, patch) {
        (Value::Object(mut base_map), Value::Object(patch_map)) => {
            for (key, patch_val) in patch_map {
                let merged = if let Some(base_val) = base_map.remove(&key) {
                    deep_merge(base_val, patch_val)
                } else {
                    patch_val
                };
                base_map.insert(key, merged);
            }
            Value::Object(base_map)
        }
        // For non-object types, patch wins
        (_base, patch) => patch,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_deep_merge_flat() {
        let base = json!({"a": 1, "b": 2});
        let patch = json!({"b": 3, "c": 4});
        let result = deep_merge(base, patch);
        assert_eq!(result, json!({"a": 1, "b": 3, "c": 4}));
    }

    #[test]
    fn test_deep_merge_nested() {
        let base = json!({"outer": {"a": 1, "b": 2}});
        let patch = json!({"outer": {"b": 3, "c": 4}});
        let result = deep_merge(base, patch);
        assert_eq!(result, json!({"outer": {"a": 1, "b": 3, "c": 4}}));
    }

    #[test]
    fn test_deep_merge_replaces_arrays() {
        let base = json!({"arr": [1, 2, 3]});
        let patch = json!({"arr": [4, 5]});
        let result = deep_merge(base, patch);
        assert_eq!(result, json!({"arr": [4, 5]}));
    }

    #[test]
    fn test_deep_merge_null_patch() {
        let base = json!({"a": 1});
        let patch = json!({"a": null});
        let result = deep_merge(base, patch);
        assert_eq!(result, json!({"a": null}));
    }

    #[test]
    fn test_deep_merge_preserves_unpatched_keys() {
        let base = json!({"voice": {"ttsAdapter": "kokoro", "ttsSpeed": 1.0}, "window": {"expanded": false}});
        let patch = json!({"voice": {"ttsSpeed": 1.5}});
        let result = deep_merge(base, patch);
        assert_eq!(result["voice"]["ttsAdapter"], "kokoro");
        assert_eq!(result["voice"]["ttsSpeed"], 1.5);
        assert_eq!(result["window"]["expanded"], false);
    }

    #[test]
    fn test_load_config_defaults() {
        // Loading from a non-existent directory should return defaults
        let config = load_config(std::path::Path::new("/nonexistent/path"));
        assert_eq!(config.ai.provider, "claude");
        assert_eq!(config.appearance.theme, "colorblind");
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let tmp = std::env::temp_dir().join("voice-mirror-test-persistence");
        let _ = std::fs::remove_dir_all(&tmp);

        let mut config = AppConfig::default();
        config.ai.provider = "ollama".into();
        config.appearance.orb_size = 128;

        save_config(&tmp, &config).expect("save should succeed");

        let loaded = load_config(&tmp);
        assert_eq!(loaded.ai.provider, "ollama");
        assert_eq!(loaded.appearance.orb_size, 128);

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
