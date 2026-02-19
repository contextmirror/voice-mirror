//! Unified input hook for PTT and other key bindings.
//!
//! Installs both WH_KEYBOARD_LL and WH_MOUSE_LL hooks to capture:
//! - Keyboard keys (including those sent by mouse side buttons via driver software)
//! - Mouse extra buttons (XBUTTON1/2, middle)
//!
//! Configured keys are **suppressed** at the OS level (keyboard hooks only),
//! preventing "44444" in text fields when holding a mouse side button for PTT.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

// ---- Key binding types ----

const KEY_TYPE_NONE: u8 = 0;
const KEY_TYPE_KEYBOARD: u8 = 1;
const KEY_TYPE_MOUSE: u8 = 2;

/// A configurable key binding (PTT key, dictation key, etc.)
struct KeyBinding {
    /// 0=none, 1=keyboard vkey, 2=mouse button
    key_type: AtomicU8,
    /// Virtual key code (for keyboard) or button ID (for mouse)
    key_code: AtomicU32,
    /// Whether the key is currently pressed (for repeat suppression)
    active: AtomicBool,
}

impl KeyBinding {
    const fn new() -> Self {
        Self {
            key_type: AtomicU8::new(KEY_TYPE_NONE),
            key_code: AtomicU32::new(0),
            active: AtomicBool::new(false),
        }
    }

    fn configure(&self, key_type: u8, key_code: u32) {
        self.active.store(false, Ordering::Relaxed);
        self.key_type.store(key_type, Ordering::Release);
        self.key_code.store(key_code, Ordering::Release);
    }

    fn matches_keyboard(&self, vkey: u32) -> bool {
        self.key_type.load(Ordering::Acquire) == KEY_TYPE_KEYBOARD
            && self.key_code.load(Ordering::Acquire) == vkey
    }

    fn matches_mouse(&self, button_id: u32) -> bool {
        self.key_type.load(Ordering::Acquire) == KEY_TYPE_MOUSE
            && self.key_code.load(Ordering::Acquire) == button_id
    }

    fn type_and_code(&self) -> (u8, u32) {
        (
            self.key_type.load(Ordering::Acquire),
            self.key_code.load(Ordering::Acquire),
        )
    }
}

// ---- Shared state ----

static PTT_BINDING: KeyBinding = KeyBinding::new();
static DICTATION_BINDING: KeyBinding = KeyBinding::new();

#[cfg(target_os = "windows")]
static HOOK_APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

// ---- Public API ----

/// Parse a key spec string and configure the PTT binding.
///
/// Formats:
/// - `"kb:52"` — keyboard virtual key code 52 (the "4" key)
/// - `"mouse:4"` — mouse button 4 (XBUTTON1 / back)
/// - `"MouseButton4"` — legacy format, equivalent to `"mouse:4"`
pub fn configure_ptt(key_spec: &str) -> Result<String, String> {
    let (key_type, key_code) = parse_key_spec(key_spec)?;
    PTT_BINDING.configure(key_type, key_code);
    let desc = format_binding(key_type, key_code);
    info!("PTT key configured: {} (spec: {:?})", desc, key_spec);
    Ok(desc)
}

/// Parse a key spec string and configure the dictation binding.
pub fn configure_dictation(key_spec: &str) -> Result<String, String> {
    let (key_type, key_code) = parse_key_spec(key_spec)?;
    DICTATION_BINDING.configure(key_type, key_code);
    let desc = format_binding(key_type, key_code);
    info!("Dictation key configured: {} (spec: {:?})", desc, key_spec);
    Ok(desc)
}

fn parse_key_spec(spec: &str) -> Result<(u8, u32), String> {
    if spec.is_empty() {
        return Ok((KEY_TYPE_NONE, 0));
    }
    // New format: "kb:52" or "mouse:4"
    if let Some(vkey) = spec.strip_prefix("kb:") {
        let code = vkey
            .parse::<u32>()
            .map_err(|_| format!("Invalid vkey: {}", vkey))?;
        return Ok((KEY_TYPE_KEYBOARD, code));
    }
    if let Some(btn) = spec.strip_prefix("mouse:") {
        let code = btn
            .parse::<u32>()
            .map_err(|_| format!("Invalid button: {}", btn))?;
        return Ok((KEY_TYPE_MOUSE, code));
    }
    // Legacy format: "MouseButton4" → mouse button 4
    if let Some(rest) = spec.strip_prefix("MouseButton") {
        let id = rest
            .parse::<u32>()
            .map_err(|_| format!("Invalid MouseButton: {}", rest))?;
        return Ok((KEY_TYPE_MOUSE, id));
    }
    Err(format!(
        "Unknown key spec: '{}'. Use 'kb:CODE' or 'mouse:ID'.",
        spec
    ))
}

fn format_binding(key_type: u8, key_code: u32) -> String {
    match key_type {
        KEY_TYPE_KEYBOARD => format!("keyboard vkey {}", key_code),
        KEY_TYPE_MOUSE => format!("mouse button {}", key_code),
        _ => "none".into(),
    }
}

// ---- Windows-specific hooks ----

#[cfg(target_os = "windows")]
mod win32 {
    use std::ffi::c_int;

    pub type HHOOK = isize;

    pub const WH_KEYBOARD_LL: c_int = 13;
    pub const WH_MOUSE_LL: c_int = 14;

    pub const WM_KEYDOWN: u32 = 0x0100;
    pub const WM_SYSKEYDOWN: u32 = 0x0104;

    pub const WM_MBUTTONDOWN: u32 = 0x0207;
    pub const WM_MBUTTONUP: u32 = 0x0208;
    pub const WM_XBUTTONDOWN: u32 = 0x020B;
    pub const WM_XBUTTONUP: u32 = 0x020C;
    pub const WM_TIMER: u32 = 0x0113;

    pub const VK_CONTROL: i32 = 0x11;
    pub const VK_MENU: i32 = 0x12;
    pub const VK_SHIFT: i32 = 0x10;
    pub const VK_LWIN: i32 = 0x5B;
    pub const VK_RWIN: i32 = 0x5C;

    #[repr(C)]
    pub struct POINT {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    pub struct KBDLLHOOKSTRUCT {
        pub vk_code: u32,
        pub scan_code: u32,
        pub flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    pub struct MSLLHOOKSTRUCT {
        pub pt: POINT,
        pub mouse_data: u32,
        pub flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    pub struct MSG {
        pub hwnd: isize,
        pub message: u32,
        pub wparam: usize,
        pub lparam: isize,
        pub time: u32,
        pub pt: POINT,
    }

    extern "system" {
        pub fn SetWindowsHookExW(
            id_hook: c_int,
            lpfn: unsafe extern "system" fn(c_int, usize, isize) -> isize,
            hmod: isize,
            dw_thread_id: u32,
        ) -> HHOOK;
        pub fn CallNextHookEx(
            hhk: HHOOK,
            n_code: c_int,
            wparam: usize,
            lparam: isize,
        ) -> isize;
        pub fn UnhookWindowsHookEx(hhk: HHOOK) -> i32;
        pub fn GetMessageW(
            msg: *mut MSG,
            hwnd: isize,
            msg_filter_min: u32,
            msg_filter_max: u32,
        ) -> i32;
        pub fn TranslateMessage(msg: *const MSG) -> i32;
        pub fn DispatchMessageW(msg: *const MSG) -> isize;
        pub fn SetTimer(
            hwnd: isize,
            id_event: usize,
            elapse: u32,
            lpfn: Option<unsafe extern "system" fn(isize, u32, usize, u32)>,
        ) -> usize;
        pub fn GetModuleHandleW(module_name: *const u16) -> isize;
        pub fn GetAsyncKeyState(vkey: i32) -> i16;
    }
}

/// Check if any modifier key is currently held.
/// Used to avoid suppressing keys when part of a modifier combo (Ctrl+4, etc.)
#[cfg(target_os = "windows")]
fn modifiers_held() -> bool {
    unsafe {
        win32::GetAsyncKeyState(win32::VK_CONTROL) < 0
            || win32::GetAsyncKeyState(win32::VK_MENU) < 0
            || win32::GetAsyncKeyState(win32::VK_SHIFT) < 0
            || win32::GetAsyncKeyState(win32::VK_LWIN) < 0
            || win32::GetAsyncKeyState(win32::VK_RWIN) < 0
    }
}

/// Handle a press/release for a key binding. Emits Tauri events and
/// suppresses key repeats (only emits on first press, not held repeats).
#[cfg(target_os = "windows")]
fn handle_binding_event(
    binding: &KeyBinding,
    event_pressed: &str,
    event_released: &str,
    is_press: bool,
) {
    if let Some(app) = HOOK_APP_HANDLE.get() {
        if is_press {
            // Only emit on first press (not repeats)
            if !binding.active.swap(true, Ordering::Relaxed) {
                info!("Input hook: emitting {}", event_pressed);
                if let Err(e) = app.emit(event_pressed, ()) {
                    warn!("Input hook: failed to emit {}: {}", event_pressed, e);
                }
            }
        } else {
            if binding.active.swap(false, Ordering::Relaxed) {
                info!("Input hook: emitting {}", event_released);
                if let Err(e) = app.emit(event_released, ()) {
                    warn!("Input hook: failed to emit {}: {}", event_released, e);
                }
            }
        }
    }
}

// ---- Keyboard hook callback ----

#[cfg(target_os = "windows")]
unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if code >= 0 {
        let info = &*(lparam as *const win32::KBDLLHOOKSTRUCT);
        let vkey = info.vk_code;
        let msg = wparam as u32;

        let is_keydown = msg == win32::WM_KEYDOWN || msg == win32::WM_SYSKEYDOWN;

        // Only match single keys — pass through modifier combos (Ctrl+4, Alt+Tab, etc.)
        if !modifiers_held() {
            // Check PTT binding
            if PTT_BINDING.matches_keyboard(vkey) {
                handle_binding_event(
                    &PTT_BINDING,
                    "ptt-key-pressed",
                    "ptt-key-released",
                    is_keydown,
                );
                return 1; // Suppress the key (prevent "4444" in text fields)
            }

            // Check dictation binding
            if DICTATION_BINDING.matches_keyboard(vkey) {
                handle_binding_event(
                    &DICTATION_BINDING,
                    "dictation-key-pressed",
                    "dictation-key-released",
                    is_keydown,
                );
                return 1; // Suppress
            }
        }
    }

    win32::CallNextHookEx(0, code, wparam, lparam)
}

// ---- Mouse hook callback ----

#[cfg(target_os = "windows")]
unsafe extern "system" fn low_level_mouse_proc(
    code: i32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if code >= 0 {
        let msg = wparam as u32;

        let (is_press, button_id) = match msg {
            win32::WM_MBUTTONDOWN => (true, Some(3u32)),
            win32::WM_MBUTTONUP => (false, Some(3u32)),
            win32::WM_XBUTTONDOWN | win32::WM_XBUTTONUP => {
                let hook_info = &*(lparam as *const win32::MSLLHOOKSTRUCT);
                let xbutton = (hook_info.mouse_data >> 16) & 0xFFFF;
                let id = match xbutton {
                    1 => Some(4u32), // XBUTTON1 (back)
                    2 => Some(5u32), // XBUTTON2 (forward)
                    _ => None,
                };
                (msg == win32::WM_XBUTTONDOWN, id)
            }
            _ => (false, None),
        };

        if let Some(id) = button_id {
            // Check PTT binding
            if PTT_BINDING.matches_mouse(id) {
                handle_binding_event(
                    &PTT_BINDING,
                    "ptt-key-pressed",
                    "ptt-key-released",
                    is_press,
                );
            }

            // Check dictation binding
            if DICTATION_BINDING.matches_mouse(id) {
                handle_binding_event(
                    &DICTATION_BINDING,
                    "dictation-key-pressed",
                    "dictation-key-released",
                    is_press,
                );
            }
        }
    }

    win32::CallNextHookEx(0, code, wparam, lparam)
}

// ---- Start the unified hook ----

/// Start the unified input hook on a background thread.
///
/// Installs both WH_KEYBOARD_LL and WH_MOUSE_LL hooks. The hooks check
/// configured key bindings (set via `configure_ptt`/`configure_dictation`)
/// and emit Tauri events when matched. Keyboard keys are suppressed at the
/// OS level to prevent them from reaching other applications.
#[cfg(target_os = "windows")]
pub fn start_input_hook(app_handle: AppHandle) {
    HOOK_APP_HANDLE
        .set(app_handle)
        .expect("Input hook AppHandle already set");

    std::thread::Builder::new()
        .name("input-hook".into())
        .spawn(|| {
            info!("Starting unified input hook (WH_KEYBOARD_LL + WH_MOUSE_LL)");

            unsafe {
                let hmod = win32::GetModuleHandleW(std::ptr::null());

                let kb_hook = win32::SetWindowsHookExW(
                    win32::WH_KEYBOARD_LL,
                    low_level_keyboard_proc,
                    hmod,
                    0,
                );
                if kb_hook == 0 {
                    error!("Failed to install WH_KEYBOARD_LL hook");
                    return;
                }
                info!("WH_KEYBOARD_LL installed (handle: {})", kb_hook);

                let mouse_hook = win32::SetWindowsHookExW(
                    win32::WH_MOUSE_LL,
                    low_level_mouse_proc,
                    hmod,
                    0,
                );
                if mouse_hook == 0 {
                    error!("Failed to install WH_MOUSE_LL hook");
                    win32::UnhookWindowsHookEx(kb_hook);
                    return;
                }
                info!("WH_MOUSE_LL installed (handle: {})", mouse_hook);

                // Heartbeat timer (60 seconds)
                win32::SetTimer(0, 1, 60_000, None);

                info!("Input hooks ready — configure bindings via configure_ptt/configure_dictation");

                // Message loop — REQUIRED for low-level hooks to fire
                let mut msg: win32::MSG = std::mem::zeroed();
                loop {
                    let ret = win32::GetMessageW(&mut msg, 0, 0, 0);
                    if ret <= 0 {
                        info!("Input hook: GetMessageW returned {}, exiting", ret);
                        break;
                    }

                    // Log heartbeats
                    if msg.message == win32::WM_TIMER {
                        let (ptt_t, ptt_c) = PTT_BINDING.type_and_code();
                        let (dict_t, dict_c) = DICTATION_BINDING.type_and_code();
                        info!(
                            "Input hook heartbeat: ptt=({},{}) dict=({},{})",
                            ptt_t, ptt_c, dict_t, dict_c
                        );
                    }

                    win32::TranslateMessage(&msg);
                    win32::DispatchMessageW(&msg);
                }

                win32::UnhookWindowsHookEx(kb_hook);
                win32::UnhookWindowsHookEx(mouse_hook);
                info!("Input hooks removed, thread exiting");
            }
        })
        .expect("Failed to spawn input hook thread");
}

/// No-op on non-Windows platforms.
#[cfg(not(target_os = "windows"))]
pub fn start_input_hook(_app_handle: AppHandle) {
    info!("Input hook not available on this platform");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_keyboard_spec() {
        assert_eq!(parse_key_spec("kb:52").unwrap(), (KEY_TYPE_KEYBOARD, 52));
        assert_eq!(parse_key_spec("kb:100").unwrap(), (KEY_TYPE_KEYBOARD, 100));
    }

    #[test]
    fn parse_mouse_spec() {
        assert_eq!(parse_key_spec("mouse:4").unwrap(), (KEY_TYPE_MOUSE, 4));
        assert_eq!(parse_key_spec("mouse:5").unwrap(), (KEY_TYPE_MOUSE, 5));
    }

    #[test]
    fn parse_legacy_spec() {
        assert_eq!(
            parse_key_spec("MouseButton4").unwrap(),
            (KEY_TYPE_MOUSE, 4)
        );
        assert_eq!(
            parse_key_spec("MouseButton3").unwrap(),
            (KEY_TYPE_MOUSE, 3)
        );
    }

    #[test]
    fn parse_empty_spec() {
        assert_eq!(parse_key_spec("").unwrap(), (KEY_TYPE_NONE, 0));
    }

    #[test]
    fn parse_invalid_spec() {
        assert!(parse_key_spec("garbage").is_err());
        assert!(parse_key_spec("kb:notanumber").is_err());
    }
}
