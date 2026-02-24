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
    // Read the saved config so the engine starts with user's settings
    // (STT model, GPU toggle, TTS adapter, etc.) instead of hardcoded defaults.
    let app_cfg = super::config::get_config_snapshot();
    let voice_cfg = crate::voice::VoiceEngineConfig {
        mode: crate::voice::VoiceMode::from_str_flexible(
            &app_cfg.behavior.activation_mode,
        )
        .unwrap_or_default(),
        stt_adapter: app_cfg.voice.stt_adapter.clone(),
        stt_model_size: app_cfg.voice.stt_model_size.clone(),
        stt_use_gpu: app_cfg.voice.stt_use_gpu,
        tts_adapter: app_cfg.voice.tts_adapter.clone(),
        tts_voice: app_cfg.voice.tts_voice.clone(),
        tts_speed: app_cfg.voice.tts_speed as f32,
        tts_volume: app_cfg.voice.tts_volume as f32,
        input_device: app_cfg.voice.input_device.clone(),
        output_device: app_cfg.voice.output_device.clone(),
        ..Default::default()
    };

    tracing::info!(
        stt_model = %voice_cfg.stt_model_size,
        stt_adapter = %voice_cfg.stt_adapter,
        use_gpu = voice_cfg.stt_use_gpu,
        tts_adapter = %voice_cfg.tts_adapter,
        mode = %voice_cfg.mode,
        "start_voice: applying saved config"
    );

    let mut engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    if engine.is_running() {
        return IpcResponse::err("Voice engine is already running");
    }

    // Apply saved config before starting
    engine.update_config(voice_cfg);

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

/// Inject text into the currently focused field via clipboard + Ctrl+V.
///
/// Used by the dictation feature: after STT transcribes speech, the
/// frontend calls this to paste the text into whatever app has focus.
#[tauri::command]
pub async fn inject_text(text: String) -> Result<(), String> {
    crate::services::text_injector::inject_text(&text).await
}

/// Ensure a Whisper STT model is downloaded and ready.
///
/// Downloads the model from HuggingFace if it doesn't exist locally.
/// Emits `stt-download-progress` events with percentage and byte counts.
/// Returns immediately if the model is already present on disk.
#[tauri::command]
pub async fn ensure_stt_model(app_handle: AppHandle, model_size: String) -> IpcResponse {
    let data_dir = crate::services::platform::get_data_dir_with_fallback();
    match crate::voice::stt::ensure_model_exists(&data_dir, &model_size, Some(&app_handle)).await {
        Ok(path) => IpcResponse::ok(json!({
            "path": path.display().to_string(),
            "modelSize": model_size,
        })),
        Err(e) => IpcResponse::err(format!("{}", e)),
    }
}

/// Restart the voice pipeline with the current configuration.
///
/// Reads the latest saved app config, builds a fresh `VoiceEngineConfig`,
/// stops the pipeline if running, updates the engine config, then starts
/// again. This picks up any config changes (STT model, TTS adapter, etc.)
/// without requiring an app restart. Works for both AI voice and dictation modes.
#[tauri::command]
pub fn restart_voice(
    app_handle: AppHandle,
    voice_state: State<'_, VoiceEngineState>,
) -> IpcResponse {
    // Read the latest saved config so the engine picks up new STT model etc.
    let app_cfg = super::config::get_config_snapshot();
    let voice_cfg = crate::voice::VoiceEngineConfig {
        mode: crate::voice::VoiceMode::from_str_flexible(
            &app_cfg.behavior.activation_mode,
        )
        .unwrap_or_default(),
        stt_adapter: app_cfg.voice.stt_adapter.clone(),
        stt_model_size: app_cfg.voice.stt_model_size.clone(),
        stt_use_gpu: app_cfg.voice.stt_use_gpu,
        tts_adapter: app_cfg.voice.tts_adapter.clone(),
        tts_voice: app_cfg.voice.tts_voice.clone(),
        tts_speed: app_cfg.voice.tts_speed as f32,
        tts_volume: app_cfg.voice.tts_volume as f32,
        input_device: app_cfg.voice.input_device.clone(),
        output_device: app_cfg.voice.output_device.clone(),
        ..Default::default()
    };

    let mut engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };

    let was_running = engine.is_running();
    if was_running {
        engine.stop();
        tracing::info!("Voice engine stopped for restart");
    }

    // Update the engine config before starting so it uses the new model/adapter
    engine.update_config(voice_cfg);

    match engine.start(app_handle) {
        Ok(()) => {
            tracing::info!("Voice engine restarted successfully");
            IpcResponse::ok(json!({
                "running": true,
                "wasRunning": was_running,
            }))
        }
        Err(e) => {
            tracing::error!("Failed to restart voice engine: {}", e);
            IpcResponse::err(format!("Restart failed: {}", e))
        }
    }
}

/// Detect available GPU for Whisper acceleration.
///
/// Runs `nvidia-smi` to check for NVIDIA GPUs and returns GPU name,
/// VRAM, and driver version. Also reports whether the binary was
/// compiled with CUDA support.
#[tauri::command]
pub fn detect_gpu() -> IpcResponse {
    let cuda_compiled = cfg!(feature = "cuda");

    match std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // Parse "NVIDIA GeForce RTX 5070 Ti, 16303 MiB, 581.80"
            let parts: Vec<&str> = text.split(", ").collect();
            let name = parts.first().unwrap_or(&"Unknown").to_string();
            let vram_mb = parts
                .get(1)
                .and_then(|s| s.replace(" MiB", "").parse::<u64>().ok());
            let driver = parts.get(2).unwrap_or(&"").to_string();

            tracing::info!(
                gpu = %name,
                vram_mb = ?vram_mb,
                driver = %driver,
                cuda_compiled = cuda_compiled,
                "GPU detected"
            );

            IpcResponse::ok(json!({
                "available": true,
                "name": name,
                "vramMb": vram_mb,
                "driverVersion": driver,
                "cudaCompiled": cuda_compiled,
            }))
        }
        _ => {
            tracing::info!(cuda_compiled = cuda_compiled, "No NVIDIA GPU detected");
            IpcResponse::ok(json!({
                "available": false,
                "cudaCompiled": cuda_compiled,
            }))
        }
    }
}

/// List installed Whisper STT models on disk.
///
/// Scans the models directory for known GGML model files and returns
/// their size, filename, and model size identifier.
#[tauri::command]
pub fn list_stt_models() -> IpcResponse {
    let data_dir = crate::services::platform::get_data_dir_with_fallback();
    let models_dir = data_dir.join("models");

    let known_models: &[(&str, &str)] = &[
        ("tiny", "ggml-tiny.en.bin"),
        ("base", "ggml-base.en.bin"),
        ("small", "ggml-small.en.bin"),
        ("large-v3-turbo", "ggml-large-v3-turbo-q5_0.bin"),
        ("large-v3", "ggml-large-v3.bin"),
    ];

    let mut installed = Vec::new();
    for (size, filename) in known_models {
        let path = models_dir.join(filename);
        if path.exists() {
            let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            installed.push(json!({
                "modelSize": size,
                "filename": filename,
                "sizeMb": (bytes as f64 / 1_048_576.0).round(),
            }));
        }
    }

    IpcResponse::ok(json!({ "models": installed }))
}

/// Delete an installed Whisper STT model from disk.
///
/// Refuses to delete a model that is currently in use by the running
/// voice engine. Returns the deleted model size on success.
#[tauri::command]
pub fn delete_stt_model(
    model_size: String,
    voice_state: State<'_, VoiceEngineState>,
) -> IpcResponse {
    // Safety: refuse to delete if voice engine is running with this model
    let engine = match voice_state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock voice state: {}", e)),
    };
    let active_model = engine.config().stt_model_size.clone();
    let is_running = engine.is_running();
    tracing::info!(
        model_size = %model_size,
        active_model = %active_model,
        is_running = is_running,
        "delete_stt_model requested"
    );
    if is_running && active_model == model_size {
        return IpcResponse::err(
            "Cannot delete the active model. Stop the voice engine first.",
        );
    }
    drop(engine); // release lock before file I/O

    let data_dir = crate::services::platform::get_data_dir_with_fallback();
    let filename = crate::voice::stt::model_filename(&model_size);
    let model_path = data_dir.join("models").join(&filename);
    tracing::info!(model_path = %model_path.display(), exists = model_path.exists(), "delete target");

    if !model_path.exists() {
        return IpcResponse::err("Model file not found");
    }

    match std::fs::remove_file(&model_path) {
        Ok(()) => {
            tracing::info!(model_size = %model_size, filename = %filename, "STT model deleted");
            IpcResponse::ok(json!({ "deleted": model_size, "filename": filename }))
        }
        Err(e) => IpcResponse::err(format!("Failed to delete model: {}", e)),
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
