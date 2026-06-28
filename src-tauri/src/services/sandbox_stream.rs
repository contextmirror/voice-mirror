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
            // Never list Voice Mirror's own windows as app targets.
            .filter(|w| !crate::services::sandbox::is_host_window(w.hwnd, &w.title))
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

/// Screenshot the app window for the AI — focus/occlusion/visibility-independent.
///
/// TWO PATHS, chosen automatically so the agent ALWAYS gets a frame:
///   1. WGC (`window_stream::latest_frame`): the same live frame the preview
///      shows. Reliable for TRANSPARENT windows (pill/overlay) that CDP captures
///      as black, and it's what's on screen. Used whenever a frame exists.
///   2. CDP (`services::sandbox::screenshot`, `Page.captureScreenshot`): a
///      fallback for when there is NO WGC frame — e.g. an OPAQUE window that is
///      hidden, occluded, or simply not presenting at idle (a Tauri app at idle
///      has no visible opaque window for WGC to paint). This works even when the
///      window is off-screen/occluded, but CDP renders TRANSPARENT windows BLACK,
///      so it's only meaningful for OPAQUE content. It captures the SAME active
///      target snapshot/click drive (`action_target` → the stored snapshot ws).
///
/// UNIFIED ACTIVE WINDOW: both paths target the same window snapshot/click is
/// driving (`active_hwnd` for WGC, the stored CDP target for the fallback), never
/// "the frontmost OS window". If the live stream is lagging on a different window
/// (e.g. the preview poll hasn't caught up after a snapshot re-pointed the active
/// window), we re-target the WGC stream to the active window HERE and wait for its
/// first frame, so the screenshot can never diverge from snapshot/click. The
/// resolved url/title/label/index and the `source` ("wgc"|"cdp") are echoed so a
/// wrong-window attach (or an all-black transparent CDP capture) is instantly
/// visible.
pub async fn capture_app_window(port: u16) -> Result<Value, String> {
    if let Some(target) = crate::services::sandbox::active_hwnd() {
        if crate::services::sandbox::is_window_alive(target)
            && crate::services::window_stream::current_hwnd() != Some(target)
        {
            // Re-point the single global WGC stream onto the active window. It
            // re-acquires the same MJPEG port after stopping, so the live preview
            // <img> keeps working; the preview store's next poll re-syncs anyway.
            crate::services::window_stream::start(target, 30)?;
            // Wait for the re-pointed window's first frame (≤3s).
            for _ in 0..60 {
                if crate::services::window_stream::latest_frame().is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
    let meta = crate::services::sandbox::active_meta();

    // PATH 1 — live WGC frame (transparent-safe + what's on screen).
    if let Some(jpeg) = crate::services::window_stream::latest_frame() {
        let b64 = crate::voice::tts::crypto::base64_encode(&jpeg);
        return Ok(serde_json::json!({
            "base64": b64,
            "contentType": "image/jpeg",
            "source": "wgc",
            "activeWindow": meta.title,
            "activeLabel": meta.label,
            "activeUrl": meta.url,
            "activeIndex": meta.index,
            "activeWidth": meta.width,
            "activeHeight": meta.height,
        }));
    }

    // PATH 2 — no WGC frame: fall back to CDP of the SAME active target. This
    // makes the screenshot work for OPAQUE windows that are hidden/occluded or
    // not presenting (the common idle case for a Tauri app with no visible opaque
    // window). CDP renders TRANSPARENT windows black, so we flag that in `note`.
    match crate::services::sandbox::screenshot(port).await {
        Ok(shot) => {
            let b64 = shot
                .get("base64")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            info!(
                "[sandbox_stream] no WGC frame; used CDP fallback for label='{}' index={} url='{}'",
                meta.label, meta.index, meta.url
            );
            Ok(serde_json::json!({
                "base64": b64,
                "contentType": "image/jpeg",
                "source": "cdp",
                "note": "Captured via CDP fallback (no live WGC frame — window hidden/occluded \
                         or not presenting). CDP renders TRANSPARENT windows (the pill/overlay) \
                         BLACK; this path is reliable only for OPAQUE windows.",
                "activeWindow": meta.title,
                "activeLabel": meta.label,
                "activeUrl": meta.url,
                "activeIndex": meta.index,
                "activeWidth": meta.width,
                "activeHeight": meta.height,
            }))
        }
        Err(e) => Err(format!(
            "No live app frame yet, and the CDP screenshot fallback failed: {}. \
             Open the App Preview (it auto-opens for Tauri apps) so the window is captured, \
             or make sure the app's CDP debug port is reachable.",
            e
        )),
    }
}

/// Find the OS window for the app on `cdp_port`. Prefers the RESOLVED sandbox
/// target — the window the last snapshot acted on (`active_hwnd`) — so the
/// preview mirrors exactly what Claude drives. Falls back to matching the CDP
/// page title against the visible window list. NEVER returns Voice Mirror's own
/// window. Retries briefly — the window may still be appearing right after launch.
async fn find_app_hwnd(cdp_port: u16) -> Option<i64> {
    for attempt in 0..20 {
        // 1. Prefer the window the snapshot resolved to (unless it's the host).
        if let Some(h) = crate::services::sandbox::active_hwnd() {
            // …but only if it's still a LIVE window. If Claude's last active
            // window has since CLOSED (e.g. a Settings panel), its HWND is stale
            // — clear it and fall through so we re-target a real window instead
            // of capturing a dead one (which froze the preview on Settings).
            if !crate::services::sandbox::is_window_alive(h) {
                crate::services::sandbox::set_active_hwnd(None);
            } else if !window_is_host(h) {
                return Some(h);
            }
        }
        // 2. Fall back to matching the CDP page title, skipping host windows.
        if let Some(title) = cdp_page_title(cdp_port).await {
            match crate::commands::screenshot::list_visible_windows_metadata() {
                Ok(windows) => {
                    let t = title.trim().to_lowercase();
                    let matches: Vec<&_> = windows
                        .iter()
                        .filter(|w| {
                            let wt = w.title.trim().to_lowercase();
                            !wt.is_empty()
                                && (wt == t || wt.contains(&t) || t.contains(&wt))
                                && !crate::services::sandbox::is_host_window(w.hwnd, &w.title)
                        })
                        .collect();
                    if !matches.is_empty() {
                        // When several windows share the title (e.g. all "Yap"),
                        // prefer the FOREGROUND one — what the user is looking at —
                        // so the very first preview mirrors what's on screen rather
                        // than an arbitrary same-titled window. snapshot then keys
                        // off this preview window, keeping them aligned.
                        let fg = crate::services::sandbox::foreground_hwnd();
                        if let Some(w) = matches.iter().find(|w| Some(w.hwnd) == fg) {
                            return Some(w.hwnd);
                        }
                        return Some(matches[0].hwnd);
                    }
                    if attempt == 0 || attempt == 5 {
                        let titles: Vec<&str> = windows.iter().map(|w| w.title.as_str()).collect();
                        warn!(
                            "[sandbox_stream] app window titled '{}' not found (excluding host) among: {:?}",
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

/// True if an HWND is Voice Mirror's own window (looks up its title for the check).
fn window_is_host(hwnd: i64) -> bool {
    if crate::services::sandbox::host_hwnd() == Some(hwnd) {
        return true;
    }
    match crate::commands::screenshot::list_visible_windows_metadata() {
        Ok(windows) => windows
            .iter()
            .find(|w| w.hwnd == hwnd)
            .map(|w| crate::services::sandbox::is_host_window(w.hwnd, &w.title))
            .unwrap_or(false),
        Err(_) => false,
    }
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
