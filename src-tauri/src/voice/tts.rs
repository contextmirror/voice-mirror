//! Text-to-Speech (TTS) engine.
//!
//! Provides a trait-based abstraction for TTS with implementations for:
//! - Edge TTS (Microsoft free cloud voices via HTTP REST)
//! - Kokoro TTS (local ONNX inference, feature-gated behind `onnx`)
//!
//! Audio output is f32 PCM samples suitable for playback via rodio.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

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

// ── SHA-256 (inline, no external crate) ─────────────────────────────
//
// Minimal SHA-256 implementation for generating the Edge TTS DRM token.
// This avoids adding `sha2` as a dependency just for one hash.

/// SHA-256 initial hash values (first 32 bits of fractional parts of
/// square roots of the first 8 primes).
const SHA256_H: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// SHA-256 round constants (first 32 bits of fractional parts of
/// cube roots of the first 64 primes).
const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// Compute SHA-256 digest of input bytes, returning 32-byte hash.
fn sha256(input: &[u8]) -> [u8; 32] {
    let mut h = SHA256_H;

    // Pre-processing: pad message to 512-bit (64-byte) blocks.
    // Append bit '1' (0x80), then zeros, then 64-bit big-endian length.
    let bit_len = (input.len() as u64) * 8;
    let mut padded = input.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit block
    for block in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut result = [0u8; 32];
    for (i, val) in h.iter().enumerate() {
        result[i * 4..i * 4 + 4].copy_from_slice(&val.to_be_bytes());
    }
    result
}

/// Convert bytes to uppercase hex string.
fn hex_encode_upper(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX_UPPER[(b >> 4) as usize]);
        s.push(HEX_UPPER[(b & 0x0f) as usize]);
    }
    s
}

const HEX_UPPER: [char; 16] = [
    '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', 'A', 'B', 'C', 'D', 'E', 'F',
];

// ── Edge TTS DRM Token ──────────────────────────────────────────────

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/// Windows epoch offset: seconds between 1601-01-01 and 1970-01-01.
const WIN_EPOCH: u64 = 11_644_473_600;

/// Generate the Sec-MS-GEC security token for Edge TTS.
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
    let hash = sha256(to_hash.as_bytes());
    hex_encode_upper(&hash)
}

// ── Edge TTS Helpers ────────────────────────────────────────────────

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

/// Decode MP3 bytes to mono f32 PCM samples using Symphonia.
fn decode_mp3_to_f32(mp3_bytes: &[u8]) -> Result<Vec<f32>, TtsError> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    // .to_vec() is required: MediaSourceStream::new takes Box<dyn MediaSource> which
    // implies 'static, so Cursor<&[u8]> (borrowed) cannot be used here.
    let cursor = std::io::Cursor::new(mp3_bytes.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp3");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| TtsError::SynthesisError(format!("MP3 probe failed: {}", e)))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| TtsError::SynthesisError("No audio track in MP3".into()))?;
    let track_id = track.id;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| TtsError::SynthesisError(format!("MP3 decoder init failed: {}", e)))?;

    let mut all_samples = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => {
                return Err(TtsError::SynthesisError(format!("MP3 decode error: {}", e)));
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("MP3 packet decode error (skipping): {}", e);
                continue;
            }
        };
        let spec = *decoded.spec();
        let duration = decoded.capacity();
        let mut sample_buf = SampleBuffer::<f32>::new(duration as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        if channels == 1 {
            all_samples.extend_from_slice(samples);
        } else {
            // Downmix to mono by averaging channels
            for chunk in samples.chunks(channels) {
                let sum: f32 = chunk.iter().sum();
                all_samples.push(sum / channels as f32);
            }
        }
    }

    Ok(all_samples)
}

// ── Edge TTS ────────────────────────────────────────────────────────

/// Microsoft Edge TTS engine using the free cloud API.
///
/// Uses the same endpoint as the Edge browser's "Read Aloud" feature.
/// Protocol:
/// 1. Connect via WebSocket to speech.platform.bing.com with DRM token
/// 2. Send speech.config + SSML messages
/// 3. Receive MP3 audio chunks in binary frames
/// 4. Decode MP3 to f32 PCM via Symphonia
///
/// Since this crate does not include a WebSocket client, we use reqwest's
/// HTTP upgrade mechanism to get a raw byte stream, then implement
/// minimal WebSocket framing on top. This avoids adding `tokio-tungstenite`.
pub struct EdgeTts {
    /// Voice name (e.g., "en-US-AriaNeural", "en-US-GuyNeural").
    voice: String,
    /// Speech rate as percentage offset (e.g., 0 for normal, 50 for 1.5x).
    rate: i32,
    /// Cancellation flag.
    cancelled: Arc<AtomicBool>,
    /// HTTP client (reused across requests).
    client: reqwest::Client,
}

impl EdgeTts {
    /// Create a new Edge TTS engine with the given voice.
    pub fn new(voice: &str) -> Self {
        Self {
            voice: voice.to_string(),
            rate: 0,
            cancelled: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::new(),
        }
    }

    /// Create a new Edge TTS engine with voice and rate.
    ///
    /// Rate is a percentage offset: 0 = normal, 50 = 1.5x, -50 = 0.5x.
    pub fn with_rate(voice: &str, rate: i32) -> Self {
        Self {
            voice: voice.to_string(),
            rate,
            cancelled: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::new(),
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

    /// Build SSML for the given text.
    fn build_ssml(&self, text: &str) -> String {
        let escaped = xml_escape(text);
        let rate_str = if self.rate >= 0 {
            format!("+{}%", self.rate)
        } else {
            format!("{}%", self.rate)
        };

        format!(
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
             <voice name='{}'>\
             <prosody rate='{}' pitch='+0Hz'>{}</prosody>\
             </voice>\
             </speak>",
            self.voice, rate_str, escaped
        )
    }

    /// Perform TTS synthesis via WebSocket using reqwest HTTP upgrade.
    ///
    /// Uses reqwest to perform the WebSocket upgrade handshake (HTTP 101),
    /// then speaks the minimal WebSocket framing protocol on the upgraded
    /// raw byte stream. This avoids adding tokio-tungstenite while
    /// leveraging reqwest's existing TLS support.
    async fn synthesize_ws(&self, text: &str) -> Result<Vec<f32>, TtsError> {
        let connection_id = uuid::Uuid::new_v4().as_simple().to_string();
        let sec_ms_gec = generate_sec_ms_gec();
        let ws_key = base64_encode(&uuid::Uuid::new_v4().as_bytes()[..16]);

        let url = format!(
            "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1\
             ?TrustedClientToken={}\
             &ConnectionId={}\
             &Sec-MS-GEC={}\
             &Sec-MS-GEC-Version=1-143.0.3650.75",
            TRUSTED_CLIENT_TOKEN, connection_id, sec_ms_gec,
        );

        // Send WebSocket upgrade via reqwest
        let response = self
            .client
            .get(&url)
            .header("Upgrade", "websocket")
            .header("Connection", "Upgrade")
            .header("Sec-WebSocket-Key", &ws_key)
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Origin",
                "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
            )
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
            )
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .send()
            .await
            .map_err(|e| TtsError::NetworkError(format!("Edge TTS request failed: {}", e)))?;

        let status = response.status();
        if status != reqwest::StatusCode::SWITCHING_PROTOCOLS {
            return Err(TtsError::NetworkError(format!(
                "Edge TTS WebSocket upgrade failed: HTTP {}",
                status
            )));
        }

        // Get the upgraded raw stream
        let mut upgraded = response
            .upgrade()
            .await
            .map_err(|e| TtsError::NetworkError(format!("Edge TTS stream upgrade failed: {}", e)))?;

        // Send speech.config message
        let request_id = uuid::Uuid::new_v4().as_simple().to_string();
        let config_msg =
            "X-Timestamp:Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)\r\n\
             Content-Type:application/json; charset=utf-8\r\n\
             Path:speech.config\r\n\r\n\
             {\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":\
             {\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\
             \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}".to_string();
        ws_send_text(&mut upgraded, &config_msg).await?;

        // Send SSML request
        let ssml = self.build_ssml(text);
        let ssml_msg = format!(
            "X-RequestId:{}\r\n\
             Content-Type:application/ssml+xml\r\n\
             X-Timestamp:Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)Z\r\n\
             Path:ssml\r\n\r\n\
             {}",
            request_id, ssml
        );
        ws_send_text(&mut upgraded, &ssml_msg).await?;

        // Receive audio frames
        let mut mp3_data = Vec::new();
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                tracing::debug!("Edge TTS interrupted by user");
                break;
            }

            let frame = match ws_read_frame(&mut upgraded).await {
                Ok(f) => f,
                Err(_) => break, // Connection closed or error
            };

            match frame {
                WsFrame::Text(txt) => {
                    if txt.contains("Path:turn.end") {
                        tracing::debug!("Edge TTS: turn.end received");
                        break;
                    }
                }
                WsFrame::Binary(data) => {
                    if data.len() < 2 {
                        continue;
                    }
                    // First 2 bytes: header length (big-endian)
                    let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
                    if header_len + 2 > data.len() {
                        continue;
                    }
                    // Check if this is an audio frame
                    let header_bytes = &data[2..2 + header_len];
                    let is_audio = header_bytes
                        .windows(b"Path:audio".len())
                        .any(|w| w == b"Path:audio");
                    if !is_audio {
                        continue;
                    }
                    let audio_start = 2 + header_len;
                    if audio_start < data.len() {
                        mp3_data.extend_from_slice(&data[audio_start..]);
                    }
                }
                WsFrame::Close => {
                    tracing::debug!("Edge TTS: WebSocket closed");
                    break;
                }
                WsFrame::Ping(payload) => {
                    let _ = ws_send_pong(&mut upgraded, &payload).await;
                }
            }
        }

        if mp3_data.is_empty() {
            return Err(TtsError::NetworkError(
                "Edge TTS: no audio data received".into(),
            ));
        }

        // Decode MP3 to f32 PCM
        let samples = decode_mp3_to_f32(&mp3_data)?;
        tracing::info!(
            mp3_bytes = mp3_data.len(),
            pcm_samples = samples.len(),
            "Edge TTS synthesis complete"
        );
        Ok(samples)
    }
}

impl TtsEngine for EdgeTts {
    fn synthesize(
        &self,
        text: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<f32>, TtsError>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.cancelled.store(false, Ordering::SeqCst);

            if self.cancelled.load(Ordering::SeqCst) {
                return Err(TtsError::Cancelled);
            }

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            tracing::info!(
                voice = %self.voice,
                text_len = text.len(),
                "Edge TTS synthesis request"
            );

            self.synthesize_ws(&text).await
        })
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("Edge TTS ({})", self.voice)
    }

    fn sample_rate(&self) -> u32 {
        24000
    }
}

// ── Minimal WebSocket Helpers ───────────────────────────────────────
//
// These implement just enough of RFC 6455 to talk to the Edge TTS
// endpoint. No extensions, no fragmentation, client-to-server masking
// only. This keeps us free of a full WebSocket crate dependency.

/// Parsed WebSocket frame.
enum WsFrame {
    Text(String),
    Binary(Vec<u8>),
    Close,
    Ping(Vec<u8>),
}

/// Send a text frame (opcode 0x1) with client masking.
async fn ws_send_text<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    text: &str,
) -> Result<(), TtsError> {
    ws_send_frame(writer, 0x01, text.as_bytes()).await
}

/// Send a pong frame (opcode 0xA) with client masking.
async fn ws_send_pong<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    payload: &[u8],
) -> Result<(), TtsError> {
    ws_send_frame(writer, 0x0A, payload).await
}

/// Send a WebSocket frame with the given opcode and payload.
/// All client-to-server frames are masked per RFC 6455.
async fn ws_send_frame<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    opcode: u8,
    payload: &[u8],
) -> Result<(), TtsError> {
    use tokio::io::AsyncWriteExt;

    let len = payload.len();
    let mut header = Vec::with_capacity(14);

    // FIN bit + opcode
    header.push(0x80 | opcode);

    // Payload length with mask bit set
    if len < 126 {
        header.push(0x80 | len as u8);
    } else if len <= 65535 {
        header.push(0x80 | 126);
        header.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        header.push(0x80 | 127);
        header.extend_from_slice(&(len as u64).to_be_bytes());
    }

    // Masking key (use a simple deterministic key -- Edge doesn't check)
    let mask_key: [u8; 4] = [0x37, 0xfa, 0x21, 0x3d];
    header.extend_from_slice(&mask_key);

    // Write header
    writer
        .write_all(&header)
        .await
        .map_err(|e| TtsError::NetworkError(format!("WS write header failed: {}", e)))?;

    // Write masked payload
    let mut masked = Vec::with_capacity(len);
    for (i, &b) in payload.iter().enumerate() {
        masked.push(b ^ mask_key[i % 4]);
    }
    writer
        .write_all(&masked)
        .await
        .map_err(|e| TtsError::NetworkError(format!("WS write payload failed: {}", e)))?;

    Ok(())
}

/// Read a single WebSocket frame from the stream.
async fn ws_read_frame<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<WsFrame, TtsError> {
    use tokio::io::AsyncReadExt;

    let mut hdr = [0u8; 2];
    reader
        .read_exact(&mut hdr)
        .await
        .map_err(|e| TtsError::NetworkError(format!("WS read header failed: {}", e)))?;

    let opcode = hdr[0] & 0x0f;
    let masked = (hdr[1] & 0x80) != 0;
    let mut payload_len = (hdr[1] & 0x7f) as u64;

    if payload_len == 126 {
        let mut buf = [0u8; 2];
        reader
            .read_exact(&mut buf)
            .await
            .map_err(|e| TtsError::NetworkError(format!("WS read len16 failed: {}", e)))?;
        payload_len = u16::from_be_bytes(buf) as u64;
    } else if payload_len == 127 {
        let mut buf = [0u8; 8];
        reader
            .read_exact(&mut buf)
            .await
            .map_err(|e| TtsError::NetworkError(format!("WS read len64 failed: {}", e)))?;
        payload_len = u64::from_be_bytes(buf);
    }

    // Server-to-client frames should NOT be masked, but handle it
    let mask_key = if masked {
        let mut key = [0u8; 4];
        reader
            .read_exact(&mut key)
            .await
            .map_err(|e| TtsError::NetworkError(format!("WS read mask failed: {}", e)))?;
        Some(key)
    } else {
        None
    };

    // Read payload (cap at 10MB to prevent OOM)
    let len = payload_len.min(10 * 1024 * 1024) as usize;
    let mut payload = vec![0u8; len];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|e| TtsError::NetworkError(format!("WS read payload failed: {}", e)))?;

    // Unmask if needed
    if let Some(key) = mask_key {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= key[i % 4];
        }
    }

    match opcode {
        0x01 => {
            let text = String::from_utf8_lossy(&payload).into_owned();
            Ok(WsFrame::Text(text))
        }
        0x02 => Ok(WsFrame::Binary(payload)),
        0x08 => Ok(WsFrame::Close),
        0x09 => Ok(WsFrame::Ping(payload)),
        0x0A => Ok(WsFrame::Ping(Vec::new())), // Pong -- treat as no-op ping
        _ => Ok(WsFrame::Text(String::new())), // Unknown opcode -- ignore
    }
}

/// Minimal base64 encoding (standard alphabet, with padding).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3f) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ── Kokoro TTS ──────────────────────────────────────────────────────
//
// Two variants: real ONNX inference behind `#[cfg(feature = "onnx")]`,
// and a simple stub when the feature is disabled. The stub preserves
// the existing test-compatible API (new(voice, speed) -> Self).

// ── Kokoro TTS (real ONNX implementation) ───────────────────────────
#[cfg(feature = "onnx")]
mod kokoro_impl {
    use std::collections::HashMap;
    use std::io::{Cursor, Read as _};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use byteorder::{LittleEndian, ReadBytesExt};
    use tracing::{debug, info, warn};

    use super::{TtsEngine, TtsError};

    const SAMPLE_RATE: u32 = 22050;
    /// Kokoro model context length minus 2 (for start/end pad tokens).
    const MAX_PHONEME_TOKENS: usize = 510;
    /// Style embedding dimension.
    const STYLE_DIM: usize = 256;

    /// Per-voice style embeddings: maps voice name -> flat f32 array of shape (N, 1, 256).
    struct VoiceData {
        /// Raw f32 data, length = num_entries * STYLE_DIM
        data: Vec<f32>,
        /// Number of style entries (== data.len() / STYLE_DIM)
        num_entries: usize,
    }

    impl VoiceData {
        /// Get the style vector for a given token count. Shape: (1, 256).
        fn style_for_len(&self, token_count: usize) -> Result<Vec<f32>, TtsError> {
            if self.num_entries == 0 {
                return Err(TtsError::SynthesisError(
                    "Voice style data is empty".into(),
                ));
            }
            let idx = token_count.min(self.num_entries - 1);
            let start = idx * STYLE_DIM;
            Ok(self.data[start..start + STYLE_DIM].to_vec())
        }
    }

    /// Local Kokoro ONNX TTS engine.
    ///
    /// Loads an ONNX model and voice embeddings from disk, then runs
    /// inference to synthesize speech from text via espeak-ng phonemes.
    pub struct KokoroTts {
        voice: Mutex<String>,
        speed: f32,
        cancelled: Arc<AtomicBool>,
        session: Mutex<ort::session::Session>,
        voices: HashMap<String, VoiceData>,
        vocab: HashMap<char, i64>,
    }

    // SAFETY: ort::Session is Send but not Sync by default; we protect it
    // with a Mutex so only one thread runs inference at a time.
    unsafe impl Sync for KokoroTts {}

    impl KokoroTts {
        /// Create a new Kokoro TTS engine loading model from `model_dir`.
        ///
        /// Expected files:
        /// - `{model_dir}/kokoro-v1.0.onnx` -- ONNX model
        /// - `{model_dir}/voices-v1.0.bin` -- Voice embeddings (NPZ)
        pub fn new(model_dir: &Path, voice: &str, speed: f32) -> Result<Self, TtsError> {
            let model_path = model_dir.join("kokoro-v1.0.onnx");
            let voices_path = model_dir.join("voices-v1.0.bin");

            if !model_path.exists() {
                return Err(TtsError::SynthesisError(format!(
                    "Kokoro model not found: {}. Download from HuggingFace.",
                    model_path.display()
                )));
            }
            if !voices_path.exists() {
                return Err(TtsError::SynthesisError(format!(
                    "Kokoro voices not found: {}. Download from HuggingFace.",
                    voices_path.display()
                )));
            }

            let session = ort::session::Session::builder()
                .map_err(|e| {
                    TtsError::SynthesisError(format!("ONNX session builder failed: {}", e))
                })?
                .commit_from_file(&model_path)
                .map_err(|e| {
                    TtsError::SynthesisError(format!("ONNX model load failed: {}", e))
                })?;

            let voices = load_voices_npz(&voices_path)?;
            info!(
                model = %model_path.display(),
                voices = voices.len(),
                "Kokoro TTS model loaded"
            );

            let vocab = build_vocab();

            Ok(Self {
                voice: Mutex::new(voice.to_string()),
                speed,
                cancelled: Arc::new(AtomicBool::new(false)),
                session: Mutex::new(session),
                voices,
                vocab,
            })
        }

        /// Change the active voice.
        pub fn set_voice(&mut self, voice: &str) {
            *self.voice.lock().unwrap() = voice.to_string();
        }

        /// Change the playback speed.
        pub fn set_speed(&mut self, speed: f32) {
            self.speed = speed;
        }

        /// Find espeak-ng executable.
        fn find_espeak_ng() -> Option<(PathBuf, Option<PathBuf>)> {
            // 1. Check if espeak-ng is on PATH
            if let Ok(output) = Command::new("espeak-ng").arg("--version").output() {
                if output.status.success() {
                    return Some((PathBuf::from("espeak-ng"), None));
                }
            }

            // 2. Check bundled location relative to current exe
            if let Ok(exe_path) = std::env::current_exe() {
                let mut dir = exe_path.parent();
                for _ in 0..5 {
                    if let Some(d) = dir {
                        let tools_dir = d.join("tools").join("espeak-ng");
                        let tools_exe = tools_dir.join("espeak-ng.exe");
                        if tools_exe.exists() {
                            return Some((tools_exe, Some(tools_dir)));
                        }
                        dir = d.parent();
                    }
                }
            }

            // 3. Check packaged location: resources/bin/espeak-ng/
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    let pkg_dir = exe_dir.join("espeak-ng");
                    let packaged = pkg_dir.join("espeak-ng.exe");
                    if packaged.exists() {
                        return Some((packaged, Some(pkg_dir)));
                    }
                }
            }

            None
        }

        /// Convert text to IPA phonemes using espeak-ng CLI.
        fn phonemize(text: &str, lang: &str) -> Result<String, TtsError> {
            let (espeak_bin, data_path) = Self::find_espeak_ng().ok_or_else(|| {
                TtsError::SynthesisError(
                    "espeak-ng not found. Install espeak-ng or place it in tools/espeak-ng/"
                        .into(),
                )
            })?;

            let mut cmd = Command::new(&espeak_bin);
            cmd.args(["--ipa", "-q", "-v", lang]).arg(text);

            if let Some(ref data) = data_path {
                cmd.env("ESPEAK_DATA_PATH", data);
            }

            match cmd.output() {
                Ok(out) if out.status.success() => {
                    let phonemes = String::from_utf8_lossy(&out.stdout)
                        .trim()
                        .replace('\n', " ")
                        .replace("  ", " ");
                    Ok(phonemes)
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    Err(TtsError::SynthesisError(format!(
                        "espeak-ng failed: {}",
                        stderr.trim()
                    )))
                }
                Err(e) => Err(TtsError::SynthesisError(format!(
                    "espeak-ng at {} failed to execute: {}",
                    espeak_bin.display(),
                    e
                ))),
            }
        }

        /// Convert IPA phoneme string to token IDs.
        fn tokenize(&self, phonemes: &str) -> Vec<i64> {
            phonemes
                .chars()
                .filter_map(|c| self.vocab.get(&c).copied())
                .collect()
        }

        /// Run inference for a single chunk of tokens.
        fn infer_chunk(
            &self,
            tokens: &[i64],
            voice_data: &VoiceData,
        ) -> Result<Vec<f32>, TtsError> {
            let token_count = tokens.len();
            let style = voice_data.style_for_len(token_count)?;

            // Pad with 0 at start and end: [0, ...tokens, 0]
            let mut padded = Vec::with_capacity(token_count + 2);
            padded.push(0i64);
            padded.extend_from_slice(tokens);
            padded.push(0i64);

            let input_len = padded.len();

            let input_ids = ort::value::Tensor::from_array((
                vec![1i64, input_len as i64],
                padded.into_boxed_slice(),
            ))
            .map_err(|e| {
                TtsError::SynthesisError(format!("ONNX input tensor failed: {}", e))
            })?;

            let style_tensor = ort::value::Tensor::from_array((
                vec![1i64, STYLE_DIM as i64],
                style.into_boxed_slice(),
            ))
            .map_err(|e| {
                TtsError::SynthesisError(format!("ONNX style tensor failed: {}", e))
            })?;

            let speed_tensor = ort::value::Tensor::from_array((
                vec![1i64],
                vec![self.speed].into_boxed_slice(),
            ))
            .map_err(|e| {
                TtsError::SynthesisError(format!("ONNX speed tensor failed: {}", e))
            })?;

            let mut session = self.session.lock().unwrap();
            let outputs = session
                .run(ort::inputs! {
                    "tokens" => input_ids,
                    "style" => style_tensor,
                    "speed" => speed_tensor
                })
                .map_err(|e| {
                    TtsError::SynthesisError(format!("ONNX inference failed: {}", e))
                })?;

            let audio_value = &outputs[0];
            let (_shape, audio_data) = audio_value
                .try_extract_tensor::<f32>()
                .map_err(|e| {
                    TtsError::SynthesisError(format!(
                        "ONNX output extraction failed: {}",
                        e
                    ))
                })?;
            Ok(audio_data.to_vec())
        }
    }

    impl TtsEngine for KokoroTts {
        fn synthesize(
            &self,
            text: &str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<f32>, TtsError>> + Send + '_>,
        > {
            let text = text.to_string();
            Box::pin(async move {
                self.cancelled.store(false, Ordering::SeqCst);

                if text.trim().is_empty() {
                    return Ok(Vec::new());
                }

                let voice_name = self.voice.lock().unwrap().clone();

                let voice_data = self.voices.get(&voice_name).ok_or_else(|| {
                    TtsError::SynthesisError(format!("Unknown Kokoro voice: {}", voice_name))
                })?;

                // Detect language from voice prefix
                let lang = match voice_name.chars().next() {
                    Some('a') => "en-us",
                    Some('b') => "en-gb",
                    _ => "en-us",
                };

                let phonemes = Self::phonemize(&text, lang)?;
                let mut tokens = self.tokenize(&phonemes);

                if tokens.is_empty() {
                    return Err(TtsError::SynthesisError(
                        "No phoneme tokens for input text".into(),
                    ));
                }

                debug!(
                    phoneme_count = phonemes.len(),
                    token_count = tokens.len(),
                    "Phonemized"
                );

                let mut all_audio = Vec::new();
                const SPACE_TOKEN: i64 = 16;

                while !tokens.is_empty() {
                    if self.cancelled.load(Ordering::SeqCst) {
                        debug!("Kokoro synthesis interrupted");
                        break;
                    }

                    let chunk = if tokens.len() <= MAX_PHONEME_TOKENS {
                        std::mem::take(&mut tokens)
                    } else {
                        let search_end = MAX_PHONEME_TOKENS;
                        let split_at = tokens[..search_end]
                            .iter()
                            .rposition(|&t| t == SPACE_TOKEN)
                            .map(|p| p + 1)
                            .unwrap_or(search_end);
                        tokens.drain(..split_at).collect()
                    };

                    let audio = self.infer_chunk(&chunk, voice_data)?;
                    all_audio.extend_from_slice(&audio);
                }

                if all_audio.is_empty() {
                    return Err(TtsError::SynthesisError(
                        "No audio generated for input text".into(),
                    ));
                }

                info!(
                    samples = all_audio.len(),
                    duration_secs = all_audio.len() as f64 / SAMPLE_RATE as f64,
                    "Kokoro synthesis complete"
                );

                Ok(all_audio)
            })
        }

        fn stop(&self) {
            self.cancelled.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            let voice = self.voice.lock().unwrap();
            format!("Kokoro ({})", voice)
        }

        fn sample_rate(&self) -> u32 {
            SAMPLE_RATE
        }
    }

    /// Load voice embeddings from an NPZ file (ZIP of .npy arrays).
    fn load_voices_npz(path: &Path) -> Result<HashMap<String, VoiceData>, TtsError> {
        let file = std::fs::File::open(path).map_err(|e| {
            TtsError::SynthesisError(format!("Failed to open voices file: {}", e))
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            TtsError::SynthesisError(format!("Failed to read voices NPZ: {}", e))
        })?;
        let mut voices = HashMap::new();

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| {
                TtsError::SynthesisError(format!("NPZ entry read failed: {}", e))
            })?;
            let name = entry.name().to_string();

            let voice_name = name.strip_suffix(".npy").unwrap_or(&name).to_string();

            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| {
                TtsError::SynthesisError(format!("NPZ entry decompress failed: {}", e))
            })?;

            let data = parse_npy_f32(&buf)?;
            let num_entries = data.len() / STYLE_DIM;
            if data.len() % STYLE_DIM != 0 {
                warn!(
                    voice = %voice_name,
                    len = data.len(),
                    "Voice data not evenly divisible by style dim, skipping"
                );
                continue;
            }

            voices.insert(voice_name, VoiceData { data, num_entries });
        }

        Ok(voices)
    }

    /// Parse a .npy file (NumPy array format) containing float32 data.
    fn parse_npy_f32(data: &[u8]) -> Result<Vec<f32>, TtsError> {
        let mut cursor = Cursor::new(data);

        let mut magic = [0u8; 6];
        cursor.read_exact(&mut magic).map_err(|e| {
            TtsError::SynthesisError(format!("NPY read magic failed: {}", e))
        })?;
        if &magic != b"\x93NUMPY" {
            return Err(TtsError::SynthesisError(
                "Invalid NPY magic number".into(),
            ));
        }

        let major = cursor.read_u8().map_err(|e| {
            TtsError::SynthesisError(format!("NPY read version failed: {}", e))
        })?;
        let _minor = cursor.read_u8().map_err(|e| {
            TtsError::SynthesisError(format!("NPY read version failed: {}", e))
        })?;

        let header_len = if major >= 2 {
            cursor
                .read_u32::<LittleEndian>()
                .map_err(|e| {
                    TtsError::SynthesisError(format!("NPY read header len failed: {}", e))
                })? as usize
        } else {
            cursor
                .read_u16::<LittleEndian>()
                .map_err(|e| {
                    TtsError::SynthesisError(format!("NPY read header len failed: {}", e))
                })? as usize
        };

        let mut header_bytes = vec![0u8; header_len];
        cursor.read_exact(&mut header_bytes).map_err(|e| {
            TtsError::SynthesisError(format!("NPY read header failed: {}", e))
        })?;

        let header_str = String::from_utf8_lossy(&header_bytes);
        if !header_str.contains("<f4") && !header_str.contains("float32") {
            if header_str.contains(">f4") {
                return Err(TtsError::SynthesisError(
                    "Big-endian float32 not supported".into(),
                ));
            }
            warn!(header = %header_str, "NPY header doesn't clearly indicate float32");
        }

        let remaining = data.len() - cursor.position() as usize;
        let num_floats = remaining / 4;
        let mut result = Vec::with_capacity(num_floats);
        for _ in 0..num_floats {
            result.push(cursor.read_f32::<LittleEndian>().map_err(|e| {
                TtsError::SynthesisError(format!("NPY read f32 failed: {}", e))
            })?);
        }

        Ok(result)
    }

    /// Build the phoneme-to-token-ID vocabulary.
    /// Extracted from kokoro-onnx's config.json DEFAULT_VOCAB (88 entries).
    fn build_vocab() -> HashMap<char, i64> {
        let entries: &[(char, i64)] = &[
            (';', 1),
            (':', 2),
            (',', 3),
            ('.', 4),
            ('!', 5),
            ('?', 6),
            ('\u{2014}', 9),  // em dash
            ('\u{2026}', 10), // ellipsis
            ('"', 11),
            ('(', 12),
            (')', 13),
            ('\u{201c}', 14), // left double quote
            ('\u{201d}', 15), // right double quote
            (' ', 16),
            ('\u{0303}', 17), // combining tilde
            ('\u{02a3}', 18),
            ('\u{02a5}', 19),
            ('\u{02a6}', 20),
            ('\u{02a8}', 21),
            ('\u{1d5d}', 22),
            ('\u{ab67}', 23),
            ('A', 24),
            ('I', 25),
            ('O', 31),
            ('Q', 33),
            ('S', 35),
            ('T', 36),
            ('W', 39),
            ('Y', 41),
            ('\u{1d4a}', 42),
            ('a', 43),
            ('b', 44),
            ('c', 45),
            ('d', 46),
            ('e', 47),
            ('f', 48),
            ('h', 50),
            ('i', 51),
            ('j', 52),
            ('k', 53),
            ('l', 54),
            ('m', 55),
            ('n', 56),
            ('o', 57),
            ('p', 58),
            ('q', 59),
            ('r', 60),
            ('s', 61),
            ('t', 62),
            ('u', 63),
            ('v', 64),
            ('w', 65),
            ('x', 66),
            ('y', 67),
            ('z', 68),
            ('\u{0251}', 69),
            ('\u{0250}', 70),
            ('\u{0252}', 71),
            ('\u{00e6}', 72),
            ('\u{03b2}', 75),
            ('\u{0254}', 76),
            ('\u{0255}', 77),
            ('\u{00e7}', 78),
            ('\u{0256}', 80),
            ('\u{00f0}', 81),
            ('\u{02a4}', 82),
            ('\u{0259}', 83),
            ('\u{025a}', 85),
            ('\u{025b}', 86),
            ('\u{025c}', 87),
            ('\u{025f}', 90),
            ('\u{0261}', 92),
            ('\u{0265}', 99),
            ('\u{0268}', 101),
            ('\u{026a}', 102),
            ('\u{029d}', 103),
            ('\u{026f}', 110),
            ('\u{0270}', 111),
            ('\u{014b}', 112),
            ('\u{0273}', 113),
            ('\u{0272}', 114),
            ('\u{0274}', 115),
            ('\u{00f8}', 116),
            ('\u{0278}', 118),
            ('\u{03b8}', 119),
            ('\u{0153}', 120),
            ('\u{0279}', 123),
            ('\u{027e}', 125),
            ('\u{027b}', 126),
            ('\u{0281}', 128),
            ('\u{027d}', 129),
            ('\u{0282}', 130),
            ('\u{0283}', 131),
            ('\u{0288}', 132),
            ('\u{02a7}', 133),
            ('\u{028a}', 135),
            ('\u{028b}', 136),
            ('\u{028c}', 138),
            ('\u{0263}', 139),
            ('\u{0264}', 140),
            ('\u{03c7}', 142),
            ('\u{028e}', 143),
            ('\u{0292}', 147),
            ('\u{0294}', 148),
            ('\u{02c8}', 156),
            ('\u{02cc}', 157),
            ('\u{02d0}', 158),
            ('\u{02b0}', 162),
            ('\u{02b2}', 164),
            ('\u{2193}', 169),
            ('\u{2192}', 171),
            ('\u{2197}', 172),
            ('\u{2198}', 173),
            ('\u{1d7b}', 177),
        ];
        entries.iter().copied().collect()
    }
}

// ── Kokoro TTS (stub when onnx feature disabled) ────────────────────
#[cfg(not(feature = "onnx"))]
mod kokoro_impl {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::{TtsEngine, TtsError};

    /// Local Kokoro ONNX TTS engine (stub).
    ///
    /// When compiled without the `onnx` feature, Kokoro TTS creates
    /// successfully but synthesis returns a short sine wave with a
    /// warning log. This keeps the engine factory and tests working.
    pub struct KokoroTts {
        /// Voice name (e.g., "af_bella", "am_michael").
        voice: String,
        /// Speed multiplier.
        speed: f32,
        /// Cancellation flag.
        cancelled: Arc<AtomicBool>,
    }

    impl KokoroTts {
        /// Create a new Kokoro TTS engine (stub mode).
        pub fn new(voice: &str, speed: f32) -> Self {
            tracing::info!(
                voice = %voice,
                speed = speed,
                "KokoroTts created (stub mode -- compile with --features onnx for real inference)"
            );
            Self {
                voice: voice.to_string(),
                speed,
                cancelled: Arc::new(AtomicBool::new(false)),
            }
        }

        /// Change the active voice.
        pub fn set_voice(&mut self, voice: &str) {
            self.voice = voice.to_string();
        }

        /// Change the playback speed.
        pub fn set_speed(&mut self, speed: f32) {
            self.speed = speed;
        }
    }

    impl TtsEngine for KokoroTts {
        fn synthesize(
            &self,
            text: &str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<f32>, TtsError>> + Send + '_>,
        > {
            let text = text.to_string();
            Box::pin(async move {
                if self.cancelled.load(Ordering::SeqCst) {
                    return Err(TtsError::Cancelled);
                }

                if text.trim().is_empty() {
                    return Ok(Vec::new());
                }

                tracing::warn!(
                    voice = %self.voice,
                    speed = %self.speed,
                    text_len = text.len(),
                    "KokoroTts.synthesize() called (stub -- compile with --features onnx)"
                );

                // Stub: generate a short sine wave
                let sample_rate = 22050;
                let duration_secs = 0.1_f32;
                let frequency = 523.25_f32; // C5 note
                let num_samples = (sample_rate as f32 * duration_secs) as usize;
                let samples: Vec<f32> = (0..num_samples)
                    .map(|i| {
                        let t = i as f32 / sample_rate as f32;
                        (2.0 * std::f32::consts::PI * frequency * t).sin() * 0.3
                    })
                    .collect();

                Ok(samples)
            })
        }

        fn stop(&self) {
            self.cancelled.store(true, Ordering::SeqCst);
        }

        fn name(&self) -> String {
            format!("Kokoro ({}) [stub]", self.voice)
        }

        fn sample_rate(&self) -> u32 {
            22050
        }
    }
}

pub use kokoro_impl::KokoroTts;

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

// ── Phrase Splitting ────────────────────────────────────────────────

/// Split text into phrases suitable for incremental TTS synthesis.
///
/// Targets 5-8 word boundaries using sentence punctuation and natural
/// break points. Short fragments are merged with neighbors.
pub fn split_into_phrases(text: &str) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Short text -- don't split
    if trimmed.len() < 80 {
        return vec![trimmed.to_string()];
    }

    let mut phrases: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        current.push(chars[i]);

        // Sentence boundary: punctuation followed by whitespace or end
        let is_punct = matches!(chars[i], '.' | '!' | '?')
            && (i + 1 >= len || chars[i + 1].is_whitespace());

        // Paragraph break
        let is_para = chars[i] == '\n' && current.trim().len() > 10;

        if is_punct || is_para {
            let s = current.trim().to_string();
            if !s.is_empty() {
                phrases.push(s);
            }
            current.clear();
            // Skip whitespace after boundary
            while i + 1 < len && chars[i + 1].is_whitespace() {
                i += 1;
            }
        }
        i += 1;
    }

    // Push remainder
    let remainder = current.trim().to_string();
    if !remainder.is_empty() {
        if remainder.len() < 15 {
            // Very short -- merge with last phrase
            if let Some(last) = phrases.last_mut() {
                last.push(' ');
                last.push_str(&remainder);
            } else {
                phrases.push(remainder);
            }
        } else {
            phrases.push(remainder);
        }
    }

    // Merge short phrases (< 20 chars) forward
    let mut merged: Vec<String> = Vec::new();
    let mut carry = String::new();
    for s in phrases {
        if !carry.is_empty() {
            carry.push(' ');
            carry.push_str(&s);
            if carry.len() >= 20 {
                merged.push(std::mem::take(&mut carry));
            }
        } else if s.len() < 20 {
            carry = s;
        } else {
            merged.push(s);
        }
    }
    if !carry.is_empty() {
        if let Some(last) = merged.last_mut() {
            last.push(' ');
            last.push_str(&carry);
        } else {
            merged.push(carry);
        }
    }

    if merged.is_empty() {
        vec![trimmed.to_string()]
    } else {
        merged
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edge_tts_creation() {
        let engine = EdgeTts::new("en-US-AriaNeural");
        assert!(engine.name().contains("Edge TTS"));
        assert!(engine.name().contains("AriaNeural"));
        assert_eq!(engine.sample_rate(), 24000);
    }

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
    fn test_phrase_splitting_empty() {
        assert!(split_into_phrases("").is_empty());
        assert!(split_into_phrases("   ").is_empty());
    }

    #[test]
    fn test_phrase_splitting_short() {
        let result = split_into_phrases("Hello world.");
        assert_eq!(result, vec!["Hello world."]);
    }

    #[test]
    fn test_phrase_splitting_multiple() {
        let text = "This is the first sentence with enough text. \
                     The second sentence follows here. And a third one.";
        let result = split_into_phrases(text);
        assert!(
            result.len() >= 2,
            "Expected at least 2 phrases, got {}: {:?}",
            result.len(),
            result
        );
    }

    #[test]
    fn test_phrase_splitting_preserves_content() {
        let text = "First sentence here. Second sentence follows. Third wraps up.";
        let result = split_into_phrases(text);
        let joined = result.join(" ");
        assert!(joined.contains("First"));
        assert!(joined.contains("Second"));
        assert!(joined.contains("Third"));
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

    #[test]
    fn test_xml_escape() {
        assert_eq!(xml_escape("hello"), "hello");
        assert_eq!(xml_escape("a & b"), "a &amp; b");
        assert_eq!(xml_escape("<tag>"), "&lt;tag&gt;");
        assert_eq!(xml_escape("it's \"fine\""), "it&apos;s &quot;fine&quot;");
    }

    #[test]
    fn test_sha256_known_vector() {
        // SHA-256 of empty string
        let hash = sha256(b"");
        let hex = hex_encode_upper(&hash);
        assert_eq!(
            hex,
            "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"
        );
    }

    #[test]
    fn test_sha256_abc() {
        let hash = sha256(b"abc");
        let hex = hex_encode_upper(&hash);
        assert_eq!(
            hex,
            "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
        );
    }

    #[test]
    fn test_sec_ms_gec_format() {
        // The DRM token should be a 64-char uppercase hex string
        let token = generate_sec_ms_gec();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(token.chars().all(|c| !c.is_ascii_lowercase()));
    }

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn test_edge_tts_ssml_building() {
        let engine = EdgeTts::new("en-US-AriaNeural");
        let ssml = engine.build_ssml("Hello world");
        assert!(ssml.contains("en-US-AriaNeural"));
        assert!(ssml.contains("Hello world"));
        assert!(ssml.contains("rate='+0%'"));

        let engine_fast = EdgeTts::with_rate("en-US-GuyNeural", 50);
        let ssml_fast = engine_fast.build_ssml("Test & <escape>");
        assert!(ssml_fast.contains("rate='+50%'"));
        assert!(ssml_fast.contains("Test &amp; &lt;escape&gt;"));
    }
}
