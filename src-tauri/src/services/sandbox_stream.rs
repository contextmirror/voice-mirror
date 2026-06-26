//! Sandbox screencast — a live CDP screencast of an app being built.
//!
//! A dedicated tokio task owns the CDP WebSocket so it can BOTH receive
//! `Page.screencastFrame` events AND reply with `Page.screencastFrameAck`
//! (omitting the ack stops frames). This is the one thing the request/reply
//! `Cdp::call` in [`crate::services::sandbox`] cannot do, so we open our own
//! connection here.
//!
//! Decoded JPEG frames are pushed into a lock-free buffer and served as MJPEG by
//! the same server the window stream uses, so the preview panel is just an
//! `<img src="http://127.0.0.1:{mjpegPort}/stream">`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use arc_swap::ArcSwap;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

use crate::services::sandbox::discover_page_target;
use crate::services::window_stream::{find_available_port, run_mjpeg_server};

/// A live screencast session, keyed by the app's CDP port.
struct Session {
    stop_flag: Arc<AtomicBool>,
    mjpeg_port: u16,
}

static SESSIONS: OnceLock<Mutex<HashMap<u16, Session>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<u16, Session>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Start (or reuse) a live screencast of the app on CDP `cdp_port`.
/// Returns the local MJPEG port to point an `<img src=".../stream">` at.
pub async fn start(cdp_port: u16) -> Result<u16, String> {
    // Reuse an existing session for this port (idempotent).
    if let Some(port) = sessions()
        .lock()
        .ok()
        .and_then(|g| g.get(&cdp_port).map(|s| s.mjpeg_port))
    {
        return Ok(port);
    }

    // Discover the page target, retrying — the app may not be listening yet.
    let ws_url = {
        let mut last_err = String::from("no attempt");
        let mut found = None;
        for _ in 0..10 {
            match discover_page_target(cdp_port).await {
                Ok((url, _)) => {
                    found = Some(url);
                    break;
                }
                Err(e) => {
                    last_err = e;
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
        found.ok_or_else(|| {
            format!("Sandbox app not reachable on CDP port {}: {}", cdp_port, last_err)
        })?
    };

    let (mut ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("CDP screencast connect failed: {}", e))?;

    // Enable the page domain and start the screencast.
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

    // Frame buffer + MJPEG server (reused from window_stream).
    let buffer: Arc<ArcSwap<Vec<u8>>> = Arc::new(ArcSwap::from_pointee(Vec::new()));
    let stop_flag = Arc::new(AtomicBool::new(false));
    let mjpeg_port = find_available_port()?;
    {
        let s = stop_flag.clone();
        let b = buffer.clone();
        std::thread::Builder::new()
            .name("sandbox-mjpeg".into())
            .spawn(move || run_mjpeg_server(mjpeg_port, s, b))
            .map_err(|e| format!("Failed to spawn MJPEG server: {}", e))?;
    }

    // Read-loop task: owns the WS, stores frames, acks each one.
    let read_stop = stop_flag.clone();
    let read_buffer = buffer.clone();
    tokio::spawn(async move {
        let mut ack_id = id;
        loop {
            if read_stop.load(Ordering::SeqCst) {
                break;
            }
            match tokio::time::timeout(Duration::from_secs(30), ws.next()).await {
                Ok(Some(Ok(Message::Text(txt)))) => {
                    let v: Value = match serde_json::from_str(&txt) {
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
                                read_buffer.store(Arc::new(bytes));
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
                Ok(Some(Ok(_))) => {}            // ping/binary/etc — ignore
                Ok(Some(Err(_))) => break,       // socket error
                Err(_) => {}                     // read timeout — loop, re-check stop
            }
        }
        // Best-effort stop + registry cleanup so a closed app frees the slot.
        let _ = ws_send(&mut ws, ack_id, "Page.stopScreencast", json!({})).await;
        read_stop.store(true, Ordering::SeqCst);
        if let Ok(mut g) = sessions().lock() {
            g.remove(&cdp_port);
        }
        info!("[sandbox_stream] screencast for CDP :{} ended", cdp_port);
    });

    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(cdp_port, Session { stop_flag, mjpeg_port });
    info!(
        "[sandbox_stream] screencast started: CDP :{} -> MJPEG :{}",
        cdp_port, mjpeg_port
    );
    Ok(mjpeg_port)
}

/// Stop the screencast for `cdp_port` (no-op if none is running).
pub fn stop(cdp_port: u16) {
    if let Ok(mut g) = sessions().lock() {
        if let Some(s) = g.remove(&cdp_port) {
            s.stop_flag.store(true, Ordering::SeqCst);
            info!("[sandbox_stream] screencast for CDP :{} stopped", cdp_port);
        }
    }
}

/// Send a CDP command over the WebSocket as a JSON text frame.
async fn ws_send<S>(ws: &mut S, id: u64, method: &str, params: Value) -> Result<(), String>
where
    S: SinkExt<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    let msg = json!({ "id": id, "method": method, "params": params }).to_string();
    ws.send(Message::Text(msg)).await.map_err(|e| {
        let m = format!("CDP send {} failed: {}", method, e);
        warn!("[sandbox_stream] {}", m);
        m
    })
}
