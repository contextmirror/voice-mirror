//! Cloud TTS adapters: Edge TTS, OpenAI TTS, ElevenLabs TTS.
//!
//! Each adapter sends text to a cloud API and returns f32 PCM audio samples.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest};
use tracing::{debug, info, warn};

use super::TtsEngine;

// ---------------------------------------------------------------------------
// Edge TTS constants (from edge-tts Python package, MIT license)
// ---------------------------------------------------------------------------

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE_URL: &str =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";
const EDGE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
    (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const CHROME_EXTENSION_ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
/// Windows epoch offset: seconds between 1601-01-01 and 1970-01-01.
const WIN_EPOCH: u64 = 11_644_473_600;

// ---------------------------------------------------------------------------
// Edge TTS DRM token generation
// ---------------------------------------------------------------------------

/// Generate the Sec-MS-GEC security token.
///
/// Replicates the Python `edge-tts` DRM logic:
/// 1. Get current unix timestamp, add Windows epoch offset.
/// 2. Round down to nearest 300 seconds (5 minutes).
/// 3. Convert to Windows file-time ticks (100-nanosecond intervals).
/// 4. SHA-256 hash of "{ticks}{TRUSTED_CLIENT_TOKEN}" -> uppercase hex.
fn generate_sec_ms_gec() -> String {
    let unix_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut ticks = unix_secs + WIN_EPOCH;
    ticks -= ticks % 300; // round down to 5-minute boundary
    let ticks_100ns = ticks as u128 * 10_000_000; // seconds -> 100ns intervals
    let to_hash = format!("{}{}", ticks_100ns, TRUSTED_CLIENT_TOKEN);
    let hash = Sha256::digest(to_hash.as_bytes());
    hex::encode_upper(hash)
}

/// JavaScript-style date string for X-Timestamp header.
fn js_date_string() -> String {
    let now = chrono::Utc::now();
    now.format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)")
        .to_string()
}

/// Escape XML special characters for SSML.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Decode MP3 bytes to mono f32 PCM samples using minimp3.
fn decode_mp3_to_f32(mp3_bytes: &[u8]) -> anyhow::Result<Vec<f32>> {
    let mut decoder = minimp3::Decoder::new(std::io::Cursor::new(mp3_bytes));
    let mut all_samples = Vec::new();
    loop {
        match decoder.next_frame() {
            Ok(frame) => {
                let channels = frame.channels;
                if channels == 1 {
                    all_samples.extend(frame.data.iter().map(|&s| s as f32 / 32768.0));
                } else {
                    // Downmix to mono by averaging channels
                    for chunk in frame.data.chunks(channels) {
                        let sum: i32 = chunk.iter().map(|&s| s as i32).sum();
                        all_samples.push((sum as f32 / channels as f32) / 32768.0);
                    }
                }
            }
            Err(minimp3::Error::Eof) => break,
            Err(e) => return Err(anyhow::anyhow!("MP3 decode error: {:?}", e)),
        }
    }
    Ok(all_samples)
}

// ---------------------------------------------------------------------------
// Edge TTS (free Microsoft voices)
// ---------------------------------------------------------------------------

/// Microsoft Edge TTS — free cloud synthesis via WebSocket.
///
/// Uses the same endpoint as the Edge browser's "Read Aloud" feature.
pub struct EdgeTts {
    voice: String,
    interrupted: AtomicBool,
}

impl EdgeTts {
    pub fn new(voice: &str) -> Self {
        Self {
            voice: voice.to_string(),
            interrupted: AtomicBool::new(false),
        }
    }

    /// Available Edge TTS voices.
    #[allow(dead_code)]
    pub fn available_voices() -> &'static [&'static str] {
        &[
            "en-US-AriaNeural",
            "en-US-GuyNeural",
            "en-US-JennyNeural",
            "en-GB-SoniaNeural",
            "en-GB-RyanNeural",
            "en-AU-NatashaNeural",
        ]
    }
}

impl TtsEngine for EdgeTts {
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.interrupted.store(false, Ordering::SeqCst);

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            info!(voice = %self.voice, text_len = text.len(), "Edge TTS request");

            // Build WebSocket URL with query parameters
            let connection_id = uuid::Uuid::new_v4().as_simple().to_string();
            let sec_ms_gec = generate_sec_ms_gec();
            let url = format!(
                "{}?TrustedClientToken={}&ConnectionId={}&Sec-MS-GEC={}&Sec-MS-GEC-Version={}",
                WSS_BASE_URL, TRUSTED_CLIENT_TOKEN, connection_id, sec_ms_gec, SEC_MS_GEC_VERSION,
            );

            // Build request with headers
            let mut request = url.into_client_request()?;
            let headers = request.headers_mut();
            headers.insert("Pragma", "no-cache".parse()?);
            headers.insert("Cache-Control", "no-cache".parse()?);
            headers.insert("Origin", CHROME_EXTENSION_ORIGIN.parse()?);
            headers.insert("User-Agent", EDGE_USER_AGENT.parse()?);
            headers.insert("Accept-Encoding", "gzip, deflate, br, zstd".parse()?);
            headers.insert("Accept-Language", "en-US,en;q=0.9".parse()?);

            // Connect
            let (ws_stream, _response) =
                tokio_tungstenite::connect_async_tls_with_config(request, None, false, None)
                    .await
                    .map_err(|e| anyhow::anyhow!("Edge TTS WebSocket connect failed: {}", e))?;

            let (mut writer, mut reader) = ws_stream.split();

            // 1) Send speech.config message
            let config_msg = format!(
                "X-Timestamp:{timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n\
                 {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":\
                 {{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}},\
                 \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}",
                timestamp = js_date_string()
            );
            writer
                .send(tungstenite::Message::Text(config_msg))
                .await
                .map_err(|e| anyhow::anyhow!("Edge TTS send config failed: {}", e))?;

            // 2) Send SSML request
            let request_id = uuid::Uuid::new_v4().as_simple().to_string();
            let escaped_text = xml_escape(&text);
            let ssml = format!(
                "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
                 <voice name='{}'>\
                 <prosody pitch='+0Hz' rate='+0%' volume='+0%'>\
                 {}\
                 </prosody>\
                 </voice>\
                 </speak>",
                self.voice, escaped_text
            );
            let ssml_msg = format!(
                "X-RequestId:{}\r\n\
                 Content-Type:application/ssml+xml\r\n\
                 X-Timestamp:{}Z\r\n\
                 Path:ssml\r\n\r\n\
                 {}",
                request_id,
                js_date_string(),
                ssml
            );
            writer
                .send(tungstenite::Message::Text(ssml_msg))
                .await
                .map_err(|e| anyhow::anyhow!("Edge TTS send SSML failed: {}", e))?;

            // 3) Receive audio chunks
            let mut mp3_data = Vec::new();
            while let Some(msg) = reader.next().await {
                if self.interrupted.load(Ordering::SeqCst) {
                    debug!("Edge TTS interrupted by user");
                    break;
                }

                let msg = msg.map_err(|e| anyhow::anyhow!("Edge TTS WebSocket error: {}", e))?;
                match msg {
                    tungstenite::Message::Binary(data) => {
                        if data.len() < 2 {
                            continue;
                        }
                        // First 2 bytes: header length (big-endian)
                        let header_len =
                            u16::from_be_bytes([data[0], data[1]]) as usize;
                        if header_len + 2 > data.len() {
                            warn!("Edge TTS: header_len exceeds data, skipping");
                            continue;
                        }
                        // Parse headers to verify Path:audio
                        let header_bytes = &data[2..2 + header_len];
                        let is_audio = header_bytes
                            .windows(b"Path:audio".len())
                            .any(|w| w == b"Path:audio");
                        if !is_audio {
                            continue;
                        }
                        // Audio data starts after headers + 2-byte length prefix
                        let audio_start = 2 + header_len;
                        if audio_start < data.len() {
                            mp3_data.extend_from_slice(&data[audio_start..]);
                        }
                    }
                    tungstenite::Message::Text(txt) => {
                        if txt.contains("Path:turn.end") {
                            debug!("Edge TTS: turn.end received");
                            break;
                        }
                    }
                    tungstenite::Message::Close(_) => {
                        debug!("Edge TTS: WebSocket closed");
                        break;
                    }
                    _ => {}
                }
            }

            if mp3_data.is_empty() {
                anyhow::bail!("Edge TTS: no audio data received");
            }

            // 4) Decode MP3 to f32 PCM
            let samples = decode_mp3_to_f32(&mp3_data)?;
            info!(
                mp3_bytes = mp3_data.len(),
                pcm_samples = samples.len(),
                "Edge TTS synthesis complete"
            );
            Ok(samples)
        })
    }

    fn stop(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("Edge TTS ({})", self.voice)
    }
}

// ---------------------------------------------------------------------------
// OpenAI TTS
// ---------------------------------------------------------------------------

/// OpenAI TTS — paid cloud synthesis via REST API.
///
/// POST `https://api.openai.com/v1/audio/speech`
/// Body: `{"model": "tts-1", "input": "text", "voice": "alloy"}`
/// Returns audio bytes (mp3/opus).
pub struct OpenAiTts {
    api_key: String,
    voice: String,
    model: String,
    interrupted: AtomicBool,
    client: reqwest::Client,
}

impl OpenAiTts {
    pub fn new(api_key: &str, voice: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            voice: voice.to_string(),
            model: "tts-1".to_string(),
            interrupted: AtomicBool::new(false),
            client: reqwest::Client::new(),
        }
    }

    /// Available OpenAI TTS voices.
    #[allow(dead_code)]
    pub fn available_voices() -> &'static [&'static str] {
        &["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
    }
}

impl TtsEngine for OpenAiTts {
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.interrupted.store(false, Ordering::SeqCst);

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            info!(voice = %self.voice, text_len = text.len(), "OpenAI TTS request");

            let body = serde_json::json!({
                "model": self.model,
                "input": text,
                "voice": self.voice,
                "response_format": "pcm",
            });

            let resp = self
                .client
                .post("https://api.openai.com/v1/audio/speech")
                .bearer_auth(&self.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("OpenAI TTS request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                anyhow::bail!("OpenAI TTS API error {}: {}", status, body);
            }

            // PCM format returns raw 24kHz 16-bit mono PCM
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to read OpenAI TTS response: {}", e))?;

            // Convert i16 PCM to f32 samples
            let samples: Vec<f32> = bytes
                .chunks_exact(2)
                .map(|chunk| {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    sample as f32 / 32768.0
                })
                .collect();

            info!(samples = samples.len(), "OpenAI TTS synthesis complete");
            Ok(samples)
        })
    }

    fn stop(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("OpenAI TTS ({})", self.voice)
    }
}

// ---------------------------------------------------------------------------
// ElevenLabs TTS
// ---------------------------------------------------------------------------

/// ElevenLabs TTS — paid cloud synthesis via REST API.
///
/// POST `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
/// Returns audio bytes (mp3).
pub struct ElevenLabsTts {
    api_key: String,
    voice_id: String,
    interrupted: AtomicBool,
    client: reqwest::Client,
}

impl ElevenLabsTts {
    pub fn new(api_key: &str, voice_id: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            voice_id: voice_id.to_string(),
            interrupted: AtomicBool::new(false),
            client: reqwest::Client::new(),
        }
    }

    /// Available ElevenLabs voice names (defaults).
    #[allow(dead_code)]
    pub fn available_voices() -> &'static [&'static str] {
        &[
            "Rachel", "Domi", "Bella", "Antoni", "Elli", "Josh", "Arnold", "Adam", "Sam",
        ]
    }
}

impl TtsEngine for ElevenLabsTts {
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.interrupted.store(false, Ordering::SeqCst);

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            info!(voice = %self.voice_id, text_len = text.len(), "ElevenLabs TTS request");

            let url = format!(
                "https://api.elevenlabs.io/v1/text-to-speech/{}",
                self.voice_id
            );

            let body = serde_json::json!({
                "text": text,
                "model_id": "eleven_monolingual_v1",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.5,
                }
            });

            let resp = self
                .client
                .post(&url)
                .header("xi-api-key", &self.api_key)
                .header("Accept", "audio/mpeg")
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("ElevenLabs TTS request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                anyhow::bail!("ElevenLabs TTS API error {}: {}", status, body);
            }

            let bytes = resp
                .bytes()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to read ElevenLabs response: {}", e))?;

            // TODO: Decode mp3 bytes to f32 PCM samples.
            // Need symphonia, minimp3, or similar crate for mp3 decoding.
            // For now, return an error indicating the decoding step is needed.
            anyhow::bail!(
                "ElevenLabs TTS received {} bytes of mp3 audio but mp3 decoding not yet implemented",
                bytes.len()
            )
        })
    }

    fn stop(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("ElevenLabs ({})", self.voice_id)
    }
}
