//! Kokoro ONNX local TTS engine.
//!
//! The real implementation is gated behind `#[cfg(feature = "onnx")]`.
//! When the feature is disabled, a stub is provided that always returns an error.

use super::TtsEngine;

// ── onnx enabled ────────────────────────────────────────────────
#[cfg(feature = "onnx")]
mod inner {
    use std::future::Future;
    use std::path::{Path, PathBuf};
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use tracing::info;

    use super::TtsEngine;

    // TODO: Reverse-engineer kokoro-onnx Python package for:
    // - Text -> phoneme conversion (likely uses espeak-ng IPA or a lookup table)
    // - Voice embedding format in voices-v1.0.bin (per-voice f32 vectors)
    // - ONNX input tensor shape: likely (batch, phoneme_ids) + voice embedding
    // - ONNX output tensor shape: likely (batch, audio_samples) at 24000 Hz
    // - Sentence splitting for chunked synthesis

    #[allow(dead_code)]
    const SAMPLE_RATE: u32 = 24000;

    pub struct KokoroTts {
        model_dir: PathBuf,
        voice: Mutex<String>,
        interrupted: AtomicBool,
        // TODO: Add ort::Session and voice embeddings once tensor shapes are known
        // session: ort::Session,
        // voices: HashMap<String, Vec<f32>>,
    }

    impl KokoroTts {
        pub fn new(model_dir: &Path) -> anyhow::Result<Self> {
            let model_path = model_dir.join("kokoro-v1.0.onnx");
            let voices_path = model_dir.join("voices-v1.0.bin");

            if !model_path.exists() {
                anyhow::bail!(
                    "Kokoro model not found: {}. Download from HuggingFace.",
                    model_path.display()
                );
            }
            if !voices_path.exists() {
                anyhow::bail!(
                    "Kokoro voices not found: {}. Download from HuggingFace.",
                    voices_path.display()
                );
            }

            // TODO: Load ONNX session via ort
            // let session = ort::Session::builder()?
            //     .with_model_from_file(&model_path)?;

            // TODO: Parse voices-v1.0.bin to extract voice embeddings
            // let voices = parse_voice_embeddings(&voices_path)?;

            info!(model = %model_path.display(), "Kokoro TTS model loaded");

            Ok(Self {
                model_dir: model_dir.to_path_buf(),
                voice: Mutex::new("af_bella".to_string()),
                interrupted: AtomicBool::new(false),
            })
        }

        pub fn set_voice(&mut self, voice: &str) {
            *self.voice.lock().unwrap() = voice.to_string();
        }
    }

    impl TtsEngine for KokoroTts {
        fn speak(&self, _text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
            Box::pin(async move {
                self.interrupted.store(false, Ordering::SeqCst);
                let voice = self.voice.lock().unwrap().clone();

                // TODO: Implement actual Kokoro inference pipeline:
                // 1. Convert text -> phoneme IDs (via espeak-ng or built-in phonemizer)
                // 2. Split into sentence-sized chunks
                // 3. For each chunk:
                //    a. Check interrupted flag
                //    b. Build input tensors (phoneme_ids + voice embedding)
                //    c. Run ort session
                //    d. Collect output audio samples
                // 4. Concatenate all chunks

                anyhow::bail!(
                    "Kokoro TTS inference not yet implemented (voice={}, model_dir={})",
                    voice,
                    self.model_dir.display()
                )
            })
        }

        fn stop(&self) {
            self.interrupted.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            let voice = self.voice.lock().unwrap();
            format!("Kokoro ({})", voice)
        }
    }
}

// ── onnx disabled (stub) ────────────────────────────────────────
#[cfg(not(feature = "onnx"))]
mod inner {
    use std::future::Future;
    use std::path::Path;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};

    use tracing::warn;

    use super::TtsEngine;

    pub struct KokoroTts {
        voice: String,
        interrupted: AtomicBool,
    }

    impl KokoroTts {
        pub fn new(model_dir: &Path) -> anyhow::Result<Self> {
            warn!(
                model_dir = %model_dir.display(),
                "Kokoro TTS requested but onnx feature is disabled"
            );
            anyhow::bail!(
                "Local Kokoro TTS is not available (compile with --features onnx)"
            )
        }

        pub fn set_voice(&mut self, voice: &str) {
            self.voice = voice.to_string();
        }
    }

    impl TtsEngine for KokoroTts {
        fn speak(&self, _text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
            Box::pin(async {
                anyhow::bail!("Local Kokoro TTS is not available (compile with --features onnx)")
            })
        }

        fn stop(&self) {
            self.interrupted.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            format!("Kokoro [disabled] ({})", self.voice)
        }
    }
}

pub use inner::KokoroTts;
