//! Config migration from Electron to Tauri.
//!
//! Detects the old Electron app's config.json and maps its fields
//! to the new Tauri `AppConfig` struct. Does not auto-apply -- returns
//! the migrated config so the user can confirm before importing.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tracing::{info, warn};

use super::persistence::deep_merge;
use super::schema::AppConfig;

/// Get the old Electron config directory path.
///
/// Electron stores its config in the platform-specific app data directory
/// under the name "voice-mirror-electron":
///
/// - Windows: `%APPDATA%\voice-mirror-electron\`
/// - macOS:   `~/Library/Application Support/voice-mirror-electron/`
/// - Linux:   `~/.config/voice-mirror-electron/`
fn get_electron_config_dir() -> Option<PathBuf> {
    let base = dirs::config_dir()?;
    Some(base.join("voice-mirror-electron"))
}

/// Check whether an old Electron config file exists.
pub fn electron_config_exists() -> bool {
    if let Some(dir) = get_electron_config_dir() {
        dir.join("config.json").exists()
    } else {
        false
    }
}

/// Attempt to migrate the old Electron config to a new `AppConfig`.
///
/// Strategy:
/// 1. Read the Electron config.json
/// 2. Parse it as generic JSON (the schemas overlap significantly)
/// 3. Deep-merge it onto `AppConfig::default()` (handles renamed/missing fields)
/// 4. Return the result for the caller to review before applying
///
/// Returns `Ok(Some(config))` if migration was successful,
/// `Ok(None)` if no Electron config was found,
/// `Err(msg)` if the config was found but couldn't be parsed.
pub fn migrate_electron_config() -> Result<Option<AppConfig>, String> {
    let config_dir = match get_electron_config_dir() {
        Some(dir) => dir,
        None => {
            info!("Could not determine Electron config directory");
            return Ok(None);
        }
    };

    let config_path = config_dir.join("config.json");

    if !config_path.exists() {
        info!("No Electron config found at {}", config_path.display());
        return Ok(None);
    }

    info!("Found Electron config at {}", config_path.display());

    let text = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read Electron config: {}", e))?;

    let electron_json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Electron config JSON: {}", e))?;

    // The Electron config uses camelCase keys which match our serde rename_all.
    // Deep-merge the Electron values onto our defaults so any new Tauri-only
    // fields get their default values, while Electron settings are preserved.
    let default_val = serde_json::to_value(AppConfig::default())
        .map_err(|e| format!("Failed to serialize default config: {}", e))?;

    let merged = deep_merge(default_val, electron_json);

    let migrated: AppConfig = serde_json::from_value(merged)
        .map_err(|e| {
            warn!("Electron config migration partial failure: {}", e);
            format!("Some Electron config fields could not be migrated: {}", e)
        })?;

    info!("Successfully migrated Electron config");
    Ok(Some(migrated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_electron_config_dir_returns_path() {
        // This should return Some on all desktop platforms
        let dir = get_electron_config_dir();
        assert!(dir.is_some());
        let path = dir.unwrap();
        assert!(
            path.to_string_lossy().contains("voice-mirror-electron"),
            "Expected path to contain 'voice-mirror-electron', got: {}",
            path.display()
        );
    }

    #[test]
    fn test_electron_config_exists_no_crash() {
        // Just verify it doesn't panic -- actual result depends on environment
        let _ = electron_config_exists();
    }

    #[test]
    fn test_migrate_nonexistent_returns_none() {
        // If no Electron config exists, migration should return None
        // (This test may return Some on a dev machine that has Electron installed)
        let result = migrate_electron_config();
        assert!(result.is_ok());
        // We can't assert None because the dev machine might have the config
    }

    #[test]
    fn test_migrate_from_json_string() {
        // Simulate migration by testing the deep_merge + deserialize path
        let electron_json: Value = serde_json::json!({
            "ai": {
                "provider": "ollama",
                "model": "llama3.2"
            },
            "appearance": {
                "theme": "dracula",
                "orbSize": 96
            },
            "voice": {
                "ttsAdapter": "edge",
                "ttsVoice": "en-US-GuyNeural"
            }
        });

        let default_val = serde_json::to_value(AppConfig::default()).unwrap();
        let merged = deep_merge(default_val, electron_json);
        let config: AppConfig = serde_json::from_value(merged).unwrap();

        assert_eq!(config.ai.provider, "ollama");
        assert_eq!(config.ai.model, Some("llama3.2".into()));
        assert_eq!(config.appearance.theme, "dracula");
        assert_eq!(config.appearance.orb_size, 96);
        assert_eq!(config.voice.tts_adapter, "edge");
        assert_eq!(config.voice.tts_voice, "en-US-GuyNeural");

        // Fields not in the Electron JSON should have defaults
        assert_eq!(config.ai.context_length, 32768);
        assert_eq!(config.wake_word.phrase, "hey_claude");
    }
}
