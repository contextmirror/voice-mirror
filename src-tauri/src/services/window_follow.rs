//! Event-driven window-follow for the live App Preview.
//!
//! The preview must mirror the OS window the human (or the app itself) most
//! recently brought to focus, AND the window Claude most recently drove — with
//! the **most-recent action winning**. Polling + a CDP-list gate were laggy and
//! had no human-focus signal, so this module installs an OS focus-event hook
//! (`SetWinEventHook`) and arbitrates between two intents:
//!
//!   * `user_focus`  — a `EVENT_SYSTEM_FOREGROUND` for one of the app's windows
//!                     (the user/app clicked/opened/raised a window).
//!   * `ai_action`   — recorded whenever `sandbox::set_active_hwnd(Some(h))` runs
//!                     (Claude snapshotted/clicked/closed a window).
//!   * `close-retarget` — synthesised when the currently-followed window is
//!                     destroyed/hidden, so we re-point to a surviving window.
//!
//! The freshest intent wins (with ~200ms hysteresis to avoid thrash); the winner
//! is streamed via `window_stream::start` and announced to the frontend with a
//! `sandbox-follow-target` Tauri event. Every decision is logged to the
//! **`preview`** tracing target so it lands in the "App Preview" Output channel.
//!
//! OUT-OF-CONTEXT hooks deliver their callbacks to the INSTALLING thread's message
//! queue, so the owner thread runs a `GetMessageW` pump — mandatory, not optional.
//! A 2.5s backstop timer re-validates the followed window in case a WinEvent was
//! missed.

// ───────────────────────────── Windows impl ─────────────────────────────────
#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Mutex;
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Emitter};

    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Accessibility::{
        SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, KillTimer, PostThreadMessageW, SetTimer, TranslateMessage,
        EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT,
        WINEVENT_SKIPOWNPROCESS, WM_QUIT, WM_TIMER,
    };

    /// A focus/drive intent: a window plus the instant it was recorded.
    #[derive(Clone, Copy)]
    struct Intent {
        hwnd: i64,
        at: Instant,
    }

    /// The app process the hooks filter on. 0 = the follow thread isn't running.
    static FOLLOW_PID: AtomicU32 = AtomicU32::new(0);
    /// True while the follow thread is alive and arbitration is active.
    static RUNNING: AtomicBool = AtomicBool::new(false);
    /// The owner thread's id (for `PostThreadMessageW(WM_QUIT)` on stop).
    static THREAD_ID: AtomicU32 = AtomicU32::new(0);
    /// The owner thread handle, for a clean join on stop.
    static JOIN: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

    /// The three competing intents and the last-switch instant (hysteresis).
    static USER_FOCUS: Mutex<Option<Intent>> = Mutex::new(None);
    static AI_ACTION: Mutex<Option<Intent>> = Mutex::new(None);
    static CLOSE_RETARGET: Mutex<Option<Intent>> = Mutex::new(None);
    static LAST_SWITCH: Mutex<Option<Instant>> = Mutex::new(None);

    /// AppHandle for emitting `sandbox-follow-target` to the frontend.
    static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

    /// ~200ms hysteresis: ignore a switch within this window of the last switch.
    const HYSTERESIS: Duration = Duration::from_millis(200);
    /// Backstop re-validation cadence.
    const BACKSTOP_MS: u32 = 2500;

    // ── Public API ───────────────────────────────────────────────────────────

    /// Record the AppHandle so follow decisions can be emitted to the frontend.
    /// Called once from `lib.rs` setup.
    pub fn set_app_handle(handle: AppHandle) {
        if let Ok(mut g) = APP_HANDLE.lock() {
            *g = Some(handle);
        }
    }

    /// Start following the windows of `app_pid`. Idempotent for the same pid;
    /// re-targets (stop + restart) if the pid changed. No-op for pid 0.
    pub fn start(app_pid: u32) {
        if app_pid == 0 {
            return;
        }
        // Never follow our own (host) process.
        if app_pid == crate::services::sandbox::host_pid() {
            return;
        }
        if RUNNING.load(Ordering::SeqCst) {
            if FOLLOW_PID.load(Ordering::SeqCst) == app_pid {
                return; // already following this app
            }
            stop(); // app pid changed — restart
        }

        clear_intents();
        if let Ok(mut g) = LAST_SWITCH.lock() {
            *g = None;
        }
        FOLLOW_PID.store(app_pid, Ordering::SeqCst);
        RUNNING.store(true, Ordering::SeqCst);

        let handle = std::thread::Builder::new()
            .name("window-follow".into())
            .spawn(move || run_thread(app_pid))
            .ok();
        if let Ok(mut g) = JOIN.lock() {
            *g = handle;
        }
        tracing::info!(target: "preview", "window-follow started for app pid={}", app_pid);
    }

    /// Stop the follow thread (unhooks + exits the message pump) and join it.
    pub fn stop() {
        if !RUNNING.swap(false, Ordering::SeqCst) {
            return; // wasn't running
        }
        FOLLOW_PID.store(0, Ordering::SeqCst);
        // Wake the GetMessageW pump so it returns and the loop exits.
        let tid = THREAD_ID.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
        if let Ok(mut g) = JOIN.lock() {
            if let Some(h) = g.take() {
                // Bound the join so a (theoretically) wedged pump can NEVER freeze
                // the caller — stop() runs on the UI thread. With the timeout-bounded
                // window sends in window_stream the pump can't wedge anymore, so this
                // is belt-and-braces: wait briefly, then move on (a detached helper
                // owns the handle and reaps the thread whenever it finally exits).
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let _ = h.join();
                    let _ = tx.send(());
                });
                if rx.recv_timeout(Duration::from_millis(1500)).is_err() {
                    tracing::warn!(target: "preview", "window-follow pump join timed out — detaching");
                }
            }
        }
        THREAD_ID.store(0, Ordering::SeqCst);
        clear_intents();
        tracing::info!(target: "preview", "window-follow stopped");
    }

    /// Record that Claude drove window `hwnd` (called from `set_active_hwnd`).
    /// A no-op for arbitration when the follow thread isn't running.
    pub fn record_ai_action(hwnd: i64) {
        if hwnd == 0 {
            return;
        }
        set_intent(&AI_ACTION, hwnd);
        arbitrate();
    }

    /// Re-run the arbiter against the current intents (exposed so `set_active_hwnd`
    /// can poke it). Safe to call when not running — it returns immediately.
    pub fn arbitrate() {
        if !RUNNING.load(Ordering::SeqCst) {
            return;
        }
        // Freshest intent wins.
        let user = lock_intent(&USER_FOCUS);
        let ai = lock_intent(&AI_ACTION);
        let close = lock_intent(&CLOSE_RETARGET);

        let mut best: Option<(Intent, &'static str)> = None;
        for (intent, source) in [
            (user, "user-focus"),
            (ai, "ai-action"),
            (close, "close-retarget"),
        ] {
            if let Some(i) = intent {
                if best.map(|(b, _)| i.at > b.at).unwrap_or(true) {
                    best = Some((i, source));
                }
            }
        }
        let (winner, source) = match best {
            Some(x) => x,
            None => return,
        };
        let target = winner.hwnd;

        // NEVER follow a host window, and never a dead one.
        if is_host(target) {
            tracing::debug!(target: "preview", "skip retarget to {:#x} source={} reason=host", target, source);
            return;
        }
        if !crate::services::sandbox::is_window_alive(target) {
            tracing::debug!(target: "preview", "skip retarget to {:#x} source={} reason=dead", target, source);
            return;
        }
        // Already mirroring it — nothing to do.
        if crate::services::window_stream::current_hwnd() == Some(target) {
            return;
        }
        // Hysteresis: ignore a switch within HYSTERESIS of the last switch.
        if let Ok(g) = LAST_SWITCH.lock() {
            if let Some(t) = *g {
                if t.elapsed() < HYSTERESIS {
                    tracing::debug!(target: "preview", "skip retarget to {:#x} source={} reason=hysteresis", target, source);
                    return;
                }
            }
        }

        let from = crate::services::window_stream::current_hwnd().unwrap_or(0);
        match crate::services::window_stream::start(target, 30) {
            Ok(_) => {
                if let Ok(mut g) = LAST_SWITCH.lock() {
                    *g = Some(Instant::now());
                }
                emit_follow(target, source);
                tracing::info!(
                    target: "preview",
                    "decision=retarget source={} from={:#x} to={:#x} reason=\"{}\"",
                    source, from, target, follow_reason(source)
                );
            }
            Err(e) => {
                tracing::warn!(target: "preview", "retarget to {:#x} (source={}) failed: {}", target, source, e);
            }
        }
    }

    // ── Owner thread + message pump ──────────────────────────────────────────

    fn run_thread(app_pid: u32) {
        unsafe {
            THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);

            // Foreground (human/app focus) + window destroy/hide, both filtered to
            // the app's process. OUT-OF-CONTEXT delivers to THIS thread's queue.
            let hook_fg = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_proc),
                app_pid,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            let hook_obj = SetWinEventHook(
                EVENT_OBJECT_DESTROY,
                EVENT_OBJECT_HIDE,
                None,
                Some(win_event_proc),
                app_pid,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );

            // Backstop timer: WM_TIMER lands in this thread's queue every BACKSTOP_MS.
            let timer_id = SetTimer(None, 0, BACKSTOP_MS, None);

            let mut msg = MSG::default();
            loop {
                let got = GetMessageW(&mut msg, None, 0, 0);
                if got.0 <= 0 {
                    // 0 = WM_QUIT retrieved, -1 = error → exit the pump.
                    break;
                }
                if msg.message == WM_TIMER {
                    // Backstop ALSO guarantees the pump exits within BACKSTOP_MS of
                    // stop() even if the WM_QUIT was missed — e.g. a stop() that raced
                    // the thread storing its id (THREAD_ID still 0 when stop() posted).
                    // Without this, that race would block the pump forever → join()
                    // would deadlock → a permanent hang. Belt to the WM_QUIT braces.
                    if !RUNNING.load(Ordering::SeqCst) {
                        break;
                    }
                    reconcile(app_pid);
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if timer_id != 0 {
                let _ = KillTimer(None, timer_id);
            }
            // Unhook unconditionally — UnhookWinEvent is harmless on a null/invalid
            // hook handle and we always want both hooks gone on teardown.
            let _ = UnhookWinEvent(hook_fg);
            let _ = UnhookWinEvent(hook_obj);
        }
    }

    /// The WinEvent callback — runs on the owner thread (out-of-context).
    unsafe extern "system" fn win_event_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        id_object: i32,
        _id_child: i32,
        _id_event_thread: u32,
        _dwms_event_time: u32,
    ) {
        let app_pid = FOLLOW_PID.load(Ordering::SeqCst);
        if app_pid == 0 || hwnd.0.is_null() {
            return;
        }
        let h = hwnd.0 as i64;

        if event == EVENT_SYSTEM_FOREGROUND {
            // Only the app's own, non-host, presentable windows count as focus.
            if crate::services::sandbox::pid_of_hwnd(h) != Some(app_pid) {
                tracing::debug!(target: "preview", "rejected foreground hwnd={:#x} reason=other-pid", h);
                return;
            }
            if is_host(h) {
                tracing::debug!(target: "preview", "rejected foreground hwnd={:#x} reason=host", h);
                return;
            }
            if !crate::services::sandbox_stream::is_hwnd_presentable(h) {
                tracing::debug!(target: "preview", "rejected foreground hwnd={:#x} reason=not-presentable", h);
                return;
            }
            set_intent(&USER_FOCUS, h);
            arbitrate();
        } else if event == EVENT_OBJECT_DESTROY || event == EVENT_OBJECT_HIDE {
            // OBJID_WINDOW (0) = the window object itself (not a child control), and
            // only when it's the window we are CURRENTLY following.
            if id_object != 0 {
                return;
            }
            if crate::services::window_stream::current_hwnd() != Some(h) {
                return;
            }
            // Don't touch the dying hwnd — resolve a replacement from live state.
            if let Some(new) = resolve_after_close(h, app_pid) {
                set_intent(&CLOSE_RETARGET, new);
                arbitrate();
            }
        }
    }

    /// 2.5s backstop: re-validate the followed window in case a WinEvent was missed.
    fn reconcile(app_pid: u32) {
        if !RUNNING.load(Ordering::SeqCst) {
            return;
        }
        // A CDP-screencast-backed preview owns the stream and has no single WGC
        // window — never disturb it.
        if crate::services::window_stream::is_external() {
            return;
        }
        match crate::services::window_stream::current_hwnd() {
            Some(h) if !crate::services::sandbox::is_window_alive(h) => {
                // The followed window died and we missed the destroy event.
                if let Some(new) = resolve_after_close(h, app_pid) {
                    tracing::debug!(target: "preview", "reconcile: followed hwnd={:#x} is dead — retargeting", h);
                    set_intent(&CLOSE_RETARGET, new);
                    arbitrate();
                }
            }
            None => {
                // Nothing followed yet (e.g. a first-frame race) — adopt the app's
                // foreground window if it's presentable.
                if let Some(fg) = crate::services::sandbox::foreground_hwnd() {
                    if crate::services::sandbox::pid_of_hwnd(fg) == Some(app_pid)
                        && !is_host(fg)
                        && crate::services::sandbox_stream::is_hwnd_presentable(fg)
                    {
                        set_intent(&USER_FOCUS, fg);
                        arbitrate();
                    }
                }
            }
            _ => {} // followed window alive — leave it.
        }
    }

    /// Resolve the window to follow after `closing` is destroyed/hidden: the new
    /// foreground window if it's an app window, else the app's surviving main one.
    fn resolve_after_close(closing: i64, app_pid: u32) -> Option<i64> {
        if let Some(fg) = crate::services::sandbox::foreground_hwnd() {
            if fg != closing
                && crate::services::sandbox::pid_of_hwnd(fg) == Some(app_pid)
                && !is_host(fg)
                && crate::services::sandbox_stream::is_hwnd_presentable(fg)
            {
                return Some(fg);
            }
        }
        crate::services::sandbox::surviving_app_window(closing)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn set_intent(cell: &Mutex<Option<Intent>>, hwnd: i64) {
        if let Ok(mut g) = cell.lock() {
            *g = Some(Intent {
                hwnd,
                at: Instant::now(),
            });
        }
    }

    fn lock_intent(cell: &Mutex<Option<Intent>>) -> Option<Intent> {
        cell.lock().ok().and_then(|g| *g)
    }

    fn clear_intents() {
        for cell in [&USER_FOCUS, &AI_ACTION, &CLOSE_RETARGET] {
            if let Ok(mut g) = cell.lock() {
                *g = None;
            }
        }
    }

    /// True if `hwnd` is Voice Mirror's own (host) window — never followable.
    fn is_host(hwnd: i64) -> bool {
        if crate::services::sandbox::host_hwnd() == Some(hwnd) {
            return true;
        }
        crate::services::sandbox::pid_of_hwnd(hwnd) == Some(crate::services::sandbox::host_pid())
    }

    fn follow_reason(source: &str) -> &'static str {
        match source {
            "user-focus" => "user/app brought a window to the foreground",
            "ai-action" => "Claude drove this window",
            "close-retarget" => "followed window closed — retargeted to a surviving window",
            _ => "follow",
        }
    }

    fn emit_follow(hwnd: i64, source: &str) {
        if let Ok(g) = APP_HANDLE.lock() {
            if let Some(handle) = g.as_ref() {
                let _ = handle.emit(
                    "sandbox-follow-target",
                    serde_json::json!({
                        "hwnd": hwnd,
                        "source": source,
                        "reason": follow_reason(source),
                    }),
                );
            }
        }
    }
}

#[cfg(windows)]
pub use imp::*;

// ─────────────────────────── Non-Windows stubs ──────────────────────────────
#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;

    pub fn set_app_handle(_handle: AppHandle) {}
    pub fn start(_app_pid: u32) {}
    pub fn stop() {}
    pub fn record_ai_action(_hwnd: i64) {}
    pub fn arbitrate() {}
}

#[cfg(not(windows))]
pub use imp::*;
