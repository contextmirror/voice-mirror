//! Sandbox live preview — mirror the real app WINDOW and serve it as MJPEG.
//!
//! Tauri pill apps are TRANSPARENT, borderless windows (`transparent: true`).
//! CDP `Page.startScreencast` renders such a window as a solid black box — JPEG
//! has no alpha and the transparent WebView2 GPU surface composites to black.
//!
//! So we don't screencast the page; we capture the actual on-screen WINDOW via
//! Windows.Graphics.Capture (the same `window_stream` the window-picker uses),
//! which mirrors exactly what the user sees — transparency, borderless chrome
//! and all. We identify the app window by its CDP page title (the same title
//! Tauri sets on the OS window) matched against the visible window list.
//!
//! CDP is still used for the AI's structured tools (snapshot/click/type); this
//! module is only the human-facing live picture.

use std::time::Duration;

use serde_json::Value;
use tracing::{info, warn};

/// Start mirroring the app on CDP `cdp_port`. Returns the local MJPEG port to
/// point an `<img src="http://127.0.0.1:{port}/stream">` at.
pub async fn start(cdp_port: u16) -> Result<u16, String> {
    let hwnd = find_app_hwnd(cdp_port)
        .await
        .ok_or_else(|| "Could not find the app window to capture (is it open?)".to_string())?;
    let port = crate::services::window_stream::start(hwnd, 30)?;
    info!(
        "[sandbox_stream] mirroring app window hwnd={} (CDP :{}) -> MJPEG :{}",
        hwnd, cdp_port, port
    );
    Ok(port)
}

/// Stop mirroring (stops the underlying window stream).
pub fn stop(_cdp_port: u16) {
    let _ = crate::services::window_stream::stop();
}

/// Find the OS window for the app on `cdp_port`, by matching its CDP page title
/// against the visible window list. Retries briefly — the window may still be
/// appearing right after launch.
async fn find_app_hwnd(cdp_port: u16) -> Option<i64> {
    for attempt in 0..20 {
        if let Some(title) = cdp_page_title(cdp_port).await {
            match crate::commands::screenshot::list_visible_windows_metadata() {
                Ok(windows) => {
                    let t = title.trim().to_lowercase();
                    if let Some(w) = windows.iter().find(|w| {
                        let wt = w.title.trim().to_lowercase();
                        !wt.is_empty() && (wt == t || wt.contains(&t) || t.contains(&wt))
                    }) {
                        return Some(w.hwnd);
                    }
                    if attempt == 0 || attempt == 5 {
                        let titles: Vec<&str> = windows.iter().map(|w| w.title.as_str()).collect();
                        warn!(
                            "[sandbox_stream] app window titled '{}' not found among: {:?}",
                            title, titles
                        );
                    }
                }
                Err(e) => warn!("[sandbox_stream] window enumeration failed: {}", e),
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    None
}

/// Fetch the app's page title from its CDP `/json` endpoint (Tauri sets the same
/// title on the OS window, so we can match it in the window list).
async fn cdp_page_title(port: u16) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    // WebView2's CDP server can bind IPv4 or IPv6 inconsistently — try both.
    for host in ["127.0.0.1", "[::1]"] {
        let url = format!("http://{}:{}/json", host, port);
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(arr) = resp.json::<Vec<Value>>().await {
                for tgt in arr {
                    if tgt.get("type").and_then(|v| v.as_str()) == Some("page") {
                        if let Some(title) = tgt.get("title").and_then(|v| v.as_str()) {
                            let title = title.trim();
                            if !title.is_empty() {
                                return Some(title.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    None
}
