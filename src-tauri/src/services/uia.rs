//! UI Automation (UIA) backend — drive NATIVE (non-CDP) Windows app windows.
//!
//! This is the tier-3 sibling of [`crate::services::sandbox`] (CDP). Where the CDP
//! path drives a Tauri/WebView2 app's web contents, this path drives ANY native
//! top-level window — Calculator, Notepad, Settings, Win32/WinForms/WPF/Qt — via
//! the Microsoft UI Automation COM API.
//!
//! The whole point is that the OUTPUT is identical to the CDP path: the same
//! `- {role} "{name}" @e{n}` tree lines, the same `@ref` model, and the same JSON
//! shape that [`crate::services::sandbox::snapshot`] returns. The agent (and the
//! whole preview/screenshot pipeline) can't tell CDP from UIA — same tool names,
//! same response, different engine underneath.
//!
//! ## COM / threading model
//! COM interface pointers (`IUIAutomationElement`, …) are NOT `Send`, so they can
//! never cross a thread boundary. We therefore run ALL UIA work on a single,
//! long-lived **MTA worker thread**: it `CoInitializeEx(COINIT_MULTITHREADED)`
//! once, creates one `IUIAutomation`, and owns a thread-LOCAL ref store
//! (`HashMap<hwnd, HashMap<ref, StoredRef>>` where `StoredRef` holds the live
//! element). Commands arrive over an `mpsc` channel, each carrying a
//! `tokio::sync::oneshot` reply. Only the JSON `Value` (or an error string) crosses
//! back to the async caller — never a COM pointer. The public async fns
//! ([`snapshot`], [`click`], [`type_text`]) just send a command and await the reply.

#[cfg(windows)]
pub use sys::{click, snapshot, type_text};

// ───────────────────────────────────── Windows implementation ─────────────────
#[cfg(windows)]
mod sys {
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::sync::OnceLock;

    use serde_json::{json, Value};
    use tokio::sync::oneshot;
    use tracing::warn;

    use windows::core::BSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, SAFEARRAY,
    };
    use windows::Win32::System::Ole::SafeArrayDestroy;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
        IUIAutomationLegacyIAccessiblePattern, IUIAutomationSelectionItemPattern,
        IUIAutomationTogglePattern, IUIAutomationValuePattern, TreeScope_Descendants,
        UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId, UIA_ComboBoxControlTypeId,
        UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_HyperlinkControlTypeId,
        UIA_InvokePatternId, UIA_LegacyIAccessiblePatternId, UIA_ListControlTypeId,
        UIA_ListItemControlTypeId, UIA_MenuItemControlTypeId, UIA_RadioButtonControlTypeId,
        UIA_SelectionItemPatternId, UIA_SliderControlTypeId, UIA_TabItemControlTypeId,
        UIA_TextControlTypeId, UIA_TogglePatternId, UIA_TreeItemControlTypeId, UIA_ValuePatternId,
    };

    use crate::services::sandbox::{self, ActiveBackend};

    /// Cap on emitted refs per snapshot (mirrors the CDP path's node budget).
    const MAX_REFS: usize = 1500;

    // ── Worker thread plumbing ────────────────────────────────────────────────

    /// A ref'd element, kept ALIVE on the worker thread (the COM ptr never leaves).
    struct StoredRef {
        element: IUIAutomationElement,
        #[allow(dead_code)]
        role: String,
        #[allow(dead_code)]
        name: String,
        runtime_id: Vec<i32>,
        center: (i32, i32),
        #[allow(dead_code)]
        control_type: i32,
    }

    enum UiaCmd {
        Snapshot {
            hwnd: i64,
            window: Option<String>,
            reply: oneshot::Sender<Result<Value, String>>,
        },
        Click {
            hwnd: i64,
            ref_str: String,
            reply: oneshot::Sender<Result<Value, String>>,
        },
        Type {
            hwnd: i64,
            ref_str: String,
            text: String,
            reply: oneshot::Sender<Result<Value, String>>,
        },
    }

    static SENDER: OnceLock<mpsc::Sender<UiaCmd>> = OnceLock::new();

    /// The (lazily-spawned) MTA worker thread's command sender.
    fn sender() -> &'static mpsc::Sender<UiaCmd> {
        SENDER.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<UiaCmd>();
            std::thread::Builder::new()
                .name("uia-worker".into())
                .spawn(move || worker_main(rx))
                .expect("failed to spawn UIA worker thread");
            tx
        })
    }

    /// The worker: init COM once, create one IUIAutomation, service commands.
    fn worker_main(rx: mpsc::Receiver<UiaCmd>) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let automation: IUIAutomation =
                match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                    Ok(a) => a,
                    Err(e) => {
                        let msg = format!("Failed to create UIAutomation COM object: {}", e);
                        warn!("[uia] {}", msg);
                        // Keep the channel drained so callers get a clear error
                        // instead of a dropped-reply error.
                        while let Ok(cmd) = rx.recv() {
                            reply_err(cmd, &msg);
                        }
                        return;
                    }
                };

            let mut store: HashMap<i64, HashMap<String, StoredRef>> = HashMap::new();

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    UiaCmd::Snapshot {
                        hwnd,
                        window,
                        reply,
                    } => {
                        let r = do_snapshot(&automation, hwnd, window.as_deref(), &mut store);
                        let _ = reply.send(r);
                    }
                    UiaCmd::Click {
                        hwnd,
                        ref_str,
                        reply,
                    } => {
                        let r = do_click(&automation, hwnd, &store, &ref_str);
                        let _ = reply.send(r);
                    }
                    UiaCmd::Type {
                        hwnd,
                        ref_str,
                        text,
                        reply,
                    } => {
                        let r = do_type(&automation, hwnd, &store, &ref_str, &text);
                        let _ = reply.send(r);
                    }
                }
            }
        }
    }

    fn reply_err(cmd: UiaCmd, msg: &str) {
        let e = Err(msg.to_string());
        match cmd {
            UiaCmd::Snapshot { reply, .. } => {
                let _ = reply.send(e);
            }
            UiaCmd::Click { reply, .. } => {
                let _ = reply.send(e);
            }
            UiaCmd::Type { reply, .. } => {
                let _ = reply.send(e);
            }
        }
    }

    // ── Public async API (mirrors services::sandbox) ──────────────────────────

    /// Snapshot a native window's UI as the same `@ref` element model the CDP path
    /// uses. Records the active window/backend so follow-up click/type + the
    /// preview/screenshot pipeline all target this window.
    pub async fn snapshot(hwnd: i64, window: Option<&str>) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        sender()
            .send(UiaCmd::Snapshot {
                hwnd,
                window: window.map(|s| s.to_string()),
                reply: tx,
            })
            .map_err(|e| format!("UIA worker thread unavailable: {}", e))?;
        // Bound the wait: a hung native app can make the worker's COM calls
        // (FindAll/Invoke/SetForegroundWindow) block indefinitely; without this the
        // caller (and any queued UIA op) would await forever. Time out instead.
        tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "UIA operation timed out (target app unresponsive)".to_string())?
            .map_err(|e| format!("UIA worker dropped the reply: {}", e))?
    }

    /// Click an element by `@ref` from the last snapshot on this window.
    pub async fn click(hwnd: i64, ref_str: &str) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        sender()
            .send(UiaCmd::Click {
                hwnd,
                ref_str: ref_str.to_string(),
                reply: tx,
            })
            .map_err(|e| format!("UIA worker thread unavailable: {}", e))?;
        // Bound the wait: a hung native app can make the worker's COM calls
        // (FindAll/Invoke/SetForegroundWindow) block indefinitely; without this the
        // caller (and any queued UIA op) would await forever. Time out instead.
        tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "UIA operation timed out (target app unresponsive)".to_string())?
            .map_err(|e| format!("UIA worker dropped the reply: {}", e))?
    }

    /// Type text into an element by `@ref` from the last snapshot on this window.
    pub async fn type_text(hwnd: i64, ref_str: &str, text: &str) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        sender()
            .send(UiaCmd::Type {
                hwnd,
                ref_str: ref_str.to_string(),
                text: text.to_string(),
                reply: tx,
            })
            .map_err(|e| format!("UIA worker thread unavailable: {}", e))?;
        // Bound the wait: a hung native app can make the worker's COM calls
        // (FindAll/Invoke/SetForegroundWindow) block indefinitely; without this the
        // caller (and any queued UIA op) would await forever. Time out instead.
        tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "UIA operation timed out (target app unresponsive)".to_string())?
            .map_err(|e| format!("UIA worker dropped the reply: {}", e))?
    }

    // ── ControlType → role (mirrors cdp::parse_ax_tree's role vocab) ───────────

    /// Map a UIA ControlType id to a CDP-style role + whether it's interactive.
    /// Interactive roles always get a ref; the lone content role (`content`, from a
    /// named Text) gets a ref only if named — exactly like `parse_ax_tree`.
    fn control_type_role(ct: i32) -> Option<(&'static str, bool)> {
        match ct {
            x if x == UIA_ButtonControlTypeId.0 => Some(("button", true)),
            x if x == UIA_EditControlTypeId.0 => Some(("textbox", true)),
            x if x == UIA_DocumentControlTypeId.0 => Some(("textbox", true)),
            x if x == UIA_CheckBoxControlTypeId.0 => Some(("checkbox", true)),
            x if x == UIA_RadioButtonControlTypeId.0 => Some(("radio", true)),
            x if x == UIA_ComboBoxControlTypeId.0 => Some(("combobox", true)),
            x if x == UIA_ListControlTypeId.0 => Some(("listbox", true)),
            x if x == UIA_ListItemControlTypeId.0 => Some(("option", true)),
            x if x == UIA_MenuItemControlTypeId.0 => Some(("menuitem", true)),
            x if x == UIA_TabItemControlTypeId.0 => Some(("tab", true)),
            x if x == UIA_HyperlinkControlTypeId.0 => Some(("link", true)),
            x if x == UIA_SliderControlTypeId.0 => Some(("slider", true)),
            x if x == UIA_TreeItemControlTypeId.0 => Some(("treeitem", true)),
            x if x == UIA_TextControlTypeId.0 => Some(("content", false)),
            _ => None,
        }
    }

    // ── Snapshot ──────────────────────────────────────────────────────────────

    /// A candidate element, collected in the first pass before nth disambiguation.
    struct Cand {
        role: &'static str,
        name: String,
        element: IUIAutomationElement,
        runtime_id: Vec<i32>,
        center: (i32, i32),
        control_type: i32,
    }

    fn do_snapshot(
        automation: &IUIAutomation,
        hwnd: i64,
        _window: Option<&str>,
        store: &mut HashMap<i64, HashMap<String, StoredRef>>,
    ) -> Result<Value, String> {
        unsafe {
            let root = automation
                .ElementFromHandle(HWND(hwnd as *mut std::ffi::c_void))
                .map_err(|e| format!("UIA ElementFromHandle({}) failed: {}", hwnd, e))?;

            let title = root
                .CurrentName()
                .map(|b| b.to_string())
                .unwrap_or_default()
                .trim()
                .to_string();

            // Host exclusion: NEVER drive Voice Mirror's own window.
            if sandbox::is_host_window(hwnd, &title) {
                return Err(
                    "That window is Voice Mirror itself — not an app to drive. Pick a different \
                     window from capture_list_windows."
                        .to_string(),
                );
            }

            // Flat descendant walk over the ControlView (the standard "drivable
            // controls" view) — simpler and more robust than a manual TreeWalker.
            let cond = automation
                .ControlViewCondition()
                .map_err(|e| format!("UIA ControlViewCondition failed: {}", e))?;
            let arr = root
                .FindAll(TreeScope_Descendants, &cond)
                .map_err(|e| format!("UIA FindAll failed: {}", e))?;
            let len = arr.Length().unwrap_or(0);

            let mut cands: Vec<Cand> = Vec::new();
            for i in 0..len {
                if cands.len() >= MAX_REFS {
                    break;
                }
                let el = match arr.GetElement(i) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let ct = match el.CurrentControlType() {
                    Ok(c) => c.0,
                    Err(_) => continue,
                };
                let (role, interactive) = match control_type_role(ct) {
                    Some(x) => x,
                    None => continue,
                };
                // Skip offscreen + disabled (can't be driven / not visible).
                if el.CurrentIsOffscreen().map(|b| b.as_bool()).unwrap_or(false) {
                    continue;
                }
                if !el.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(true) {
                    continue;
                }
                let name: String = el
                    .CurrentName()
                    .map(|b| b.to_string())
                    .unwrap_or_default()
                    .trim()
                    .chars()
                    .take(120)
                    .collect();
                // Content roles only get a ref if named (mirrors parse_ax_tree).
                if !interactive && name.is_empty() {
                    continue;
                }
                let rect = el.CurrentBoundingRectangle().unwrap_or_default();
                let center = (
                    (rect.left + rect.right) / 2,
                    (rect.top + rect.bottom) / 2,
                );
                let runtime_id = el
                    .GetRuntimeId()
                    .ok()
                    .map(|sa| read_and_destroy_runtime_id(sa))
                    .unwrap_or_default();
                cands.push(Cand {
                    role,
                    name,
                    element: el,
                    runtime_id,
                    center,
                    control_type: ct,
                });
            }

            // Second pass: count role+name pairs, assign sequential refs + nth, and
            // emit the EXACT `- {role} "{name}" @e{n}[ [nth=k]]` lines.
            let mut pair_counts: HashMap<(&'static str, String), u32> = HashMap::new();
            for c in &cands {
                *pair_counts.entry((c.role, c.name.clone())).or_insert(0) += 1;
            }
            let mut nth_tracker: HashMap<(&'static str, String), u32> = HashMap::new();
            let mut lines: Vec<String> = Vec::new();
            let mut refs: HashMap<String, StoredRef> = HashMap::new();
            let mut counter: u32 = 1;
            for c in cands {
                let pair = (c.role, c.name.clone());
                let total = *pair_counts.get(&pair).unwrap_or(&1);
                let nth = if total > 1 {
                    let idx = nth_tracker.entry(pair).or_insert(0);
                    let v = *idx;
                    *idx += 1;
                    Some(v)
                } else {
                    None
                };
                let ref_key = format!("e{}", counter);
                counter += 1;
                let nth_suffix = match nth {
                    Some(n) => format!(" [nth={}]", n),
                    None => String::new(),
                };
                lines.push(format!(
                    "- {} \"{}\" @{}{}",
                    c.role, c.name, ref_key, nth_suffix
                ));
                refs.insert(
                    ref_key,
                    StoredRef {
                        element: c.element,
                        role: c.role.to_string(),
                        name: c.name,
                        runtime_id: c.runtime_id,
                        center: c.center,
                        control_type: c.control_type,
                    },
                );
            }

            let tree = lines.join("\n");
            let ref_count = refs.len();
            store.insert(hwnd, refs);

            // Publish the active window so the WGC preview + screenshot mirror this
            // native window, and mark UIA as the active backend so follow-up
            // click/type route here.
            let (w, h) = sandbox::window_logical_size(hwnd).unwrap_or((0, 0));
            sandbox::set_active_hwnd(Some(hwnd));
            sandbox::set_active_meta(String::new(), title.clone(), 0, String::new(), w, h);
            sandbox::set_active_backend(Some(ActiveBackend::Uia(hwnd)));
            let pid = sandbox::pid_of_hwnd(hwnd);

            let windows = json!([{
                "index": 0,
                "label": "",
                "title": title,
                "url": "",
                "width": w,
                "height": h,
            }]);

            Ok(json!({
                "tree": tree,
                "refCount": ref_count,
                "activeWindow": title,
                "activeLabel": "",
                "activeWidth": w,
                "activeHeight": h,
                "activeIndex": 0,
                "pid": pid,
                "pageUrl": "",
                "windows": windows,
            }))
        }
    }

    // ── Click ─────────────────────────────────────────────────────────────────

    fn do_click(
        automation: &IUIAutomation,
        hwnd: i64,
        store: &HashMap<i64, HashMap<String, StoredRef>>,
        ref_str: &str,
    ) -> Result<Value, String> {
        let refs = store.get(&hwnd).ok_or(
            "No UIA snapshot for this window yet — call sandbox_snapshot (with this window) first",
        )?;
        let key = resolve_key(refs, ref_str)?;
        let stored = refs.get(&key).unwrap();
        let element = stored.element.clone();
        let center = stored.center;
        let runtime_id = stored.runtime_id.clone();

        unsafe {
            // If the stored element went stale, re-find it by runtime id.
            let element = if element.CurrentControlType().is_err() {
                refind_by_runtime_id(automation, hwnd, &runtime_id).unwrap_or(element)
            } else {
                element
            };

            // Prefer UIA patterns (no focus-stealing) over synthetic input.
            if let Ok(p) = element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
            {
                if p.Invoke().is_ok() {
                    return Ok(json!({ "ok": true, "method": "invoke" }));
                }
            }
            if let Ok(p) =
                element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            {
                if p.Toggle().is_ok() {
                    return Ok(json!({ "ok": true, "method": "toggle" }));
                }
            }
            if let Ok(p) = element
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
            {
                if p.Select().is_ok() {
                    return Ok(json!({ "ok": true, "method": "select" }));
                }
            }
            if let Ok(p) = element.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(
                UIA_LegacyIAccessiblePatternId,
            ) {
                if p.DoDefaultAction().is_ok() {
                    return Ok(json!({ "ok": true, "method": "legacy" }));
                }
            }

            // Last resort: synthetic mouse click at the element center.
            sendinput_click(hwnd, center)?;
            Ok(json!({ "ok": true, "method": "sendinput" }))
        }
    }

    // ── Type ──────────────────────────────────────────────────────────────────

    fn do_type(
        automation: &IUIAutomation,
        hwnd: i64,
        store: &HashMap<i64, HashMap<String, StoredRef>>,
        ref_str: &str,
        text: &str,
    ) -> Result<Value, String> {
        let refs = store.get(&hwnd).ok_or(
            "No UIA snapshot for this window yet — call sandbox_snapshot (with this window) first",
        )?;
        let key = resolve_key(refs, ref_str)?;
        let stored = refs.get(&key).unwrap();
        let element = stored.element.clone();
        let runtime_id = stored.runtime_id.clone();

        unsafe {
            let element = if element.CurrentControlType().is_err() {
                refind_by_runtime_id(automation, hwnd, &runtime_id).unwrap_or(element)
            } else {
                element
            };

            // Prefer ValuePattern.SetValue (no focus-stealing).
            if let Ok(p) =
                element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            {
                let bstr = BSTR::from(text);
                if p.SetValue(&bstr).is_ok() {
                    return Ok(json!({ "ok": true, "method": "value" }));
                }
            }

            // Fallback: focus + unicode keystrokes.
            let _ = element.SetFocus();
            send_unicode_text(text);
            Ok(json!({ "ok": true, "method": "sendinput", "length": text.chars().count() }))
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Resolve a `@e7` / `e7` ref string to the stored key (mirrors sandbox lookup).
    fn resolve_key(refs: &HashMap<String, StoredRef>, ref_str: &str) -> Result<String, String> {
        let stripped = ref_str.trim_start_matches('@');
        if refs.contains_key(ref_str) {
            return Ok(ref_str.to_string());
        }
        if refs.contains_key(stripped) {
            return Ok(stripped.to_string());
        }
        let at = format!("@{}", stripped);
        if refs.contains_key(&at) {
            return Ok(at);
        }
        Err(format!("Unknown ref '{}' (snapshot may be stale)", ref_str))
    }

    /// Read a 1-D `SAFEARRAY` of i32 (a UIA runtime id) into a Vec, then destroy it.
    unsafe fn read_and_destroy_runtime_id(psa: *mut SAFEARRAY) -> Vec<i32> {
        if psa.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        let sa = &*psa;
        if sa.cDims == 1 {
            let count = sa.rgsabound[0].cElements as usize;
            let data = sa.pvData as *const i32;
            if !data.is_null() {
                for i in 0..count {
                    out.push(*data.add(i));
                }
            }
        }
        let _ = SafeArrayDestroy(psa);
        out
    }

    /// Re-find an element by its runtime id via a RawView descendant walk (used when
    /// a stored element has gone stale, e.g. the UI rebuilt its subtree).
    unsafe fn refind_by_runtime_id(
        automation: &IUIAutomation,
        hwnd: i64,
        rid: &[i32],
    ) -> Option<IUIAutomationElement> {
        if rid.is_empty() {
            return None;
        }
        let root = automation
            .ElementFromHandle(HWND(hwnd as *mut std::ffi::c_void))
            .ok()?;
        let cond = automation.RawViewCondition().ok()?;
        let arr = root.FindAll(TreeScope_Descendants, &cond).ok()?;
        let len = arr.Length().unwrap_or(0);
        for i in 0..len {
            if let Ok(el) = arr.GetElement(i) {
                if let Ok(sa) = el.GetRuntimeId() {
                    if read_and_destroy_runtime_id(sa) == rid {
                        return Some(el);
                    }
                }
            }
        }
        None
    }

    /// Synthetic left-click at a screen coordinate via SendInput (absolute, over the
    /// whole virtual desktop). Foregrounds the window first so the click lands.
    unsafe fn sendinput_click(hwnd: i64, center: (i32, i32)) -> Result<(), String> {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN,
            MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT,
            MOUSE_EVENT_FLAGS,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SetForegroundWindow, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
            SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
        };

        let _ = SetForegroundWindow(HWND(hwnd as *mut std::ffi::c_void));

        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1);
        let nx = (((center.0 - vx) as f64) * 65535.0 / ((vw - 1).max(1) as f64)).round() as i32;
        let ny = (((center.1 - vy) as f64) * 65535.0 / ((vh - 1).max(1) as f64)).round() as i32;
        let abs = MOUSEEVENTF_ABSOLUTE.0 | MOUSEEVENTF_VIRTUALDESK.0;

        let mk = |flags: u32| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: nx,
                    dy: ny,
                    mouseData: 0,
                    dwFlags: MOUSE_EVENT_FLAGS(flags),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [
            mk(MOUSEEVENTF_MOVE.0 | abs),
            mk(MOUSEEVENTF_LEFTDOWN.0 | abs),
            mk(MOUSEEVENTF_LEFTUP.0 | abs),
        ];
        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent == 0 {
            return Err("SendInput (mouse click) was blocked".to_string());
        }
        Ok(())
    }

    /// Type a string as unicode keystrokes via SendInput (KEYEVENTF_UNICODE).
    unsafe fn send_unicode_text(text: &str) {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
        };
        let mut inputs: Vec<INPUT> = Vec::new();
        for unit in text.encode_utf16() {
            let mk = |up: bool| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: unit,
                        dwFlags: if up {
                            KEYBD_EVENT_FLAGS(KEYEVENTF_UNICODE.0 | KEYEVENTF_KEYUP.0)
                        } else {
                            KEYEVENTF_UNICODE
                        },
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            inputs.push(mk(false));
            inputs.push(mk(true));
        }
        if !inputs.is_empty() {
            let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

// ───────────────────────────────────── Non-Windows stubs ──────────────────────
#[cfg(not(windows))]
pub async fn snapshot(_hwnd: i64, _window: Option<&str>) -> Result<serde_json::Value, String> {
    Err("UIA is Windows-only".to_string())
}

#[cfg(not(windows))]
pub async fn click(_hwnd: i64, _ref_str: &str) -> Result<serde_json::Value, String> {
    Err("UIA is Windows-only".to_string())
}

#[cfg(not(windows))]
pub async fn type_text(
    _hwnd: i64,
    _ref_str: &str,
    _text: &str,
) -> Result<serde_json::Value, String> {
    Err("UIA is Windows-only".to_string())
}
