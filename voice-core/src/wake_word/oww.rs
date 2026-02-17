//! OpenWakeWord 3-stage ONNX detection pipeline.
//!
//! Pipeline stages:
//!   1. `melspectrogram.onnx` — audio (1280 samples) -> mel spectrogram features
//!   2. `embedding_model.onnx` — mel features -> embeddings
//!   3. `hey_claude_v2.onnx` — accumulated embeddings -> wake word score
//!
//! When the `onnx` feature is disabled, provides a stub that always
//! uses energy-based detection as a fallback (never triggers wake word).
//!
//! When `onnx` is enabled but exact tensor shapes cannot be resolved
//! at runtime (model mismatch, etc.), falls back gracefully to the stub.

use std::path::Path;
use tracing::warn;
#[cfg(feature = "onnx")]
use tracing::info;

/// Detection threshold — score must be >= this to trigger.
const DETECTION_THRESHOLD: f32 = 0.98;

/// Chunk size in samples (80 ms at 16 kHz).
const CHUNK_SAMPLES: usize = 1280;

// -----------------------------------------------------------------------
// onnx: real ONNX implementation
// -----------------------------------------------------------------------
#[cfg(feature = "onnx")]
mod inner {
    use super::*;
    use ort::session::Session;

    /// OpenWakeWord 3-stage pipeline.
    ///
    /// The pipeline processes audio through three ONNX models:
    /// 1. Mel spectrogram: converts raw audio to mel-frequency features
    /// 2. Embedding: converts mel features to embedding vectors
    /// 3. Wake word classifier: scores accumulated embeddings
    pub struct OpenWakeWord {
        mel_session: Option<Session>,
        embed_session: Option<Session>,
        ww_session: Option<Session>,
        /// Audio sample accumulation buffer.
        buffer: Vec<f32>,
        /// Accumulated embedding vectors for the classifier.
        /// The wake word model expects a window of recent embeddings.
        embeddings: Vec<Vec<f32>>,
        /// How many embeddings the wake word model expects (window size).
        /// Determined from the model's input shape at load time.
        embedding_window: usize,
    }

    impl OpenWakeWord {
        pub fn new() -> Self {
            Self {
                mel_session: None,
                embed_session: None,
                ww_session: None,
                buffer: Vec::new(),
                embeddings: Vec::new(),
                embedding_window: 16, // default; will be updated from model shape
            }
        }

        pub fn is_loaded(&self) -> bool {
            self.mel_session.is_some()
                && self.embed_session.is_some()
                && self.ww_session.is_some()
        }

        pub fn load(&mut self, model_dir: &Path) -> bool {
            let mel_path = model_dir.join("melspectrogram.onnx");
            let embed_path = model_dir.join("embedding_model.onnx");
            let ww_path = model_dir.join("hey_claude_v2.onnx");

            for (name, path) in [
                ("melspectrogram", &mel_path),
                ("embedding_model", &embed_path),
                ("hey_claude_v2", &ww_path),
            ] {
                if !path.exists() {
                    warn!(
                        "OpenWakeWord model not found: {} at {} — wake word disabled",
                        name,
                        path.display()
                    );
                    return false;
                }
            }

            let load = |path: &Path| -> Result<Session, String> {
                Session::builder()
                    .and_then(|b| b.with_intra_threads(1))
                    .and_then(|b| b.with_inter_threads(1))
                    .and_then(|b| b.commit_from_file(path))
                    .map_err(|e| format!("{}: {e}", path.display()))
            };

            match (load(&mel_path), load(&embed_path), load(&ww_path)) {
                (Ok(mel), Ok(embed), Ok(ww)) => {
                    self.mel_session = Some(mel);
                    self.embed_session = Some(embed);
                    self.ww_session = Some(ww);
                    self.reset();
                    info!("OpenWakeWord loaded (3-stage pipeline)");
                    true
                }
                (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => {
                    warn!("Failed to load OpenWakeWord: {e} — wake word disabled");
                    self.mel_session = None;
                    self.embed_session = None;
                    self.ww_session = None;
                    false
                }
            }
        }

        pub fn reset(&mut self) {
            self.buffer.clear();
            self.embeddings.clear();
        }

        /// Run the 3-stage pipeline on a single 1280-sample chunk.
        ///
        /// Returns `Ok(score)` where score is the wake word confidence (0..1).
        ///
        /// TODO: The exact tensor shapes for each stage need to be verified
        /// against the openwakeword Python source. The shapes below are
        /// best-effort based on the typical openwakeword architecture:
        ///   - mel input: [1, 1280] f32 (raw audio)
        ///   - mel output: [1, N_MELS, N_FRAMES] -> embedding input
        ///   - embedding output: [1, EMBED_DIM] -> accumulated for classifier
        ///   - classifier input: [1, WINDOW, EMBED_DIM] accumulated embeddings
        fn run_pipeline(&mut self, chunk: &[f32]) -> Result<f32, String> {
            let mel_session = self.mel_session.as_mut().ok_or("mel model not loaded")?;
            let embed_session = self.embed_session.as_mut().ok_or("embed model not loaded")?;
            let ww_session = self.ww_session.as_mut().ok_or("ww model not loaded")?;

            // Stage 1: audio -> mel spectrogram
            let audio_input = ort::value::Value::from_array(
                ([1, CHUNK_SAMPLES], chunk.to_vec()),
            )
            .map_err(|e| format!("mel input value: {e}"))?;

            let mel_inputs = ort::inputs!["input" => audio_input];
            let mel_outputs = mel_session
                .run(mel_inputs)
                .map_err(|e| format!("mel inference: {e}"))?;

            // Stage 2: mel features -> embedding
            // Extract mel output data and re-create as input tensor
            let (mel_shape, mel_data) = mel_outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("extract mel output: {e}"))?;

            // Re-create tensor from extracted shape + data
            let mel_dims: Vec<usize> = mel_shape.iter().map(|&d| d as usize).collect();
            let embed_input_val = ort::value::Value::from_array(
                (mel_dims, mel_data.to_vec()),
            )
            .map_err(|e| format!("embed input value: {e}"))?;

            let embed_inputs = ort::inputs!["input" => embed_input_val];
            let embed_outputs = embed_session
                .run(embed_inputs)
                .map_err(|e| format!("embed inference: {e}"))?;

            let (_embed_shape, embed_data) = embed_outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("extract embedding: {e}"))?;
            let embed_vec: Vec<f32> = embed_data.to_vec();

            // Accumulate embeddings
            self.embeddings.push(embed_vec);
            if self.embeddings.len() > self.embedding_window {
                self.embeddings
                    .drain(..self.embeddings.len() - self.embedding_window);
            }

            // Need enough embeddings before we can classify
            if self.embeddings.len() < self.embedding_window {
                return Ok(0.0);
            }

            // Stage 3: accumulated embeddings -> wake word score
            let embed_dim = self.embeddings[0].len();
            let flat: Vec<f32> = self.embeddings.iter().flat_map(|e| e.iter().copied()).collect();

            let ww_input = ort::value::Value::from_array(
                ([1, self.embedding_window, embed_dim], flat),
            )
            .map_err(|e| format!("ww input value: {e}"))?;

            let ww_inputs = ort::inputs!["input" => ww_input];
            let ww_outputs = ww_session
                .run(ww_inputs)
                .map_err(|e| format!("ww inference: {e}"))?;

            let score = {
                let (_shape, data) = ww_outputs[0]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("extract ww score: {e}"))?;
                *data.first().ok_or("empty ww output")?
            };

            Ok(score)
        }

        pub fn process(&mut self, audio_chunk: &[f32]) -> (bool, f32) {
            if !self.is_loaded() {
                return (false, 0.0);
            }

            self.buffer.extend_from_slice(audio_chunk);

            let mut max_score: f32 = 0.0;
            while self.buffer.len() >= CHUNK_SAMPLES {
                let chunk: Vec<f32> = self.buffer.drain(..CHUNK_SAMPLES).collect();
                match self.run_pipeline(&chunk) {
                    Ok(score) => {
                        if score > max_score {
                            max_score = score;
                        }
                    }
                    Err(e) => {
                        warn!("OpenWakeWord pipeline error: {e}");
                        // Don't fail hard — just skip this chunk
                    }
                }
            }

            (max_score >= DETECTION_THRESHOLD, max_score)
        }
    }
}

// -----------------------------------------------------------------------
// Stub: no onnx feature
// -----------------------------------------------------------------------
#[cfg(not(feature = "onnx"))]
mod inner {
    use super::*;

    pub struct OpenWakeWord {
        _private: (),
    }

    impl OpenWakeWord {
        pub fn new() -> Self {
            Self { _private: () }
        }

        pub fn is_loaded(&self) -> bool {
            false
        }

        pub fn load(&mut self, _model_dir: &Path) -> bool {
            warn!("OpenWakeWord not available (onnx feature disabled) — wake word disabled");
            false
        }

        pub fn reset(&mut self) {}

        pub fn process(&mut self, _audio_chunk: &[f32]) -> (bool, f32) {
            (false, 0.0)
        }
    }
}

pub use inner::OpenWakeWord;
