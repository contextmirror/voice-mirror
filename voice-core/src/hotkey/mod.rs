//! Global hotkey / push-to-talk listener.
//!
//! Captures keyboard and mouse events system-wide using `rdev` for
//! cross-platform support. Sends hotkey events (PTT down/up, dictation
//! down/up) via a channel to the main event loop.
//!
//! Platform-specific backends:
//! - Windows: `rdev` with Win32 hooks (via windows crate for advanced suppression)
//! - Linux: `rdev` on X11, `evdev` on Wayland
//! - macOS: `rdev` via Quartz

pub mod linux;
pub mod macos;
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use rdev::{listen, Event, EventType, Key};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Events emitted by the hotkey listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyEvent {
    /// Push-to-talk key pressed down (start recording).
    PttDown,
    /// Push-to-talk key released (stop recording).
    PttUp,
    /// Dictation key pressed down (start dictation recording).
    DictationDown,
    /// Dictation key released (stop dictation recording).
    DictationUp,
}

/// Configuration for hotkey bindings.
#[derive(Debug, Clone)]
pub struct HotkeyConfig {
    /// Key binding for push-to-talk (e.g. "MouseButton5", "F5", "space").
    pub ptt_key: Option<String>,
    /// Key binding for dictation mode (e.g. "MouseButton4", "F6").
    pub dictation_key: Option<String>,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            ptt_key: Some("MouseButton5".to_string()),
            dictation_key: None,
        }
    }
}

/// Global hotkey listener using rdev for cross-platform key/mouse capture.
pub struct HotkeyListener {
    config: HotkeyConfig,
    running: Arc<AtomicBool>,
}

impl HotkeyListener {
    pub fn new(config: HotkeyConfig) -> Self {
        Self {
            config,
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start listening for hotkeys in a background thread.
    /// Sends `HotkeyEvent`s to the provided channel.
    pub fn start(&self, tx: mpsc::Sender<HotkeyEvent>) {
        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();

        let ptt_target = self.config.ptt_key.as_ref().map(|k| parse_key(k));
        let dict_target = self.config.dictation_key.as_ref().map(|k| parse_key(k));

        if ptt_target.is_none() && dict_target.is_none() {
            warn!("No hotkey bindings configured");
            return;
        }

        info!(
            ptt = ?self.config.ptt_key,
            dictation = ?self.config.dictation_key,
            "Starting hotkey listener"
        );

        // Track press state to distinguish down/up
        let ptt_pressed = Arc::new(AtomicBool::new(false));
        let dict_pressed = Arc::new(AtomicBool::new(false));

        let ptt_pressed_clone = ptt_pressed.clone();
        let dict_pressed_clone = dict_pressed.clone();

        thread::spawn(move || {
            let callback = move |event: Event| {
                if !running.load(Ordering::SeqCst) {
                    return;
                }

                match event.event_type {
                    EventType::KeyPress(key) => {
                        if let Some(Some(target)) = ptt_target.as_ref() {
                            if matches_rdev_key(&key, target) && !ptt_pressed_clone.load(Ordering::SeqCst) {
                                ptt_pressed_clone.store(true, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::PttDown);
                            }
                        }
                        if let Some(Some(target)) = dict_target.as_ref() {
                            if matches_rdev_key(&key, target) && !dict_pressed_clone.load(Ordering::SeqCst) {
                                dict_pressed_clone.store(true, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::DictationDown);
                            }
                        }
                    }
                    EventType::KeyRelease(key) => {
                        if let Some(Some(target)) = ptt_target.as_ref() {
                            if matches_rdev_key(&key, target) && ptt_pressed_clone.load(Ordering::SeqCst) {
                                ptt_pressed_clone.store(false, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::PttUp);
                            }
                        }
                        if let Some(Some(target)) = dict_target.as_ref() {
                            if matches_rdev_key(&key, target) && dict_pressed_clone.load(Ordering::SeqCst) {
                                dict_pressed_clone.store(false, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::DictationUp);
                            }
                        }
                    }
                    EventType::ButtonPress(button) => {
                        if let Some(Some(target)) = ptt_target.as_ref() {
                            if matches_rdev_button(&button, target) && !ptt_pressed_clone.load(Ordering::SeqCst) {
                                ptt_pressed_clone.store(true, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::PttDown);
                            }
                        }
                        if let Some(Some(target)) = dict_target.as_ref() {
                            if matches_rdev_button(&button, target) && !dict_pressed_clone.load(Ordering::SeqCst) {
                                dict_pressed_clone.store(true, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::DictationDown);
                            }
                        }
                    }
                    EventType::ButtonRelease(button) => {
                        if let Some(Some(target)) = ptt_target.as_ref() {
                            if matches_rdev_button(&button, target) && ptt_pressed_clone.load(Ordering::SeqCst) {
                                ptt_pressed_clone.store(false, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::PttUp);
                            }
                        }
                        if let Some(Some(target)) = dict_target.as_ref() {
                            if matches_rdev_button(&button, target) && dict_pressed_clone.load(Ordering::SeqCst) {
                                dict_pressed_clone.store(false, Ordering::SeqCst);
                                let _ = tx.blocking_send(HotkeyEvent::DictationUp);
                            }
                        }
                    }
                    _ => {}
                }
            };

            if let Err(e) = listen(callback) {
                warn!("Hotkey listener error: {:?}", e);
            }
        });
    }

    /// Stop the hotkey listener.
    #[allow(dead_code)]
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

/// Parsed target: either a keyboard key or a mouse button identifier.
#[derive(Debug, Clone)]
enum HotkeyTarget {
    Keyboard(Key),
    MouseButton(rdev::Button),
}

/// Parse a key name string (from config) into an rdev target.
fn parse_key(name: &str) -> Option<HotkeyTarget> {
    let name_lower = name.to_lowercase().trim().to_string();

    // Mouse buttons
    match name_lower.as_str() {
        "mousebutton3" | "mouse3" | "middleclick" => {
            return Some(HotkeyTarget::MouseButton(rdev::Button::Middle))
        }
        "mousebutton4" | "mouse4" | "xbutton1" => {
            return Some(HotkeyTarget::MouseButton(rdev::Button::Unknown(4)))
        }
        "mousebutton5" | "mouse5" | "xbutton2" => {
            return Some(HotkeyTarget::MouseButton(rdev::Button::Unknown(5)))
        }
        _ => {}
    }

    // Function keys
    let key = match name_lower.as_str() {
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        "space" => Key::Space,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "capslock" => Key::CapsLock,
        "scrolllock" => Key::ScrollLock,
        "pause" => Key::Pause,
        "insert" => Key::Insert,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "delete" => Key::Delete,
        "numlock" => Key::NumLock,
        "arrowup" | "up" => Key::UpArrow,
        "arrowdown" | "down" => Key::DownArrow,
        "arrowleft" | "left" => Key::LeftArrow,
        "arrowright" | "right" => Key::RightArrow,
        // Single characters
        "a" => Key::KeyA,
        "b" => Key::KeyB,
        "c" => Key::KeyC,
        "d" => Key::KeyD,
        "e" => Key::KeyE,
        "f" => Key::KeyF,
        "g" => Key::KeyG,
        "h" => Key::KeyH,
        "i" => Key::KeyI,
        "j" => Key::KeyJ,
        "k" => Key::KeyK,
        "l" => Key::KeyL,
        "m" => Key::KeyM,
        "n" => Key::KeyN,
        "o" => Key::KeyO,
        "p" => Key::KeyP,
        "q" => Key::KeyQ,
        "r" => Key::KeyR,
        "s" => Key::KeyS,
        "t" => Key::KeyT,
        "u" => Key::KeyU,
        "v" => Key::KeyV,
        "w" => Key::KeyW,
        "x" => Key::KeyX,
        "y" => Key::KeyY,
        "z" => Key::KeyZ,
        "0" => Key::Num0,
        "1" => Key::Num1,
        "2" => Key::Num2,
        "3" => Key::Num3,
        "4" => Key::Num4,
        "5" => Key::Num5,
        "6" => Key::Num6,
        "7" => Key::Num7,
        "8" => Key::Num8,
        "9" => Key::Num9,
        _ => {
            warn!("Unknown hotkey: {}", name);
            return None;
        }
    };

    Some(HotkeyTarget::Keyboard(key))
}

/// Check if an rdev Key matches a parsed keyboard target.
fn matches_rdev_key(event_key: &Key, target: &HotkeyTarget) -> bool {
    match target {
        HotkeyTarget::Keyboard(target_key) => event_key == target_key,
        HotkeyTarget::MouseButton(_) => false,
    }
}

/// Check if an rdev Button matches a parsed mouse button target.
fn matches_rdev_button(event_button: &rdev::Button, target: &HotkeyTarget) -> bool {
    match target {
        HotkeyTarget::MouseButton(target_button) => event_button == target_button,
        HotkeyTarget::Keyboard(_) => false,
    }
}
