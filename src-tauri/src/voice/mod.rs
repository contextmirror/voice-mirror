//! Voice engine module for Voice Mirror Tauri.
//!
//! Replaces the standalone voice-core child process with native Rust
//! integrated directly into the Tauri application. Provides:
//!
//! - Voice Activity Detection (VAD) via energy-based analysis
//! - Speech-to-Text (STT) via whisper-rs (stubbed until model files available)
//! - Text-to-Speech (TTS) via Edge TTS HTTP API
//! - Full voice pipeline orchestrating Mic -> VAD -> STT -> event -> TTS -> Speaker

pub mod pipeline;
pub mod stt;
pub mod tts;
pub mod vad;

use serde::{Deserialize, Serialize};

// ── Voice State ─────────────────────────────────────────────────────

/// Current state of the voice engine pipeline.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceState {
    /// Voice engine is not active. No audio processing.
    #[default]
    Idle,
    /// Listening for wake word or VAD trigger. Microphone active.
    Listening,
    /// Actively recording user speech (PTT, wake word, or continuous).
    Recording,
    /// Recorded audio is being processed (STT transcription in progress).
    Processing,
    /// TTS audio is being played back through speakers.
    Speaking,
}

impl std::fmt::Display for VoiceState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Idle => write!(f, "idle"),
            Self::Listening => write!(f, "listening"),
            Self::Recording => write!(f, "recording"),
            Self::Processing => write!(f, "processing"),
            Self::Speaking => write!(f, "speaking"),
        }
    }
}

// ── Voice Mode ──────────────────────────────────────────────────────

/// Voice activation mode controlling how recording is triggered.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceMode {
    /// Push-to-talk: recording only while key is held.
    #[default]
    PushToTalk,
    /// Toggle-to-talk: press once to start, press again to stop.
    Toggle,
    /// Wake word: always listening, VAD determines speech segments.
    /// (Wake word detection not yet implemented — currently behaves as
    /// always-on VAD-triggered recording.)
    WakeWord,
}

impl std::fmt::Display for VoiceMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PushToTalk => write!(f, "pushToTalk"),
            Self::Toggle => write!(f, "toggle"),
            Self::WakeWord => write!(f, "wakeWord"),
        }
    }
}

impl VoiceMode {
    /// Parse a mode string (accepting both camelCase and snake_case).
    /// Maps deprecated modes: continuous/hybrid → WakeWord.
    pub fn from_str_flexible(s: &str) -> Option<Self> {
        match s {
            "pushToTalk" | "push_to_talk" | "ptt" => Some(Self::PushToTalk),
            "toggle" | "toggleToTalk" | "toggle_to_talk" => Some(Self::Toggle),
            "wakeWord" | "wake_word" => Some(Self::WakeWord),
            // Backwards compat: continuous / hybrid map to wake word
            "continuous" | "hybrid" => Some(Self::WakeWord),
            _ => None,
        }
    }
}

// ── Voice Config ────────────────────────────────────────────────────

/// Runtime configuration for the voice engine.
///
/// This is derived from the app's `VoiceConfig` and `BehaviorConfig`
/// at pipeline start time. Changes require a pipeline restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEngineConfig {
    /// Voice activation mode.
    pub mode: VoiceMode,

    /// STT adapter name (e.g., "whisper-local", "openai-cloud").
    pub stt_adapter: String,

    /// STT model size for local whisper (e.g., "tiny", "base", "small").
    pub stt_model_size: String,

    /// TTS adapter name (e.g., "edge", "kokoro", "openai-tts").
    pub tts_adapter: String,

    /// TTS voice name (e.g., "en-US-AriaNeural" for Edge).
    pub tts_voice: String,

    /// TTS playback speed multiplier.
    pub tts_speed: f32,

    /// TTS playback volume (0.0 - 1.0).
    pub tts_volume: f32,

    /// Preferred input device name. None = system default.
    pub input_device: Option<String>,

    /// Preferred output device name. None = system default.
    pub output_device: Option<String>,

    /// Silence timeout in seconds before auto-stopping recording.
    pub silence_timeout_secs: f64,

    /// VAD energy threshold for speech detection.
    pub vad_threshold: f32,
}

impl Default for VoiceEngineConfig {
    fn default() -> Self {
        Self {
            mode: VoiceMode::PushToTalk,
            stt_adapter: "whisper-local".into(),
            stt_model_size: "base".into(),
            tts_adapter: "kokoro".into(),
            tts_voice: "af_bella".into(),
            tts_speed: 1.0,
            tts_volume: 1.0,
            input_device: None,
            output_device: None,
            silence_timeout_secs: 2.0,
            vad_threshold: 0.01,
        }
    }
}

// ── Voice Engine ────────────────────────────────────────────────────

/// Top-level voice engine that orchestrates all voice components.
///
/// This is the main entry point stored in Tauri's managed state.
/// It delegates to `VoicePipeline` for the actual audio processing loop.
pub struct VoiceEngine {
    /// The running pipeline, if active.
    pipeline: Option<pipeline::VoicePipeline>,
    /// Current engine configuration.
    config: VoiceEngineConfig,
}

impl Default for VoiceEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceEngine {
    /// Create a new voice engine with default configuration.
    pub fn new() -> Self {
        Self {
            pipeline: None,
            config: VoiceEngineConfig::default(),
        }
    }

    /// Create a new voice engine with the given configuration.
    pub fn with_config(config: VoiceEngineConfig) -> Self {
        Self {
            pipeline: None,
            config,
        }
    }

    /// Start the voice pipeline. Returns an error if already running.
    pub fn start(&mut self, app_handle: tauri::AppHandle) -> Result<(), String> {
        if self.pipeline.is_some() {
            return Err("Voice engine is already running".into());
        }

        let pipeline = pipeline::VoicePipeline::start(self.config.clone(), app_handle)?;
        self.pipeline = Some(pipeline);
        Ok(())
    }

    /// Stop the voice pipeline.
    pub fn stop(&mut self) {
        if let Some(pipeline) = self.pipeline.take() {
            pipeline.stop();
        }
    }

    /// Check if the voice pipeline is currently running.
    pub fn is_running(&self) -> bool {
        self.pipeline
            .as_ref()
            .map(|p| p.is_running())
            .unwrap_or(false)
    }

    /// Get the current voice state.
    pub fn state(&self) -> VoiceState {
        self.pipeline
            .as_ref()
            .map(|p| p.state())
            .unwrap_or(VoiceState::Idle)
    }

    /// Set the voice activation mode.
    pub fn set_mode(&mut self, mode: VoiceMode) {
        self.config.mode = mode;
        if let Some(ref pipeline) = self.pipeline {
            pipeline.set_mode(mode);
        }
    }

    /// Start recording (for PTT press / Toggle start).
    pub fn start_recording(&self) -> Result<(), String> {
        match self.pipeline {
            Some(ref pipeline) => {
                pipeline.start_recording();
                Ok(())
            }
            None => Err("Voice engine is not running".into()),
        }
    }

    /// Stop recording (for PTT release / Toggle stop).
    pub fn stop_recording(&self) -> Result<(), String> {
        match self.pipeline {
            Some(ref pipeline) => {
                pipeline.stop_recording();
                Ok(())
            }
            None => Err("Voice engine is not running".into()),
        }
    }

    /// Interrupt any in-progress TTS playback.
    pub fn stop_speaking(&self) {
        if let Some(ref pipeline) = self.pipeline {
            pipeline.stop_speaking();
        }
    }

    /// Speak text using the TTS engine. Requires a running pipeline.
    pub async fn speak(&self, text: &str) -> Result<(), String> {
        match self.pipeline {
            Some(ref pipeline) => pipeline.speak(text).await,
            None => Err("Voice engine is not running".into()),
        }
    }

    /// Speak text non-blocking (spawns a tokio task). Requires a running pipeline.
    pub fn speak_blocking(&self, text: String) -> Result<(), String> {
        match self.pipeline {
            Some(ref pipeline) => {
                pipeline.speak_blocking(text);
                Ok(())
            }
            None => Err("Voice engine is not running".into()),
        }
    }

    /// Update the engine configuration. Pipeline must be restarted for
    /// changes to take effect.
    pub fn update_config(&mut self, config: VoiceEngineConfig) {
        self.config = config;
    }

    /// Get a reference to the current configuration.
    pub fn config(&self) -> &VoiceEngineConfig {
        &self.config
    }
}
