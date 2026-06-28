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

// ── Active backend marker (CDP vs UIA) ────────────────────────────────────────
// The sandbox tools can drive TWO kinds of app: a CDP/WebView2 app (this module)
// or a NATIVE window over UI Automation (`crate::services::uia`). The active
// backend is recorded by whichever `snapshot` ran last, so a follow-up
// click/type/screenshot with no explicit `port`/`hwnd` routes to the SAME engine.

/// Which engine the active sandbox target is driven through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActiveBackend {
    /// A CDP/WebView2 app on this remote-debugging port.
    Cdp(u16),
    /// A native window (Win32/WinForms/WPF/Qt/UWP) driven via UI Automation.
    Uia(i64),
}

static ACTIVE_BACKEND: OnceLock<Mutex<Option<ActiveBackend>>> = OnceLock::new();

fn active_backend_cell() -> &'static Mutex<Option<ActiveBackend>> {
    ACTIVE_BACKEND.get_or_init(|| Mutex::new(None))
}

/// Record (or clear) the active sandbox backend (CDP port or UIA window).
pub fn set_active_backend(backend: Option<ActiveBackend>) {
    if let Ok(mut g) = active_backend_cell().lock() {
        *g = backend;
    }
}

/// The active sandbox backend, if any — lets click/type/screenshot follow the
/// engine the last snapshot used.
pub fn active_backend() -> Option<ActiveBackend> {
    active_backend_cell().lock().ok().and_then(|g| *g)
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
pub(crate) fn pid_of_hwnd(hwnd: i64) -> Option<u32> {
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
pub(crate) fn pid_of_hwnd(_hwnd: i64) -> Option<u32> {
    None
}

/// An OS window's logical (DIP) size `(width, height)` — used by the UIA backend
/// to fill the `activeWidth`/`activeHeight` echo for a native window.
#[cfg(windows)]
pub(crate) fn window_logical_size(hwnd: i64) -> Option<(i64, i64)> {
    window_geom(hwnd).map(|g| (g.w.round() as i64, g.h.round() as i64))
}

#[cfg(not(windows))]
pub(crate) fn window_logical_size(_hwnd: i64) -> Option<(i64, i64)> {
    None
}

/// True if `hwnd` is still a real, existing OS window. Used by the live preview
/// so it never re-targets (or lingers on) a window that has been CLOSED — a
/// closed window's HWND is stale and `CreateForWindow` on it captures nothing.
#[cfg(windows)]
pub(crate) fn is_window_alive(hwnd: i64) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    unsafe { IsWindow(Some(HWND(hwnd as *mut std::ffi::c_void))).as_bool() }
}

#[cfg(not(windows))]
pub(crate) fn is_window_alive(_hwnd: i64) -> bool {
    true
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

// ── Active target METADATA (url + title + index) ──────────────────────────────
// snapshot() also records the resolved target's CDP url, title and index so the
// screenshot path can ECHO exactly which window it is showing — a wrong-window
// attach is then instantly visible, and screenshot + snapshot provably agree.

#[derive(Clone, Default)]
pub struct ActiveMeta {
    pub url: String,
    pub title: String,
    pub index: i64,
    /// The Tauri window LABEL (unique per window) — the authoritative identity key
    /// for the screenshot/snapshot/click lockstep echo. Empty for non-Tauri apps.
    pub label: String,
    /// The resolved window's logical (DIP) size, for the echo (e.g. 720×640).
    pub width: i64,
    pub height: i64,
}

static ACTIVE_META: OnceLock<Mutex<ActiveMeta>> = OnceLock::new();

fn active_meta_cell() -> &'static Mutex<ActiveMeta> {
    ACTIVE_META.get_or_init(|| Mutex::new(ActiveMeta::default()))
}

/// Record the resolved active target's url/title/index/label/size (screenshot echo).
pub fn set_active_meta(url: String, title: String, index: i64, label: String, width: i64, height: i64) {
    if let Ok(mut g) = active_meta_cell().lock() {
        *g = ActiveMeta { url, title, index, label, width, height };
    }
}

/// The resolved active target's url/title/index, for the screenshot to echo.
pub fn active_meta() -> ActiveMeta {
    active_meta_cell().lock().ok().map(|g| g.clone()).unwrap_or_default()
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

/// The CDP `webSocketDebuggerUrl` of the ACTIVE target on `port` — the window the
/// last snapshot drove (`set_target`), falling back to the first page target.
/// Exposed for the live preview's CDP screencast fallback: when WGC can't capture
/// the active window (an opaque window that's hidden/occluded/not-presenting), the
/// preview screencasts THIS target instead of erroring.
pub(crate) async fn active_target_ws(port: u16) -> Result<String, String> {
    action_target(port).await
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

    // Real OS windows to correlate the CDP page targets against. The CDP page
    // titles + URLs all collide on a Tauri SPA ("Yap" / "http://localhost:1430/"),
    // so we DON'T key off them: the Tauri LABEL is identity, and the OS window's
    // SIZE (distinct per window: 210×60 / 720×640 / 620×720 / 330×48) binds the HWND.
    let os_windows = app_windows_with_geom(port).await;
    let foreground = foreground_hwnd();

    // Snapshot every page target. For each we read its Tauri window LABEL (the
    // unique identity key) and correlate it to a real OS window by SIZE (so we
    // recover the native title + HWND for capture).
    struct Cand {
        ws: String,
        page_url: String,
        page_title: String,
        tree: String,
        refs: HashMap<String, RefEntry>,
        visible: bool,
        hwnd: Option<i64>,
        os_title: String,
        /// The Tauri window label (`window.__TAURI_INTERNALS__.metadata.currentWindow.label`).
        label: Option<String>,
        /// The correlated OS window's logical (DIP) size, for the windows list echo.
        os_size: Option<(f64, f64)>,
    }

    let mut cands: Vec<Cand> = Vec::new();
    for t in &targets {
        let ws = match t.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
            Some(w) => w.to_string(),
            None => continue,
        };
        let page_url = t.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let page_title = t.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let (tree, refs, bounds, visible, label) = snapshot_target(&ws).await.unwrap_or_default();
        // Correlate to an OS window by SIZE (DPI-tolerant). Sizes are distinct per
        // window, so size alone disambiguates even when titles/URLs are identical.
        let (hwnd, os_title, os_size) = match bounds {
            Some((cx, cy, cw, ch)) => correlate_by_size(&os_windows, cx, cy, cw, ch),
            None => (None, String::new(), None),
        };
        cands.push(Cand {
            ws, page_url, page_title, tree, refs, visible, hwnd, os_title, label, os_size,
        });
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

    // The OS window the live preview is currently mirroring (what the USER sees).
    // Unique even when every window shares a title, so it's the reliable signal
    // for "drive what's on screen" — and it keeps the screenshot (which mirrors
    // this same window) from ever diverging from snapshot/click.
    let preview_hwnd = crate::services::window_stream::current_hwnd();

    // A short echo of a candidate for error/diagnostics: `[i] label "title" (W×H)`.
    let fmt_cand = |i: usize, c: &Cand| -> String {
        let title = if !c.os_title.trim().is_empty() {
            c.os_title.trim()
        } else {
            c.page_title.trim()
        };
        let label = c.label.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or("?");
        let size = c
            .os_size
            .map(|(w, h)| format!(" ({}×{})", w.round() as i64, h.round() as i64))
            .unwrap_or_default();
        format!("[{}] {} \"{}\"{}", i, label, title, size)
    };

    // Pick the target.
    let chosen_idx = if let Some(w) = &want {
        // Resolution order (title/URL-INDEPENDENT, so identical titles like all
        // "Yap" never block selection):
        //   1. label exact (case-insensitive)  — the unique Tauri identity key
        //   2. label substring
        //   3. numeric index (from the `windows` list)
        //   4. exact native/page title
        //   5. URL/route substring, then loose title substring
        cands
            .iter()
            .position(|c| {
                c.label
                    .as_deref()
                    .map(|l| l.trim().to_lowercase() == *w)
                    .unwrap_or(false)
            })
            .or_else(|| {
                cands.iter().position(|c| {
                    c.label
                        .as_deref()
                        .map(|l| {
                            let l = l.trim().to_lowercase();
                            !l.is_empty() && (l.contains(w.as_str()) || w.contains(&l))
                        })
                        .unwrap_or(false)
                })
            })
            .or_else(|| w.parse::<usize>().ok().filter(|i| *i < cands.len()))
            // Exact title (OS or CDP page) — a parent stays selectable by its exact
            // name even when a child window's title extends it.
            .or_else(|| {
                cands.iter().position(|c| {
                    let ot = c.os_title.trim().to_lowercase();
                    let pt = c.page_title.trim().to_lowercase();
                    (!ot.is_empty() && ot == *w) || (!pt.is_empty() && pt == *w)
                })
            })
            // URL / route substring.
            .or_else(|| {
                cands.iter().position(|c| {
                    let url = c.page_url.to_lowercase();
                    !url.is_empty() && url.contains(w.as_str())
                })
            })
            // Loose title substring (last resort).
            .or_else(|| {
                cands.iter().position(|c| {
                    let ot = c.os_title.trim().to_lowercase();
                    let pt = c.page_title.trim().to_lowercase();
                    (!ot.is_empty() && (ot.contains(w.as_str()) || w.contains(&ot)))
                        || (!pt.is_empty() && (pt.contains(w.as_str()) || w.contains(&pt)))
                })
            })
            .ok_or_else(|| {
                // Echo the REAL targetable candidates as `[index] label "title" (W×H)`
                // so an agent facing identical titles can disambiguate by label/index.
                let listed = cands
                    .iter()
                    .enumerate()
                    .map(|(i, c)| fmt_cand(i, c))
                    .collect::<Vec<_>>()
                    .join("; ");
                let listed = if listed.is_empty() { "(none)".to_string() } else { listed };
                format!(
                    "No app window matching '{}'. Available windows on port {}: {}. \
                     Target one by its label (exact or substring), its index, or its title — \
                     or snapshot without `window` for the default.",
                    w, port, listed
                )
            })?
    } else {
        // Default: drive what the USER is watching. Prefer the window the live
        // preview is currently mirroring (unique even with identical titles), so
        // screenshot + snapshot + click can't diverge. Then the foreground app
        // window; then a mirrorable visible window with interactive elements; then
        // any mirrorable window. Only as a last resort fall back to a
        // non-mirrorable target.
        cands
            .iter()
            .position(|c| c.visible && c.hwnd.is_some() && c.hwnd == preview_hwnd)
            .or_else(|| {
                cands
                    .iter()
                    .position(|c| c.visible && c.hwnd.is_some() && c.hwnd == foreground)
            })
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
    // Mark CDP as the active backend so a follow-up click/type/screenshot with no
    // explicit target routes back here (and not to the UIA engine).
    set_active_backend(Some(ActiveBackend::Cdp(port)));

    let tree = chosen.tree.clone();
    let page_url = chosen.page_url.clone();
    // Prefer the distinct OS title; fall back to the CDP page title.
    let active_window = if chosen.os_title.trim().is_empty() {
        chosen.page_title.clone()
    } else {
        chosen.os_title.clone()
    };
    let active_label = chosen.label.clone().unwrap_or_default();
    let (active_w, active_h) = chosen
        .os_size
        .map(|(w, h)| (w.round() as i64, h.round() as i64))
        .unwrap_or((0, 0));
    let resolved_pid = chosen.hwnd.and_then(pid_of_hwnd);
    let ref_count = chosen.refs.len();
    store_refs(port, chosen.refs.clone());

    // Record the resolved target's url/title/index/label/size so the screenshot
    // path echoes the SAME window — wrong-window attach is then instantly visible.
    set_active_meta(
        page_url.clone(),
        active_window.clone(),
        chosen_idx as i64,
        active_label.clone(),
        active_w,
        active_h,
    );

    // The drivable windows, each with its stable INDEX, Tauri LABEL (the unique
    // identity key) and its size, so identical titles/URLs ("Yap, Yap, Yap" on
    // "http://localhost:1430/") stop blocking selection — target by label or index.
    let windows: Vec<Value> = cands
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let title = if c.os_title.trim().is_empty() {
                c.page_title.trim().to_string()
            } else {
                c.os_title.trim().to_string()
            };
            let (w, h) = c
                .os_size
                .map(|(w, h)| (w.round() as i64, h.round() as i64))
                .unwrap_or((0, 0));
            json!({
                "index": i,
                "label": c.label,
                "title": title,
                "url": c.page_url,
                "width": w,
                "height": h,
            })
        })
        .collect();

    Ok(json!({
        "pageUrl": page_url,
        "tree": tree,
        "refCount": ref_count,
        "windows": windows,
        "activeWindow": active_window,
        "activeLabel": active_label,
        "activeWidth": active_w,
        "activeHeight": active_h,
        "activeIndex": chosen_idx,
        // Echo the resolved target so a wrong-app attach is instantly visible.
        "port": port,
        "pid": resolved_pid,
    }))
}

/// Snapshot a single CDP target: the accessibility tree (falling back to a DOM
/// walk when the AX tree is empty), the target window's screen bounds (so we can
/// correlate it to a real OS window by size), its visibility, and its **Tauri
/// window label** (the unique identity key).
async fn snapshot_target(
    ws_url: &str,
) -> Result<
    (
        String,
        HashMap<String, RefEntry>,
        Option<(f64, f64, f64, f64)>,
        bool,
        Option<String>,
    ),
    String,
> {
    let mut cdp = Cdp::connect(ws_url).await?;
    let _ = cdp.call("DOM.enable", json!({})).await;
    // Accessibility is off until enabled; without this the AX tree is empty.
    let _ = cdp.call("Accessibility.enable", json!({})).await;

    // The Tauri window LABEL — injected into every Tauri webview unconditionally
    // (no withGlobalTauri needed), but transiently undefined in the first ms after
    // a target appears, so POLL it (up to 5×, 60ms apart) until it's non-null.
    let mut label: Option<String> = None;
    for attempt in 0..5 {
        let r = cdp
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": "window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label",
                    "returnByValue": true
                }),
            )
            .await
            .ok();
        if let Some(s) = r
            .as_ref()
            .and_then(|r| r.get("result"))
            .and_then(|res| res.get("value"))
            .and_then(|v| v.as_str())
        {
            let s = s.trim();
            if !s.is_empty() {
                label = Some(s.to_string());
                break;
            }
        }
        if attempt < 4 {
            tokio::time::sleep(Duration::from_millis(60)).await;
        }
    }

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
    Ok((tree, refs, bounds, visible, label))
}

/// A real OS window's geometry, in BOTH logical (DIP) and physical pixels. We
/// keep both because `Browser.getWindowForTarget` bounds can come back in DIP or
/// physical px depending on the WebView2 / per-monitor-DPI combo, so a robust
/// correlation must be able to match either interpretation.
#[derive(Clone)]
struct OsWin {
    hwnd: i64,
    title: String,
    /// DIP rect (left, top, width, height) — width/height are what we echo.
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    /// Physical size (px).
    pw: f64,
    ph: f64,
}

/// Geometry of an OS window in DIP + physical px.
#[cfg(windows)]
fn window_geom(hwnd: i64) -> Option<OsWin> {
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
        let pw = (rect.right - rect.left) as f64;
        let ph = (rect.bottom - rect.top) as f64;
        Some(OsWin {
            hwnd,
            title: String::new(),
            x: rect.left as f64 / scale,
            y: rect.top as f64 / scale,
            w: pw / scale,
            h: ph / scale,
            pw,
            ph,
        })
    }
}

/// The app's visible windows with their OS titles + geometry, to correlate CDP
/// page targets to real OS windows by SIZE (distinct per window).
#[cfg(windows)]
async fn app_windows_with_geom(port: u16) -> Vec<OsWin> {
    let wins = crate::services::sandbox_stream::list_windows(port)
        .await
        .unwrap_or_default();
    wins.into_iter()
        .filter_map(|w| {
            let mut g = window_geom(w.hwnd)?;
            g.title = w.title;
            Some(g)
        })
        .collect()
}

/// Combined relative size error of CDP bounds `(cw,ch)` vs an OS size `(ow,oh)`.
fn rel_size_err(cw: f64, ch: f64, ow: f64, oh: f64) -> f64 {
    (cw - ow).abs() / ow.max(1.0) + (ch - oh).abs() / oh.max(1.0)
}

/// Correlate a CDP target's window bounds to the best-matching OS window by SIZE,
/// DPI-tolerantly. CDP bounds may be in DIP OR physical px, so we compare against
/// both the OS window's DIP and physical size and take the closer fit. Position is
/// only a tiny tiebreak (it diverges for borderless/transparent Tauri windows, so
/// it must NOT gate the match the way the old absolute-pixel threshold did).
/// Returns `(hwnd, os_title, dip_size)` or `(None, "", None)` if nothing is close.
#[cfg(windows)]
fn correlate_by_size(
    os: &[OsWin],
    cx: f64,
    cy: f64,
    cw: f64,
    ch: f64,
) -> (Option<i64>, String, Option<(f64, f64)>) {
    // Reasonably-close size match: combined relative error within ~35% (so a real
    // window always wins, but a target with no on-screen window won't mis-bind).
    const SIZE_TOL: f64 = 0.35;
    let mut best: Option<(f64, &OsWin)> = None;
    for w in os {
        let size_err = rel_size_err(cw, ch, w.w, w.h).min(rel_size_err(cw, ch, w.pw, w.ph));
        // Normalize position into a tiny additive nudge (≤0.05) — breaks ties
        // between same-size windows without ever overriding a clear size winner.
        let pos = (((cx - w.x).abs() + (cy - w.y).abs()) / 4000.0).min(0.05);
        let score = size_err + pos;
        if best.as_ref().map(|(b, _)| score < *b).unwrap_or(true) {
            best = Some((score, w));
        }
    }
    match best {
        Some((score, w)) if score <= SIZE_TOL + 0.05 => {
            (Some(w.hwnd), w.title.clone(), Some((w.w, w.h)))
        }
        _ => (None, String::new(), None),
    }
}

/// The foreground OS window's HWND, if any — used to default the snapshot to the
/// window currently in focus (e.g. Settings right after it opens).
#[cfg(windows)]
pub(crate) fn foreground_hwnd() -> Option<i64> {
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
#[derive(Clone)]
struct OsWin {
    hwnd: i64,
    title: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    pw: f64,
    ph: f64,
}

#[cfg(not(windows))]
async fn app_windows_with_geom(_port: u16) -> Vec<OsWin> {
    Vec::new()
}

#[cfg(not(windows))]
fn correlate_by_size(
    _os: &[OsWin],
    _cx: f64,
    _cy: f64,
    _cw: f64,
    _ch: f64,
) -> (Option<i64>, String, Option<(f64, f64)>) {
    (None, String::new(), None)
}

#[cfg(not(windows))]
pub(crate) fn foreground_hwnd() -> Option<i64> {
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

    // Native <select>: a synthetic mouse click can't change a native dropdown's
    // value (the OS renders the popup, and Input.dispatchMouseEvent never lands
    // on an option). For a <select> or an <option>, set the select's value and
    // fire a bubbling `change` (and `input`) event via JS instead — the same
    // result a real selection produces. Everything else clicks normally.
    let node_name = cdp
        .call("DOM.describeNode", json!({ "backendNodeId": backend }))
        .await
        .ok()
        .and_then(|v| {
            v.get("node")
                .and_then(|n| n.get("nodeName"))
                .and_then(|s| s.as_str())
                .map(|s| s.to_uppercase())
        });
    if matches!(node_name.as_deref(), Some("SELECT") | Some("OPTION")) {
        if let Ok(v) = drive_select(&mut cdp, backend).await {
            return Ok(v);
        }
        // If the JS path failed, fall through to a normal click.
    }

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

/// Drive a native `<select>` (or an `<option>`): set the owning select's value
/// to the chosen option and dispatch bubbling `input` + `change` events, which a
/// synthetic mouse click can't do for a native dropdown. The `@ref` may point at
/// either the `<select>` or one of its `<option>`s.
async fn drive_select(cdp: &mut Cdp, backend: u32) -> Result<Value, String> {
    let resolved = cdp
        .call("DOM.resolveNode", json!({ "backendNodeId": backend }))
        .await?;
    let obj_id = resolved
        .get("object")
        .and_then(|o| o.get("objectId"))
        .and_then(|v| v.as_str())
        .ok_or("could not resolve the select/option to a JS handle")?;
    let func = r#"function(){
        var el = this;
        var select = el.tagName === 'OPTION' ? el.closest('select') : (el.tagName === 'SELECT' ? el : null);
        if (!select) { el.click(); return { handled: false }; }
        if (el.tagName === 'OPTION') {
            var idx = Array.prototype.indexOf.call(select.options, el);
            if (idx >= 0) select.selectedIndex = idx; else select.value = el.value;
        }
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        var sel = select.options[select.selectedIndex];
        return { handled: true, value: select.value, label: sel ? sel.textContent.trim() : null };
    }"#;
    let r = cdp
        .call(
            "Runtime.callFunctionOn",
            json!({
                "objectId": obj_id,
                "functionDeclaration": func,
                "returnByValue": true,
                "userGesture": true
            }),
        )
        .await?;
    let result = r
        .get("result")
        .and_then(|res| res.get("value"))
        .cloned()
        .unwrap_or(Value::Null);
    Ok(json!({ "ok": true, "method": "select", "result": result }))
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

/// Find the app's SURVIVING main window after `closing` is closed: another visible
/// top-level window of the SAME process that isn't the one being closed and isn't
/// Voice Mirror itself. Resolved BEFORE the WM_CLOSE so the closing window is still
/// alive (its process is resolvable). Lets the live preview re-point deterministically
/// to a live window instead of nulling the target (which races the WGC teardown).
#[cfg(windows)]
fn surviving_app_window(closing: i64) -> Option<i64> {
    let windows = crate::commands::screenshot::list_visible_windows_metadata().ok()?;
    let proc = windows
        .iter()
        .find(|w| w.hwnd == closing)
        .map(|w| w.process_name.clone())?;
    windows
        .into_iter()
        .find(|w| {
            w.hwnd != closing
                && !w.process_name.is_empty()
                && w.process_name == proc
                && !w.title.trim().is_empty()
                && !is_host_window(w.hwnd, &w.title)
        })
        .map(|w| w.hwnd)
}

/// Close the window Claude is currently driving (the last snapshot's window) by
/// posting `WM_CLOSE` — the graceful close you'd get from the title-bar X, which
/// is native OS chrome that CDP/DOM can't reach. Re-points the active window to the
/// app's surviving main window so the live preview follows to a live window
/// deterministically (rather than nulling the target, which left the preview
/// relying on a snap-back that raced the WGC teardown and could wedge it).
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
    // Resolve the surviving sibling BEFORE closing (the window is still alive now,
    // so its process is resolvable and the sibling list is accurate).
    let surviving = surviving_app_window(hwnd);
    unsafe {
        let h = HWND(hwnd as *mut std::ffi::c_void);
        PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0))
            .map_err(|e| format!("Failed to close window: {}", e))?;
    }
    // Point the preview at the surviving window (or None — find_app_hwnd then
    // title-matches the main window — if no sibling was found).
    set_active_hwnd(surviving);
    Ok(json!({ "ok": true, "closedHwnd": hwnd, "activeHwnd": surviving }))
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
