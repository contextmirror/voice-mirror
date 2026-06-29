//! Microsoft Edge TTS engine using the free cloud API.
//!
//! Uses the same endpoint as the Edge browser's "Read Aloud" feature.
//! Protocol:
//! 1. Connect via WebSocket to speech.platform.bing.com with DRM token
//! 2. Send speech.config + SSML messages
//! 3. Receive MP3 audio chunks in binary frames
//! 4. Decode MP3 to f32 PCM via Symphonia
//!
//! Since this crate does not include a WebSocket client, we use reqwest's
//! HTTP upgrade mechanism to get a raw byte stream, then implement
//! minimal WebSocket framing on top. This avoids adding `tokio-tungstenite`.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use super::crypto::{base64_encode, hex_encode_upper, sha256};
use super::mp3_decode::decode_mp3_to_f32;
use super::{TtsEngine, TtsError};

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

// ── Edge TTS ────────────────────────────────────────────────────────

/// Microsoft Edge TTS engine using the free cloud API.
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
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
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
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
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

            // Bound the read so a network stall mid-frame can't wedge the pipeline
            // in the Speaking state forever (cancel is only checked between frames).
            let frame = match tokio::time::timeout(
                std::time::Duration::from_secs(10),
                ws_read_frame(&mut upgraded),
            )
            .await
            {
                Ok(Ok(f)) => f,
                Ok(Err(_)) => break, // connection closed or error
                Err(_) => {
                    tracing::warn!("Edge TTS: frame read timed out — ending synthesis");
                    break;
                }
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
    fn test_sec_ms_gec_format() {
        // The DRM token should be a 64-char uppercase hex string
        let token = generate_sec_ms_gec();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(token.chars().all(|c| !c.is_ascii_lowercase()));
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

    #[test]
    fn test_xml_escape() {
        assert_eq!(xml_escape("hello"), "hello");
        assert_eq!(xml_escape("a & b"), "a &amp; b");
        assert_eq!(xml_escape("<tag>"), "&lt;tag&gt;");
        assert_eq!(xml_escape("it's \"fine\""), "it&apos;s &quot;fine&quot;");
    }
}
