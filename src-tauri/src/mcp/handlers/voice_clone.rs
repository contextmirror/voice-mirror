//! Voice cloning handlers: `clone_voice`, `clear_voice_clone`, `list_voice_clones`
//!
//! Port of `mcp-server/handlers/voice-clone.js`.
//!
//! These tools manage voice clones stored in `{data_dir}/voices/`.
//! Cloning uses file-based IPC with the voice backend (Rust voice-core or
//! Python agent) and optionally downloads audio via curl/yt-dlp and processes
//! it via ffmpeg.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};
use tracing::info;

use super::McpToolResult;

// ============================================
// Paths
// ============================================

/// Get the MCP data directory.
fn get_mcp_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror-electron")
        .join("data")
}

fn voices_dir() -> PathBuf {
    get_mcp_data_dir().join("voices")
}

fn voice_clone_request_path() -> PathBuf {
    get_mcp_data_dir().join("voice_clone_request.json")
}

fn voice_clone_response_path() -> PathBuf {
    get_mcp_data_dir().join("voice_clone_response.json")
}

/// Get current time as a simple timestamp string.
fn now_iso() -> String {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}ms", ts)
}

// ============================================
// Validation
// ============================================

/// Validate a URL to prevent SSRF attacks.
/// Only allows http/https schemes and blocks private/internal IP ranges.
fn validate_audio_url(url_str: &str) -> Result<(), String> {
    let parsed: url::Url = url_str
        .parse()
        .map_err(|_| "Invalid URL format".to_string())?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!(
            "Unsupported URL scheme: {} (only http/https allowed)",
            parsed.scheme()
        ));
    }

    let hostname = parsed.host_str().unwrap_or("").to_lowercase();

    // Block localhost and loopback
    if hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1" || hostname == "[::1]"
    {
        return Err("URLs pointing to localhost/loopback are not allowed".into());
    }

    // Block private IP ranges
    if let Ok(ip) = hostname.parse::<std::net::Ipv4Addr>() {
        let octets = ip.octets();
        if octets[0] == 10
            || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 169 && octets[1] == 254)
            || octets[0] == 0
        {
            return Err("URLs pointing to private/internal networks are not allowed".into());
        }
    }

    Ok(())
}

/// Validate an audio file path to prevent path traversal.
#[allow(dead_code)]
fn validate_audio_path(file_path: &str) -> Result<(), String> {
    let resolved = std::path::Path::new(file_path)
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    let data_dir = get_mcp_data_dir();
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    let resolved_str = resolved.to_string_lossy();

    if resolved_str.starts_with(data_dir.to_string_lossy().as_ref())
        || resolved_str.starts_with(home_dir.to_string_lossy().as_ref())
    {
        Ok(())
    } else {
        Err("Path not allowed: must be within user home directory or app data directory".into())
    }
}

/// Validate voice name to prevent path traversal in constructed file paths.
fn validate_voice_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("voice_name is required".into());
    }

    if name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.contains('*')
        || name.contains('?')
        || name.contains('"')
        || name.contains('<')
        || name.contains('>')
        || name.contains('|')
        || name.contains("..")
    {
        return Err("voice_name contains invalid characters".into());
    }

    if name.len() > 64 {
        return Err("voice_name too long (max 64 characters)".into());
    }

    Ok(())
}

// ============================================
// File-based IPC helper
// ============================================

/// Watch for a response file using polling.
async fn watch_for_response(response_path: &Path, timeout: Duration) -> Option<Value> {
    let start = Instant::now();
    let poll_interval = Duration::from_millis(500);

    loop {
        if start.elapsed() >= timeout {
            return None;
        }

        if response_path.exists() {
            if let Ok(raw) = fs::read_to_string(response_path) {
                if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                    return Some(val);
                }
                // Partial write, keep polling
            }
        }

        tokio::time::sleep(poll_interval).await;
    }
}

// ============================================
// Handlers
// ============================================

/// `clone_voice` -- Clone a voice from audio sample.
///
/// Uses file-based IPC to communicate with the voice backend.
/// Optionally downloads audio from a URL and processes it with ffmpeg.
pub async fn handle_clone_voice(args: &Value, _data_dir: &Path) -> McpToolResult {
    let audio_url = args.get("audio_url").and_then(|v| v.as_str()).map(|s| s.to_string());
    let audio_path = args
        .get("audio_path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let voice_name = args
        .get("voice_name")
        .and_then(|v| v.as_str())
        .unwrap_or("custom")
        .to_string();
    let transcript = args
        .get("transcript")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if audio_url.is_none() && audio_path.is_none() {
        return McpToolResult::error("Error: Either audio_url or audio_path is required");
    }

    // Validate voice name
    if let Err(e) = validate_voice_name(&voice_name) {
        return McpToolResult::error(format!("Error: {}", e));
    }

    // Validate URL if provided
    if let Some(ref url) = audio_url {
        if let Err(e) = validate_audio_url(url) {
            return McpToolResult::error(format!("Error: {}", e));
        }
    }

    // Validate file path if provided
    if let Some(ref path) = audio_path {
        // For path validation, we just check it doesn't escape allowed dirs
        // We can't canonicalize non-existent paths, so do a basic check
        if path.contains("..") {
            return McpToolResult::error("Error: Path traversal not allowed");
        }
    }

    let vdir = voices_dir();
    if let Err(e) = fs::create_dir_all(&vdir) {
        return McpToolResult::error(format!("Failed to create voices dir: {}", e));
    }

    let mut source_audio_path = audio_path.clone();
    let mut downloaded_file: Option<PathBuf> = None;

    // Download audio if URL provided
    if let Some(ref url) = audio_url {
        info!("Downloading audio from: {}", url);
        let download_path = vdir.join(format!("download_{}.tmp", SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()));

        // Try curl for download
        let result = std::process::Command::new("curl")
            .args(["-L", "-o"])
            .arg(download_path.to_str().unwrap_or(""))
            .arg(url)
            .output();

        match result {
            Ok(output) if output.status.success() => {
                source_audio_path = Some(download_path.to_string_lossy().to_string());
                downloaded_file = Some(download_path);
            }
            _ => {
                return McpToolResult::error("Failed to download audio file");
            }
        }
    }

    let source = match source_audio_path {
        Some(ref p) if Path::new(p).exists() => p.clone(),
        _ => return McpToolResult::error("Audio file not found"),
    };

    // Process audio with ffmpeg: convert to WAV 16kHz mono, trim to 5 seconds
    let processed_path = vdir.join(format!("{}_processed.wav", voice_name));
    info!("Processing audio to: {:?}", processed_path);

    let ffmpeg_result = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &source,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-t",
            "5",
            "-af",
            "silenceremove=1:0:-50dB,loudnorm",
        ])
        .arg(processed_path.to_str().unwrap_or(""))
        .output();

    // Clean up downloaded file
    if let Some(ref dl) = downloaded_file {
        if dl.exists() && dl != &processed_path {
            let _ = fs::remove_file(dl);
        }
    }

    match ffmpeg_result {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return McpToolResult::error(format!("Failed to process audio with ffmpeg: {}", stderr));
        }
        Err(e) => {
            return McpToolResult::error(format!("Failed to run ffmpeg: {}", e));
        }
    }

    // Delete old response file
    let resp_path = voice_clone_response_path();
    let _ = fs::remove_file(&resp_path);

    // Write request for voice backend
    let request = json!({
        "action": "clone",
        "audio_path": processed_path.to_string_lossy(),
        "voice_name": voice_name,
        "transcript": transcript,
        "timestamp": now_iso(),
    });

    let req_path = voice_clone_request_path();
    if let Err(e) = fs::write(
        &req_path,
        serde_json::to_string_pretty(&request).unwrap_or_default(),
    ) {
        return McpToolResult::error(format!("Failed to write clone request: {}", e));
    }

    info!("Clone request written, waiting for response...");

    // Wait for response (up to 60 seconds)
    match watch_for_response(&resp_path, Duration::from_secs(60)).await {
        None => {
            McpToolResult::error("Voice cloning request timed out. Is the voice backend running?")
        }
        Some(response) => {
            let success = response
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if success {
                let resp_transcript = response
                    .get("transcript")
                    .and_then(|v| v.as_str())
                    .or(transcript.as_deref())
                    .unwrap_or("")
                    .to_string();

                // Save voice metadata
                let meta_path = vdir.join(format!("{}.json", voice_name));
                let meta = json!({
                    "name": voice_name,
                    "audio_path": processed_path.to_string_lossy(),
                    "transcript": resp_transcript,
                    "created_at": now_iso(),
                });
                let _ = fs::write(
                    &meta_path,
                    serde_json::to_string_pretty(&meta).unwrap_or_default(),
                );

                McpToolResult::text(format!(
                    "Voice \"{}\" cloned successfully!\n\
                     Audio: {}\n\
                     Transcript: \"{}\"\n\n\
                     The TTS will now use this voice. Try speaking to hear it!",
                    voice_name,
                    processed_path.display(),
                    resp_transcript,
                ))
            } else {
                let error = response
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                McpToolResult::error(format!("Voice cloning failed: {}", error))
            }
        }
    }
}

/// `clear_voice_clone` -- Clear current voice clone.
pub async fn handle_clear_voice_clone(_args: &Value, _data_dir: &Path) -> McpToolResult {
    let resp_path = voice_clone_response_path();
    let _ = fs::remove_file(&resp_path);

    let request = json!({
        "action": "clear",
        "timestamp": now_iso(),
    });

    let req_path = voice_clone_request_path();
    if let Err(e) = fs::write(
        &req_path,
        serde_json::to_string_pretty(&request).unwrap_or_default(),
    ) {
        return McpToolResult::error(format!("Failed to write clear request: {}", e));
    }

    // Wait briefly for confirmation
    match watch_for_response(&resp_path, Duration::from_secs(5)).await {
        Some(response) => {
            let success = response
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if success {
                McpToolResult::text(
                    "Voice clone cleared. TTS will now use the default preset voice.",
                )
            } else {
                McpToolResult::text(
                    "Voice clone clear request sent. The preset voice will be used for the next response.",
                )
            }
        }
        None => McpToolResult::text(
            "Voice clone clear request sent. The preset voice will be used for the next response.",
        ),
    }
}

/// `list_voice_clones` -- List saved voice clones.
pub async fn handle_list_voice_clones(_args: &Value, _data_dir: &Path) -> McpToolResult {
    let vdir = voices_dir();

    if !vdir.exists() {
        return McpToolResult::text("No voice clones saved yet.");
    }

    let entries = match fs::read_dir(&vdir) {
        Ok(e) => e,
        Err(_) => return McpToolResult::text("No voice clones saved yet."),
    };

    let voice_files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .map(|e| e.path())
        .collect();

    if voice_files.is_empty() {
        return McpToolResult::text("No voice clones saved yet.");
    }

    let mut voices: Vec<String> = vec![];
    for path in &voice_files {
        match fs::read_to_string(path) {
            Ok(raw) => {
                if let Ok(meta) = serde_json::from_str::<Value>(&raw) {
                    let name = meta.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                    let transcript = meta
                        .get("transcript")
                        .and_then(|v| v.as_str())
                        .unwrap_or("No transcript");
                    let truncated = if transcript.len() > 50 {
                        format!("{}...", &transcript[..50])
                    } else {
                        transcript.to_string()
                    };
                    let created = meta
                        .get("created_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?");
                    voices.push(format!("- {}: \"{}\" (created: {})", name, truncated, created));
                } else {
                    let filename = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "?".into());
                    voices.push(format!("- {}: (metadata unavailable)", filename));
                }
            }
            Err(_) => {
                let filename = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "?".into());
                voices.push(format!("- {}: (metadata unavailable)", filename));
            }
        }
    }

    McpToolResult::text(format!(
        "=== Saved Voice Clones ===\n\n{}",
        voices.join("\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_voice_name_valid() {
        assert!(validate_voice_name("my-voice").is_ok());
        assert!(validate_voice_name("custom_v1").is_ok());
        assert!(validate_voice_name("test").is_ok());
    }

    #[test]
    fn test_validate_voice_name_empty() {
        assert!(validate_voice_name("").is_err());
    }

    #[test]
    fn test_validate_voice_name_path_traversal() {
        assert!(validate_voice_name("../escape").is_err());
        assert!(validate_voice_name("foo/bar").is_err());
        assert!(validate_voice_name("foo\\bar").is_err());
    }

    #[test]
    fn test_validate_voice_name_too_long() {
        let long_name = "a".repeat(65);
        assert!(validate_voice_name(&long_name).is_err());
    }

    #[test]
    fn test_validate_audio_url_valid() {
        assert!(validate_audio_url("https://example.com/audio.wav").is_ok());
        assert!(validate_audio_url("http://example.com/audio.wav").is_ok());
    }

    #[test]
    fn test_validate_audio_url_localhost() {
        assert!(validate_audio_url("http://localhost/audio.wav").is_err());
        assert!(validate_audio_url("http://127.0.0.1/audio.wav").is_err());
    }

    #[test]
    fn test_validate_audio_url_private() {
        assert!(validate_audio_url("http://10.0.0.1/audio.wav").is_err());
        assert!(validate_audio_url("http://192.168.1.1/audio.wav").is_err());
    }

    #[test]
    fn test_validate_audio_url_bad_scheme() {
        assert!(validate_audio_url("ftp://example.com/audio.wav").is_err());
        assert!(validate_audio_url("file:///etc/passwd").is_err());
    }
}
