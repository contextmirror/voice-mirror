//! Tauri commands for voice engine control.
//!
//! These commands are invoked from the frontend via `window.__TAURI__.invoke()`.
//! They interact with the `VoiceEngine` stored in Tauri's managed state.

use serde_json::json;
use tauri::{AppHandle, State};

use super::IpcResponse;
use crate::voice::pipeline::{list_input_devices, list_output_devices};
use crate::voice::{VoiceEngine, VoiceMode};

/// Tauri managed state wrapper for the voice engine.
///
/// Uses a std::sync::Mutex because Tauri state must be Sync.
/// Voice engine operations are fast (just setting flags), so
/// contention is minimal.
pub type VoiceEngineState = std::sync::Mutex<VoiceEngine>;

/// Start the voice pipeline.
///
/// Initializes audio capture, VAD, STT, and TTS engines, then
/// begins the audio processing loop on background threads.
#[tauri::command]
pub fn start_voice(
    app_handle: AppHandle,
    voice_state: State<'_, VoiceEngineState>,
) -> IpcResponse {
    let mut engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    if engine.is_running() {
        return IpcResponse::err("Voice engine is already running");
    }

    match engine.start(app_handle) {
        Ok(()) => {
            tracing::info!("Voice engine started");
            IpcResponse::ok(json!({
                "running": true,
                "state": engine.state().to_string(),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to start voice engine: {}", e);
            IpcResponse::err(format!("Failed to start voice engine: {}", e))
        }
    }
}

/// Stop the voice pipeline.
///
/// Stops audio capture, cancels any in-progress TTS, and shuts
/// down all background processing threads.
#[tauri::command]
pub fn stop_voice(voice_state: State<'_, VoiceEngineState>) -> IpcResponse {
    let mut engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    if !engine.is_running() {
        return IpcResponse::ok(json!({
            "running": false,
            "message": "Voice engine was not running",
        }));
    }

    engine.stop();
    tracing::info!("Voice engine stopped");
    IpcResponse::ok(json!({
        "running": false,
        "state": "idle",
    }))
}

/// Get the current voice engine status.
///
/// Returns the running state, current voice state, STT/TTS readiness,
/// and active configuration.
#[tauri::command]
pub fn get_voice_status(voice_state: State<'_, VoiceEngineState>) -> IpcResponse {
    let engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    let running = engine.is_running();
    let state = engine.state();
    let config = engine.config();

    IpcResponse::ok(json!({
        "running": running,
        "state": state.to_string(),
        "sttAdapter": config.stt_adapter,
        "sttModelSize": config.stt_model_size,
        "ttsAdapter": config.tts_adapter,
        "ttsVoice": config.tts_voice,
        "mode": format!("{}", config.mode),
        // Backwards-compatible fields matching voice-core events
        "sttReady": running,
        "ttsReady": running,
        "wakeWordReady": false,
    }))
}

/// Set the voice activation mode.
///
/// Accepts mode strings: "pushToTalk", "ptt", "wakeWord", "wake_word",
/// "continuous", "hybrid".
#[tauri::command]
pub fn set_voice_mode(mode: String, voice_state: State<'_, VoiceEngineState>) -> IpcResponse {
    let mut engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    match VoiceMode::from_str_flexible(&mode) {
        Some(voice_mode) => {
            engine.set_mode(voice_mode);
            tracing::info!(mode = %mode, "Voice mode set");
            IpcResponse::ok(json!({
                "mode": voice_mode.to_string(),
            }))
        }
        None => IpcResponse::err(format!(
            "Unknown voice mode: '{}'. Valid modes: pushToTalk, toggle, wakeWord",
            mode
        )),
    }
}

/// List available audio input and output devices.
///
/// Uses cpal to enumerate the system's audio devices. Returns both
/// input (microphone) and output (speaker) devices.
#[tauri::command]
pub fn list_audio_devices() -> IpcResponse {
    let input = list_input_devices();
    let output = list_output_devices();

    tracing::info!(
        input_count = input.len(),
        output_count = output.len(),
        "Audio devices enumerated"
    );

    IpcResponse::ok(json!({
        "input": input,
        "output": output,
    }))
}

/// Speak text using the TTS engine.
///
/// Accepts text to synthesize and play via the voice pipeline's TTS engine.
/// Requires the voice engine to be running. Spawns TTS on a background task
/// and returns immediately.
#[tauri::command]
pub fn speak_text(
    text: String,
    voice_state: State<'_, VoiceEngineState>,
) -> IpcResponse {
    let engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    if !engine.is_running() {
        return IpcResponse::err("Voice engine is not running");
    }

    match engine.speak_blocking(text) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Interrupt in-progress TTS playback.
///
/// Sets the cancellation flag on the TTS engine, causing any
/// queued or playing audio to stop.
#[tauri::command]
pub fn stop_speaking(voice_state: State<'_, VoiceEngineState>) -> IpcResponse {
    let engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    if !engine.is_running() {
        return IpcResponse::ok(json!({
            "message": "Voice engine is not running",
        }));
    }

    engine.stop_speaking();
    tracing::info!("TTS playback stop requested");
    IpcResponse::ok_empty()
}

/// Start recording (PTT press / Toggle start).
///
/// Transitions Idle/Listening → Recording. Used by the frontend
/// when the push-to-talk or toggle-to-talk key is pressed.
#[tauri::command]
pub fn ptt_press(voice_state: State<'_, VoiceEngineState>) -> IpcResponse {
    let engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    match engine.start_recording() {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Stop recording (PTT release / Toggle stop).
///
/// Forces the pipeline to immediately run STT on the recorded audio
/// instead of waiting for silence timeout.
#[tauri::command]
pub fn ptt_release(voice_state: State<'_, VoiceEngineState>) -> IpcResponse {
    let engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    match engine.stop_recording() {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Configure the PTT key binding in the global input hook.
///
/// Accepts key specs like `"kb:52"` (keyboard vkey 52 = the "4" key),
/// `"mouse:4"` (mouse button 4 / back), or legacy `"MouseButton4"`.
/// The configured key is suppressed at the OS level for keyboard bindings,
/// preventing "4444" from appearing in text fields while holding PTT.
#[tauri::command]
pub fn configure_ptt_key(key_spec: String) -> IpcResponse {
    match crate::services::input_hook::configure_ptt(&key_spec) {
        Ok(desc) => IpcResponse::ok(json!({ "binding": desc })),
        Err(e) => IpcResponse::err(e),
    }
}

/// Configure the dictation key binding in the global input hook.
///
/// Same format as `configure_ptt_key`.
#[tauri::command]
pub fn configure_dictation_key(key_spec: String) -> IpcResponse {
    match crate::services::input_hook::configure_dictation(&key_spec) {
        Ok(desc) => IpcResponse::ok(json!({ "binding": desc })),
        Err(e) => IpcResponse::err(e),
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::{VoiceEngineConfig, VoiceState};

    #[test]
    fn test_voice_engine_creation() {
        let engine = VoiceEngine::new();
        assert!(!engine.is_running());
        assert_eq!(engine.state(), VoiceState::Idle);
    }

    #[test]
    fn test_voice_engine_config() {
        let config = VoiceEngineConfig {
            mode: VoiceMode::Toggle,
            stt_adapter: "whisper-local".into(),
            stt_model_size: "tiny".into(),
            tts_adapter: "edge".into(),
            tts_voice: "en-US-GuyNeural".into(),
            ..Default::default()
        };

        let engine = VoiceEngine::with_config(config);
        assert_eq!(engine.config().mode, VoiceMode::Toggle);
        assert_eq!(engine.config().tts_voice, "en-US-GuyNeural");
    }

    #[test]
    fn test_voice_mode_from_str() {
        assert_eq!(
            VoiceMode::from_str_flexible("pushToTalk"),
            Some(VoiceMode::PushToTalk)
        );
        assert_eq!(
            VoiceMode::from_str_flexible("ptt"),
            Some(VoiceMode::PushToTalk)
        );
        assert_eq!(
            VoiceMode::from_str_flexible("toggle"),
            Some(VoiceMode::Toggle)
        );
        assert_eq!(
            VoiceMode::from_str_flexible("wakeWord"),
            Some(VoiceMode::WakeWord)
        );
        // Backwards compat: continuous/hybrid → WakeWord
        assert_eq!(
            VoiceMode::from_str_flexible("continuous"),
            Some(VoiceMode::WakeWord)
        );
        assert_eq!(
            VoiceMode::from_str_flexible("hybrid"),
            Some(VoiceMode::WakeWord)
        );
        assert_eq!(VoiceMode::from_str_flexible("invalid"), None);
    }
}
