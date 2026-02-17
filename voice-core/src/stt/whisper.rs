//! Local whisper.cpp STT via whisper-rs.
//!
//! The real implementation is gated behind `#[cfg(feature = "whisper")]`.
//! When the feature is disabled, a stub is provided that always returns an error.
//!
//! Includes model auto-download from HuggingFace when models are missing.

use std::path::{Path, PathBuf};

use crate::ipc::bridge::emit_event;
use crate::ipc::VoiceEvent;

/// Download a whisper GGML model from HuggingFace if not already present.
///
/// Emits `VoiceEvent::Loading` progress events during download so the
/// Electron UI can show a progress indicator.
pub async fn ensure_model(data_dir: &Path, size: &str) -> anyhow::Result<PathBuf> {
    let model_filename = format!("ggml-{}.en.bin", size);
    let model_path = data_dir.join("models").join(&model_filename);

    if model_path.exists() {
        tracing::info!(path = %model_path.display(), "Whisper model already present");
        return Ok(model_path);
    }

    // Create models directory
    tokio::fs::create_dir_all(data_dir.join("models")).await?;

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        model_filename
    );

    tracing::info!(url = %url, dest = %model_path.display(), "Downloading whisper model");
    emit_event(&VoiceEvent::Loading {
        step: format!("Downloading whisper {} model...", size),
    });

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await?;

    if !resp.status().is_success() {
        anyhow::bail!(
            "Failed to download whisper model: HTTP {}",
            resp.status()
        );
    }

    let total_size = resp.content_length();

    // Download to a temp file, then rename (prevents corrupt partial downloads)
    let tmp_path = model_path.with_extension("bin.tmp");
    let mut file = tokio::fs::File::create(&tmp_path).await?;

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut downloaded: u64 = 0;
    let mut last_progress: u8 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        // Emit progress every ~5%
        if let Some(total) = total_size {
            let pct = ((downloaded as f64 / total as f64) * 100.0) as u8;
            if pct >= last_progress + 5 {
                last_progress = pct;
                emit_event(&VoiceEvent::Loading {
                    step: format!("Downloading whisper {} model... {}%", size, pct),
                });
            }
        }
    }

    file.flush().await?;
    drop(file);

    // Atomic-ish rename
    tokio::fs::rename(&tmp_path, &model_path).await?;

    tracing::info!(path = %model_path.display(), "Whisper model downloaded");
    emit_event(&VoiceEvent::Loading {
        step: format!("Whisper {} model ready", size),
    });

    Ok(model_path)
}

// ── whisper enabled ────────────────────────────────────────────────
#[cfg(feature = "whisper")]
mod inner {
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use tracing::info;
    use whisper_rs::{
        FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
    };

    use crate::stt::SttEngine;

    /// Minimum audio duration in samples at 16 kHz (0.4 s = 6400 samples).
    const MIN_SAMPLES: usize = 6_400;

    /// Number of threads for whisper.cpp inference.
    /// Uses half the available cores (capped 1..=8) to leave headroom for
    /// the rest of the app (audio capture, TTS playback, Electron UI).
    fn inference_threads() -> i32 {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        (cores / 2).clamp(1, 8) as i32
    }

    /// Holds both the WhisperContext and a cached WhisperState.
    ///
    /// `WhisperState` internally holds an `Arc` clone of the context's inner
    /// data, so no lifetime issues arise from storing both together.
    /// Caching the state avoids ~200 MB of buffer reallocation per call
    /// (`whisper_init_state` in whisper.cpp).
    struct WhisperInner {
        ctx: WhisperContext,
        cached_state: Option<WhisperState>,
    }

    // SAFETY: WhisperContext and WhisperState are safe to send between threads
    // when access is serialized via a Mutex (no interior mutability without the lock).
    unsafe impl Send for WhisperInner {}
    unsafe impl Sync for WhisperInner {}

    pub struct WhisperStt {
        inner: Arc<Mutex<WhisperInner>>,
        n_threads: i32,
    }

    impl WhisperStt {
        /// Load a GGML whisper model from disk.
        pub fn new(model_path: &Path) -> anyhow::Result<Self> {
            if !model_path.exists() {
                anyhow::bail!(
                    "Whisper model not found: {}",
                    model_path.display()
                );
            }
            let ctx_params = WhisperContextParameters::default();
            let ctx = WhisperContext::new_with_params(
                model_path.to_str().unwrap_or_default(),
                ctx_params,
            )
            .map_err(|e| anyhow::anyhow!("Failed to load whisper model: {}", e))?;

            let n_threads = inference_threads();
            info!(
                model = %model_path.display(),
                threads = n_threads,
                "Whisper model loaded"
            );
            Ok(Self {
                inner: Arc::new(Mutex::new(WhisperInner {
                    ctx,
                    cached_state: None,
                })),
                n_threads,
            })
        }
    }

    impl SttEngine for WhisperStt {
        async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
            if audio.len() < MIN_SAMPLES {
                return Ok(String::new());
            }

            let audio = audio.to_vec();
            let inner = Arc::clone(&self.inner);
            let n_threads = self.n_threads;

            // Run whisper inference on a blocking thread to avoid stalling
            // the tokio runtime.
            let result = tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
                let mut guard = inner.lock().unwrap();

                // Lazily create the state on first call, reuse on subsequent calls.
                // This avoids ~200 MB of whisper_init_state overhead per transcription.
                let state = match guard.cached_state.as_mut() {
                    Some(s) => s,
                    None => {
                        info!("Creating whisper state (first transcription)");
                        let s = guard.ctx.create_state()
                            .map_err(|e| anyhow::anyhow!("Failed to create whisper state: {}", e))?;
                        guard.cached_state = Some(s);
                        guard.cached_state.as_mut().unwrap()
                    }
                };

                let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                params.set_language(Some("en"));
                params.set_n_threads(n_threads);
                params.set_print_special(false);
                params.set_print_progress(false);
                params.set_print_realtime(false);
                params.set_print_timestamps(false);
                params.set_single_segment(true);
                params.set_no_timestamps(true);
                // Suppress non-speech tokens (reduces hallucination on silence)
                params.set_suppress_non_speech_tokens(true);

                state
                    .full(params, &audio)
                    .map_err(|e| anyhow::anyhow!("Whisper inference failed: {}", e))?;

                let num_segments = state.full_n_segments()
                    .map_err(|e| anyhow::anyhow!("Failed to get segment count: {}", e))?;
                let mut text = String::new();
                for i in 0..num_segments {
                    if let Ok(seg) = state.full_get_segment_text(i) {
                        text.push_str(seg.trim());
                        if i + 1 < num_segments {
                            text.push(' ');
                        }
                    }
                }

                Ok(text)
            })
            .await
            .map_err(|e| anyhow::anyhow!("Whisper task panicked: {}", e))??;

            Ok(result)
        }
    }
}

// ── whisper disabled (stub) ────────────────────────────────────────
#[cfg(not(feature = "whisper"))]
mod inner {
    use std::path::Path;

    use tracing::warn;

    use crate::stt::SttEngine;

    pub struct WhisperStt;

    impl WhisperStt {
        pub fn new(model_path: &Path) -> anyhow::Result<Self> {
            warn!(
                model = %model_path.display(),
                "Whisper STT requested but whisper feature is disabled"
            );
            anyhow::bail!(
                "Local whisper STT is not available (compile with --features whisper)"
            )
        }
    }

    impl SttEngine for WhisperStt {
        async fn transcribe(&self, _audio: &[f32]) -> anyhow::Result<String> {
            anyhow::bail!("Local whisper STT is not available (compile with --features whisper)")
        }
    }
}

pub use inner::WhisperStt;
