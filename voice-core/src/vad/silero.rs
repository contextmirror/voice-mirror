//! Silero VAD via ONNX Runtime (ort crate).
//!
//! Processes 512-sample windows at 16 kHz and returns speech probability.
//! Maintains LSTM hidden state (h, c tensors) across calls.
//!
//! When the `onnx` feature is disabled, provides a stub that always
//! falls back to energy-based detection.

use std::path::Path;
use tracing::warn;
#[cfg(feature = "onnx")]
use tracing::info;

use super::energy;

/// Silero VAD window size (samples at 16 kHz).
const WINDOW_SIZE: usize = 512;

/// Sample rate expected by the model.
const SAMPLE_RATE: i64 = 16000;

/// Speech probability thresholds by mode.
pub fn threshold_for_mode(mode: &str) -> f32 {
    match mode {
        "recording" => 0.5,
        "follow_up" => 0.5,
        _ => 0.5,
    }
}

/// Energy fallback thresholds by mode.
fn energy_threshold_for_mode(mode: &str) -> f32 {
    match mode {
        "recording" => 0.01,
        "follow_up" => 0.03,
        _ => 0.01,
    }
}

// -----------------------------------------------------------------------
// onnx: real ONNX implementation
// -----------------------------------------------------------------------
#[cfg(feature = "onnx")]
mod inner {
    use super::*;
    use ort::session::Session;

    pub struct SileroVad {
        session: Option<Session>,
        /// LSTM hidden state h: shape [2, 1, 128]
        h: Vec<f32>,
        /// LSTM cell state c: shape [2, 1, 128]
        c: Vec<f32>,
        /// Accumulation buffer for incoming audio.
        buffer: Vec<f32>,
    }

    const STATE_SIZE: usize = 2 * 1 * 128; // 256 floats

    impl SileroVad {
        pub fn new() -> Self {
            Self {
                session: None,
                h: vec![0.0f32; STATE_SIZE],
                c: vec![0.0f32; STATE_SIZE],
                buffer: Vec::new(),
            }
        }

        pub fn is_loaded(&self) -> bool {
            self.session.is_some()
        }

        pub fn load(&mut self, model_dir: &Path) -> bool {
            let model_path = model_dir.join("silero_vad.onnx");
            if !model_path.exists() {
                warn!(
                    "Silero VAD model not found at {} — using energy fallback",
                    model_path.display()
                );
                return false;
            }

            match Session::builder()
                .and_then(|b| b.with_intra_threads(1))
                .and_then(|b| b.with_inter_threads(1))
                .and_then(|b| b.commit_from_file(&model_path))
            {
                Ok(session) => {
                    self.session = Some(session);
                    self.reset();
                    info!("Silero VAD loaded from {}", model_path.display());
                    true
                }
                Err(e) => {
                    warn!("Failed to load Silero VAD: {} — using energy fallback", e);
                    self.session = None;
                    false
                }
            }
        }

        pub fn reset(&mut self) {
            self.h = vec![0.0f32; STATE_SIZE];
            self.c = vec![0.0f32; STATE_SIZE];
            self.buffer.clear();
        }

        fn infer_window(&mut self, window: &[f32]) -> Result<f32, String> {
            let session = self.session.as_mut().ok_or("Model not loaded")?;

            // Build input tensors using ort's tuple API: (shape, Vec<T>)
            let input_tensor = ort::value::Value::from_array(
                ([1, WINDOW_SIZE], window.to_vec()),
            )
            .map_err(|e| format!("input value: {e}"))?;

            let sr_tensor = ort::value::Value::from_array(
                ([1], vec![SAMPLE_RATE]),
            )
            .map_err(|e| format!("sr value: {e}"))?;

            let h_tensor = ort::value::Value::from_array(
                ([2, 1, 128], self.h.clone()),
            )
            .map_err(|e| format!("h value: {e}"))?;

            let c_tensor = ort::value::Value::from_array(
                ([2, 1, 128], self.c.clone()),
            )
            .map_err(|e| format!("c value: {e}"))?;

            let inputs = ort::inputs![
                "input" => input_tensor,
                "sr" => sr_tensor,
                "h" => h_tensor,
                "c" => c_tensor,
            ];
            let outputs = session
                .run(inputs)
                .map_err(|e| format!("inference: {e}"))?;

            // Output[0]: speech probability, Output[1]: new h, Output[2]: new c
            let prob = {
                let (_shape, data) = outputs[0]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("extract prob: {e}"))?;
                *data.first().ok_or("empty probability output")?
            };

            // Update hidden states
            {
                let (_shape, data) = outputs[1]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("extract h: {e}"))?;
                self.h = data.to_vec();
            }
            {
                let (_shape, data) = outputs[2]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("extract c: {e}"))?;
                self.c = data.to_vec();
            }

            Ok(prob)
        }

        pub fn process(&mut self, audio_chunk: &[f32], mode: &str) -> (bool, f32) {
            if !self.is_loaded() {
                return Self::energy_fallback(audio_chunk, mode);
            }

            self.buffer.extend_from_slice(audio_chunk);

            let mut max_prob: f32 = 0.0;
            while self.buffer.len() >= WINDOW_SIZE {
                let window: Vec<f32> = self.buffer.drain(..WINDOW_SIZE).collect();
                match self.infer_window(&window) {
                    Ok(prob) => {
                        if prob > max_prob {
                            max_prob = prob;
                        }
                    }
                    Err(e) => {
                        warn!("Silero VAD inference error: {}", e);
                        return Self::energy_fallback(audio_chunk, mode);
                    }
                }
            }

            let threshold = threshold_for_mode(mode);
            (max_prob >= threshold, max_prob)
        }

        fn energy_fallback(audio_chunk: &[f32], mode: &str) -> (bool, f32) {
            let e = energy::detect(audio_chunk);
            let threshold = energy_threshold_for_mode(mode);
            (e > threshold, e)
        }
    }
}

// -----------------------------------------------------------------------
// Stub: no onnx feature
// -----------------------------------------------------------------------
#[cfg(not(feature = "onnx"))]
mod inner {
    use super::*;

    pub struct SileroVad {
        _private: (),
    }

    impl SileroVad {
        pub fn new() -> Self {
            Self { _private: () }
        }

        pub fn is_loaded(&self) -> bool {
            false
        }

        pub fn load(&mut self, _model_dir: &Path) -> bool {
            warn!("Silero VAD not available (onnx feature disabled) — using energy fallback");
            false
        }

        pub fn reset(&mut self) {}

        pub fn process(&mut self, audio_chunk: &[f32], mode: &str) -> (bool, f32) {
            let e = energy::detect(audio_chunk);
            let threshold = energy_threshold_for_mode(mode);
            (e > threshold, e)
        }
    }
}

pub use inner::SileroVad;
