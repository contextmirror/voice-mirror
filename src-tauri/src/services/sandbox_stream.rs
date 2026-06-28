//! Sandbox live preview — mirror the active app WINDOW and serve it as MJPEG.
//!
//! TWO frame sources feed the SAME MJPEG endpoint (`window_stream`'s FRAME_BUFFER
//! + `/stream` server), chosen automatically so the preview NEVER errors when the
//! app has a reachable CDP target:
//!
//!   1. WGC (`window_stream`, Windows.Graphics.Capture) — the DEFAULT. It mirrors
//!      the actual on-screen window, TRANSPARENCY included, so it's the only source
//!      that works for the transparent pill/overlay (CDP renders those BLACK). Used
//!      whenever the active window is a live, capturable OS window that produces
//!      frames.
//!   2. CDP `Page.startScreencast` (this module's `start_cdp_screencast`) — the
//!      FALLBACK. The Windows compositor only presents a visible window, so a Tauri
//!      app at idle (pill transparent+hidden, settings/onboarding/overlay
//!      `visible:false`) has NO opaque window for WGC to capture → WGC finds nothing
//!      / no frames. CDP screencast produces frames from the compositor REGARDLESS of
//!      window visibility/occlusion, so it shows the active OPAQUE target live even
//!      when it has no visible window. (It renders TRANSPARENT windows black, which is
//!      exactly why transparent chrome stays on WGC.)
//!
//! A dedicated tokio task owns the CDP screencast WebSocket so it can BOTH receive
//! `Page.screencastFrame` events AND reply with `Page.screencastFrameAck` (omitting
//! the ack stops frames) — the one thing the request/reply `Cdp::call` cannot do.
//! Its frames go straight into `window_stream`'s shared FRAME_BUFFER via
//! `publish_external_frame`, guarded by the same generation discipline as WGC so the
//! two sources never write at once. CDP is also used for the AI's structured tools
//! (snapshot/click/type).

use std::sync::atomic::Ordering;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

/// One of the app's visible windows (pill, settings, a dialog, …).
#[derive(serde::Serialize)]
pub struct AppWindow {
    pub hwnd: i64,
    pub title: String,
}

/// Start the live preview for the app on CDP `cdp_port`. Returns
/// `(mjpeg_port, hwnd)` — point an `<img src="http://127.0.0.1:{port}/stream">` at
/// it. `hwnd` is the captured OS window for the WGC source, or `None` for the CDP
/// screencast fallback (which has no single OS window).
///
/// SOURCE SELECTION:
///   * An explicit `hwnd` (the frontend switcher picked a real window) → WGC of
///     that window — transparent-safe, exactly what the user chose.
///   * Otherwise (auto) → prefer WGC of the resolved app window IF it produces a
///     frame (covers the transparent pill/overlay). If no capturable window is
///     found, OR a window was found but it never presents a frame (an opaque
///     window that's hidden/occluded/idle), fall back to a CDP screencast of the
///     active CDP target — so the preview shows the active OPAQUE window live
///     instead of erroring with "Failed to start the live preview".
pub async fn start(cdp_port: u16, hwnd: Option<i64>) -> Result<(u16, Option<i64>), String> {
    // Explicit window from the switcher → always WGC (the user picked it).
    if let Some(h) = hwnd {
        let port = crate::services::window_stream::start(h, 30)?;
        info!(
            "[sandbox_stream] mirroring app window hwnd={} via WGC (CDP :{}) -> MJPEG :{}",
            h, cdp_port, port
        );
        return Ok((port, Some(h)));
    }

    // Auto: try WGC of the resolved app window first (transparent-safe).
    if let Some(h) = find_app_hwnd(cdp_port).await {
        let port = crate::services::window_stream::start(h, 30)?;
        // Wait briefly for the FIRST frame. A visible window (the pill) presents
        // promptly (the present-nudge fires at ~400ms); an opaque window that's
        // occluded/not-presenting yields nothing — then we fall back to CDP.
        let got_frame = wait_for_wgc_frame(Duration::from_millis(1500)).await;
        if got_frame {
            info!(
                "[sandbox_stream] mirroring app window hwnd={} via WGC (CDP :{}) -> MJPEG :{}",
                h, cdp_port, port
            );
            return Ok((port, Some(h)));
        }
        info!(
            "[sandbox_stream] WGC window hwnd={} produced no frame — falling back to CDP screencast",
            h
        );
        // Fall through to the CDP screencast (it will supersede the WGC capture).
    } else {
        info!(
            "[sandbox_stream] no capturable WGC window on CDP :{} — using CDP screencast fallback",
            cdp_port
        );
    }

    // CDP screencast fallback of the active target (opaque windows only — CDP
    // renders transparent windows black, but those are handled by WGC above).
    let port = start_cdp_screencast(cdp_port).await?;
    Ok((port, None))
}

/// Poll the WGC frame buffer until a frame appears or `budget` elapses. Returns
/// true if a frame arrived (the window is presenting and WGC works for it).
async fn wait_for_wgc_frame(budget: Duration) -> bool {
    let deadline = std::time::Instant::now() + budget;
    loop {
        if crate::services::window_stream::latest_frame().is_some() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Start a CDP `Page.startScreencast` of the active target on `cdp_port`, feeding
/// frames into `window_stream`'s shared FRAME_BUFFER / MJPEG server. Returns the
/// (stable, port-preserving) MJPEG port. A dedicated tokio task owns the CDP
/// WebSocket so it can receive `screencastFrame` events and send
/// `screencastFrameAck`; it self-terminates when the stream generation is
/// superseded (a later WGC start / another screencast / `stop`) or the socket
/// closes — so it never leaks.
async fn start_cdp_screencast(cdp_port: u16) -> Result<u16, String> {
    // The active CDP target: the window the last snapshot drove, else the first
    // page target. This is the OPAQUE window we want to show live.
    let ws_url = crate::services::sandbox::active_target_ws(cdp_port).await?;

    let (mut ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("CDP screencast connect failed: {}", e))?;

    // Enable the page domain and start the screencast BEFORE we claim the stream
    // (so a failure here doesn't leave the buffer cleared with no producer).
    let mut id: u64 = 1;
    ws_send(&mut ws, id, "Page.enable", json!({})).await?;
    id += 1;
    ws_send(
        &mut ws,
        id,
        "Page.startScreencast",
        json!({
            "format": "jpeg",
            "quality": 70,
            "maxWidth": 1600,
            "maxHeight": 1200,
            "everyNthFrame": 1
        }),
    )
    .await?;
    id += 1;

    // Claim the stream as an external source: stops any WGC capture, reuses the
    // MJPEG server + port, and hands us this source's generation + stop flag.
    let title = crate::services::sandbox::active_meta().title;
    let title = if title.trim().is_empty() {
        "App (CDP screencast)".to_string()
    } else {
        title
    };
    let (mjpeg_port, generation, stop_flag) =
        crate::services::window_stream::start_external(title, 30)?;

    // Read-loop task: owns the WS, publishes frames into the shared buffer, acks
    // each one, and stops cleanly when superseded or the socket closes.
    tokio::spawn(async move {
        let mut ack_id = id;
        loop {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }
            // Short timeout so a STATIC opaque page (no new compositor frames)
            // still notices the stop flag promptly instead of blocking ~30s.
            match tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
                Ok(Some(Ok(Message::Text(txt)))) => {
                    let v: Value = match serde_json::from_str(txt.as_str()) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if v.get("method").and_then(|m| m.as_str()) == Some("Page.screencastFrame") {
                        let params = v.get("params");
                        let data = params
                            .and_then(|p| p.get("data"))
                            .and_then(|d| d.as_str())
                            .unwrap_or("");
                        let session_id = params
                            .and_then(|p| p.get("sessionId"))
                            .cloned()
                            .unwrap_or_else(|| Value::from(0));
                        if let Ok(bytes) = crate::voice::tts::crypto::base64_decode(data) {
                            if !bytes.is_empty() {
                                // Generation guard: if a newer source has taken
                                // over, stop — never clobber its frames.
                                if !crate::services::window_stream::publish_external_frame(
                                    generation, bytes,
                                ) {
                                    break;
                                }
                            }
                        }
                        // Ack — without this, Chromium stops sending frames.
                        let _ = ws_send(
                            &mut ws,
                            ack_id,
                            "Page.screencastFrameAck",
                            json!({ "sessionId": session_id }),
                        )
                        .await;
                        ack_id += 1;
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) => break,
                Ok(Some(Ok(_))) => {}      // ping/binary/etc — ignore
                Ok(Some(Err(_))) => break, // socket error
                Err(_) => {}               // read timeout — loop, re-check stop
            }
        }
        // Best-effort stop so a re-targeted/closed app frees the screencast.
        let _ = ws_send(&mut ws, ack_id, "Page.stopScreencast", json!({})).await;
        info!(
            "[sandbox_stream] CDP screencast (gen {}) on :{} ended",
            generation, cdp_port
        );
    });

    info!(
        "[sandbox_stream] CDP screencast started: CDP :{} -> MJPEG :{} (gen {})",
        cdp_port, mjpeg_port, generation
    );
    Ok(mjpeg_port)
}

/// Send a CDP command over the screencast WebSocket as a JSON text frame.
async fn ws_send<S>(ws: &mut S, id: u64, method: &str, params: Value) -> Result<(), String>
where
    S: SinkExt<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    let msg = json!({ "id": id, "method": method, "params": params }).to_string();
    ws.send(Message::Text(msg.into())).await.map_err(|e| {
        let m = format!("CDP screencast send {} failed: {}", method, e);
        warn!("[sandbox_stream] {}", m);
        m
    })
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
    // When the live preview is CDP-backed (external source — an opaque window WGC
    // can't capture), don't try to re-point a WGC window or reuse the screencast
    // frame: take a fresh CDP screenshot of the active target below (PATH 2), which
    // is always the current resolved window. Re-pointing WGC here would also tear
    // down the live CDP screencast the user is watching.
    let external = crate::services::window_stream::is_external();
    if !external {
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
    }
    let meta = crate::services::sandbox::active_meta();

    // PATH 1 — live WGC frame (transparent-safe + what's on screen). Skipped for a
    // CDP-backed preview so the screenshot reflects the CURRENT active target via a
    // fresh CDP capture rather than the screencast's possibly-older frame.
    if !external {
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
    }

    // PATH 2 — no WGC frame (or a CDP-backed preview): fall back to CDP of the SAME
    // active target. This
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
