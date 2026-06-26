//! Sandbox mode — drive an external app's WebView2 over CDP (WebSocket).
//!
//! The Lens browser is driven via the WebView2 COM `CallDevToolsProtocolMethod`
//! (same process). An app *being built* (e.g. a Tauri app) runs in its OWN
//! process, launched with `--remote-debugging-port=N`, so we reach it the
//! standard way: over a CDP WebSocket to its page target. The AX-tree parser in
//! [`crate::services::cdp`] is transport-agnostic, so the AI sees the app's UI
//! through the same `@ref` element model it uses for websites, and the driving
//! recipes (click/type) mirror `services::browser_bridge`.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream,
};

use crate::services::cdp::{parse_ax_tree, RefEntry};

// ── Ref store ───────────────────────────────────────────────────────────────
// The last snapshot's `@ref` → element map, keyed by CDP port, so a follow-up
// click/type can resolve a ref to its backend DOM node id.

static REF_STORE: OnceLock<Mutex<HashMap<u16, HashMap<String, RefEntry>>>> = OnceLock::new();

fn ref_store() -> &'static Mutex<HashMap<u16, HashMap<String, RefEntry>>> {
    REF_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn store_refs(port: u16, refs: HashMap<String, RefEntry>) {
    if let Ok(mut g) = ref_store().lock() {
        g.insert(port, refs);
    }
}

/// Resolve a ref string (`@e7`, `e7`, …) to a backend DOM node id from the last
/// snapshot on `port`.
fn lookup_backend(port: u16, ref_str: &str) -> Result<u32, String> {
    let g = ref_store().lock().map_err(|e| e.to_string())?;
    let refs = g
        .get(&port)
        .ok_or("No snapshot for this port yet — call sandbox_snapshot first")?;
    let stripped = ref_str.trim_start_matches('@');
    let entry = refs
        .get(ref_str)
        .or_else(|| refs.get(stripped))
        .or_else(|| refs.get(&format!("@{}", stripped)))
        .ok_or_else(|| format!("Unknown ref '{}' (snapshot may be stale)", ref_str))?;
    entry
        .backend_node_id
        .ok_or_else(|| format!("Ref '{}' has no backend node id", ref_str))
}

// ── Active sandbox CDP port registry ─────────────────────────────────────────
// The dev-server-manager records here the CDP remote-debugging port of the Tauri
// app it launched, so the sandbox MCP tools can default to it when the AI omits
// an explicit `port`. v1 tracks a single active sandbox app; a project-keyed
// registry is the later generalization.

static ACTIVE_CDP_PORT: OnceLock<Mutex<Option<u16>>> = OnceLock::new();

fn active_port_cell() -> &'static Mutex<Option<u16>> {
    ACTIVE_CDP_PORT.get_or_init(|| Mutex::new(None))
}

/// Record (or clear) the active sandbox app's CDP port.
pub fn set_active_cdp_port(port: Option<u16>) {
    if let Ok(mut g) = active_port_cell().lock() {
        *g = port;
    }
}

/// The active sandbox app's CDP port, if one is registered.
pub fn active_cdp_port() -> Option<u16> {
    active_port_cell().lock().ok().and_then(|g| *g)
}

// ── CDP discovery + session ──────────────────────────────────────────────────

/// Fetch the debuggable `page` targets from a CDP port's `/json` endpoint.
async fn fetch_page_targets(port: u16) -> Result<Vec<Value>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    // WebView2's CDP server can bind IPv4 or IPv6 inconsistently — try both.
    let mut last_err = String::new();
    for host in ["127.0.0.1", "[::1]"] {
        let list_url = format!("http://{}:{}/json", host, port);
        match client.get(&list_url).send().await {
            Ok(resp) => match resp.json::<Vec<Value>>().await {
                Ok(targets) => {
                    let pages: Vec<Value> = targets
                        .into_iter()
                        .filter(|t| t.get("type").and_then(|v| v.as_str()) == Some("page"))
                        .collect();
                    return Ok(pages);
                }
                Err(e) => last_err = format!("CDP /json parse failed: {}", e),
            },
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!(
        "CDP port {} not reachable (is the app running with --remote-debugging-port={}?): {}",
        port, port, last_err
    ))
}

/// Discover a page target on a CDP port. With `title`, match the window whose
/// title contains/equals it (so the AI can target e.g. "Yap Settings"); without,
/// return the first page target. Returns `(webSocketDebuggerUrl, page_url)`.
pub(crate) async fn discover_page_target(
    port: u16,
    title: Option<&str>,
) -> Result<(String, String), String> {
    let targets = fetch_page_targets(port).await?;
    let want = title.map(|t| t.trim().to_lowercase());
    let mut first: Option<(String, String)> = None;
    for t in &targets {
        let ws = match t.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
            Some(w) => w.to_string(),
            None => continue,
        };
        let url = t.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if let Some(w) = &want {
            let ttl = t
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            if !ttl.is_empty() && (ttl == *w || ttl.contains(w) || w.contains(&ttl)) {
                return Ok((ws, url));
            }
        }
        if first.is_none() {
            first = Some((ws, url));
        }
    }
    if let Some(w) = title {
        return Err(format!(
            "No app window matching '{}'. Call sandbox_snapshot without `window` to see the available windows.",
            w
        ));
    }
    first.ok_or_else(|| "no debuggable page target found".to_string())
}

/// Titles of the app's debuggable windows (for the AI to target by name).
pub(crate) async fn list_window_titles(port: u16) -> Vec<String> {
    match fetch_page_targets(port).await {
        Ok(targets) => targets
            .iter()
            .filter_map(|t| t.get("title").and_then(|v| v.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

// ── Last-snapshot target per port ────────────────────────────────────────────
// snapshot() records which window's CDP target it used, so a follow-up
// click/type acts on the SAME window (the refs' backend node ids are only valid
// for that target). No window arg needed on click/type — they follow snapshot.

static TARGET_STORE: OnceLock<Mutex<HashMap<u16, String>>> = OnceLock::new();

fn target_store() -> &'static Mutex<HashMap<u16, String>> {
    TARGET_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn set_target(port: u16, ws_url: &str) {
    if let Ok(mut g) = target_store().lock() {
        g.insert(port, ws_url.to_string());
    }
}

fn get_target(port: u16) -> Option<String> {
    target_store().lock().ok().and_then(|g| g.get(&port).cloned())
}

/// Resolve the CDP target for a follow-up action: the window the last snapshot
/// used, falling back to the first page target.
async fn action_target(port: u16) -> Result<String, String> {
    match get_target(port) {
        Some(ws) => Ok(ws),
        None => Ok(discover_page_target(port, None).await?.0),
    }
}

/// A minimal CDP session over a single WebSocket. Commands are sequential:
/// send an id-tagged request, then read frames (skipping events) until the
/// matching reply. Sufficient for one-page driving recipes.
struct Cdp {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Cdp {
    async fn connect(ws_url: &str) -> Result<Self, String> {
        let (ws, _) = connect_async(ws_url)
            .await
            .map_err(|e| format!("CDP WebSocket connect failed: {}", e))?;
        Ok(Self { ws, next_id: 1 })
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let req = json!({ "id": id, "method": method, "params": params });
        self.ws
            .send(Message::Text(req.to_string().into()))
            .await
            .map_err(|e| format!("CDP send failed: {}", e))?;

        loop {
            let frame = tokio::time::timeout(Duration::from_secs(15), self.ws.next())
                .await
                .map_err(|_| format!("CDP call '{}' timed out", method))?;
            let Some(frame) = frame else {
                return Err("CDP socket closed before responding".to_string());
            };
            let frame = frame.map_err(|e| format!("CDP recv failed: {}", e))?;
            if let Message::Text(txt) = frame {
                let v: Value = serde_json::from_str(txt.as_str())
                    .map_err(|e| format!("CDP json parse failed: {}", e))?;
                if v.get("id").and_then(|x| x.as_u64()) == Some(id) {
                    if let Some(err) = v.get("error") {
                        return Err(format!("CDP error on '{}': {}", method, err));
                    }
                    return Ok(v.get("result").cloned().unwrap_or(Value::Null));
                }
                // else: an event with no/other id — skip and keep reading.
            }
        }
    }
}

// ── Public driving API ───────────────────────────────────────────────────────

/// Snapshot the external app's UI: its accessibility tree rendered to the same
/// `@ref` element model the AI uses for the Lens browser. Stores the ref map so
/// a follow-up `click`/`type` can resolve refs.
pub async fn snapshot(port: u16, window: Option<&str>) -> Result<Value, String> {
    let (ws_url, page_url) = discover_page_target(port, window).await?;
    // Remember this target so click/type act on the same window.
    set_target(port, &ws_url);
    let mut cdp = Cdp::connect(&ws_url).await?;
    let _ = cdp.call("DOM.enable", json!({})).await;
    // CRITICAL: Accessibility.getFullAXTree returns an EMPTY tree unless the
    // Accessibility domain is enabled first — WebView2 keeps accessibility off
    // until something turns it on (no screen reader running). Enabling it makes
    // Chromium compute the AX tree so the elements actually show up.
    let _ = cdp.call("Accessibility.enable", json!({})).await;

    let mut ax = cdp.call("Accessibility.getFullAXTree", json!({})).await?;
    let (mut tree, mut refs) = parse_ax_tree(&ax, true);
    // The tree can lag right after enabling — retry once if it came back empty.
    if refs.is_empty() {
        tokio::time::sleep(Duration::from_millis(350)).await;
        ax = cdp.call("Accessibility.getFullAXTree", json!({})).await?;
        let (t, r) = parse_ax_tree(&ax, true);
        tree = t;
        refs = r;
    }
    let ref_count = refs.len();
    store_refs(port, refs);
    let windows = list_window_titles(port).await;
    Ok(json!({ "pageUrl": page_url, "tree": tree, "refCount": ref_count, "windows": windows }))
}

/// Compute the center of the first non-degenerate quad from `DOM.getContentQuads`.
fn quad_center(quads_result: &Value) -> Option<(f64, f64)> {
    let quads = quads_result.get("quads")?.as_array()?;
    for q in quads {
        let pts = q.as_array()?;
        if pts.len() == 8 {
            let n: Vec<f64> = pts.iter().filter_map(|v| v.as_f64()).collect();
            if n.len() == 8 {
                let cx = (n[0] + n[2] + n[4] + n[6]) / 4.0;
                let cy = (n[1] + n[3] + n[5] + n[7]) / 4.0;
                // Reject zero-area quads.
                let w = (n[2] - n[0]).abs() + (n[4] - n[6]).abs();
                let h = (n[5] - n[3]).abs() + (n[7] - n[1]).abs();
                if w > 0.0 && h > 0.0 {
                    return Some((cx, cy));
                }
            }
        }
    }
    None
}

/// Click an element (by `@ref`) in the external app via synthetic mouse events,
/// falling back to `element.click()` when geometry is unavailable.
pub async fn click(port: u16, ref_str: &str) -> Result<Value, String> {
    let backend = lookup_backend(port, ref_str)?;
    let ws_url = action_target(port).await?;
    let mut cdp = Cdp::connect(&ws_url).await?;
    let _ = cdp.call("DOM.enable", json!({})).await;
    let _ = cdp
        .call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": backend }))
        .await;

    let quads = cdp
        .call("DOM.getContentQuads", json!({ "backendNodeId": backend }))
        .await
        .unwrap_or(Value::Null);

    if let Some((x, y)) = quad_center(&quads) {
        cdp.call(
            "Input.dispatchMouseEvent",
            json!({ "type": "mouseMoved", "x": x, "y": y, "buttons": 0 }),
        )
        .await?;
        cdp.call(
            "Input.dispatchMouseEvent",
            json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1 }),
        )
        .await?;
        cdp.call(
            "Input.dispatchMouseEvent",
            json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1 }),
        )
        .await?;
        Ok(json!({ "ok": true, "method": "mouse" }))
    } else {
        // Fallback: resolve to a JS handle and invoke its own click().
        let resolved = cdp
            .call("DOM.resolveNode", json!({ "backendNodeId": backend }))
            .await?;
        let obj_id = resolved
            .get("object")
            .and_then(|o| o.get("objectId"))
            .and_then(|v| v.as_str())
            .ok_or("could not resolve element to a JS handle")?;
        cdp.call(
            "Runtime.callFunctionOn",
            json!({
                "objectId": obj_id,
                "functionDeclaration": "function(){ this.scrollIntoView({block:'center'}); this.click(); }",
                "userGesture": true
            }),
        )
        .await?;
        Ok(json!({ "ok": true, "method": "js" }))
    }
}

/// Type text into an element (by `@ref`) after focusing it.
pub async fn type_text(port: u16, ref_str: &str, text: &str) -> Result<Value, String> {
    let backend = lookup_backend(port, ref_str)?;
    let ws_url = action_target(port).await?;
    let mut cdp = Cdp::connect(&ws_url).await?;
    let _ = cdp.call("DOM.enable", json!({})).await;
    let _ = cdp.call("DOM.focus", json!({ "backendNodeId": backend })).await;
    cdp.call("Input.insertText", json!({ "text": text })).await?;
    Ok(json!({ "ok": true, "length": text.len() }))
}

/// Screenshot the external app's web contents (JPEG) for the AI's eyes.
pub async fn screenshot(port: u16) -> Result<Value, String> {
    let ws_url = action_target(port).await?;
    let mut cdp = Cdp::connect(&ws_url).await?;
    let _ = cdp.call("Page.enable", json!({})).await;
    let r = cdp
        .call(
            "Page.captureScreenshot",
            json!({ "format": "jpeg", "quality": 75, "fromSurface": true }),
        )
        .await?;
    let data = r.get("data").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(json!({ "base64": data, "contentType": "image/jpeg" }))
}
