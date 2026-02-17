//! Voice Mirror — Rust voice processing core.
//!
//! Communicates with Electron via JSON-line IPC on stdin/stdout.
//! This is the entry point that initializes all subsystems and runs the
//! main event loop.

mod audio;
mod config;
mod hotkey;
mod inbox;
mod ipc;
mod stt;
mod text_injector;
mod tts;
mod vad;
mod wake_word;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use audio::{audio_ring_buffer, AudioConsumer, AudioStateMachine, RecordingSource};
use config::paths::get_data_dir;
use config::{read_voice_config, read_voice_settings};
use hotkey::{HotkeyConfig, HotkeyEvent, HotkeyListener};
use ipc::bridge::{emit_error, emit_event, spawn_stdin_reader};
use ipc::{AudioDeviceInfo, VoiceCommand, VoiceEvent};

/// Chunk size in samples (80 ms at 16 kHz). Matches capture and OWW input.
const CHUNK_SAMPLES: usize = 1280;

/// How long silence must persist before we stop recording (seconds).
const SILENCE_TIMEOUT_SECS: f64 = 2.0;

/// TTS sample rate for OpenAI TTS PCM output.
const TTS_SAMPLE_RATE: u32 = 24_000;

/// Shared application state that the command handler and audio loop both need.
struct AppState {
    audio_state: Arc<AudioStateMachine>,
    tts_engine: Option<Box<dyn tts::TtsEngine>>,
    tts_player: Option<tts::playback::AudioPlayer>,
    stt_engine: Option<stt::SttAdapter>,
    inbox: Option<inbox::InboxManager>,
    /// Buffer accumulating recorded audio samples for STT.
    recording_buf: Vec<f32>,
}

#[tokio::main]
async fn main() {
    // Initialize tracing (respects RUST_LOG env, defaults to info).
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    // Try to log to a file; fall back to stderr if the directory can't be created.
    let data_dir = get_data_dir();
    let use_file = std::fs::create_dir_all(&data_dir).is_ok();

    // We need to keep the non-blocking guard alive for the lifetime of the program.
    let _guard: Option<tracing_appender::non_blocking::WorkerGuard>;

    if use_file {
        let file_appender = tracing_appender::rolling::never(&data_dir, "vmr-rust.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        _guard = Some(guard);
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_writer(non_blocking)
            .with_ansi(false)
            .init();
    } else {
        _guard = None;
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_writer(std::io::stderr)
            .init();
    }

    // Emit starting event immediately so Electron knows we're alive.
    emit_event(&VoiceEvent::Starting {});

    // Read config
    emit_event(&VoiceEvent::Loading {
        step: "Reading configuration...".to_string(),
    });
    let voice_config = read_voice_config();
    let voice_settings = read_voice_settings();
    info!(?voice_config, ?voice_settings, "Configuration loaded");

    let model_dir = data_dir.join("models");

    // Spawn stdin reader (blocking thread -> async channel)
    emit_event(&VoiceEvent::Loading {
        step: "Starting IPC bridge...".to_string(),
    });
    let mut cmd_rx = spawn_stdin_reader();

    // ── Audio subsystem ──────────────────────────────────────────────
    emit_event(&VoiceEvent::Loading {
        step: "Initializing audio...".to_string(),
    });

    let audio_state = AudioStateMachine::new();
    let (producer, consumer) = audio_ring_buffer(None);

    // Start cpal capture (returns a Stream handle we must keep alive)
    let _capture_stream = match audio::start_capture(producer, None) {
        Ok(stream) => {
            info!("Audio capture initialized");
            Some(stream)
        }
        Err(e) => {
            warn!("Audio capture failed to start: {} — microphone features disabled", e);
            emit_event(&VoiceEvent::Error {
                message: format!("Audio capture failed: {}", e),
            });
            None
        }
    };

    // ── VAD ──────────────────────────────────────────────────────────
    emit_event(&VoiceEvent::Loading {
        step: "Loading VAD model...".to_string(),
    });

    let mut vad_engine = vad::SileroVad::new();
    let vad_loaded = vad_engine.load(&model_dir);
    if vad_loaded {
        info!("Silero VAD loaded (ONNX)");
    } else {
        info!("Using energy-based VAD fallback");
    }

    // ── Wake word ────────────────────────────────────────────────────
    emit_event(&VoiceEvent::Loading {
        step: "Loading wake word model...".to_string(),
    });

    let mut ww_engine = wake_word::OpenWakeWord::new();
    let ww_loaded = ww_engine.load(&model_dir);
    if ww_loaded {
        info!("OpenWakeWord loaded");
    } else {
        info!("Wake word detection disabled (models not found or native-ml off)");
    }

    // ── STT ──────────────────────────────────────────────────────────
    emit_event(&VoiceEvent::Loading {
        step: "Loading STT model...".to_string(),
    });

    let stt_adapter_name = voice_settings
        .stt_adapter
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.stt_adapter.as_deref()))
        .unwrap_or("whisper-local");

    let stt_api_key = voice_settings
        .stt_api_key
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.stt_api_key.as_deref()));

    let stt_endpoint = voice_settings
        .stt_endpoint
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.stt_endpoint.as_deref()));

    let stt_model_name = voice_settings
        .stt_model_name
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.stt_model_name.as_deref()));

    let stt_engine = match stt::create_stt_engine(
        stt_adapter_name,
        &data_dir,
        stt_model_name,
        stt_api_key,
        stt_endpoint,
    ) {
        Ok(engine) => {
            info!(adapter = stt_adapter_name, "STT engine initialized");
            Some(engine)
        }
        Err(e) => {
            warn!("STT engine failed to initialize: {}", e);
            emit_event(&VoiceEvent::Error {
                message: format!("STT not available: {}", e),
            });
            None
        }
    };

    // ── TTS ──────────────────────────────────────────────────────────
    emit_event(&VoiceEvent::Loading {
        step: "Loading TTS engine...".to_string(),
    });

    let tts_adapter_name = voice_settings
        .tts_adapter
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.tts_adapter.as_deref()))
        .unwrap_or("edge");

    let tts_voice = voice_settings
        .tts_voice
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.tts_voice.as_deref()));

    let tts_api_key = voice_settings
        .tts_api_key
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.tts_api_key.as_deref()));

    let tts_endpoint = voice_settings
        .tts_endpoint
        .as_deref()
        .or(voice_config
            .voice
            .as_ref()
            .and_then(|v| v.tts_endpoint.as_deref()));

    let tts_engine = match tts::create_tts_engine(
        tts_adapter_name,
        &data_dir,
        tts_voice,
        tts_api_key,
        tts_endpoint,
    ) {
        Ok(engine) => {
            info!(adapter = tts_adapter_name, name = engine.name(), "TTS engine initialized");
            Some(engine)
        }
        Err(e) => {
            warn!("TTS engine failed to initialize: {}", e);
            emit_event(&VoiceEvent::Error {
                message: format!("TTS not available: {}", e),
            });
            None
        }
    };

    // ── TTS Playback ─────────────────────────────────────────────────
    let tts_player = match tts::playback::AudioPlayer::new() {
        Ok(player) => {
            let volume = voice_settings
                .tts_volume
                .or(voice_config.voice.as_ref().and_then(|v| v.tts_volume))
                .unwrap_or(1.0) as f32;
            player.set_volume(volume);
            info!("Audio playback initialized");
            Some(player)
        }
        Err(e) => {
            warn!("Audio playback failed to initialize: {}", e);
            None
        }
    };

    // ── Hotkey listener ──────────────────────────────────────────────
    let activation_mode = voice_config
        .activation_mode
        .as_deref()
        .unwrap_or("ptt");

    let (hotkey_tx, mut hotkey_rx) = tokio::sync::mpsc::channel::<HotkeyEvent>(32);

    let _hotkey_listener = if activation_mode == "ptt" || activation_mode == "hybrid" {
        let hk_config = HotkeyConfig {
            ptt_key: voice_config.ptt_key.clone().or(Some("MouseButton5".to_string())),
            dictation_key: None,
        };
        let listener = HotkeyListener::new(hk_config);
        listener.start(hotkey_tx);
        info!(mode = activation_mode, "Hotkey listener started");
        Some(listener)
    } else {
        info!(mode = activation_mode, "Hotkey listener not started");
        None
    };

    // ── Inbox ────────────────────────────────────────────────────────
    let inbox_manager = inbox::InboxManager::new(&data_dir, Some("user"));
    let removed = inbox_manager.cleanup(2.0);
    if removed > 0 {
        info!(removed, "Inbox startup cleanup");
    }

    // ── Shared mutable state ─────────────────────────────────────────
    let app_state = Arc::new(Mutex::new(AppState {
        audio_state: audio_state.clone(),
        tts_engine,
        tts_player,
        stt_engine,
        inbox: Some(inbox_manager),
        recording_buf: Vec::new(),
    }));

    let vad_shared = Arc::new(Mutex::new(vad_engine));
    let ww_shared = Arc::new(Mutex::new(ww_engine));
    let consumer_shared = Arc::new(Mutex::new(consumer));

    // ── Audio processing loop ────────────────────────────────────────
    if activation_mode == "wake_word" || activation_mode == "hybrid" {
        if audio_state.start_listening() {
            emit_event(&VoiceEvent::Listening {});
            info!("Auto-started listening mode");
        }
    }

    let audio_loop_state = audio_state.clone();
    let audio_loop_app = app_state.clone();
    let audio_loop_vad = vad_shared.clone();
    let audio_loop_ww = ww_shared.clone();
    let audio_loop_consumer = consumer_shared.clone();

    let audio_task = tokio::spawn(async move {
        let mut read_buf = vec![0.0f32; CHUNK_SAMPLES];
        let mut silence_start: Option<Instant> = None;

        loop {
            tokio::time::sleep(Duration::from_millis(40)).await;

            let samples_read = {
                let mut cons = audio_loop_consumer.lock().unwrap();
                cons.pop_slice(&mut read_buf)
            };

            if samples_read == 0 {
                continue;
            }

            let chunk = &read_buf[..samples_read];
            let current_state = audio_loop_state.current_state();

            match current_state {
                audio::AudioState::Listening => {
                    let ww_detected = {
                        let mut ww = audio_loop_ww.lock().unwrap();
                        if ww.is_loaded() {
                            let (detected, score) = ww.process(chunk);
                            if detected {
                                info!(score, "Wake word detected!");
                                emit_event(&VoiceEvent::WakeWord {
                                    model: "hey_claude_v2".to_string(),
                                    score: score as f64,
                                });
                                true
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    };

                    if ww_detected
                        && audio_loop_state.start_recording(RecordingSource::WakeWord)
                    {
                        emit_event(&VoiceEvent::RecordingStart {
                            rec_type: "wake_word".to_string(),
                        });
                        silence_start = None;
                        let mut app = audio_loop_app.lock().unwrap();
                        app.recording_buf.clear();
                    }
                }
                audio::AudioState::Recording => {
                    {
                        let mut app = audio_loop_app.lock().unwrap();
                        app.recording_buf.extend_from_slice(chunk);
                    }

                    let (is_speech, _prob) = {
                        let mut v = audio_loop_vad.lock().unwrap();
                        v.process(chunk, "recording")
                    };

                    if is_speech {
                        silence_start = None;
                    } else {
                        let silence = silence_start.get_or_insert_with(Instant::now);
                        if silence.elapsed().as_secs_f64() >= SILENCE_TIMEOUT_SECS {
                            info!("Silence timeout — stopping recording");
                            if audio_loop_state.stop_recording() {
                                emit_event(&VoiceEvent::RecordingStop {});

                                let remaining = {
                                    let mut cons = audio_loop_consumer.lock().unwrap();
                                    cons.drain_all()
                                };

                                let audio_for_stt = {
                                    let mut app = audio_loop_app.lock().unwrap();
                                    app.recording_buf.extend_from_slice(&remaining);
                                    std::mem::take(&mut app.recording_buf)
                                };

                                run_stt_and_emit(&audio_loop_app, audio_for_stt).await;

                                audio_loop_state.finish_processing();
                                emit_event(&VoiceEvent::Listening {});
                                silence_start = None;

                                let mut v = audio_loop_vad.lock().unwrap();
                                v.reset();
                            }
                        }
                    }
                }
                audio::AudioState::Idle | audio::AudioState::Processing => {
                    // Consume audio to keep the ring buffer from filling up.
                }
            }
        }
    });

    // All subsystems ready
    emit_event(&VoiceEvent::Ready {});
    info!("Voice core ready");

    // ── Main loop: process commands from Electron ────────────────────
    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(command) => {
                        if !handle_command(command, &app_state).await {
                            break;
                        }
                    }
                    None => {
                        info!("stdin closed, shutting down");
                        break;
                    }
                }
            }
            hotkey = hotkey_rx.recv() => {
                if let Some(event) = hotkey {
                    handle_hotkey_event(
                        event,
                        &audio_state,
                        &app_state,
                        &vad_shared,
                        &consumer_shared,
                    ).await;
                }
            }
        }
    }

    audio_task.abort();
    info!("Voice core shutting down");
}

/// Run STT on recorded audio and emit transcription event.
async fn run_stt_and_emit(app_state: &Arc<Mutex<AppState>>, audio: Vec<f32>) {
    if audio.is_empty() {
        return;
    }

    info!(
        samples = audio.len(),
        duration_secs = audio.len() as f64 / 16000.0,
        "Running STT"
    );

    // Take the STT engine out so we can call .transcribe() (async) without
    // holding the mutex across the await point.
    let stt_engine = {
        let mut app = app_state.lock().unwrap();
        app.stt_engine.take()
    };

    let Some(engine) = stt_engine else {
        emit_error("No STT engine available — recording discarded");
        return;
    };

    match engine.transcribe(&audio).await {
        Ok(text) => {
            let text = text.trim().to_string();
            if !text.is_empty() {
                info!(text = %text, "Transcription result");
                emit_event(&VoiceEvent::Transcription {
                    text: text.clone(),
                });

                // Send to inbox for AI processing
                let msg_id = {
                    let app = app_state.lock().unwrap();
                    if let Some(ref inbox) = app.inbox {
                        match inbox.send(&text) {
                            Ok(id) => id,
                            Err(e) => {
                                warn!("Failed to send to inbox: {}", e);
                                None
                            }
                        }
                    } else {
                        None
                    }
                };

                if let Some(ref id) = msg_id {
                    emit_event(&VoiceEvent::SentToInbox {
                        message: text,
                        msg_id: Some(id.clone()),
                    });
                }
            } else {
                info!("STT returned empty transcription");
            }
        }
        Err(e) => {
            error!("STT transcription failed: {}", e);
            emit_error(&format!("STT failed: {}", e));
        }
    }

    // Put the engine back
    let mut app = app_state.lock().unwrap();
    app.stt_engine = Some(engine);
}

/// Handle hotkey events (PTT down/up, dictation down/up).
async fn handle_hotkey_event(
    event: HotkeyEvent,
    audio_state: &Arc<AudioStateMachine>,
    app_state: &Arc<Mutex<AppState>>,
    vad_shared: &Arc<Mutex<vad::SileroVad>>,
    consumer_shared: &Arc<Mutex<AudioConsumer>>,
) {
    match event {
        HotkeyEvent::PttDown => {
            info!("PTT key pressed — start recording");
            emit_event(&VoiceEvent::PttStart {});

            if audio_state.start_recording(RecordingSource::Ptt) {
                emit_event(&VoiceEvent::RecordingStart {
                    rec_type: "ptt".to_string(),
                });
                let mut app = app_state.lock().unwrap();
                app.recording_buf.clear();
                let mut cons = consumer_shared.lock().unwrap();
                cons.drain_all();
            }
        }
        HotkeyEvent::PttUp => {
            info!("PTT key released — stop recording");
            emit_event(&VoiceEvent::PttStop {});

            if audio_state.stop_recording() {
                emit_event(&VoiceEvent::RecordingStop {});

                let remaining = {
                    let mut cons = consumer_shared.lock().unwrap();
                    cons.drain_all()
                };

                let audio_for_stt = {
                    let mut app = app_state.lock().unwrap();
                    app.recording_buf.extend_from_slice(&remaining);
                    std::mem::take(&mut app.recording_buf)
                };

                run_stt_and_emit(app_state, audio_for_stt).await;

                audio_state.finish_processing();

                let mut v = vad_shared.lock().unwrap();
                v.reset();
            }
        }
        HotkeyEvent::DictationDown => {
            info!("Dictation key pressed — start dictation recording");
            emit_event(&VoiceEvent::DictationStart {});

            if audio_state.start_recording(RecordingSource::Dictation) {
                emit_event(&VoiceEvent::RecordingStart {
                    rec_type: "dictation".to_string(),
                });
                let mut app = app_state.lock().unwrap();
                app.recording_buf.clear();
                let mut cons = consumer_shared.lock().unwrap();
                cons.drain_all();
            }
        }
        HotkeyEvent::DictationUp => {
            info!("Dictation key released — stop dictation recording");

            if audio_state.stop_recording() {
                emit_event(&VoiceEvent::RecordingStop {});

                let remaining = {
                    let mut cons = consumer_shared.lock().unwrap();
                    cons.drain_all()
                };

                let audio_for_stt = {
                    let mut app = app_state.lock().unwrap();
                    app.recording_buf.extend_from_slice(&remaining);
                    std::mem::take(&mut app.recording_buf)
                };

                // Take STT engine for transcription
                let stt_engine = {
                    let mut app = app_state.lock().unwrap();
                    app.stt_engine.take()
                };

                if let Some(engine) = stt_engine {
                    let result = engine.transcribe(&audio_for_stt).await;
                    // Put engine back immediately
                    {
                        let mut app = app_state.lock().unwrap();
                        app.stt_engine = Some(engine);
                    }

                    match result {
                        Ok(text) => {
                            let text = text.trim().to_string();
                            let success = if !text.is_empty() {
                                match text_injector::inject_text(&text) {
                                    Ok(()) => {
                                        info!(text = %text, "Dictation text injected");
                                        true
                                    }
                                    Err(e) => {
                                        warn!("Text injection failed: {}", e);
                                        false
                                    }
                                }
                            } else {
                                false
                            };
                            emit_event(&VoiceEvent::DictationResult { text, success });
                        }
                        Err(e) => {
                            error!("Dictation STT failed: {}", e);
                            emit_event(&VoiceEvent::DictationResult {
                                text: String::new(),
                                success: false,
                            });
                        }
                    }
                } else {
                    emit_error("No STT engine available for dictation");
                }

                emit_event(&VoiceEvent::DictationStop {});
                audio_state.finish_processing();

                let mut v = vad_shared.lock().unwrap();
                v.reset();
            }
        }
    }
}

/// Handle a single command from Electron.
/// Returns `false` if the main loop should exit.
async fn handle_command(cmd: VoiceCommand, app_state: &Arc<Mutex<AppState>>) -> bool {
    match cmd {
        VoiceCommand::Ping {} => {
            emit_event(&VoiceEvent::Pong {});
        }

        VoiceCommand::Stop {} => {
            emit_event(&VoiceEvent::Stopping {});
            return false;
        }

        VoiceCommand::ListAudioDevices {} => {
            let device_names = audio::list_devices();
            let input: Vec<AudioDeviceInfo> = device_names
                .into_iter()
                .enumerate()
                .map(|(i, name)| AudioDeviceInfo {
                    id: i as i32,
                    name,
                })
                .collect();
            let output = Vec::<AudioDeviceInfo>::new();
            emit_event(&VoiceEvent::AudioDevices { input, output });
        }

        VoiceCommand::ConfigUpdate { config } => {
            info!("Config update received");
            emit_event(&VoiceEvent::ConfigUpdated { config });
        }

        VoiceCommand::SetMode { mode } => {
            info!(mode = %mode, "Mode change requested");
            {
                let app = app_state.lock().unwrap();
                match mode.as_str() {
                    "listening" | "wake_word" | "hybrid" => {
                        if app.audio_state.start_listening() {
                            emit_event(&VoiceEvent::Listening {});
                        }
                    }
                    "idle" => {
                        app.audio_state.reset();
                    }
                    _ => {}
                }
            }
            emit_event(&VoiceEvent::ModeChange { mode });
        }

        VoiceCommand::Query { text, image } => {
            info!(text = ?text, has_image = image.is_some(), "Query received");
            if let Some(query_text) = text {
                let msg_id = {
                    let app = app_state.lock().unwrap();
                    if let Some(ref inbox) = app.inbox {
                        match inbox.send(&query_text) {
                            Ok(id) => id,
                            Err(e) => {
                                warn!("Failed to send query to inbox: {}", e);
                                emit_error(&format!("Failed to send query: {}", e));
                                None
                            }
                        }
                    } else {
                        emit_error("Inbox not available");
                        None
                    }
                };

                if let Some(id) = msg_id {
                    emit_event(&VoiceEvent::SentToInbox {
                        message: query_text,
                        msg_id: Some(id.clone()),
                    });

                    // Poll for response in background
                    let app_clone = app_state.clone();
                    tokio::spawn(async move {
                        let inbox = {
                            let mut app = app_clone.lock().unwrap();
                            app.inbox.take()
                        };

                        if let Some(inbox) = inbox {
                            match inbox.wait_for_response(&id, None).await {
                                Ok(Some(response)) => {
                                    emit_event(&VoiceEvent::Response {
                                        text: response,
                                        source: "inbox".to_string(),
                                        msg_id: Some(id),
                                    });
                                }
                                Ok(None) => {
                                    warn!("Inbox poll timed out for {}", id);
                                }
                                Err(e) => {
                                    warn!("Inbox poll error: {}", e);
                                }
                            }
                            let mut app = app_clone.lock().unwrap();
                            app.inbox = Some(inbox);
                        }
                    });
                }
            }
        }

        VoiceCommand::StartRecording {} => {
            info!("Start recording requested (manual)");
            let started = {
                let app = app_state.lock().unwrap();
                app.audio_state.start_recording(RecordingSource::Ptt)
            };
            if started {
                emit_event(&VoiceEvent::RecordingStart {
                    rec_type: "manual".to_string(),
                });
                let mut app = app_state.lock().unwrap();
                app.recording_buf.clear();
            }
        }

        VoiceCommand::StopRecording {} => {
            info!("Stop recording requested (manual)");
            let audio_for_stt = {
                let mut app = app_state.lock().unwrap();
                if app.audio_state.stop_recording() {
                    emit_event(&VoiceEvent::RecordingStop {});
                    Some(std::mem::take(&mut app.recording_buf))
                } else {
                    None
                }
            };

            if let Some(audio) = audio_for_stt {
                run_stt_and_emit(app_state, audio).await;
                let app = app_state.lock().unwrap();
                app.audio_state.finish_processing();
            }
        }

        VoiceCommand::SystemSpeak { text } => {
            info!(text = %text, "System speak requested");

            let tts_engine = {
                let mut app = app_state.lock().unwrap();
                app.tts_engine.take()
            };
            let tts_player = {
                let mut app = app_state.lock().unwrap();
                app.tts_player.take()
            };

            match (tts_engine, tts_player) {
                (Some(engine), Some(player)) => {
                    emit_event(&VoiceEvent::SpeakingStart {
                        text: text.clone(),
                    });

                    match engine.speak(&text).await {
                        Ok(samples) => {
                            if !samples.is_empty() {
                                let play_result = tokio::task::spawn_blocking(move || {
                                    player.play(&samples, TTS_SAMPLE_RATE)
                                })
                                .await;

                                match play_result {
                                    Ok(Ok(())) => info!("TTS playback complete"),
                                    Ok(Err(e)) => {
                                        warn!("TTS playback error: {}", e);
                                        emit_error(&format!("TTS playback failed: {}", e));
                                    }
                                    Err(e) => warn!("TTS playback task panicked: {}", e),
                                }

                                // Player was moved into spawn_blocking; recreate it.
                                let new_player = tts::playback::AudioPlayer::new().ok();
                                let mut app = app_state.lock().unwrap();
                                app.tts_engine = Some(engine);
                                app.tts_player = new_player;
                            } else {
                                let mut app = app_state.lock().unwrap();
                                app.tts_engine = Some(engine);
                                app.tts_player = Some(player);
                            }
                        }
                        Err(e) => {
                            warn!("TTS synthesis error: {}", e);
                            emit_error(&format!("TTS synthesis failed: {}", e));
                            let mut app = app_state.lock().unwrap();
                            app.tts_engine = Some(engine);
                            app.tts_player = Some(player);
                        }
                    }

                    emit_event(&VoiceEvent::SpeakingEnd {});
                }
                (engine, player) => {
                    // Put back whatever we had
                    let mut app = app_state.lock().unwrap();
                    app.tts_engine = engine;
                    app.tts_player = player;
                    emit_error("TTS not available");
                }
            }
        }

        VoiceCommand::ListAdapters {} => {
            emit_event(&VoiceEvent::AdapterList {
                tts: vec![
                    "edge".to_string(),
                    "openai-tts".to_string(),
                    "elevenlabs".to_string(),
                    "kokoro".to_string(),
                ],
                stt: vec![
                    "whisper-local".to_string(),
                    "openai-cloud".to_string(),
                    "custom-cloud".to_string(),
                ],
            });
        }
    }

    true
}
