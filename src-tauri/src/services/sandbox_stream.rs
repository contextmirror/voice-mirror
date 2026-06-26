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

/// One of the app's visible windows (pill, settings, a dialog, …).
#[derive(serde::Serialize)]
pub struct AppWindow {
    pub hwnd: i64,
    pub title: String,
}

/// Start mirroring the app on CDP `cdp_port`. If `hwnd` is given, mirror that
/// specific window; otherwise mirror the main window. Returns the local MJPEG
/// port to point an `<img src="http://127.0.0.1:{port}/stream">` at.
pub async fn start(cdp_port: u16, hwnd: Option<i64>) -> Result<(u16, i64), String> {
    let hwnd = match hwnd {
        Some(h) => h,
        None => find_app_hwnd(cdp_port)
            .await
            .ok_or_else(|| "Could not find the app window to capture (is it open?)".to_string())?,
    };
    let port = crate::services::window_stream::start(hwnd, 30)?;
    info!(
        "[sandbox_stream] mirroring app window hwnd={} (CDP :{}) -> MJPEG :{}",
        hwnd, cdp_port, port
    );
    Ok((port, hwnd))
}

/// List the app's visible top-level windows (pill, settings, dialogs), so the
/// preview can offer a switcher and auto-follow newly-opened ones. Identifies
/// the app's process via its main window (matched by CDP page title), then
/// returns every visible window of that process.
pub async fn list_windows(cdp_port: u16) -> Result<Vec<AppWindow>, String> {
    let windows = crate::commands::screenshot::list_visible_windows_metadata()?;
    let main_proc = match cdp_page_title(cdp_port).await {
        Some(title) => {
            let t = title.trim().to_lowercase();
            windows
                .iter()
                .find(|w| {
                    let wt = w.title.trim().to_lowercase();
                    !wt.is_empty() && (wt == t || wt.contains(&t) || t.contains(&wt))
                })
                .map(|w| w.process_name.clone())
        }
        None => None,
    };
    let result = match main_proc {
        Some(proc) if !proc.is_empty() => windows
            .into_iter()
            .filter(|w| w.process_name == proc && !w.title.trim().is_empty())
            .map(|w| AppWindow {
                hwnd: w.hwnd,
                title: w.title,
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(result)
}

/// Stop mirroring (stops the underlying window stream).
pub fn stop(_cdp_port: u16) {
    let _ = crate::services::window_stream::stop();
}

/// Screenshot the app window for the AI — the same WGC frame the live preview
/// shows. Reliable for transparent windows (which CDP captures as black).
/// Requires the live preview to be streaming (it auto-opens for Tauri apps).
pub fn capture_app_window() -> Result<Value, String> {
    let jpeg = crate::services::window_stream::latest_frame().ok_or_else(|| {
        "No live app frame yet — open the App Preview (it auto-opens for Tauri apps) so the window is being captured.".to_string()
    })?;
    let b64 = crate::voice::tts::crypto::base64_encode(&jpeg);
    Ok(serde_json::json!({ "base64": b64, "contentType": "image/jpeg" }))
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
