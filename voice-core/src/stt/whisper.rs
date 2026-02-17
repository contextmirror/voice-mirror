//! Local whisper.cpp STT via whisper-rs.
//!
//! The real implementation is gated behind `#[cfg(feature = "whisper")]`.
//! When the feature is disabled, a stub is provided that always returns an error.

/// Minimum audio duration in samples at 16 kHz (0.4 s = 6400 samples).
const MIN_SAMPLES: usize = 6_400;

// ── whisper enabled ────────────────────────────────────────────────
#[cfg(feature = "whisper")]
mod inner {
    use std::path::Path;
    use std::sync::Mutex;

    use tracing::info;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    use super::MIN_SAMPLES;
    use crate::stt::SttEngine;

    pub struct WhisperStt {
        ctx: Mutex<WhisperContext>,
    }

    // SAFETY: WhisperContext is internally thread-safe for inference when
    // access is serialized (we hold a Mutex).
    unsafe impl Send for WhisperStt {}
    unsafe impl Sync for WhisperStt {}

    impl WhisperStt {
        /// Load a GGML whisper model from disk.
        pub fn new(model_path: &Path) -> anyhow::Result<Self> {
            if !model_path.exists() {
                anyhow::bail!(
                    "Whisper model not found: {}",
                    model_path.display()
                );
            }
            let params = WhisperContextParameters::default();
            let ctx = WhisperContext::new_with_params(
                model_path.to_str().unwrap_or_default(),
                params,
            )
            .map_err(|e| anyhow::anyhow!("Failed to load whisper model: {}", e))?;

            info!(model = %model_path.display(), "Whisper model loaded");
            Ok(Self {
                ctx: Mutex::new(ctx),
            })
        }
    }

    impl SttEngine for WhisperStt {
        async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
            if audio.len() < MIN_SAMPLES {
                return Ok(String::new());
            }

            // Clone the audio so we can move it into the blocking closure.
            let audio = audio.to_vec();

            // Run whisper inference on a blocking thread to avoid stalling
            // the tokio runtime.
            let ctx_guard = &self.ctx;
            let result = tokio::task::spawn_blocking({
                // We need to send the Mutex reference — this is safe because
                // we hold &self for the duration.
                let ctx_ptr = ctx_guard as *const Mutex<WhisperContext>;
                move || {
                    // SAFETY: the Mutex is alive for the duration of &self.
                    let ctx_mutex = unsafe { &*ctx_ptr };
                    let ctx = ctx_mutex.lock().unwrap();

                    let mut state = ctx.create_state()
                        .map_err(|e| anyhow::anyhow!("Failed to create whisper state: {}", e))?;

                    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                    params.set_language(Some("en"));
                    params.set_print_special(false);
                    params.set_print_progress(false);
                    params.set_print_realtime(false);
                    params.set_print_timestamps(false);
                    params.set_single_segment(true);
                    params.set_no_timestamps(true);

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
                }
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
