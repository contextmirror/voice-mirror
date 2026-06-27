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

// ── Host identity (so the sandbox NEVER targets Voice Mirror itself) ──────────
// Voice Mirror's own renderer is a CDP server on HOST_CDP_PORT and both the host
// and a dev app can serve on localhost:1420 — so URL/title can't disambiguate.
// The reliable signal is the owning PROCESS: the host's PID. Any CDP target whose
// OS window belongs to host_pid() is the IDE itself and must be dropped.

/// Voice Mirror's own process id — the host. A sandbox candidate whose window
/// belongs to this PID is the IDE's own renderer and must never be driven.
pub fn host_pid() -> u32 {
    std::process::id()
}

/// The CDP port Voice Mirror's own WebView2 host listens on. The sandbox tools
/// must refuse to operate on this port.
pub fn host_cdp_port() -> u16 {
    crate::HOST_CDP_PORT
}

/// The owning process id of an OS window, via `GetWindowThreadProcessId`. Used to
/// drop any sandbox candidate that belongs to Voice Mirror itself.
#[cfg(windows)]
fn pid_of_hwnd(hwnd: i64) -> Option<u32> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    unsafe {
        let h = HWND(hwnd as *mut std::ffi::c_void);
        let mut pid: u32 = 0;
        let tid = GetWindowThreadProcessId(h, Some(&mut pid));
        if tid == 0 || pid == 0 {
            None
        } else {
            Some(pid)
        }
    }
}

#[cfg(not(windows))]
fn pid_of_hwnd(_hwnd: i64) -> Option<u32> {
    None
}

// ── Host identity by HWND + title (port-agnostic exclusion) ───────────────────
// HOST_CDP_PORT alone is not enough: the host can surface on OTHER CDP ports too
// (e.g. a dev app that collides on the dev frontend port ends up showing Voice
// Mirror's own 1420 page, titled "Voice Mirror"), and uncorrelated CDP targets
// have `hwnd=None` so a PID check can't reach them. So we record the host's own
// top-level window + page title at startup and treat ANY target that matches by
// HWND, owning-PID, OR page title as the host — on every port.

static HOST_HWND: OnceLock<Mutex<Option<i64>>> = OnceLock::new();
static HOST_TITLE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn host_hwnd_cell() -> &'static Mutex<Option<i64>> {
    HOST_HWND.get_or_init(|| Mutex::new(None))
}

fn host_title_cell() -> &'static Mutex<Option<String>> {
    HOST_TITLE.get_or_init(|| Mutex::new(None))
}

/// Record Voice Mirror's OWN top-level window + title (called once at startup).
/// Used to exclude the IDE itself from every sandbox candidate list, regardless
/// of which CDP port it happens to be reachable on.
pub fn set_host_identity(hwnd: Option<i64>, title: Option<String>) {
    if let Ok(mut g) = host_hwnd_cell().lock() {
        *g = hwnd;
    }
    if let Ok(mut g) = host_title_cell().lock() {
        *g = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    }
}

/// The host's own top-level window HWND, if recorded.
pub fn host_hwnd() -> Option<i64> {
    host_hwnd_cell().lock().ok().and_then(|g| *g)
}

/// The host's own window/page title, if recorded.
pub fn host_title() -> Option<String> {
    host_title_cell().lock().ok().and_then(|g| g.clone())
}

/// True if a sandbox candidate is actually Voice Mirror itself. Matches by:
///   1. correlated window == the host window, or its owning PID == the host PID;
///   2. CDP page title == the host title (covers UNCORRELATED targets where
///      `hwnd` is None, and "ghost" dev-app windows that loaded the host's own
///      1420 frontend and are therefore titled "Voice Mirror").
fn is_host_candidate(hwnd: Option<i64>, page_title: &str) -> bool {
    if let Some(h) = hwnd {
        if Some(h) == host_hwnd() {
            return true;
        }
        if pid_of_hwnd(h) == Some(host_pid()) {
            return true;
        }
    }
    let pt = page_title.trim().to_lowercase();
    if pt.len() >= 4 {
        if let Some(ht) = host_title() {
            let ht = ht.trim().to_lowercase();
            if ht.len() >= 4 && (pt == ht || pt.contains(&ht) || ht.contains(&pt)) {
                return true;
            }
        }
    }
    false
}

/// True if a real OS window (by HWND + title) is Voice Mirror's own window — used
/// by the live-preview stream so it never mirrors the IDE itself.
pub(crate) fn is_host_window(hwnd: i64, title: &str) -> bool {
    is_host_candidate(Some(hwnd), title)
}

/// True if the first page target on `port` is Voice Mirror's own renderer — used
/// to refuse registering the host as the active sandbox port.
pub(crate) async fn port_is_host(port: u16) -> bool {
    if port == host_cdp_port() {
        return true;
    }
    match fetch_page_targets(port).await {
        Ok(targets) => targets.iter().any(|t| {
            let title = t.get("title").and_then(|v| v.as_str()).unwrap_or("");
            is_host_candidate(None, title)
        }),
        Err(_) => false,
    }
}

// ── Active sandbox WINDOW (the unified source of truth) ───────────────────────
// snapshot() records the OS window (HWND) it acted on. The live preview polls
// this and mirrors the SAME window — so the human watches exactly the window
// Claude is driving, by construction, not by guessing. This is what replaced the
// fragile auto-follow.

static ACTIVE_HWND: OnceLock<Mutex<Option<i64>>> = OnceLock::new();

fn active_hwnd_cell() -> &'static Mutex<Option<i64>> {
    ACTIVE_HWND.get_or_init(|| Mutex::new(None))
}

/// Record the OS window Claude is currently driving (so the preview can follow).
pub fn set_active_hwnd(hwnd: Option<i64>) {
    if let Ok(mut g) = active_hwnd_cell().lock() {
        *g = hwnd;
    }
}

/// The OS window Claude is currently driving, for the live preview to mirror.
pub fn active_hwnd() -> Option<i64> {
    active_hwnd_cell().lock().ok().and_then(|g| *g)
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
    // Authoritative host guard: HOST_CDP_PORT is Voice Mirror's OWN renderer.
    // Snapshotting it would have Claude drive the IDE itself, not the app.
    if port == host_cdp_port() {
        return Err(format!(
            "Port {} is Voice Mirror's own renderer — not the app you're building. \
             Launch your app with a different --remote-debugging-port (e.g. via sandbox_start), \
             or pass the correct `port`.",
            port
        ));
    }
    let targets = fetch_page_targets(port).await?;
    if targets.is_empty() {
        return Err("no debuggable page target found".to_string());
    }
    let want = window.map(|t| t.trim().to_lowercase());

    // Real OS windows (DISTINCT titles + screen positions) to correlate the CDP
    // page targets against — the CDP titles all collide ("Yap"), but the OS
    // windows ("Yap", "Yap Settings", …) don't, and their positions are unique.
    let os_windows = app_windows_with_rects(port).await;
    let foreground = foreground_hwnd();

    // Snapshot every page target and correlate each to a real OS window so we
    // know its distinct title + HWND.
    struct Cand {
        ws: String,
        page_url: String,
        page_title: String,
        tree: String,
        refs: HashMap<String, RefEntry>,
        visible: bool,
        hwnd: Option<i64>,
        os_title: String,
    }
    // Max DIP distance for a CDP target to count as "the same window" as a
    // visible OS window. Beyond this, the target has no real mirrorable window
    // (e.g. a hidden leftover onboarding page) and must NOT mis-correlate to the
    // one visible window — else Claude reads a ghost the preview can't show.
    const MATCH_THRESHOLD: f64 = 140.0;

    let mut cands: Vec<Cand> = Vec::new();
    for t in &targets {
        let ws = match t.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
            Some(w) => w.to_string(),
            None => continue,
        };
        let page_url = t.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let page_title = t.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let (tree, refs, bounds, visible) = snapshot_target(&ws).await.unwrap_or_default();
        // Correlate to the closest OS window by position (+ size) — but only if
        // it's actually CLOSE (a real, mirrorable window).
        let (hwnd, os_title) = match bounds {
            Some((cx, cy, cw, ch)) => os_windows
                .iter()
                .map(|(h, title, x, y, w, hh)| {
                    let d =
                        (cx - x).abs() + (cy - y).abs() + 0.5 * ((cw - w).abs() + (ch - hh).abs());
                    (d, *h, title.clone())
                })
                .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
                .filter(|(d, ..)| *d <= MATCH_THRESHOLD)
                .map(|(_, h, title)| (Some(h), title))
                .unwrap_or((None, String::new())),
            None => (None, String::new()),
        };
        cands.push(Cand { ws, page_url, page_title, tree, refs, visible, hwnd, os_title });
    }
    if cands.is_empty() {
        return Err("no debuggable page target found".to_string());
    }

    // HOST EXCLUSION (authoritative, port-agnostic): drop any candidate that is
    // Voice Mirror itself — by HWND/PID when correlated, OR by page title when
    // uncorrelated (hwnd=None) or a "ghost" dev window that loaded the host's own
    // 1420 frontend (titled "Voice Mirror"). PID alone misses both of those.
    cands.retain(|c| !is_host_candidate(c.hwnd, &c.page_title));
    if cands.is_empty() {
        return Err(format!(
            "No app window found on CDP port {} that isn't Voice Mirror itself. \
             (A dev app that collides on the host's dev port can end up showing \
             Voice Mirror's own page.) Launch your app with its own \
             --remote-debugging-port on a FREE dev port (try sandbox_start).",
            port
        ));
    }

    // Pick the target.
    let chosen_idx = if let Some(w) = &want {
        // Explicit window: match the DISTINCT OS title OR the CDP page title
        // (case-insensitive substring either way), so `window:"TaskDeck"` works
        // even when OS-window correlation was unavailable.
        cands
            .iter()
            .position(|c| {
                let ot = c.os_title.trim().to_lowercase();
                let pt = c.page_title.trim().to_lowercase();
                let matches = |s: &str| !s.is_empty() && (s == *w || s.contains(w) || w.contains(s));
                matches(&ot) || matches(&pt)
            })
            .ok_or_else(|| {
                // Echo the REAL targetable candidates (the resolved port's page +
                // OS titles), not the OS-window list — which can be empty when
                // process correlation fails, leaving the agent blind.
                let mut names: Vec<String> = cands
                    .iter()
                    .map(|c| {
                        if !c.os_title.trim().is_empty() {
                            c.os_title.trim().to_string()
                        } else {
                            c.page_title.trim().to_string()
                        }
                    })
                    .filter(|s| !s.is_empty())
                    .collect();
                names.sort();
                names.dedup();
                let listed = if names.is_empty() {
                    "(none)".to_string()
                } else {
                    names.join(", ")
                };
                format!(
                    "No app window matching '{}'. Available windows on port {}: {}. \
                     Snapshot without `window` to target the default.",
                    w, port, listed
                )
            })?
    } else {
        // Default: prefer a window that's actually MIRRORABLE (correlates to a
        // real visible OS window) so Claude and the preview stay on the same
        // window. The foreground app window wins; then a mirrorable visible
        // window with interactive elements; then any mirrorable window. Only as
        // a last resort fall back to a non-mirrorable target.
        cands
            .iter()
            .position(|c| c.visible && c.hwnd.is_some() && c.hwnd == foreground)
            .or_else(|| {
                cands
                    .iter()
                    .position(|c| c.visible && c.hwnd.is_some() && !c.refs.is_empty())
            })
            .or_else(|| cands.iter().position(|c| c.visible && c.hwnd.is_some()))
            .or_else(|| cands.iter().position(|c| c.hwnd.is_some()))
            .or_else(|| cands.iter().position(|c| c.visible && !c.refs.is_empty()))
            .or_else(|| cands.iter().position(|c| c.visible))
            .unwrap_or(0)
    };

    let chosen = &cands[chosen_idx];
    // Remember the chosen target so click/type act on the same window…
    set_target(port, &chosen.ws);
    // …and publish the OS window so the live preview mirrors exactly what Claude
    // is driving (the unified active-window source of truth).
    if let Some(h) = chosen.hwnd {
        set_active_hwnd(Some(h));
    }

    let tree = chosen.tree.clone();
    let page_url = chosen.page_url.clone();
    // Prefer the distinct OS title; fall back to the CDP page title.
    let active_window = if chosen.os_title.trim().is_empty() {
        chosen.page_title.clone()
    } else {
        chosen.os_title.clone()
    };
    let resolved_pid = chosen.hwnd.and_then(pid_of_hwnd);
    let ref_count = chosen.refs.len();
    store_refs(port, chosen.refs.clone());

    // Distinct OS window titles for the AI to target by name.
    let windows: Vec<String> = if os_windows.is_empty() {
        list_window_titles(port).await
    } else {
        os_windows.iter().map(|(_, t, ..)| t.clone()).collect()
    };

    Ok(json!({
        "pageUrl": page_url,
        "tree": tree,
        "refCount": ref_count,
        "windows": windows,
        "activeWindow": active_window,
        // Echo the resolved target so a wrong-app attach is instantly visible.
        "port": port,
        "pid": resolved_pid,
    }))
}

/// Snapshot a single CDP target: the accessibility tree (falling back to a DOM
/// walk when the AX tree is empty), plus the target window's aspect ratio (w/h)
/// so we can match it to the OS window the preview is mirroring.
async fn snapshot_target(
    ws_url: &str,
) -> Result<(String, HashMap<String, RefEntry>, Option<(f64, f64, f64, f64)>, bool), String> {
    let mut cdp = Cdp::connect(ws_url).await?;
    let _ = cdp.call("DOM.enable", json!({})).await;
    // Accessibility is off until enabled; without this the AX tree is empty.
    let _ = cdp.call("Accessibility.enable", json!({})).await;
    let bounds = cdp
        .call("Browser.getWindowForTarget", json!({}))
        .await
        .ok()
        .and_then(|w| {
            let b = w.get("bounds")?;
            Some((
                b.get("left")?.as_f64()?,
                b.get("top")?.as_f64()?,
                b.get("width")?.as_f64()?,
                b.get("height")?.as_f64()?,
            ))
        });
    // Is this window actually ON SCREEN? Chromium reports document.visibilityState
    // = "hidden" for a hidden window, so we never let Claude act on a window the
    // user can't see.
    let visible = cdp
        .call(
            "Runtime.evaluate",
            json!({ "expression": "document.visibilityState", "returnByValue": true }),
        )
        .await
        .ok()
        .and_then(|r| {
            r.get("result")
                .and_then(|res| res.get("value"))
                .and_then(|v| v.as_str())
                .map(|s| s == "visible")
        })
        .unwrap_or(true);
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
    Ok((tree, refs, bounds, visible))
}

/// Logical (DIP) screen rect (left, top, width, height) of an OS window. CDP
/// `Browser.getWindowForTarget` bounds are also in DIP, so they compare directly
/// once we divide the physical rect by the window's DPI scale. Used to correlate
/// CDP page targets to real OS windows by position (unique per window).
#[cfg(windows)]
fn window_dip_rect(hwnd: i64) -> Option<(f64, f64, f64, f64)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    unsafe {
        let h = HWND(hwnd as *mut std::ffi::c_void);
        let mut rect = RECT::default();
        if GetWindowRect(h, &mut rect).is_err() {
            return None;
        }
        let dpi = GetDpiForWindow(h);
        let scale = if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 };
        Some((
            rect.left as f64 / scale,
            rect.top as f64 / scale,
            (rect.right - rect.left) as f64 / scale,
            (rect.bottom - rect.top) as f64 / scale,
        ))
    }
}

/// The app's visible windows with their DISTINCT OS titles + DIP rects, to
/// correlate CDP page targets to real OS windows. Returns
/// `(hwnd, title, left, top, width, height)`.
#[cfg(windows)]
async fn app_windows_with_rects(port: u16) -> Vec<(i64, String, f64, f64, f64, f64)> {
    let wins = crate::services::sandbox_stream::list_windows(port)
        .await
        .unwrap_or_default();
    wins.into_iter()
        .filter_map(|w| {
            let (x, y, ww, hh) = window_dip_rect(w.hwnd)?;
            Some((w.hwnd, w.title, x, y, ww, hh))
        })
        .collect()
}

/// The foreground OS window's HWND, if any — used to default the snapshot to the
/// window currently in focus (e.g. Settings right after it opens).
#[cfg(windows)]
fn foreground_hwnd() -> Option<i64> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe {
        let h = GetForegroundWindow();
        if h.0.is_null() {
            None
        } else {
            Some(h.0 as i64)
        }
    }
}

#[cfg(not(windows))]
async fn app_windows_with_rects(_port: u16) -> Vec<(i64, String, f64, f64, f64, f64)> {
    Vec::new()
}

#[cfg(not(windows))]
fn foreground_hwnd() -> Option<i64> {
    None
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

/// Close the window Claude is currently driving (the last snapshot's window) by
/// posting `WM_CLOSE` — the graceful close you'd get from the title-bar X, which
/// is native OS chrome that CDP/DOM can't reach. Clears the active window so the
/// live preview snaps back to the app's main window.
#[cfg(windows)]
pub fn close_active_window() -> Result<Value, String> {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

    let hwnd =
        active_hwnd().ok_or("No active window — call sandbox_snapshot first to choose a window")?;
    // Never close Voice Mirror's own window.
    if pid_of_hwnd(hwnd) == Some(host_pid()) {
        return Err(
            "Refusing to close Voice Mirror's own window — the active window is the IDE itself, \
             not the app you're building."
                .to_string(),
        );
    }
    unsafe {
        let h = HWND(hwnd as *mut std::ffi::c_void);
        PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0))
            .map_err(|e| format!("Failed to close window: {}", e))?;
    }
    set_active_hwnd(None);
    Ok(json!({ "ok": true, "closedHwnd": hwnd }))
}

#[cfg(not(windows))]
pub fn close_active_window() -> Result<Value, String> {
    Err("Closing a window is Windows-only".to_string())
}

/// Register an ALREADY-running CDP app (one the agent launched itself with a
/// debug port) as the active sandbox. Validates the port is reachable and is NOT
/// Voice Mirror's own renderer. The caller (pipe arm) then opens the live preview.
/// Returns the resolved `{ port, url, title }` so a wrong attach is visible.
pub async fn attach(port: u16) -> Result<Value, String> {
    if port == host_cdp_port() {
        return Err(format!(
            "Port {} is Voice Mirror's own renderer — not an app you're building. \
             Relaunch your app with a different --remote-debugging-port and attach to that.",
            port
        ));
    }
    // Reachability check: discover the first page target (also gives us a URL).
    let (_ws, url) = discover_page_target(port, None).await.map_err(|e| {
        format!(
            "Could not reach a CDP app on port {} ({}). Launch your app with \
             --remote-debugging-port={} first.",
            port, e, port
        )
    })?;
    // Identity guard: refuse if this port is actually Voice Mirror itself (e.g. a
    // dev app that collided on the host's 1420 frontend and now shows the host's
    // own page). Never register the IDE as the active sandbox.
    if port_is_host(port).await {
        return Err(format!(
            "Port {} is showing Voice Mirror itself, not the app you're building \
             (it likely collided on Voice Mirror's own dev port and loaded the \
             host frontend). Relaunch your app on a FREE dev port with its own \
             --remote-debugging-port and attach to that.",
            port
        ));
    }
    let title = list_window_titles(port).await.into_iter().next().unwrap_or_default();
    set_active_cdp_port(Some(port));
    Ok(json!({ "ok": true, "port": port, "url": url, "title": title }))
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
