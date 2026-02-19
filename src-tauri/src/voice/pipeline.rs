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

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rodio::{OutputStream, Sink};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::stt::{self, SttAdapter};
use super::tts::{self, TtsEngine};
use super::vad::VadProcessor;
use super::{VoiceEngineConfig, VoiceMode, VoiceState};

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
struct PipelineShared {
    /// Current voice state (atomic for lock-free reads).
    state: AtomicU8,
    /// Current voice mode.
    mode: std::sync::Mutex<VoiceMode>,
    /// Whether the pipeline is running.
    running: AtomicBool,
    /// Cancellation flag for TTS playback.
    tts_cancel: AtomicBool,
    /// Force-stop recording flag (PTT release / Toggle stop).
    /// When set, the processing loop immediately transitions Recording → Processing.
    force_stop_recording: AtomicBool,
    /// Tauri app handle for emitting events.
    app_handle: AppHandle,
    /// Audio ring buffer: producer side (written by capture callback).
    ring_producer: Mutex<Option<RingProducer>>,
    /// Audio ring buffer: consumer side (read by processing thread).
    ring_consumer: Mutex<Option<RingConsumer>>,
    /// Accumulated recording buffer.
    recording_buf: Mutex<Vec<f32>>,
    /// STT engine.
    stt_engine: Mutex<Option<SttAdapter>>,
    /// TTS engine for speech synthesis output.
    tts_engine: Mutex<Option<Box<dyn TtsEngine>>>,
    /// Pipeline configuration.
    config: VoiceEngineConfig,
}

/// Simple ring buffer producer (wraps a Vec with write position).
struct RingProducer {
    buffer: Arc<Mutex<RingBuffer>>,
}

/// Simple ring buffer consumer (reads from shared buffer).
struct RingConsumer {
    buffer: Arc<Mutex<RingBuffer>>,
}

/// Lock-based ring buffer for audio samples.
///
/// Uses a simple Vec-based circular buffer with mutex protection.
/// Not lock-free like the voice-core ringbuf implementation, but
/// sufficient for the Tauri integration where we have more flexibility
/// in thread scheduling.
struct RingBuffer {
    data: Vec<f32>,
    write_pos: usize,
    read_pos: usize,
    count: usize,
    capacity: usize,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity],
            write_pos: 0,
            read_pos: 0,
            count: 0,
            capacity,
        }
    }

    fn push_slice(&mut self, samples: &[f32]) -> usize {
        let mut written = 0;
        for &sample in samples {
            if self.count >= self.capacity {
                // Overwrite oldest data
                self.read_pos = (self.read_pos + 1) % self.capacity;
                self.count -= 1;
            }
            self.data[self.write_pos] = sample;
            self.write_pos = (self.write_pos + 1) % self.capacity;
            self.count += 1;
            written += 1;
        }
        written
    }

    fn pop_slice(&mut self, buf: &mut [f32]) -> usize {
        let to_read = buf.len().min(self.count);
        for item in buf.iter_mut().take(to_read) {
            *item = self.data[self.read_pos];
            self.read_pos = (self.read_pos + 1) % self.capacity;
            self.count -= 1;
        }
        to_read
    }

    #[allow(dead_code)]
    fn available(&self) -> usize {
        self.count
    }

    fn drain_all(&mut self) -> Vec<f32> {
        let n = self.count;
        if n == 0 {
            return Vec::new();
        }
        let mut buf = vec![0.0f32; n];
        self.pop_slice(&mut buf);
        buf
    }
}

fn create_ring_buffer(capacity: usize) -> (RingProducer, RingConsumer) {
    let buffer = Arc::new(Mutex::new(RingBuffer::new(capacity)));
    (
        RingProducer {
            buffer: Arc::clone(&buffer),
        },
        RingConsumer { buffer },
    )
}

// ── State helpers ───────────────────────────────────────────────────

fn state_from_u8(v: u8) -> VoiceState {
    match v {
        0 => VoiceState::Idle,
        1 => VoiceState::Listening,
        2 => VoiceState::Recording,
        3 => VoiceState::Processing,
        4 => VoiceState::Speaking,
        _ => VoiceState::Idle,
    }
}

fn state_to_u8(s: VoiceState) -> u8 {
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
    /// When switching from WakeWord → PTT/Toggle, transitions Listening → Idle.
    /// When switching from PTT/Toggle → WakeWord, transitions Idle → Listening.
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
    /// Transitions Idle/Listening → Recording. Also supports "barge-in":
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
        speak(&self.shared, text).await
    }

    /// Convenience method: spawn `speak()` on the tokio runtime (non-blocking).
    pub fn speak_blocking(&self, text: String) {
        let shared = Arc::clone(&self.shared);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = speak(&shared, &text).await {
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
                // TODO: For wake-word mode, also run a wake word detector here.
                // Currently wake word mode uses VAD-triggered recording.
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
                    // - WakeWord → Listening (auto-detect next utterance)
                    // - PTT / Toggle → Idle (wait for next key press)
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

// ── TTS Playback ────────────────────────────────────────────────────

/// Transition to Speaking state and emit events.
fn set_speaking_state(shared: &Arc<PipelineShared>, text: &str) {
    shared
        .state
        .store(state_to_u8(VoiceState::Speaking), Ordering::Release);
    let _ = shared.app_handle.emit(
        "voice-event",
        VoiceEvent::StateChange {
            state: "speaking".into(),
        },
    );
    let _ = shared.app_handle.emit(
        "voice-event",
        VoiceEvent::SpeakingStart {
            text: text.to_string(),
        },
    );
}

/// Take the TTS engine from shared state. Returns None if unavailable.
fn take_tts_engine(shared: &Arc<PipelineShared>) -> Option<Box<dyn TtsEngine>> {
    match shared.tts_engine.lock() {
        Ok(mut guard) => guard.take(),
        Err(e) => {
            tracing::error!("Failed to lock tts_engine: {}", e);
            None
        }
    }
}

/// Speak text using streaming synthesis for low first-audio latency.
///
/// Splits text into phrases, synthesizes each one individually, and streams
/// audio chunks to a rodio Sink via an async channel. First audio plays
/// within ~400ms instead of waiting for full synthesis.
///
/// Falls back to single-shot synthesis for short text (1 phrase).
async fn speak(shared: &Arc<PipelineShared>, text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    // If already speaking, cancel current playback and wait for the TTS engine
    // to be restored before starting new synthesis (prevents overlapping audio).
    let current = state_from_u8(shared.state.load(Ordering::Acquire));
    if current == VoiceState::Speaking {
        tracing::info!("Cancelling previous TTS for new speech request");
        shared.tts_cancel.store(true, Ordering::SeqCst);
        // Wait up to 1 second for the engine to be returned
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if shared.tts_engine.lock().map(|g| g.is_some()).unwrap_or(false) {
                break;
            }
        }
    }

    // Reset cancellation flag for the new request
    shared.tts_cancel.store(false, Ordering::SeqCst);

    // Set state to Speaking + emit events
    set_speaking_state(shared, text);

    // Take the TTS engine
    let engine = match take_tts_engine(shared) {
        Some(e) => e,
        None => {
            tracing::warn!("No TTS engine available, skipping speech");
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: "No TTS engine available".into(),
                },
            );
            finish_speaking(shared);
            return Err("No TTS engine available".into());
        }
    };

    // Check cancellation before synthesis
    if shared.tts_cancel.load(Ordering::SeqCst) {
        tracing::info!("TTS cancelled before synthesis");
        restore_tts_engine(shared, engine);
        finish_speaking(shared);
        return Ok(());
    }

    let sample_rate = engine.sample_rate();
    let volume = shared.config.tts_volume;
    let output_device = shared.config.output_device.clone();

    // Split into phrases for streaming
    let phrases = tts::split_into_phrases(text);

    if phrases.is_empty() {
        restore_tts_engine(shared, engine);
        finish_speaking(shared);
        return Ok(());
    }

    // For single phrase, use simpler non-streaming path (less overhead)
    if phrases.len() <= 1 {
        let result = speak_oneshot(shared, engine, &phrases[0], sample_rate, volume, output_device).await;
        finish_speaking(shared);
        return result;
    }

    // Streaming: synthesize phrase by phrase, queue in rodio Sink
    tracing::info!(
        phrases = phrases.len(),
        "Starting streaming TTS ({} phrases)",
        phrases.len()
    );

    let (chunk_tx, chunk_rx) = tokio::sync::mpsc::channel::<Vec<f32>>(4);
    let shared_for_playback = Arc::clone(shared);

    // Spawn playback thread: creates Sink, receives chunks via channel
    let playback_handle = tokio::task::spawn_blocking(move || {
        play_chunks_rodio(
            chunk_rx,
            sample_rate,
            volume,
            output_device.as_deref(),
            &shared_for_playback.tts_cancel,
        )
    });

    // Synthesize phrases and send to playback
    for (i, phrase) in phrases.iter().enumerate() {
        if shared.tts_cancel.load(Ordering::SeqCst) {
            tracing::info!("TTS cancelled during streaming synthesis");
            break;
        }

        match engine.synthesize(phrase).await {
            Ok(samples) if !samples.is_empty() => {
                tracing::debug!(
                    phrase = i + 1,
                    samples = samples.len(),
                    duration_secs = format!("{:.2}", samples.len() as f64 / sample_rate as f64),
                    "Phrase synthesized"
                );
                if chunk_tx.send(samples).await.is_err() {
                    tracing::warn!("Playback channel closed, stopping synthesis");
                    break;
                }
            }
            Ok(_) => {
                tracing::debug!(phrase = i + 1, "Phrase produced no audio, skipping");
            }
            Err(e) => {
                tracing::warn!(phrase = i + 1, error = %e, "Phrase synthesis failed, skipping");
                // Continue with remaining phrases
            }
        }
    }

    // Drop sender to signal playback thread that no more chunks are coming
    drop(chunk_tx);

    // Wait for playback to finish
    restore_tts_engine(shared, engine);

    match playback_handle.await {
        Ok(Ok(())) => {
            tracing::info!("Streaming TTS playback complete");
        }
        Ok(Err(e)) => {
            tracing::error!("Streaming TTS playback error: {}", e);
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: format!("TTS playback error: {}", e),
                },
            );
        }
        Err(e) => {
            tracing::error!("Streaming TTS playback task panicked: {}", e);
        }
    }

    finish_speaking(shared);
    Ok(())
}

/// Single-shot (non-streaming) synthesis + playback for short text.
async fn speak_oneshot(
    shared: &Arc<PipelineShared>,
    engine: Box<dyn TtsEngine>,
    text: &str,
    sample_rate: u32,
    volume: f32,
    output_device: Option<String>,
) -> Result<(), String> {
    let synthesize_result = engine.synthesize(text).await;

    match synthesize_result {
        Ok(samples) => {
            if samples.is_empty() {
                tracing::debug!("TTS produced no audio samples");
                restore_tts_engine(shared, engine);
                return Ok(());
            }

            tracing::info!(
                samples = samples.len(),
                sample_rate,
                duration_secs = format!("{:.2}", samples.len() as f64 / sample_rate as f64),
                "TTS synthesis complete, starting playback"
            );

            if shared.tts_cancel.load(Ordering::SeqCst) {
                tracing::info!("TTS cancelled after synthesis");
                restore_tts_engine(shared, engine);
                return Ok(());
            }

            let shared_for_playback = Arc::clone(shared);
            let playback_result = tokio::task::spawn_blocking(move || {
                play_samples_rodio(
                    samples,
                    sample_rate,
                    volume,
                    output_device.as_deref(),
                    &shared_for_playback.tts_cancel,
                )
            })
            .await;

            restore_tts_engine(shared, engine);

            match playback_result {
                Ok(Ok(())) => tracing::info!("TTS playback complete"),
                Ok(Err(e)) => {
                    tracing::error!("TTS playback error: {}", e);
                    let _ = shared.app_handle.emit(
                        "voice-event",
                        VoiceEvent::Error {
                            message: format!("TTS playback error: {}", e),
                        },
                    );
                }
                Err(e) => tracing::error!("TTS playback task panicked: {}", e),
            }
        }
        Err(e) => {
            tracing::error!("TTS synthesis failed: {}", e);
            restore_tts_engine(shared, engine);
            let _ = shared.app_handle.emit(
                "voice-event",
                VoiceEvent::Error {
                    message: format!("TTS synthesis failed: {}", e),
                },
            );
        }
    }

    Ok(())
}

/// Restore the TTS engine into shared state after use.
fn restore_tts_engine(shared: &Arc<PipelineShared>, engine: Box<dyn TtsEngine>) {
    match shared.tts_engine.lock() {
        Ok(mut guard) => {
            *guard = Some(engine);
        }
        Err(e) => {
            tracing::error!("Failed to lock tts_engine to restore: {}", e);
        }
    }
}

/// Transition the pipeline out of Speaking state.
///
/// Uses compare-and-swap: only transitions if still in Speaking state.
/// If a barge-in already moved the state to Recording, this is a no-op
/// (the SpeakingEnd event is still emitted for the frontend).
///
/// WakeWord → Listening (resume auto-detection).
/// PTT / Toggle → Idle (wait for key press).
fn finish_speaking(shared: &Arc<PipelineShared>) {
    let mode = shared.mode.lock().map(|g| *g).unwrap_or(VoiceMode::PushToTalk);
    let next_state = match mode {
        VoiceMode::WakeWord => VoiceState::Listening,
        VoiceMode::PushToTalk | VoiceMode::Toggle => VoiceState::Idle,
    };

    // Only transition if we're still in Speaking state.
    // If barge-in already moved us to Recording, don't overwrite.
    let swapped = shared.state.compare_exchange(
        state_to_u8(VoiceState::Speaking),
        state_to_u8(next_state),
        Ordering::SeqCst,
        Ordering::Relaxed,
    );

    // Always emit SpeakingEnd so the frontend knows TTS is done
    let _ = shared
        .app_handle
        .emit("voice-event", VoiceEvent::SpeakingEnd {});

    if swapped.is_ok() {
        let _ = shared.app_handle.emit(
            "voice-event",
            VoiceEvent::StateChange {
                state: next_state.to_string(),
            },
        );
    } else {
        tracing::debug!("finish_speaking: state already changed (barge-in?), skipping state transition");
    }
}

/// Open the audio output stream for a named or default device.
fn open_output_stream(
    output_device_name: Option<&str>,
) -> Result<(OutputStream, rodio::OutputStreamHandle), String> {
    if let Some(name) = output_device_name {
        let host = cpal::default_host();
        let device = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {}", e))?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false));

        match device {
            Some(dev) => {
                tracing::info!(device = %name, "Using configured output device");
                OutputStream::try_from_device(&dev)
                    .map_err(|e| format!("Failed to open output device '{}': {}", name, e))
            }
            None => {
                tracing::warn!(
                    device = %name,
                    "Configured output device not found, falling back to default"
                );
                OutputStream::try_default()
                    .map_err(|e| format!("No audio output device available: {}", e))
            }
        }
    } else {
        OutputStream::try_default()
            .map_err(|e| format!("No audio output device available: {}", e))
    }
}

/// Play f32 PCM samples through the audio output device using rodio.
///
/// This runs on a blocking thread. It creates a rodio `OutputStream` and
/// `Sink`, loads the samples as a buffer source, and blocks until playback
/// finishes or cancellation is requested.
fn play_samples_rodio(
    samples: Vec<f32>,
    sample_rate: u32,
    volume: f32,
    output_device_name: Option<&str>,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (_stream, stream_handle) = open_output_stream(output_device_name)?;

    let sink = Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create audio sink: {}", e))?;

    // Set volume (rodio volume: 1.0 = normal)
    sink.set_volume(volume.clamp(0.0, 2.0));

    // Create a rodio source from the f32 samples (mono, engine sample rate)
    let source = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
    sink.append(source);

    // Poll for completion or cancellation
    while !sink.empty() {
        if cancel.load(Ordering::SeqCst) {
            tracing::info!("TTS playback cancelled");
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    // Wait for any remaining buffered audio
    sink.sleep_until_end();

    Ok(())
}

/// Play audio chunks received from an async channel via rodio Sink.
///
/// This runs on a blocking thread. It receives synthesized audio chunks
/// from the streaming TTS pipeline and appends each to the Sink for
/// gapless playback. First audio plays as soon as the first chunk arrives.
fn play_chunks_rodio(
    rx: tokio::sync::mpsc::Receiver<Vec<f32>>,
    sample_rate: u32,
    volume: f32,
    output_device_name: Option<&str>,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (_stream, stream_handle) = open_output_stream(output_device_name)?;

    let sink = Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create audio sink: {}", e))?;

    sink.set_volume(volume.clamp(0.0, 2.0));

    // Use the current tokio runtime handle to block_on channel receives
    let rt = tokio::runtime::Handle::current();
    let mut rx = rx;

    // Receive and play chunks as they arrive
    loop {
        if cancel.load(Ordering::SeqCst) {
            tracing::info!("Streaming TTS playback cancelled");
            sink.stop();
            return Ok(());
        }

        match rt.block_on(rx.recv()) {
            Some(samples) => {
                let source = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
                sink.append(source);
            }
            None => {
                // Channel closed — all chunks sent, wait for playback to finish
                break;
            }
        }
    }

    // Wait for all queued audio to finish playing
    while !sink.empty() {
        if cancel.load(Ordering::SeqCst) {
            tracing::info!("Streaming TTS playback cancelled during drain");
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    sink.sleep_until_end();

    Ok(())
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
    fn test_ring_buffer_basic() {
        let mut rb = RingBuffer::new(10);
        assert_eq!(rb.available(), 0);

        rb.push_slice(&[1.0, 2.0, 3.0]);
        assert_eq!(rb.available(), 3);

        let mut buf = [0.0f32; 2];
        let read = rb.pop_slice(&mut buf);
        assert_eq!(read, 2);
        assert_eq!(buf, [1.0, 2.0]);
        assert_eq!(rb.available(), 1);
    }

    #[test]
    fn test_ring_buffer_overflow() {
        let mut rb = RingBuffer::new(4);
        // Write 6 samples into a buffer of size 4
        rb.push_slice(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(rb.available(), 4);

        // Should have the last 4 samples (overflow drops oldest)
        let all = rb.drain_all();
        assert_eq!(all, vec![3.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn test_ring_buffer_drain_all() {
        let mut rb = RingBuffer::new(100);
        rb.push_slice(&[1.0, 2.0, 3.0, 4.0]);
        let all = rb.drain_all();
        assert_eq!(all, vec![1.0, 2.0, 3.0, 4.0]);
        assert_eq!(rb.available(), 0);
    }

    #[test]
    fn test_ring_buffer_empty_drain() {
        let mut rb = RingBuffer::new(100);
        let all = rb.drain_all();
        assert!(all.is_empty());
    }

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
        // No assertion on count -- hardware-dependent
        let _ = devices;
    }

    #[test]
    fn test_list_output_devices() {
        let devices = list_output_devices();
        let _ = devices;
    }
}
