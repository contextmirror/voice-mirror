//! Text-to-Speech adapters and playback.
//!
//! Provides a common `TtsEngine` trait with implementations for:
//! - Local Kokoro ONNX synthesis (behind `onnx` feature)
//! - Edge TTS (free Microsoft cloud voices)
//! - OpenAI TTS API
//! - ElevenLabs TTS API

pub mod cloud;
pub mod kokoro;
pub mod playback;

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

/// Common trait for all TTS engines (dyn-compatible).
pub trait TtsEngine: Send + Sync {
    /// Synthesize text to f32 PCM audio samples.
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>>;

    /// Interrupt any in-progress synthesis.
    #[allow(dead_code)]
    fn stop(&self);

    /// Display name for this engine (e.g. "Kokoro (af_bella)").
    fn name(&self) -> String;
}

/// Create a TTS engine from config values.
///
/// `adapter` is one of: "kokoro", "edge", "openai-tts", "elevenlabs".
/// Returns a boxed trait object.
pub fn create_tts_engine(
    adapter: &str,
    data_dir: &Path,
    voice: Option<&str>,
    api_key: Option<&str>,
    _endpoint: Option<&str>,
) -> anyhow::Result<Box<dyn TtsEngine>> {
    match adapter {
        "kokoro" => {
            let model_dir = data_dir.join("models").join("kokoro");
            match kokoro::KokoroTts::new(&model_dir) {
                Ok(mut engine) => {
                    if let Some(v) = voice {
                        engine.set_voice(v);
                    }
                    Ok(Box::new(engine))
                }
                Err(_) => {
                    // Kokoro unavailable (no onnx feature or missing models), fall back to Edge TTS
                    tracing::warn!("Kokoro TTS unavailable, falling back to Edge TTS");
                    let v = voice.unwrap_or("en-US-AriaNeural");
                    Ok(Box::new(cloud::EdgeTts::new(v)))
                }
            }
        }
        "edge" => {
            let v = voice.unwrap_or("en-US-AriaNeural");
            Ok(Box::new(cloud::EdgeTts::new(v)))
        }
        "openai-tts" => {
            let key = api_key
                .ok_or_else(|| anyhow::anyhow!("OpenAI TTS requires an API key"))?;
            let v = voice.unwrap_or("alloy");
            Ok(Box::new(cloud::OpenAiTts::new(key, v)))
        }
        "elevenlabs" => {
            let key = api_key
                .ok_or_else(|| anyhow::anyhow!("ElevenLabs TTS requires an API key"))?;
            let v = voice.unwrap_or("Rachel");
            Ok(Box::new(cloud::ElevenLabsTts::new(key, v)))
        }
        other => anyhow::bail!("Unknown TTS adapter: {}", other),
    }
}
