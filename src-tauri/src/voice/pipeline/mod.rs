//! Voice pipeline: Mic -> VAD -> STT -> event -> TTS -> Speaker.
//!
//! Orchestrates the full voice processing pipeline. Runs audio capture
//! and processing on background threads, emitting Tauri events for
//! state changes and transcription results.
//!
//! The pipeline uses:
//! - `cpal` for audio capture from the microphone
//! - `rodio` for audio playback (TTS output)
//! - Energy-based VAD for speech/silence detection
//! - STT engine (Whisper stub) for transcription
//! - TTS engine (Edge/Kokoro stub) for speech synthesis

mod playback;
mod ring_buffer;

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::stt::{self, SttAdapter};
use super::tts::{self, TtsEngine};
use super::vad::VadProcessor;
use super::{VoiceEngineConfig, VoiceMode, VoiceState};

use ring_buffer::{create_ring_buffer, RingConsumer, RingProducer};

// ── Constants ───────────────────────────────────────────────────────

/// Target sample rate for the processing pipeline (16kHz mono).
const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Audio chunk size in samples (80ms at 16kHz). Matches voice-core.
const CHUNK_SAMPLES: usize = 1280;

/// Ring buffer capacity: ~10 seconds of 16kHz mono audio.
const RING_BUFFER_CAPACITY: usize = 160_000;

// ── Voice Events (emitted to frontend) ─────────────────────────────

/// Events emitted by the voice pipeline to the Tauri frontend.
///
/// These are serialized as JSON and sent via `app_handle.emit()`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum VoiceEvent {
    /// Pipeline is starting up.
    Starting {},
    /// Pipeline is ready for voice input.
    Ready {},
    /// State changed (idle, listening, recording, processing, speaking).
    StateChange { state: String },
    /// Recording started.
    RecordingStart { rec_type: String },
    /// Recording stopped.
    RecordingStop {},
    /// Transcription result from STT.
    Transcription { text: String },
    /// TTS playback started.
    SpeakingStart { text: String },
    /// TTS playback ended.
    SpeakingEnd {},
    /// An error occurred.
    Error { message: String },
    /// Audio devices enumerated.
    AudioDevices {
        input: Vec<AudioDeviceInfo>,
        output: Vec<AudioDeviceInfo>,
    },
    /// Pipeline is shutting down.
    Stopping {},
    /// Real-time audio levels for waveform visualization (emitted during recording).
    AudioLevel { levels: Vec<f32> },
}

/// Audio device info for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: i32,
    pub name: String,
}

// ── Voice Pipeline ──────────────────────────────────────────────────

/// Wrapper to make `cpal::Stream` Send.
///
/// `cpal::Stream` is `!Send` on some platforms due to internal raw pointers,
/// but we only hold it alive -- we never move it across threads after creation.
/// The stream's audio callback runs on its own internal thread managed by cpal.
#[allow(dead_code)]
struct SendStream(cpal::Stream);

// SAFETY: We only store the stream to keep it alive. The stream itself manages
// its own internal threading. We never access it from another thread -- we only
// drop it, which is safe.
unsafe impl Send for SendStream {}

/// The running voice pipeline.
///
/// Manages background threads for audio capture and processing.
/// Communicates with the frontend via Tauri events.
pub struct VoicePipeline {
    /// Shared state (accessible from multiple threads).
    shared: Arc<PipelineShared>,
    /// Handle to the cpal capture stream (must be kept alive).
    _capture_stream: Option<SendStream>,
    /// Handle to the audio processing task.
    processing_handle: Option<tauri::async_runtime::JoinHandle<()>>,
}

/// Shared state between the pipeline and its background threads.
pub(crate) struct PipelineShared {
    /// Current voice state (atomic for lock-free reads).
    pub(crate) state: AtomicU8,
    /// Current voice mode.
    pub(crate) mode: std::sync::Mutex<VoiceMode>,
    /// Whether the pipeline is running.
    pub(crate) running: AtomicBool,
    /// Cancellation flag for TTS playback.
    pub(crate) tts_cancel: AtomicBool,
    /// Force-stop recording flag (PTT release / Toggle stop).
    /// When set, the processing loop immediately transitions Recording -> Processing.
    force_stop_recording: AtomicBool,
    /// Tauri app handle for emitting events.
    pub(crate) app_handle: AppHandle,
    /// Audio ring buffer: producer side (written by capture callback).
    ring_producer: Mutex<Option<RingProducer>>,
    /// Audio ring buffer: consumer side (read by processing thread).
    ring_consumer: Mutex<Option<RingConsumer>>,
    /// Accumulated recording buffer.
    recording_buf: Mutex<Vec<f32>>,
    /// STT engine.
    stt_engine: Mutex<Option<SttAdapter>>,
    /// TTS engine for speech synthesis output.
    pub(crate) tts_engine: Mutex<Option<Box<dyn TtsEngine>>>,
    /// Pipeline configuration.
    pub(crate) config: VoiceEngineConfig,
}

// ── State helpers ───────────────────────────────────────────────────

pub(crate) fn state_from_u8(v: u8) -> VoiceState {
    match v {
        0 => VoiceState::Idle,
        1 => VoiceState::Listening,
        2 => VoiceState::Recording,
        3 => VoiceState::Processing,
        4 => VoiceState::Speaking,
        _ => VoiceState::Idle,
    }
}

pub(crate) fn state_to_u8(s: VoiceState) -> u8 {
    match s {
        VoiceState::Idle => 0,
        VoiceState::Listening => 1,
        VoiceState::Recording => 2,
        VoiceState::Processing => 3,
        VoiceState::Speaking => 4,
    }
}

// ── Pipeline Implementation ─────────────────────────────────────────

impl VoicePipeline {
    /// Start the voice pipeline with the given configuration.
    ///
    /// This initializes audio capture, VAD, STT, and TTS, then spawns
    /// background processing tasks.
    pub fn start(config: VoiceEngineConfig, app_handle: AppHandle) -> Result<Self, String> {
        tracing::info!("Starting voice pipeline");

        // Emit starting event
        let _ = app_handle.emit("voice-event", VoiceEvent::Starting {});

        // Create ring buffer for audio
        let (producer, consumer) = create_ring_buffer(RING_BUFFER_CAPACITY);

        // Initialize STT engine (with Electron model dir fallback)
        let data_dir = crate::services::platform::get_data_dir_with_fallback();
        let stt_engine = match stt::create_stt_engine(
            &config.stt_adapter,
            &data_dir,
            Some(&config.stt_model_size),
        ) {
            Ok(engine) => {
                tracing::info!(adapter = %config.stt_adapter, "STT engine initialized");
                Some(engine)
            }
            Err(e) => {
                tracing::warn!("STT engine failed to initialize: {}", e);
                let _ = app_handle.emit(
                    "voice-event",
                    VoiceEvent::Error {
                        message: format!("STT not available: {}", e),
                    },
                );
                None
            }
        };

        // Initialize TTS engine — try pre-loaded first, then create a new one
        let tts_engine = {
            // Check for pre-loaded engine from app startup
            use tauri::Manager;
            let preloaded: Option<Box<dyn TtsEngine>> = app_handle
                .try_state::<crate::PreloadedTtsState>()
                .and_then(|state| state.lock().ok()?.take());

            match preloaded {
                Some(engine) => {
                    tracing::info!(name = %engine.name(), "Using pre-loaded TTS engine");
                    Some(engine)
                }
                None => {
                    // Fall back to creating a new engine
                    match tts::create_tts_engine(
                        &config.tts_adapter,
                        Some(&config.tts_voice),
                        Some(config.tts_speed),
                    ) {
                        Ok(engine) => {
                            tracing::info!(adapter = %config.tts_adapter, name = %engine.name(), "TTS engine initialized");
                            Some(engine)
                        }
                        Err(e) => {
                            tracing::warn!("TTS engine failed to initialize: {}", e);
                            let _ = app_handle.emit(
                                "voice-event",
                                VoiceEvent::Error {
                                    message: format!("TTS not available: {}", e),
                                },
                            );
                            None
                        }
                    }
                }
            }
        };

        // Build shared state
        let shared = Arc::new(PipelineShared {
            state: AtomicU8::new(state_to_u8(VoiceState::Idle)),
            mode: std::sync::Mutex::new(config.mode),
            running: AtomicBool::new(true),
            tts_cancel: AtomicBool::new(false),
            force_stop_recording: AtomicBool::new(false),
            app_handle: app_handle.clone(),
            ring_producer: Mutex::new(Some(producer)),
            ring_consumer: Mutex::new(Some(consumer)),
            recording_buf: Mutex::new(Vec::new()),
            stt_engine: Mutex::new(stt_engine),
            tts_engine: Mutex::new(tts_engine),
            config,
        });

        // Start audio capture
        let capture_stream = start_audio_capture(&shared)?;

        // Spawn the audio processing loop
        let shared_clone = Arc::clone(&shared);
        let processing_handle = tauri::async_runtime::spawn(async move {
            audio_processing_loop(shared_clone).await;
        });

        // Set initial state based on mode
        {
            let mode = match shared.mode.lock() {
                Ok(guard) => *guard,
                Err(e) => {
                    tracing::error!("Failed to lock mode in start(): {}", e);
                    VoiceMode::PushToTalk
                }
            };
            match mode {
                VoiceMode::WakeWord => {
                    // Wake word mode starts listening immediately (VAD-triggered)
                    shared
                        .state
                        .store(state_to_u8(VoiceState::Listening), Ordering::Release);
                    let _ = app_handle.emit(
                        "voice-event",
                        VoiceEvent::StateChange {
                            state: "listening".into(),
                        },
                    );
                }
                VoiceMode::PushToTalk | VoiceMode::Toggle => {
                    // Stay idle until PTT/Toggle key is pressed
                }
            }
        }

        // Emit ready event
        let _ = app_handle.emit("voice-event", VoiceEvent::Ready {});
        tracing::info!("Voice pipeline ready");

        Ok(Self {
            shared,
            _capture_stream: Some(SendStream(capture_stream)),
            processing_handle: Some(processing_handle),
        })
    }

    /// Stop the voice pipeline.
    pub fn stop(self) {
        tracing::info!("Stopping voice pipeline");
        self.shared.running.store(false, Ordering::SeqCst);
        self.shared.tts_cancel.store(true, Ordering::SeqCst);

        let _ = self
            .shared
            .app_handle
            .emit("voice-event", VoiceEvent::Stopping {});

        // The capture stream and processing task will be dropped,
        // which stops audio capture and aborts the processing loop.
        if let Some(handle) = self.processing_handle {
            handle.abort();
        }
    }

    /// Check if the pipeline is running.
    pub fn is_running(&self) -> bool {
        self.shared.running.load(Ordering::Relaxed)
    }

    /// Get the current voice state.
    pub fn state(&self) -> VoiceState {
        state_from_u8(self.shared.state.load(Ordering::Acquire))
    }

    /// Set the voice activation mode and update the pipeline state accordingly.
    ///
    /// When switching from WakeWord -> PTT/Toggle, transitions Listening -> Idle.
    /// When switching from PTT/Toggle -> WakeWord, transitions Idle -> Listening.
    pub fn set_mode(&self, mode: VoiceMode) {
        match self.shared.mode.lock() {
            Ok(mut current) => {
                let old = *current;
                *current = mode;
                tracing::info!(old = %old, new = %mode, "Voice mode changed");

                // Update state based on new mode (only if idle or listening)
                let current_state = state_from_u8(self.shared.state.load(Ordering::Acquire));
                let new_state = match (current_state, mode) {
                    (VoiceState::Listening, VoiceMode::PushToTalk | VoiceMode::Toggle) => {
                        Some(VoiceState::Idle)
                    }
                    (VoiceState::Idle, VoiceMode::WakeWord) => {
                        Some(VoiceState::Listening)
                    }
                    _ => None, // Don't interrupt recording/processing/speaking
                };

                if let Some(state) = new_state {
                    self.shared.state.store(state_to_u8(state), Ordering::Release);
                    let _ = self.shared.app_handle.emit(
                        "voice-event",
                        VoiceEvent::StateChange {
                            state: state.to_string(),
                        },
                    );
                }
            }
            Err(e) => {
                tracing::error!("Failed to lock mode in set_mode(): {}", e);
            }
        }
    }

    /// Start recording (for PTT press / Toggle start).
    ///
    /// Transitions Idle/Listening -> Recording. Also supports "barge-in":
    /// if TTS is currently speaking, it cancels playback and starts recording.
    pub fn start_recording(&self) {
        let current = state_from_u8(self.shared.state.load(Ordering::Acquire));
        match current {
            VoiceState::Idle | VoiceState::Listening => {
                self.begin_recording();
            }
            VoiceState::Speaking => {
                // Barge-in: interrupt TTS and start recording immediately
                tracing::info!("Barge-in: interrupting TTS to start recording");
                self.shared.tts_cancel.store(true, Ordering::SeqCst);
                self.begin_recording();
            }
            _ => {
                tracing::debug!(state = ?current, "Ignoring start_recording in current state");
            }
        }
    }

    /// Internal: set up recording state (shared by normal start and barge-in).
    fn begin_recording(&self) {
        if let Ok(mut buf) = self.shared.recording_buf.lock() {
            buf.clear();
        }
        self.shared.force_stop_recording.store(false, Ordering::SeqCst);
        self.shared
            .state
            .store(state_to_u8(VoiceState::Recording), Ordering::Release);
        let _ = self.shared.app_handle.emit(
            "voice-event",
            VoiceEvent::RecordingStart {
                rec_type: "manual".into(),
            },
        );
        let _ = self.shared.app_handle.emit(
            "voice-event",
            VoiceEvent::StateChange {
                state: "recording".into(),
            },
        );
        tracing::info!("Recording started (manual)");
    }

    /// Stop recording (for PTT release / Toggle stop).
    ///
    /// Sets the force_stop flag so the processing loop immediately triggers
    /// STT instead of waiting for silence timeout.
    pub fn stop_recording(&self) {
        let current = state_from_u8(self.shared.state.load(Ordering::Acquire));
        if current == VoiceState::Recording {
            tracing::info!("Force-stopping recording (manual release)");
            self.shared.force_stop_recording.store(true, Ordering::SeqCst);
        } else {
            tracing::debug!(state = ?current, "Ignoring stop_recording in current state");
        }
    }

    /// Interrupt TTS playback.
    pub fn stop_speaking(&self) {
        self.shared.tts_cancel.store(true, Ordering::SeqCst);
        tracing::info!("TTS playback interrupted");
    }

    /// Speak text using the TTS engine and play via rodio.
    ///
    /// This is the main entry point for TTS playback from external callers
    /// (e.g. Tauri commands, AI provider responses).
    pub async fn speak(&self, text: &str) -> Result<(), String> {
        playback::speak(&self.shared, text).await
    }

    /// Convenience method: spawn `speak()` on the tokio runtime (non-blocking).
    pub fn speak_blocking(&self, text: String) {
        let shared = Arc::clone(&self.shared);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = playback::speak(&shared, &text).await {
                tracing::error!("speak_blocking failed: {}", e);
            }
        });
    }
}

// ── Audio Capture ───────────────────────────────────────────────────

/// Start cpal audio capture, pushing samples into the ring buffer.
fn start_audio_capture(shared: &Arc<PipelineShared>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();

    // Find the input device
    let device = if let Some(ref name) = shared.config.input_device {
        host.input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?
            .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
            .ok_or_else(|| format!("Input device not found: {}", name))?
    } else {
        host.default_input_device()
            .ok_or_else(|| "No default input device available".to_string())?
    };

    let dev_name = device.name().unwrap_or_else(|_| "unknown".into());
    tracing::info!(device = %dev_name, "Selected input device");

    let default_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {}", e))?;

    let native_rate = default_config.sample_rate().0;
    let channels = default_config.channels();

    let stream_config = cpal::StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(native_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    let needs_resample = native_rate != TARGET_SAMPLE_RATE;
    let needs_downmix = channels > 1;

    tracing::info!(
        native_rate,
        channels,
        needs_resample,
        needs_downmix,
        "Audio input config"
    );

    // Take the producer out of shared state for the capture callback
    let producer_mutex = {
        let mut guard = shared
            .ring_producer
            .lock()
            .map_err(|e| format!("Failed to lock ring_producer: {}", e))?;
        guard.take()
    };

    let Some(producer) = producer_mutex else {
        return Err("Ring buffer producer already taken".into());
    };

    // Wrap producer in Arc<Mutex> for the callback (cpal callbacks need Send)
    let producer = Arc::new(Mutex::new(producer));
    let mut chunk_buf: Vec<f32> = Vec::with_capacity(CHUNK_SAMPLES * 2);

    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                // Downmix to mono if needed
                let mono = if needs_downmix {
                    let ch = channels as usize;
                    data.chunks_exact(ch)
                        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
                        .collect::<Vec<f32>>()
                } else {
                    data.to_vec()
                };

                // Resample to 16kHz if needed
                let resampled = if needs_resample {
                    resample_linear(&mono, native_rate, TARGET_SAMPLE_RATE)
                } else {
                    mono
                };

                // Accumulate and push full chunks
                chunk_buf.extend_from_slice(&resampled);
                while chunk_buf.len() >= CHUNK_SAMPLES {
                    let chunk: Vec<f32> = chunk_buf.drain(..CHUNK_SAMPLES).collect();
                    if let Ok(prod) = producer.lock() {
                        if let Ok(mut ring) = prod.buffer.lock() {
                            ring.push_slice(&chunk);
                        }
                    }
                }
            },
            move |err| {
                tracing::error!("Audio input stream error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start input stream: {}", e))?;

    tracing::info!("Audio capture started");
    Ok(stream)
}

/// Simple linear resampler from one rate to another.
fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx.floor() as usize;
        let frac = (src_idx - idx0 as f64) as f32;
        let s0 = input.get(idx0).copied().unwrap_or(0.0);
        let s1 = input.get(idx0 + 1).copied().unwrap_or(s0);
        output.push(s0 + frac * (s1 - s0));
    }
    output
}

// ── Audio Processing Loop ───────────────────────────────────────────

/// Main audio processing loop running on a background tokio task.
///
/// Reads audio from the ring buffer, runs VAD, accumulates recording
/// buffers, triggers STT on silence timeout, and orchestrates TTS.
async fn audio_processing_loop(shared: Arc<PipelineShared>) {
    let mut read_buf = vec![0.0f32; CHUNK_SAMPLES];
    let mut vad = VadProcessor::new(shared.config.vad_threshold);
    let silence_timeout = Duration::from_secs_f64(shared.config.silence_timeout_secs);

    tracing::info!("Audio processing loop started");

    while shared.running.load(Ordering::Relaxed) {
        // Sleep to avoid busy-waiting (40ms = roughly 2 chunks at 80ms each)
        tokio::time::sleep(Duration::from_millis(40)).await;

        // Read from ring buffer
        let samples_read = {
            let guard = match shared.ring_consumer.lock() {
                Ok(g) => g,
                Err(e) => {
                    tracing::error!("Failed to lock ring_consumer: {}", e);
                    continue;
                }
            };
            if let Some(ref consumer) = *guard {
                if let Ok(mut ring) = consumer.buffer.lock() {
                    ring.pop_slice(&mut read_buf)
                } else {
                    0
                }
            } else {
                0
            }
        };

        if samples_read == 0 {
            continue;
        }

        let chunk = &read_buf[..samples_read];
        let current_state = state_from_u8(shared.state.load(Ordering::Acquire));

        match current_state {
            VoiceState::Listening => {
                // In listening mode, run VAD to detect speech onset.
                let is_speech = vad.process_frame(chunk);

                let mode = match shared.mode.lock() {
                    Ok(g) => *g,
                    Err(e) => {
                        tracing::error!("Failed to lock mode: {}", e);
                        VoiceMode::PushToTalk
                    }
                };
                if is_speech && mode == VoiceMode::WakeWord {
                    // Auto-start recording on speech detection (wake word / VAD mode)
                    shared
                        .state
                        .store(state_to_u8(VoiceState::Recording), Ordering::Release);
                    let _ = shared.app_handle.emit(
                        "voice-event",
                        VoiceEvent::RecordingStart {
                            rec_type: "continuous".into(),
                        },
                    );
                    match shared.recording_buf.lock() {
                        Ok(mut buf) => {
                            buf.clear();
                            buf.extend_from_slice(chunk);
                        }
                        Err(e) => {
                            tracing::error!("Failed to lock recording_buf: {}", e);
                        }
                    }
                }
            }

            VoiceState::Recording => {
                // Accumulate audio for STT
                {
                    match shared.recording_buf.lock() {
                        Ok(mut buf) => {
                            buf.extend_from_slice(chunk);
                        }
                        Err(e) => {
                            tracing::error!("Failed to lock recording_buf: {}", e);
                            continue;
                        }
                    }
                }

                // Emit audio levels for waveform visualization
                {
                    const BAR_COUNT: usize = 16;
                    let segment_len = chunk.len() / BAR_COUNT;
                    if segment_len > 0 {
                        let mut levels = Vec::with_capacity(BAR_COUNT);
                        for i in 0..BAR_COUNT {
                            let start = i * segment_len;
                            let end = if i == BAR_COUNT - 1 {
                                chunk.len()
                            } else {
                                start + segment_len
                            };
                            let segment = &chunk[start..end];
                            // RMS energy
                            let rms = (segment.iter().map(|s| s * s).sum::<f32>()
                                / segment.len() as f32)
                                .sqrt();
                            // Normalize: typical speech RMS ~0.01-0.1, scale to 0-1
                            let level = (rms * 10.0).min(1.0);
                            levels.push(level);
                        }
                        let _ = shared
                            .app_handle
                            .emit("voice-event", VoiceEvent::AudioLevel { levels });
                    }
                }

                // Run VAD for silence detection
                vad.process_frame(chunk);

                // Check for force-stop (PTT release / Toggle stop) OR silence timeout
                let force_stop = shared.force_stop_recording.swap(false, Ordering::SeqCst);
                if force_stop || vad.silence_exceeded(silence_timeout) {
                    tracing::info!(
                        reason = if force_stop { "manual" } else { "silence" },
                        "Stopping recording"
                    );

                    shared
                        .state
                        .store(state_to_u8(VoiceState::Processing), Ordering::Release);
                    let _ = shared
                        .app_handle
                        .emit("voice-event", VoiceEvent::RecordingStop {});
                    let _ = shared.app_handle.emit(
                        "voice-event",
                        VoiceEvent::StateChange {
                            state: "processing".into(),
                        },
                    );

                    // Drain remaining audio from ring buffer.
                    // The lock result must be fully resolved (not held) before
                    // any .await, because MutexGuard is !Send.
                    let drain_result: Result<Vec<f32>, String> = shared
                        .ring_consumer
                        .lock()
                        .map(|guard| {
                            if let Some(ref consumer) = *guard {
                                if let Ok(mut ring) = consumer.buffer.lock() {
                                    ring.drain_all()
                                } else {
                                    Vec::new()
                                }
                            } else {
                                Vec::new()
                            }
                        })
                        .map_err(|e| format!("{}", e));

                    let remaining = match drain_result {
                        Ok(v) => v,
                        Err(e) => {
                            tracing::error!("Failed to lock ring_consumer for drain: {}", e);
                            Vec::new()
                        }
                    };

                    let audio_for_stt = match shared.recording_buf.lock() {
                        Ok(mut buf) => {
                            buf.extend_from_slice(&remaining);
                            std::mem::take(&mut *buf)
                        }
                        Err(e) => {
                            tracing::error!("Failed to lock recording_buf for STT: {}", e);
                            remaining
                        }
                    };

                    // Run STT
                    run_stt_and_emit(&shared, audio_for_stt).await;

                    // Return to appropriate state based on mode:
                    // - WakeWord -> Listening (auto-detect next utterance)
                    // - PTT / Toggle -> Idle (wait for next key press)
                    let mode = shared.mode.lock().map(|g| *g).unwrap_or(VoiceMode::PushToTalk);
                    let next_state = match mode {
                        VoiceMode::WakeWord => VoiceState::Listening,
                        VoiceMode::PushToTalk | VoiceMode::Toggle => VoiceState::Idle,
                    };
                    shared
                        .state
                        .store(state_to_u8(next_state), Ordering::Release);
                    let _ = shared.app_handle.emit(
                        "voice-event",
                        VoiceEvent::StateChange {
                            state: next_state.to_string(),
                        },
                    );

                    vad.reset();
                }
            }

            VoiceState::Idle | VoiceState::Processing | VoiceState::Speaking => {
                // Consume audio to prevent ring buffer overflow,
                // but don't process it.
            }
        }
    }

    tracing::info!("Audio processing loop ended");
}

/// Run STT on recorded audio and emit the transcription as a Tauri event.
async fn run_stt_and_emit(shared: &Arc<PipelineShared>, audio: Vec<f32>) {
    if audio.is_empty() {
        return;
    }

    let duration_secs = audio.len() as f64 / 16000.0;
    tracing::info!(
        samples = audio.len(),
        duration_secs = format!("{:.2}", duration_secs),
        "Running STT"
    );

    // Take the STT engine out so we don't hold the mutex during transcription
    let engine = {
        match shared.stt_engine.lock() {
            Ok(mut guard) => guard.take(),
            Err(e) => {
                tracing::error!("Failed to lock stt_engine: {}", e);
                let _ = shared.app_handle.emit(
                    "voice-event",
                    VoiceEvent::Error {
                        message: format!("STT engine lock poisoned: {}", e),
                    },
                );
                return;
            }
        }
    };

    let Some(engine) = engine else {
        let _ = shared.app_handle.emit(
            "voice-event",
            VoiceEvent::Error {
                message: "No STT engine available".into(),
            },
        );
        return;
    };

    // Run transcription (this is CPU-bound, use spawn_blocking)
    let transcription = tokio::task::spawn_blocking(move || {
        let result = engine.transcribe(&audio);
        (engine, result)
    })
    .await;

    match transcription {
        Ok((engine, Ok(text))) => {
            let text = text.trim().to_string();

            // Put engine back
            match shared.stt_engine.lock() {
                Ok(mut guard) => {
                    *guard = Some(engine);
                }
                Err(e) => {
                    tracing::error!("Failed to lock stt_engine to restore: {}", e);
                    // Engine is lost, but we can still emit the transcription
                }
            }

            if !text.is_empty() {
                tracing::info!(text = %text, "Transcription result");
                let _ = shared.app_handle.emit(
                    "voice-event",
                    VoiceEvent::Transcription { text },
                );
            }
        }
        Ok((engine, Err(e))) => {
            tracing::error!("STT transcription failed: {}", e);
            // Put engine back
            match shared.stt_engine.lock() {
                Ok(mut guard) => {
                    *guard = Some(engine);
                }
                Err(e2) => {
                    tracing::error!("Failed to lock stt_engine to restore: {}", e2);
                }
            }
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: format!("STT failed: {}", e),
                },
            );
        }
        Err(e) => {
            tracing::error!("STT task panicked: {}", e);
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: format!("STT task failed: {}", e),
                },
            );
        }
    }
}

// ── Audio Device Listing ────────────────────────────────────────────

/// List available audio input devices.
pub fn list_input_devices() -> Vec<AudioDeviceInfo> {
    let host = cpal::default_host();
    let mut devices = Vec::new();
    if let Ok(inputs) = host.input_devices() {
        for (i, dev) in inputs.enumerate() {
            if let Ok(name) = dev.name() {
                devices.push(AudioDeviceInfo {
                    id: i as i32,
                    name,
                });
            }
        }
    }
    devices
}

/// List available audio output devices.
pub fn list_output_devices() -> Vec<AudioDeviceInfo> {
    let host = cpal::default_host();
    let mut devices = Vec::new();
    if let Ok(outputs) = host.output_devices() {
        for (i, dev) in outputs.enumerate() {
            if let Ok(name) = dev.name() {
                devices.push(AudioDeviceInfo {
                    id: i as i32,
                    name,
                });
            }
        }
    }
    devices
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_same_rate() {
        let input = vec![1.0, 2.0, 3.0];
        let output = resample_linear(&input, 16000, 16000);
        assert_eq!(output, input);
    }

    #[test]
    fn test_resample_downsample() {
        // 48kHz -> 16kHz = 3:1 ratio
        let input: Vec<f32> = (0..48).map(|i| i as f32).collect();
        let output = resample_linear(&input, 48000, 16000);
        // Should get ~16 samples from 48
        assert_eq!(output.len(), 16);
    }

    #[test]
    fn test_state_roundtrip() {
        for state in [
            VoiceState::Idle,
            VoiceState::Listening,
            VoiceState::Recording,
            VoiceState::Processing,
            VoiceState::Speaking,
        ] {
            let u = state_to_u8(state);
            let back = state_from_u8(u);
            assert_eq!(state, back);
        }
    }

    #[test]
    fn test_list_input_devices() {
        // This just tests that the function doesn't panic.
        // On CI without audio hardware, it may return an empty list.
        let devices = list_input_devices();
        let _ = devices;
    }

    #[test]
    fn test_list_output_devices() {
        let devices = list_output_devices();
        let _ = devices;
    }
}
