//! Speech-to-Text adapters.
//!
//! Provides a common `SttEngine` trait with implementations for:
//! - Local whisper.cpp inference (behind `whisper` feature)
//! - OpenAI Whisper API (cloud)
//! - Custom user-configured API endpoint (cloud)

pub mod cloud;
pub mod whisper;

use std::path::Path;

/// Common trait for all STT engines.
#[allow(async_fn_in_trait)]
pub trait SttEngine: Send + Sync {
    /// Transcribe 16 kHz mono f32 audio to text.
    async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String>;
}

/// Enum-dispatch wrapper over all STT backends.
///
/// This avoids dyn-compatibility issues with async trait methods.
pub enum SttAdapter {
    Whisper(whisper::WhisperStt),
    OpenAi(cloud::OpenAiStt),
    Custom(cloud::CustomApiStt),
}

impl SttAdapter {
    /// Transcribe audio using the underlying engine.
    pub async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
        match self {
            Self::Whisper(e) => e.transcribe(audio).await,
            Self::OpenAi(e) => e.transcribe(audio).await,
            Self::Custom(e) => e.transcribe(audio).await,
        }
    }
}

/// Create an STT engine from config values.
///
/// `adapter` is one of: "whisper-local", "openai-cloud", "custom-cloud".
pub fn create_stt_engine(
    adapter: &str,
    data_dir: &Path,
    model_size: Option<&str>,
    api_key: Option<&str>,
    endpoint: Option<&str>,
) -> anyhow::Result<SttAdapter> {
    // Map legacy Python adapter names to Rust equivalents
    let adapter = match adapter {
        "parakeet" | "whisper" | "faster-whisper" => "whisper-local",
        "openai" => "openai-cloud",
        other => other,
    };

    match adapter {
        "whisper-local" => {
            let size = model_size.unwrap_or("base");
            let model_path = data_dir
                .join("models")
                .join(format!("ggml-{}.en.bin", size));
            let engine = whisper::WhisperStt::new(&model_path)?;
            Ok(SttAdapter::Whisper(engine))
        }
        "openai-cloud" => {
            let key = api_key
                .ok_or_else(|| anyhow::anyhow!("OpenAI STT requires an API key"))?;
            Ok(SttAdapter::OpenAi(cloud::OpenAiStt::new(key)))
        }
        "custom-cloud" => {
            let url = endpoint
                .ok_or_else(|| anyhow::anyhow!("Custom STT requires an endpoint URL"))?;
            let key = api_key.map(|s| s.to_string());
            Ok(SttAdapter::Custom(cloud::CustomApiStt::new(url, key)))
        }
        other => anyhow::bail!("Unknown STT adapter: {}", other),
    }
}
