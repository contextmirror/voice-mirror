//! Screen capture handler: `capture_screen`
//!
//! Port of `mcp-server/handlers/screen.js`.
//!
//! Strategy:
//! 1. Try `cosmic-screenshot` on Linux (Cosmic desktop, no permission dialog).
//! 2. Fall back to file-based IPC with the Tauri app (screen_capture_request/response).
//! 3. Clean up old screenshots, keeping only the last 5.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{debug, error};

use super::McpToolResult;

/// Request written to `screen_capture_request.json` for the app to pick up.
#[derive(Debug, Serialize)]
struct ScreenCaptureRequest {
    display: u32,
    timestamp: String,
}

/// Response expected in `screen_capture_response.json`.
#[derive(Debug, Deserialize)]
struct ScreenCaptureResponse {
    success: bool,
    #[serde(default)]
    image_path: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    displays_available: Option<u32>,
}

/// Get the MCP data directory (matches the Node.js MCP server paths).
fn get_mcp_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror-electron")
        .join("data")
}

/// Clean up old screenshots, keeping only the most recent `keep_count`.
fn cleanup_old_screenshots(images_dir: &Path, keep_count: usize) {
    let entries = match fs::read_dir(images_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut png_files: Vec<(PathBuf, SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "png")
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let mtime = meta.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();

    // Sort by modification time, newest first
    png_files.sort_by(|a, b| b.1.cmp(&a.1));

    if png_files.len() > keep_count {
        for (path, _) in &png_files[keep_count..] {
            if let Err(e) = fs::remove_file(path) {
                error!("Failed to clean up old screenshot {:?}: {}", path, e);
            } else {
                debug!("Cleaned up old screenshot: {:?}", path.file_name());
            }
        }
    }
}

/// Wait for a response file to appear, using polling.
///
/// Returns `Some(parsed_json)` if the file appears and parses successfully,
/// or `None` if the timeout is reached.
async fn wait_for_response_file(response_path: &Path, timeout: Duration) -> Option<Value> {
    let start = Instant::now();
    let poll_interval = Duration::from_millis(500);

    // Check immediately
    if let Some(val) = try_read_json(response_path) {
        return Some(val);
    }

    loop {
        if start.elapsed() >= timeout {
            return None;
        }

        tokio::time::sleep(poll_interval).await;

        if let Some(val) = try_read_json(response_path) {
            return Some(val);
        }
    }
}

/// Try to read and parse a JSON file. Returns None on any failure.
fn try_read_json(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// `capture_screen` -- request a screenshot.
///
/// Tries cosmic-screenshot first (Linux/Cosmic), then falls back to
/// file-based IPC with the Tauri app's screen capture service.
pub async fn handle_capture_screen(args: &Value, data_dir: &Path) -> McpToolResult {
    let images_dir = data_dir.join("images");

    // Ensure images directory exists
    if let Err(e) = fs::create_dir_all(&images_dir) {
        return McpToolResult::error(format!("Failed to create images dir: {}", e));
    }

    // Clean up old screenshots (keep last 5)
    cleanup_old_screenshots(&images_dir, 5);

    let display = args
        .get("display")
        .and_then(|d| d.as_u64())
        .unwrap_or(0) as u32;

    // Try cosmic-screenshot first (Linux only)
    #[cfg(target_os = "linux")]
    {
        match try_cosmic_screenshot(&images_dir) {
            Ok(path) => {
                return McpToolResult::text(format!(
                    "Screenshot captured and saved to: {}\nYou can now analyze this image. The path is: {}",
                    path, path
                ));
            }
            Err(e) => {
                debug!("cosmic-screenshot failed, falling back: {}", e);
            }
        }
    }

    // Fallback: file-based IPC with the app
    let ipc_dir = get_mcp_data_dir();
    let request_path = ipc_dir.join("screen_capture_request.json");
    let response_path = ipc_dir.join("screen_capture_response.json");

    // Delete old response file
    let _ = fs::remove_file(&response_path);

    // Write request
    let request = ScreenCaptureRequest {
        display,
        timestamp: chrono_now_iso(),
    };
    let request_json = serde_json::to_string_pretty(&request)
        .unwrap_or_else(|_| "{}".into());

    if let Err(e) = fs::write(&request_path, request_json) {
        return McpToolResult::error(format!("Failed to write screen capture request: {}", e));
    }

    // Wait for response (up to 10 seconds)
    let timeout = Duration::from_secs(10);
    let response_val = wait_for_response_file(&response_path, timeout).await;

    match response_val {
        None => {
            McpToolResult::error("Screenshot request timed out. Is the Voice Mirror app running?")
        }
        Some(val) => {
            let response: ScreenCaptureResponse = match serde_json::from_value(val) {
                Ok(r) => r,
                Err(e) => {
                    return McpToolResult::error(format!("Failed to parse screen capture response: {}", e));
                }
            };

            if response.success {
                let image_path = response.image_path.unwrap_or_default();
                let displays_info = if let Some(count) = response.displays_available {
                    if count > 1 {
                        format!(
                            "\n{} displays available. Use display parameter (0-{}) to capture a different monitor.",
                            count,
                            count - 1
                        )
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                };

                McpToolResult::text(format!(
                    "Screenshot captured and saved to: {}\nYou can now analyze this image. The path is: {}{}",
                    image_path, image_path, displays_info
                ))
            } else {
                let error = response.error.unwrap_or_else(|| "Unknown error".into());
                McpToolResult::error(format!("Screenshot failed: {}", error))
            }
        }
    }
}

/// Try cosmic-screenshot (Linux/Cosmic desktop).
#[cfg(target_os = "linux")]
fn try_cosmic_screenshot(images_dir: &Path) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("cosmic-screenshot")
        .arg("--interactive=false")
        .arg("--modal=false")
        .arg("--notify=false")
        .arg(format!("--save-dir={}", images_dir.display()))
        .output()
        .map_err(|e| format!("cosmic-screenshot not available: {}", e))?;

    if !output.status.success() {
        return Err("cosmic-screenshot failed".into());
    }

    let result_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if result_path.is_empty() || !Path::new(&result_path).exists() {
        return Err("cosmic-screenshot returned no file path".into());
    }

    Ok(result_path)
}

/// Get current time as ISO-8601 string (no chrono dependency, use manual formatting).
fn chrono_now_iso() -> String {
    // Use SystemTime for a simple ISO timestamp
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    // Simple Unix timestamp-based approach; exact ISO formatting would need chrono
    // For now, use a Unix millis approach that the JS side can parse
    format!("{}ms", now.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_mcp_data_dir_contains_voice_mirror() {
        let dir = get_mcp_data_dir();
        let path_str = dir.to_string_lossy();
        assert!(
            path_str.contains("voice-mirror-electron"),
            "MCP data dir should contain 'voice-mirror-electron', got: {}",
            path_str
        );
    }

    #[test]
    fn test_try_read_json_missing_file() {
        let result = try_read_json(Path::new("/nonexistent/file.json"));
        assert!(result.is_none());
    }

    #[test]
    fn test_chrono_now_iso_not_empty() {
        let ts = chrono_now_iso();
        assert!(!ts.is_empty());
    }
}
