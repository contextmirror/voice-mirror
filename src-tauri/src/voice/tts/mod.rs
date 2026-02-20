//! Text-to-Speech (TTS) engine.
//!
//! Provides a trait-based abstraction for TTS with implementations for:
//! - Edge TTS (Microsoft free cloud voices via HTTP REST)
//! - Kokoro TTS (local ONNX inference, feature-gated behind `onnx`)
//!
//! Audio output is f32 PCM samples suitable for playback via rodio.

pub(crate) mod crypto;
mod edge_tts;
mod kokoro_impl;
mod mp3_decode;
mod phrase_split;

use std::future::Future;
use std::pin::Pin;

pub use edge_tts::EdgeTts;
pub use kokoro_impl::KokoroTts;
pub use phrase_split::split_into_phrases;

// ── TTS Engine Trait ────────────────────────────────────────────────

/// Common trait for all TTS engines (dyn-compatible).
///
/// Engines must be Send + Sync. The `synthesize` method returns a
/// pinned future for async HTTP-based engines.
pub trait TtsEngine: Send + Sync {
    /// Synthesize text to f32 PCM audio samples.
    ///
    /// Returns mono audio at the engine's native sample rate
    /// (typically 24kHz for cloud APIs, 22050Hz for Kokoro).
    fn synthesize(
        &self,
        text: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<f32>, TtsError>> + Send + '_>>;

    /// Synthesize text with streaming, returning audio for each phrase.
    ///
    /// The default implementation splits text into phrases and synthesizes
    /// each one individually. Engines can override for true streaming.
    fn synthesize_streaming(
        &self,
        text: &str,
    ) -> Pin<Box<dyn Future<Output = Result<TtsStream, TtsError>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            let phrases = split_into_phrases(&text);
            Ok(TtsStream {
                phrases,
                current_index: 0,
            })
        })
    }

    /// Interrupt any in-progress synthesis.
    fn stop(&self);

    /// Get the engine display name (e.g., "Edge TTS (en-US-AriaNeural)").
    fn name(&self) -> String;

    /// Get the output sample rate in Hz.
    fn sample_rate(&self) -> u32;
}

// ── TTS Stream ──────────────────────────────────────────────────────

/// A stream of phrases for incremental TTS synthesis.
///
/// Phrases are text chunks (typically 5-8 words) that can be
/// synthesized individually for lower latency first-audio.
pub struct TtsStream {
    /// Text phrases to synthesize in order.
    pub phrases: Vec<String>,
    /// Current phrase index (for tracking progress).
    pub current_index: usize,
}

impl TtsStream {
    /// Get the next phrase, if any.
    pub fn next_phrase(&mut self) -> Option<&str> {
        if self.current_index < self.phrases.len() {
            let phrase = &self.phrases[self.current_index];
            self.current_index += 1;
            Some(phrase)
        } else {
            None
        }
    }

    /// Whether all phrases have been consumed.
    pub fn is_done(&self) -> bool {
        self.current_index >= self.phrases.len()
    }

    /// Total number of phrases.
    pub fn total_phrases(&self) -> usize {
        self.phrases.len()
    }
}

// ── TTS Error ───────────────────────────────────────────────────────

/// Errors that can occur during TTS operations.
#[derive(Debug)]
pub enum TtsError {
    /// TTS synthesis failed.
    SynthesisError(String),
    /// Network error (for cloud TTS).
    NetworkError(String),
    /// Engine not initialized.
    NotReady,
    /// Synthesis was cancelled.
    Cancelled,
    /// Audio playback error.
    PlaybackError(String),
}

impl std::fmt::Display for TtsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SynthesisError(msg) => write!(f, "TTS synthesis error: {}", msg),
            Self::NetworkError(msg) => write!(f, "TTS network error: {}", msg),
            Self::NotReady => write!(f, "TTS engine not ready"),
            Self::Cancelled => write!(f, "TTS synthesis cancelled"),
            Self::PlaybackError(msg) => write!(f, "TTS playback error: {}", msg),
        }
    }
}

impl std::error::Error for TtsError {}

// ── TTS Engine Factory ──────────────────────────────────────────────

/// Create a TTS engine from configuration.
///
/// # Arguments
/// * `adapter` - Adapter name: "edge", "kokoro", "openai-tts", "elevenlabs"
/// * `voice` - Voice name (engine-specific)
/// * `speed` - Playback speed multiplier
pub fn create_tts_engine(
    adapter: &str,
    voice: Option<&str>,
    speed: Option<f32>,
) -> Result<Box<dyn TtsEngine>, TtsError> {
    let speed = speed.unwrap_or(1.0);

    match adapter {
        "kokoro" => {
            #[cfg(feature = "onnx")]
            {
                let v = voice.unwrap_or("af_bella");
                // Load from data directory (with Electron fallback)
                let data_dir = crate::services::platform::get_data_dir_with_fallback()
                    .join("models")
                    .join("kokoro");

                match KokoroTts::new(&data_dir, v, speed) {
                    Ok(engine) => {
                        tracing::info!("Created Kokoro TTS with voice: {}", v);
                        Ok(Box::new(engine))
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Kokoro model not available ({}), falling back to Edge TTS",
                            e
                        );
                        let ev = voice.unwrap_or("en-US-AriaNeural");
                        Ok(Box::new(EdgeTts::new(ev)))
                    }
                }
            }
            #[cfg(not(feature = "onnx"))]
            {
                let v = voice.unwrap_or("af_bella");
                tracing::info!("Creating Kokoro TTS (stub) with voice: {}", v);
                Ok(Box::new(KokoroTts::new(v, speed)))
            }
        }
        "edge" => {
            let v = voice.unwrap_or("en-US-AriaNeural");
            let rate = ((speed - 1.0) * 100.0) as i32;
            Ok(Box::new(EdgeTts::with_rate(v, rate)))
        }
        "openai-tts" => {
            // TODO: Implement OpenAI TTS adapter
            tracing::warn!("OpenAI TTS not yet implemented, falling back to Edge TTS");
            let v = voice.unwrap_or("en-US-AriaNeural");
            Ok(Box::new(EdgeTts::new(v)))
        }
        "elevenlabs" => {
            // TODO: Implement ElevenLabs TTS adapter
            tracing::warn!("ElevenLabs TTS not yet implemented, falling back to Edge TTS");
            let v = voice.unwrap_or("en-US-AriaNeural");
            Ok(Box::new(EdgeTts::new(v)))
        }
        other => Err(TtsError::SynthesisError(format!(
            "Unknown TTS adapter: {}",
            other
        ))),
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kokoro_tts_creation() {
        // Stub mode (no onnx feature): simple 2-arg constructor
        #[cfg(not(feature = "onnx"))]
        {
            let engine = KokoroTts::new("af_bella", 1.0);
            assert!(engine.name().contains("Kokoro"));
            assert!(engine.name().contains("af_bella"));
            assert_eq!(engine.sample_rate(), 22050);
        }
    }

    #[test]
    fn test_create_tts_engine_edge() {
        let engine = create_tts_engine("edge", Some("en-US-GuyNeural"), None);
        assert!(engine.is_ok());
        assert!(engine.unwrap().name().contains("Guy"));
    }

    #[test]
    fn test_create_tts_engine_kokoro() {
        let engine = create_tts_engine("kokoro", Some("af_bella"), Some(1.2));
        assert!(engine.is_ok());
    }

    #[test]
    fn test_create_tts_engine_unknown() {
        let engine = create_tts_engine("nonexistent", None, None);
        assert!(engine.is_err());
    }

    #[test]
    fn test_tts_stream() {
        let mut stream = TtsStream {
            phrases: vec!["Hello.".into(), "World.".into()],
            current_index: 0,
        };

        assert!(!stream.is_done());
        assert_eq!(stream.total_phrases(), 2);

        assert_eq!(stream.next_phrase(), Some("Hello."));
        assert_eq!(stream.next_phrase(), Some("World."));
        assert_eq!(stream.next_phrase(), None);
        assert!(stream.is_done());
    }
}
