//! Configuration reading and data directory paths.
//!
//! The single source of truth is `voice_settings.json` in the data directory,
//! written by Electron's `syncVoiceSettings()` before spawning voice-core.
//! All fields use snake_case.

pub mod paths;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tracing::warn;

use paths::get_data_dir;

/// voice_settings.json — the single config file written by Electron and read by voice-core.
///
/// Electron's `syncVoiceSettings()` merges the relevant parts of config.json
/// (voice adapters, behavior keys, user name) into this flat snake_case structure
/// before spawning the voice-core process.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VoiceSettings {
    // ── Adapter selection ────────────────────────────────────────────
    #[serde(default)]
    pub tts_adapter: Option<String>,
    #[serde(default)]
    pub tts_voice: Option<String>,
    #[serde(default)]
    pub tts_model_size: Option<String>,
    #[serde(default)]
    pub tts_volume: Option<f64>,
    #[serde(default)]
    pub tts_speed: Option<f64>,
    #[serde(default)]
    pub tts_api_key: Option<String>,
    #[serde(default)]
    pub tts_endpoint: Option<String>,
    #[serde(default)]
    pub tts_model_path: Option<String>,
    #[serde(default)]
    pub stt_adapter: Option<String>,
    #[serde(default)]
    pub stt_api_key: Option<String>,
    #[serde(default)]
    pub stt_endpoint: Option<String>,
    #[serde(default)]
    pub stt_model_name: Option<String>,

    // ── Behavior / hotkey ────────────────────────────────────────────
    #[serde(default)]
    pub activation_mode: Option<String>,
    #[serde(default)]
    pub ptt_key: Option<String>,
    #[serde(default)]
    pub dictation_key: Option<String>,

    // ── Audio devices ────────────────────────────────────────────────
    #[serde(default)]
    pub input_device: Option<String>,
    #[serde(default)]
    pub output_device: Option<String>,

    // ── User ─────────────────────────────────────────────────────────
    #[serde(default)]
    pub user_name: Option<String>,
}

/// Read voice_settings.json from the data directory.
pub fn read_voice_settings() -> VoiceSettings {
    let path = get_voice_settings_path();
    read_json_file(&path).unwrap_or_default()
}

/// Path to voice_settings.json.
pub fn get_voice_settings_path() -> PathBuf {
    get_data_dir().join("voice_settings.json")
}

/// Generic helper: read a JSON file and deserialize it.
fn read_json_file<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    match std::fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(val) => Some(val),
            Err(e) => {
                warn!("Failed to parse {}: {}", path.display(), e);
                None
            }
        },
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!("Failed to read {}: {}", path.display(), e);
            }
            None
        }
    }
}
