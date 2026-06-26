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
    let targets = fetch_page_targets(port).await?;
    let want = window.map(|t| t.trim().to_lowercase());

    // Candidate targets to snapshot: the requested window, else all of them.
    let mut candidates: Vec<(String, String)> = Vec::new(); // (ws_url, page_url)
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
                candidates.push((ws, url));
            }
        } else {
            candidates.push((ws, url));
        }
    }
    if candidates.is_empty() {
        return Err(match window {
            Some(w) => format!(
                "No app window matching '{}'. Call sandbox_snapshot without `window` to see the windows.",
                w
            ),
            None => "no debuggable page target found".to_string(),
        });
    }

    // Snapshot candidates. With an explicit window, just that one. Otherwise pick
    // the window that (a) has interactive elements and (b) best matches the OS
    // window the live preview is mirroring — so Claude drives the SAME visible
    // window the user is watching, not a hidden one.
    let preview_aspect = if want.is_none() {
        preview_window_aspect()
    } else {
        None
    };
    let mut chosen_ws = candidates[0].0.clone();
    let mut page_url = candidates[0].1.clone();
    let mut tree = String::new();
    let mut refs: HashMap<String, RefEntry> = HashMap::new();
    let mut have_fallback = false;
    let mut best_diff = f64::MAX;
    for (ws, url) in &candidates {
        let (t, r, aspect) = snapshot_target(ws).await.unwrap_or_default();
        if want.is_some() {
            // Explicit window: use it as-is.
            chosen_ws = ws.clone();
            page_url = url.clone();
            tree = t;
            refs = r;
            break;
        }
        // Keep the first non-empty result as a fallback (in case nothing matches
        // the preview's aspect).
        if r.is_empty() {
            if !have_fallback && tree.is_empty() {
                chosen_ws = ws.clone();
                page_url = url.clone();
                tree = t;
                refs = r;
            }
            continue;
        }
        let diff = match (preview_aspect, aspect) {
            (Some(pa), Some(a)) => (pa - a).abs(),
            _ => 0.0, // no preview aspect to match — any window with refs is fine
        };
        if !have_fallback || diff < best_diff {
            have_fallback = true;
            best_diff = diff;
            chosen_ws = ws.clone();
            page_url = url.clone();
            tree = t;
            refs = r;
        }
    }

    // Remember the chosen target so click/type act on the same window.
    set_target(port, &chosen_ws);
    let ref_count = refs.len();
    store_refs(port, refs);
    let windows = list_window_titles(port).await;
    Ok(json!({ "pageUrl": page_url, "tree": tree, "refCount": ref_count, "windows": windows }))
}

/// Snapshot a single CDP target: the accessibility tree (falling back to a DOM
/// walk when the AX tree is empty), plus the target window's aspect ratio (w/h)
/// so we can match it to the OS window the preview is mirroring.
async fn snapshot_target(
    ws_url: &str,
) -> Result<(String, HashMap<String, RefEntry>, Option<f64>), String> {
    let mut cdp = Cdp::connect(ws_url).await?;
    let _ = cdp.call("DOM.enable", json!({})).await;
    // Accessibility is off until enabled; without this the AX tree is empty.
    let _ = cdp.call("Accessibility.enable", json!({})).await;
    let aspect = cdp
        .call("Browser.getWindowForTarget", json!({}))
        .await
        .ok()
        .and_then(|w| {
            let b = w.get("bounds")?;
            let width = b.get("width")?.as_f64()?;
            let height = b.get("height")?.as_f64()?;
            if height > 0.0 {
                Some(width / height)
            } else {
                None
            }
        });
    let ax = cdp.call("Accessibility.getFullAXTree", json!({})).await?;
    let (mut tree, mut refs) = parse_ax_tree(&ax, true);
    if refs.is_empty() {
        if let Ok((dtree, drefs)) = dom_snapshot(&mut cdp).await {
            if !drefs.is_empty() {
                tree = dtree;
                refs = drefs;
            }
        }
    }
    Ok((tree, refs, aspect))
}

/// Aspect ratio (w/h) of the OS window the live preview is currently mirroring,
/// so the default snapshot can target the SAME window the user is watching.
fn preview_window_aspect() -> Option<f64> {
    let hwnd = crate::services::window_stream::current_hwnd()?;
    let windows = crate::commands::screenshot::list_visible_windows_metadata().ok()?;
    let w = windows.iter().find(|w| w.hwnd == hwnd)?;
    if w.height > 0 {
        Some(w.width as f64 / w.height as f64)
    } else {
        None
    }
}

/// DOM-based snapshot: walk `DOM.getDocument` for interactive elements and build
/// `@ref`s from their backend node ids (the same model the AX snapshot uses, so
/// click/type work unchanged). Used when the accessibility tree is empty.
async fn dom_snapshot(cdp: &mut Cdp) -> Result<(String, HashMap<String, RefEntry>), String> {
    let doc = cdp
        .call("DOM.getDocument", json!({ "depth": -1, "pierce": true }))
        .await?;
    let root = doc.get("root").ok_or("DOM.getDocument: no root")?;
    let mut refs: HashMap<String, RefEntry> = HashMap::new();
    let mut lines: Vec<String> = Vec::new();
    let mut counter: u32 = 1;
    walk_dom_interactive(root, &mut refs, &mut lines, &mut counter);
    Ok((lines.join("\n"), refs))
}

/// Parse a CDP node's flat `[name, value, name, value, …]` attributes array.
fn dom_attrs(node: &Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(arr) = node.get("attributes").and_then(|v| v.as_array()) {
        let mut i = 0;
        while i + 1 < arr.len() {
            if let (Some(k), Some(v)) = (arr[i].as_str(), arr[i + 1].as_str()) {
                map.insert(k.to_lowercase(), v.to_string());
            }
            i += 2;
        }
    }
    map
}

/// Concatenate descendant text-node values (for an element's visible label).
fn collect_dom_text(node: &Value, out: &mut String) {
    if out.chars().count() >= 80 {
        return;
    }
    if node.get("nodeType").and_then(|v| v.as_u64()) == Some(3) {
        if let Some(t) = node.get("nodeValue").and_then(|v| v.as_str()) {
            let t = t.trim();
            if !t.is_empty() {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(t);
            }
        }
    }
    if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
        for c in children {
            collect_dom_text(c, out);
        }
    }
}

/// Recursively collect interactive elements (buttons, links, inputs, anything
/// with a role / onclick / focusable) into `@ref`s, piercing shadow DOM + iframes.
fn walk_dom_interactive(
    node: &Value,
    refs: &mut HashMap<String, RefEntry>,
    lines: &mut Vec<String>,
    counter: &mut u32,
) {
    if node.get("nodeType").and_then(|v| v.as_u64()) == Some(1) {
        let node_name = node
            .get("nodeName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let attrs = dom_attrs(node);
        let interactive = matches!(
            node_name.as_str(),
            "BUTTON" | "A" | "INPUT" | "SELECT" | "TEXTAREA" | "OPTION" | "SUMMARY"
        ) || attrs.contains_key("role")
            || attrs.contains_key("onclick")
            || attrs.get("tabindex").map(|t| t != "-1").unwrap_or(false)
            || attrs
                .get("contenteditable")
                .map(|c| c != "false")
                .unwrap_or(false);
        if interactive {
            if let Some(b) = node.get("backendNodeId").and_then(|v| v.as_u64()) {
                let role = attrs
                    .get("role")
                    .cloned()
                    .unwrap_or_else(|| node_name.to_lowercase());
                let mut name = attrs
                    .get("aria-label")
                    .or_else(|| attrs.get("title"))
                    .or_else(|| attrs.get("value"))
                    .or_else(|| attrs.get("placeholder"))
                    .cloned()
                    .unwrap_or_default();
                if name.trim().is_empty() {
                    let mut txt = String::new();
                    collect_dom_text(node, &mut txt);
                    name = txt;
                }
                let name: String = name.trim().chars().take(60).collect();
                let ref_key = format!("e{}", *counter);
                *counter += 1;
                lines.push(format!("- {} \"{}\" @{}", role, name, ref_key));
                refs.insert(
                    ref_key,
                    RefEntry {
                        role,
                        name,
                        backend_node_id: Some(b as u32),
                        nth: None,
                    },
                );
            }
        }
    }
    if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
        for c in children {
            walk_dom_interactive(c, refs, lines, counter);
        }
    }
    if let Some(shadows) = node.get("shadowRoots").and_then(|v| v.as_array()) {
        for s in shadows {
            walk_dom_interactive(s, refs, lines, counter);
        }
    }
    if let Some(cd) = node.get("contentDocument") {
        walk_dom_interactive(cd, refs, lines, counter);
    }
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
