//! IPC protocol types for communication with Electron.
//!
//! Events use `{"event": "<name>", "data": {...}}` format (Rust -> Electron).
//! Commands use `{"command": "<name>", ...}` format (Electron -> Rust).

pub mod bridge;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Events: Rust -> Electron (stdout)
// ---------------------------------------------------------------------------

/// All events emitted to Electron via stdout as JSON lines.
///
/// Serialized as `{"event": "<variant>", "data": {...}}`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum VoiceEvent {
    Starting {},
    Loading { step: String },
    Ready {},
    WakeWord { model: String, score: f64 },
    RecordingStart {
        #[serde(rename = "type")]
        rec_type: String,
    },
    RecordingStop {},
    Transcription { text: String },
    Response {
        text: String,
        source: String,
        #[serde(rename = "msgId", skip_serializing_if = "Option::is_none")]
        msg_id: Option<String>,
    },
    SpeakingStart { text: String },
    SpeakingEnd {},
    Error { message: String },
    Pong {},
    AudioDevices {
        input: Vec<AudioDeviceInfo>,
        output: Vec<AudioDeviceInfo>,
    },
    ModeChange { mode: String },
    SentToInbox {
        message: String,
        #[serde(rename = "msgId", skip_serializing_if = "Option::is_none")]
        msg_id: Option<String>,
    },
    ConfigUpdated { config: serde_json::Value },
    Stopping {},
    AdapterList {
        tts: Vec<String>,
        stt: Vec<String>,
    },
    DictationStart {},
    DictationStop {},
    DictationResult { text: String, success: bool },
    ImageReceived { path: String },
    Listening {},
    ConversationActive {},
    PttStart {},
    PttStop {},
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: i32,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Commands: Electron -> Rust (stdin)
// ---------------------------------------------------------------------------

/// All commands received from Electron via stdin as JSON lines.
///
/// Deserialized from `{"command": "<variant>", ...}`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "command")]
#[serde(rename_all = "snake_case")]
pub enum VoiceCommand {
    Query {
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        image: Option<String>,
    },
    StartRecording {},
    StopRecording {},
    SetMode {
        mode: String,
    },
    ConfigUpdate {
        #[serde(default)]
        config: serde_json::Value,
    },
    ListAudioDevices {},
    SystemSpeak {
        text: String,
    },
    Stop {},
    ListAdapters {},
    Ping {},
    /// Image sent from Electron (uses `"type": "image"` instead of `"command"`).
    /// Normalized to `"command": "image"` in the stdin reader.
    Image {
        #[serde(default)]
        data: Option<String>,
        #[serde(default)]
        filename: Option<String>,
        #[serde(default)]
        prompt: Option<String>,
    },
}
