//! Speech-to-Text (STT) engine.
//!
//! Provides a trait-based abstraction for STT with implementations for:
//! - Local Whisper inference via whisper-rs (behind `whisper` feature flag)
//! - Stub fallback when the `whisper` feature is disabled
//! - Cloud API placeholder for future use
//!
//! The real whisper-rs implementation loads a GGML model, caches a
//! `WhisperState` to avoid ~200MB reallocation per transcription, and
//! runs inference on a blocking thread.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── STT Engine Trait ────────────────────────────────────────────────

/// Common trait for all Speech-to-Text engines.
///
/// Implementations must be Send + Sync for use across async boundaries.
/// The `transcribe` method is synchronous because whisper-rs inference
/// is CPU-bound and should be called from a blocking task.
pub trait SttEngine: Send + Sync {
    /// Transcribe 16kHz mono f32 audio to text.
    ///
    /// This is a potentially long-running operation. For local Whisper,
    /// it performs inference on the audio buffer. For cloud APIs, it
    /// uploads the audio and waits for the response.
    fn transcribe(&self, audio: &[f32]) -> Result<String, SttError>;

    /// Process a streaming audio chunk and return a partial transcript
    /// if enough audio has accumulated.
    ///
    /// Returns `Ok(Some(text))` when a partial transcript is available,
    /// `Ok(None)` when more audio is needed, or an error on failure.
    fn transcribe_streaming(&self, audio_chunk: &[f32]) -> Result<Option<String>, SttError>;

    /// Get the engine name for display/logging.
    fn name(&self) -> &str;

    /// Whether the engine is ready to process audio.
    fn is_ready(&self) -> bool;
}

// ── STT Error ───────────────────────────────────────────────────────

/// Errors that can occur during STT operations.
#[derive(Debug)]
pub enum SttError {
    /// Model file not found at the expected path.
    ModelNotFound(PathBuf),
    /// Failed to load or initialize the model.
    ModelLoadError(String),
    /// Transcription failed during inference.
    TranscriptionError(String),
    /// Audio format is invalid (wrong sample rate, etc.).
    InvalidAudio(String),
    /// Engine is not initialized or ready.
    NotReady,
    /// Model download failed.
    DownloadError(String),
}

impl std::fmt::Display for SttError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ModelNotFound(path) => write!(f, "STT model not found: {}", path.display()),
            Self::ModelLoadError(msg) => write!(f, "STT model load error: {}", msg),
            Self::TranscriptionError(msg) => write!(f, "STT transcription error: {}", msg),
            Self::InvalidAudio(msg) => write!(f, "Invalid audio: {}", msg),
            Self::NotReady => write!(f, "STT engine not ready"),
            Self::DownloadError(msg) => write!(f, "STT model download failed: {}", msg),
        }
    }
}

impl std::error::Error for SttError {}

// ── Model Descriptor Registry ───────────────────────────────────────

/// Metadata for a Whisper GGML model file.
struct ModelDescriptor {
    /// Filename on disk (e.g., "ggml-base.en.bin").
    filename: &'static str,
    /// HuggingFace repo path (e.g., "ggerganov/whisper.cpp").
    repo: &'static str,
}

/// Look up the model descriptor for a given size identifier.
///
/// Known sizes map to exact filenames. Unknown sizes fall back to
/// the legacy `ggml-{size}.en.bin` pattern for backward compatibility.
fn model_descriptor(size: &str) -> ModelDescriptor {
    match size {
        "tiny" => ModelDescriptor {
            filename: "ggml-tiny.en.bin",
            repo: "ggerganov/whisper.cpp",
        },
        "base" => ModelDescriptor {
            filename: "ggml-base.en.bin",
            repo: "ggerganov/whisper.cpp",
        },
        "small" => ModelDescriptor {
            filename: "ggml-small.en.bin",
            repo: "ggerganov/whisper.cpp",
        },
        "large-v3-turbo" => ModelDescriptor {
            filename: "ggml-large-v3-turbo-q5_0.bin",
            repo: "ggerganov/whisper.cpp",
        },
        "large-v3" => ModelDescriptor {
            filename: "ggml-large-v3.bin",
            repo: "ggerganov/whisper.cpp",
        },
        // Legacy / unknown — fall back to old naming convention
        _ => ModelDescriptor {
            filename: "",
            repo: "ggerganov/whisper.cpp",
        },
    }
}

/// Get the model filename for a given size, using the descriptor registry.
pub fn model_filename(size: &str) -> String {
    let desc = model_descriptor(size);
    if desc.filename.is_empty() {
        format!("ggml-{}.en.bin", size)
    } else {
        desc.filename.to_string()
    }
}

// ── Model Auto-Download ─────────────────────────────────────────────

/// Progress event emitted during model download.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttDownloadProgress {
    pub model_size: String,
    pub percent: u8,
    pub downloaded_mb: f64,
    pub total_mb: f64,
}

/// Ensure a whisper GGML model exists, downloading from HuggingFace if needed.
///
/// Uses the model descriptor registry to resolve filenames. Downloads to a
/// `.tmp` file first, then renames atomically to prevent corrupt partials.
/// Emits `stt-download-progress` events via the AppHandle for UI feedback.
///
/// # Arguments
/// * `data_dir` - Application data directory
/// * `model_size` - Model size identifier (e.g., "tiny", "base", "large-v3-turbo")
/// * `app_handle` - Optional Tauri AppHandle for emitting progress events
///
/// # Returns
/// The path to the model file.
pub async fn ensure_model_exists(
    data_dir: &Path,
    model_size: &str,
    app_handle: Option<&AppHandle>,
) -> Result<PathBuf, SttError> {
    let filename = model_filename(model_size);
    let desc = model_descriptor(model_size);
    let models_dir = data_dir.join("models");
    let model_path = models_dir.join(&filename);

    if model_path.exists() {
        tracing::info!(path = %model_path.display(), "Whisper model already present");
        return Ok(model_path);
    }

    // Create models directory
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| SttError::DownloadError(format!("Failed to create models dir: {}", e)))?;

    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        desc.repo, filename
    );

    tracing::info!(url = %url, dest = %model_path.display(), "Downloading whisper model");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| SttError::DownloadError(format!("HTTP request failed: {}", e)))?;

    if !resp.status().is_success() {
        return Err(SttError::DownloadError(format!(
            "HTTP {} from {}",
            resp.status(),
            url
        )));
    }

    let total_size = resp.content_length();

    // Download to a temp file, then rename (atomic pattern)
    let tmp_path = model_path.with_extension("bin.tmp");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| SttError::DownloadError(format!("Failed to create temp file: {}", e)))?;

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut downloaded: u64 = 0;
    let mut last_progress: u8 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| SttError::DownloadError(format!("Download stream error: {}", e)))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| SttError::DownloadError(format!("Write error: {}", e)))?;
        downloaded += chunk.len() as u64;

        // Emit progress every ~5%
        if let Some(total) = total_size {
            let pct = ((downloaded as f64 / total as f64) * 100.0) as u8;
            if pct >= last_progress + 5 {
                last_progress = pct;
                let downloaded_mb = downloaded as f64 / 1_048_576.0;
                let total_mb = total as f64 / 1_048_576.0;
                tracing::info!(
                    "Downloading whisper {} model... {}% ({:.1} MB / {:.1} MB)",
                    model_size, pct, downloaded_mb, total_mb
                );
                if let Some(handle) = app_handle {
                    let _ = handle.emit("stt-download-progress", SttDownloadProgress {
                        model_size: model_size.to_string(),
                        percent: pct,
                        downloaded_mb,
                        total_mb,
                    });
                }
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| SttError::DownloadError(format!("Flush error: {}", e)))?;
    drop(file);

    // Atomic rename from tmp to final path
    tokio::fs::rename(&tmp_path, &model_path)
        .await
        .map_err(|e| SttError::DownloadError(format!("Rename failed: {}", e)))?;

    tracing::info!(path = %model_path.display(), "Whisper model downloaded successfully");

    Ok(model_path)
}

// ── Whisper STT (Real Implementation) ────────────────────────────────

#[cfg(feature = "whisper")]
mod whisper_real {
    use super::*;
    use std::sync::{Arc, Mutex};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    /// Minimum audio length in samples before processing (0.4s at 16kHz).
    const MIN_SAMPLES: usize = 6_400;

    /// Minimum audio length for streaming before triggering transcription
    /// (2 seconds at 16kHz).
    const MIN_STREAMING_SAMPLES: usize = 32_000;

    /// Number of inference threads: half available cores, clamped to 1..=8.
    fn inference_threads() -> i32 {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        (cores / 2).clamp(1, 8) as i32
    }

    /// Holds the WhisperContext and a cached WhisperState.
    ///
    /// The state is lazily created on the first transcription and reused
    /// for subsequent calls, avoiding ~200MB of buffer reallocation per
    /// `whisper_init_state` in whisper.cpp.
    struct WhisperInner {
        ctx: WhisperContext,
        cached_state: Option<whisper_rs::WhisperState>,
    }

    // SAFETY: WhisperContext and WhisperState are safe to send between
    // threads when access is serialized via a Mutex.
    unsafe impl Send for WhisperInner {}
    unsafe impl Sync for WhisperInner {}

    /// Local Whisper-based STT engine using whisper-rs (whisper.cpp FFI).
    ///
    /// Loads a GGML model file and runs inference on 16kHz mono f32 audio.
    /// Caches the WhisperState for reuse across transcriptions.
    pub struct WhisperStt {
        inner: Arc<Mutex<WhisperInner>>,
        n_threads: i32,
        model_size: String,
        ready: AtomicBool,
        streaming_buffer: Mutex<Vec<f32>>,
    }

    impl WhisperStt {
        /// Create a new Whisper STT engine by loading a GGML model.
        ///
        /// # Arguments
        /// * `model_path` - Path to the GGML Whisper model file.
        /// * `use_gpu` - Whether to use GPU acceleration (CUDA). Falls back to CPU if unavailable.
        ///
        /// # Errors
        /// Returns `SttError::ModelNotFound` if the model file doesn't exist.
        /// Returns `SttError::ModelLoadError` if whisper-rs can't load the model.
        pub fn new(model_path: &Path, use_gpu: bool) -> Result<Self, SttError> {
            if !model_path.exists() {
                return Err(SttError::ModelNotFound(model_path.to_path_buf()));
            }

            let model_size = guess_model_size(model_path);
            let n_threads = inference_threads();

            let mut ctx_params = WhisperContextParameters::default();
            ctx_params.use_gpu = use_gpu;
            // Flash attention gives extra speed on GPU (incompatible with DTW, which we don't use)
            if use_gpu {
                ctx_params.flash_attn = true;
            }
            let ctx = WhisperContext::new_with_params(
                model_path.to_str().unwrap_or_default(),
                ctx_params,
            )
            .map_err(|e| SttError::ModelLoadError(format!("Failed to load whisper model: {}", e)))?;

            tracing::info!(
                model_path = %model_path.display(),
                model_size = %model_size,
                threads = n_threads,
                use_gpu = use_gpu,
                "WhisperStt loaded (real whisper-rs)"
            );

            Ok(Self {
                inner: Arc::new(Mutex::new(WhisperInner {
                    ctx,
                    cached_state: None,
                })),
                n_threads,
                model_size,
                ready: AtomicBool::new(true),
                streaming_buffer: Mutex::new(Vec::new()),
            })
        }

        /// Create from a model size name, resolving the path in the data directory.
        ///
        /// Uses the model descriptor registry to resolve the correct filename
        /// for each model size (e.g., "large-v3-turbo" -> "ggml-large-v3-turbo-q5_0.bin").
        pub fn from_model_size(data_dir: &Path, size: &str, use_gpu: bool) -> Result<Self, SttError> {
            let filename = model_filename(size);
            let model_path = data_dir.join("models").join(filename);
            Self::new(&model_path, use_gpu)
        }
    }

    impl SttEngine for WhisperStt {
        fn transcribe(&self, audio: &[f32]) -> Result<String, SttError> {
            if !self.is_ready() {
                return Err(SttError::NotReady);
            }

            if audio.is_empty() {
                return Ok(String::new());
            }

            // Skip audio that's too short for meaningful transcription
            if audio.len() < MIN_SAMPLES {
                tracing::debug!(
                    samples = audio.len(),
                    min = MIN_SAMPLES,
                    "Audio too short for whisper, skipping"
                );
                return Ok(String::new());
            }

            let duration_secs = audio.len() as f64 / 16000.0;
            tracing::info!(
                samples = audio.len(),
                duration_secs = format!("{:.2}", duration_secs),
                model = %self.model_size,
                "Running whisper inference"
            );

            let mut guard = self.inner.lock().map_err(|e| {
                SttError::TranscriptionError(format!("Failed to lock whisper context: {}", e))
            })?;

            // Lazily create or reuse the cached WhisperState
            let state = match guard.cached_state.as_mut() {
                Some(s) => s,
                None => {
                    tracing::info!("Creating whisper state (first transcription)");
                    let s = guard.ctx.create_state().map_err(|e| {
                        SttError::TranscriptionError(format!(
                            "Failed to create whisper state: {}",
                            e
                        ))
                    })?;
                    guard.cached_state = Some(s);
                    guard.cached_state.as_mut().unwrap()
                }
            };

            // Configure inference parameters
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some("en"));
            params.set_n_threads(self.n_threads);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_single_segment(true);
            params.set_no_timestamps(true);
            // Suppress non-speech tokens to reduce hallucination on silence
            params.set_suppress_nst(true);

            // Run inference
            state.full(params, audio).map_err(|e| {
                SttError::TranscriptionError(format!("Whisper inference failed: {}", e))
            })?;

            // Collect transcribed text from all segments
            let num_segments = state.full_n_segments();

            let mut text = String::new();
            for i in 0..num_segments {
                if let Some(seg) = state.get_segment(i) {
                    if let Ok(seg_text) = seg.to_str() {
                        let trimmed = seg_text.trim();
                        if !trimmed.is_empty() {
                            if !text.is_empty() {
                                text.push(' ');
                            }
                            text.push_str(trimmed);
                        }
                    }
                }
            }

            tracing::info!(
                segments = num_segments,
                text_len = text.len(),
                "Whisper transcription complete"
            );

            Ok(text)
        }

        fn transcribe_streaming(&self, audio_chunk: &[f32]) -> Result<Option<String>, SttError> {
            if !self.is_ready() {
                return Err(SttError::NotReady);
            }

            let mut buffer = self.streaming_buffer.lock().map_err(|e| {
                SttError::TranscriptionError(format!("Failed to lock streaming buffer: {}", e))
            })?;

            buffer.extend_from_slice(audio_chunk);

            // Accumulate at least 2 seconds of audio before attempting transcription
            if buffer.len() >= MIN_STREAMING_SAMPLES {
                let audio = std::mem::take(&mut *buffer);
                drop(buffer); // Release lock before transcription
                let text = self.transcribe(&audio)?;
                if text.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(text))
                }
            } else {
                Ok(None)
            }
        }

        fn name(&self) -> &str {
            "whisper-local"
        }

        fn is_ready(&self) -> bool {
            self.ready.load(Ordering::Relaxed)
        }
    }
}

// ── Whisper STT (Stub — feature disabled) ────────────────────────────

#[cfg(not(feature = "whisper"))]
mod whisper_stub {
    use super::*;

    /// Stub Whisper STT engine used when the `whisper` feature is disabled.
    ///
    /// Returns placeholder text indicating audio was received. Useful for
    /// testing the pipeline without compiling whisper.cpp.
    pub struct WhisperStt {
        /// Path to the model file (unused in stub mode).
        #[allow(dead_code)]
        model_path: PathBuf,
        /// Whether the engine is "ready" (always true in stub mode).
        ready: AtomicBool,
        /// Model size identifier.
        model_size: String,
        /// Accumulated audio buffer for streaming transcription.
        streaming_buffer: std::sync::Mutex<Vec<f32>>,
    }

    impl WhisperStt {
        /// Create a new stub Whisper STT engine.
        ///
        /// Always succeeds regardless of whether the model file exists.
        /// The `use_gpu` parameter is accepted for API compatibility but ignored in stub mode.
        pub fn new(model_path: &Path, _use_gpu: bool) -> Result<Self, SttError> {
            let model_size = guess_model_size(model_path);

            tracing::info!(
                model_path = %model_path.display(),
                model_size = %model_size,
                "WhisperStt created (stub mode -- no real inference)"
            );

            Ok(Self {
                model_path: model_path.to_path_buf(),
                ready: AtomicBool::new(true),
                model_size,
                streaming_buffer: std::sync::Mutex::new(Vec::new()),
            })
        }

        /// Create from a model size name, resolving the path in the data directory.
        ///
        /// Uses the model descriptor registry to resolve the correct filename
        /// for each model size (e.g., "large-v3-turbo" -> "ggml-large-v3-turbo-q5_0.bin").
        pub fn from_model_size(data_dir: &Path, size: &str, use_gpu: bool) -> Result<Self, SttError> {
            let filename = model_filename(size);
            let model_path = data_dir.join("models").join(filename);
            Self::new(&model_path, use_gpu)
        }
    }

    impl SttEngine for WhisperStt {
        fn transcribe(&self, audio: &[f32]) -> Result<String, SttError> {
            if !self.is_ready() {
                return Err(SttError::NotReady);
            }

            if audio.is_empty() {
                return Ok(String::new());
            }

            // Validate audio length (at least 100ms of audio at 16kHz)
            if audio.len() < 1600 {
                return Err(SttError::InvalidAudio(format!(
                    "Audio too short: {} samples ({:.1}ms). Need at least 100ms.",
                    audio.len(),
                    audio.len() as f64 / 16.0
                )));
            }

            let duration_secs = audio.len() as f64 / 16000.0;
            tracing::info!(
                samples = audio.len(),
                duration_secs = format!("{:.2}", duration_secs),
                model = %self.model_size,
                "WhisperStt.transcribe() called (stub)"
            );

            // Stub: return a placeholder indicating the audio was received
            Ok(format!(
                "[STT stub: received {:.1}s of audio, model={}]",
                duration_secs, self.model_size
            ))
        }

        fn transcribe_streaming(&self, audio_chunk: &[f32]) -> Result<Option<String>, SttError> {
            if !self.is_ready() {
                return Err(SttError::NotReady);
            }

            let mut buffer = self.streaming_buffer.lock().map_err(|e| {
                SttError::TranscriptionError(format!("Failed to lock streaming buffer: {}", e))
            })?;

            buffer.extend_from_slice(audio_chunk);

            // Accumulate at least 2 seconds of audio (32000 samples at 16kHz)
            const MIN_STREAMING_SAMPLES: usize = 32000;

            if buffer.len() >= MIN_STREAMING_SAMPLES {
                let audio = std::mem::take(&mut *buffer);
                drop(buffer); // Release lock before transcription
                let text = self.transcribe(&audio)?;
                if text.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(text))
                }
            } else {
                Ok(None)
            }
        }

        fn name(&self) -> &str {
            "whisper-local (stub)"
        }

        fn is_ready(&self) -> bool {
            self.ready.load(Ordering::Relaxed)
        }
    }
}

// ── Re-export the active WhisperStt ─────────────────────────────────

#[cfg(feature = "whisper")]
pub use whisper_real::WhisperStt;

#[cfg(not(feature = "whisper"))]
pub use whisper_stub::WhisperStt;

// ── STT Engine Factory ──────────────────────────────────────────────

/// Enum-dispatch wrapper to avoid dyn-trait issues with non-object-safe methods.
pub enum SttAdapter {
    Whisper(WhisperStt),
    // TODO: Add cloud adapters:
    // OpenAi(OpenAiStt),
    // Custom(CustomApiStt),
}

impl SttAdapter {
    /// Transcribe audio using the underlying engine.
    pub fn transcribe(&self, audio: &[f32]) -> Result<String, SttError> {
        match self {
            Self::Whisper(e) => e.transcribe(audio),
        }
    }

    /// Process a streaming audio chunk.
    pub fn transcribe_streaming(&self, audio_chunk: &[f32]) -> Result<Option<String>, SttError> {
        match self {
            Self::Whisper(e) => e.transcribe_streaming(audio_chunk),
        }
    }

    /// Get the engine name.
    pub fn name(&self) -> &str {
        match self {
            Self::Whisper(e) => e.name(),
        }
    }

    /// Whether the engine is ready.
    pub fn is_ready(&self) -> bool {
        match self {
            Self::Whisper(e) => e.is_ready(),
        }
    }
}

/// Create an STT engine from configuration.
///
/// # Arguments
/// * `adapter` - Adapter name: "whisper-local", "openai-cloud", "custom-cloud"
/// * `data_dir` - Application data directory for model files
/// * `model_size` - Model size for local whisper (e.g., "tiny", "base", "small")
/// * `use_gpu` - Whether to use GPU acceleration (CUDA)
pub fn create_stt_engine(
    adapter: &str,
    data_dir: &Path,
    model_size: Option<&str>,
    use_gpu: bool,
) -> Result<SttAdapter, SttError> {
    // Normalize legacy adapter names
    let adapter = match adapter {
        "whisper" | "faster-whisper" => "whisper-local",
        "openai" => "openai-cloud",
        other => other,
    };

    match adapter {
        "whisper-local" => {
            let size = model_size.unwrap_or("base");
            let engine = WhisperStt::from_model_size(data_dir, size, use_gpu)?;
            Ok(SttAdapter::Whisper(engine))
        }
        "openai-cloud" => {
            // TODO: Implement OpenAI cloud STT adapter
            tracing::warn!("OpenAI cloud STT not yet implemented, falling back to whisper stub");
            let engine = WhisperStt::from_model_size(data_dir, "base", false)?;
            Ok(SttAdapter::Whisper(engine))
        }
        "custom-cloud" => {
            // TODO: Implement custom cloud STT adapter
            tracing::warn!("Custom cloud STT not yet implemented, falling back to whisper stub");
            let engine = WhisperStt::from_model_size(data_dir, "base", false)?;
            Ok(SttAdapter::Whisper(engine))
        }
        other => Err(SttError::ModelLoadError(format!(
            "Unknown STT adapter: {}",
            other
        ))),
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Guess the model size from the file path (e.g., "ggml-base.en.bin" -> "base").
///
/// Checks versioned names first (e.g., "large-v3-turbo") before generic names
/// (e.g., "large") to avoid false substring matches.
fn guess_model_size(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");

    // Check versioned names first (most specific → least specific)
    for size in &[
        "large-v3-turbo",
        "large-v3",
        "tiny",
        "base",
        "small",
        "medium",
        "large",
    ] {
        if stem.contains(size) {
            return (*size).to_string();
        }
    }

    "unknown".to_string()
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Stub-only tests (only run without whisper feature) ──────────

    #[cfg(not(feature = "whisper"))]
    mod stub_tests {
        use super::*;

        #[test]
        fn test_whisper_stt_stub_creation() {
            let path = PathBuf::from("/tmp/models/ggml-base.en.bin");
            let engine = WhisperStt::new(&path);
            assert!(engine.is_ok());

            let engine = engine.unwrap();
            assert!(engine.is_ready());
            assert!(engine.name().contains("stub"));
        }

        #[test]
        fn test_whisper_stt_stub_transcribe() {
            let path = PathBuf::from("/tmp/models/ggml-base.en.bin");
            let engine = WhisperStt::new(&path).unwrap();

            // Generate 1 second of fake audio
            let audio = vec![0.1f32; 16000];
            let result = engine.transcribe(&audio);
            assert!(result.is_ok());
            assert!(result.unwrap().contains("STT stub"));
        }

        #[test]
        fn test_whisper_stt_empty_audio() {
            let path = PathBuf::from("/tmp/models/ggml-base.en.bin");
            let engine = WhisperStt::new(&path).unwrap();

            let result = engine.transcribe(&[]);
            assert!(result.is_ok());
            assert!(result.unwrap().is_empty());
        }

        #[test]
        fn test_whisper_stt_short_audio() {
            let path = PathBuf::from("/tmp/models/ggml-base.en.bin");
            let engine = WhisperStt::new(&path).unwrap();

            // Audio too short (< 100ms)
            let audio = vec![0.1f32; 100];
            let result = engine.transcribe(&audio);
            assert!(result.is_err());
        }

        #[test]
        fn test_create_stt_engine_whisper() {
            let data_dir = PathBuf::from("/tmp/voice-mirror-test");
            let result = create_stt_engine("whisper-local", &data_dir, Some("tiny"), false);
            assert!(result.is_ok());
        }

        #[test]
        fn test_stt_adapter_dispatch() {
            let data_dir = PathBuf::from("/tmp/voice-mirror-test");
            let adapter = create_stt_engine("whisper-local", &data_dir, Some("base")).unwrap();
            assert!(adapter.is_ready());
            assert!(adapter.name().contains("stub"));
        }
    }

    // ── Real whisper tests (only run with whisper feature) ──────────

    #[cfg(feature = "whisper")]
    mod real_tests {
        use super::*;

        #[test]
        fn test_whisper_stt_real_missing_model() {
            // Real implementation should fail when model file is missing
            let path = PathBuf::from("/tmp/nonexistent/ggml-base.en.bin");
            let result = WhisperStt::new(&path, false);
            assert!(result.is_err());
        }

        #[test]
        fn test_whisper_stt_real_name() {
            // When we have a valid model, the name should NOT contain "stub"
            // We can't test creation without a real model file, so we check
            // the name constant by checking the source or using from_model_size
            // on a path that doesn't exist (which will error).
            // This test just verifies the error path reports correctly.
            let data_dir = PathBuf::from("/tmp/voice-mirror-test-real");
            let result = create_stt_engine("whisper-local", &data_dir, Some("tiny"), false);
            // Should fail because model file doesn't exist
            assert!(result.is_err());
        }
    }

    // ── Feature-independent tests ──────────────────────────────────

    #[test]
    fn test_guess_model_size() {
        assert_eq!(guess_model_size(Path::new("ggml-tiny.en.bin")), "tiny");
        assert_eq!(guess_model_size(Path::new("ggml-base.en.bin")), "base");
        assert_eq!(guess_model_size(Path::new("ggml-small.en.bin")), "small");
        assert_eq!(guess_model_size(Path::new("ggml-medium.en.bin")), "medium");
        assert_eq!(guess_model_size(Path::new("ggml-large.bin")), "large");
        assert_eq!(
            guess_model_size(Path::new("ggml-large-v3-turbo-q5_0.bin")),
            "large-v3-turbo"
        );
        assert_eq!(guess_model_size(Path::new("ggml-large-v3.bin")), "large-v3");
        assert_eq!(guess_model_size(Path::new("custom-model.bin")), "unknown");
    }

    #[test]
    fn test_model_filename() {
        assert_eq!(model_filename("tiny"), "ggml-tiny.en.bin");
        assert_eq!(model_filename("base"), "ggml-base.en.bin");
        assert_eq!(model_filename("small"), "ggml-small.en.bin");
        assert_eq!(
            model_filename("large-v3-turbo"),
            "ggml-large-v3-turbo-q5_0.bin"
        );
        assert_eq!(model_filename("large-v3"), "ggml-large-v3.bin");
        // Unknown falls back to legacy pattern
        assert_eq!(model_filename("medium"), "ggml-medium.en.bin");
    }

    #[test]
    fn test_create_stt_engine_unknown() {
        let data_dir = PathBuf::from("/tmp/voice-mirror-test");
        let result = create_stt_engine("nonexistent-adapter", &data_dir, None, false);
        assert!(result.is_err());
    }

    #[test]
    fn test_stt_error_display() {
        let err = SttError::ModelNotFound(PathBuf::from("/tmp/missing.bin"));
        assert!(err.to_string().contains("not found"));

        let err = SttError::ModelLoadError("bad model".into());
        assert!(err.to_string().contains("load error"));

        let err = SttError::TranscriptionError("inference failed".into());
        assert!(err.to_string().contains("transcription error"));

        let err = SttError::InvalidAudio("wrong format".into());
        assert!(err.to_string().contains("Invalid audio"));

        let err = SttError::NotReady;
        assert!(err.to_string().contains("not ready"));

        let err = SttError::DownloadError("network error".into());
        assert!(err.to_string().contains("download failed"));
    }
}
