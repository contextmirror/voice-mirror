//! IPC bridge: stdin reader and stdout event emitter.
//!
//! Pattern borrowed from wayland-orb/src/ipc.rs — a blocking stdin reader
//! thread that sends deserialized commands through an mpsc channel, plus a
//! helper to emit JSON-line events to stdout.

use std::io::{self, BufRead, Write};

use tokio::sync::mpsc;
use tracing::{debug, error};

use super::{VoiceCommand, VoiceEvent};

/// Emit a `VoiceEvent` as a JSON line on stdout and flush.
pub fn emit_event(event: &VoiceEvent) {
    let json = match serde_json::to_string(event) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("Failed to serialize event: {}", e);
            return;
        }
    };
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    // Ignore write/flush errors — pipe may be closed.
    let _ = writeln!(handle, "{}", json);
    let _ = handle.flush();
}

/// Convenience helper for emitting error events.
pub fn emit_error(message: &str) {
    emit_event(&VoiceEvent::Error {
        message: message.to_string(),
    });
}

/// Normalize incoming JSON: if it has a `"type"` field but no `"command"`
/// field, rename `"type"` to `"command"` so serde can deserialize it.
/// This handles Electron's `sendImage` which sends `{"type": "image", ...}`.
fn normalize_command_json(input: &str) -> String {
    if let Ok(mut obj) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(input)
    {
        if !obj.contains_key("command") {
            if let Some(type_val) = obj.remove("type") {
                obj.insert("command".to_string(), type_val);
                if let Ok(json) = serde_json::to_string(&obj) {
                    return json;
                }
            }
        }
    }
    input.to_string()
}

/// Spawn a blocking thread that reads JSON lines from stdin, deserializes
/// them into `VoiceCommand`, and forwards them through the returned channel.
///
/// The thread exits when stdin is closed (parent process gone) or on
/// unrecoverable read error.
pub fn spawn_stdin_reader() -> mpsc::UnboundedReceiver<VoiceCommand> {
    let (tx, rx) = mpsc::unbounded_channel();

    std::thread::spawn(move || {
        let stdin = io::stdin();
        let reader = stdin.lock();
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if trimmed.is_empty() {
                        continue;
                    }
                    // Electron sometimes sends `{"type": "image", ...}` instead
                    // of `{"command": "image", ...}`. Normalize so serde can
                    // deserialize with the `command` tag.
                    let normalized = normalize_command_json(&trimmed);
                    match serde_json::from_str::<VoiceCommand>(&normalized) {
                        Ok(cmd) => {
                            debug!(?cmd, "Received command from Electron");
                            if tx.send(cmd).is_err() {
                                break; // Receiver dropped — main task is gone.
                            }
                        }
                        Err(e) => {
                            error!("Invalid JSON command: {} — input: {}", e, trimmed);
                            emit_error(&format!("Invalid JSON command: {}", e));
                        }
                    }
                }
                Err(e) => {
                    error!("stdin read error: {}", e);
                    break; // stdin closed
                }
            }
        }
        debug!("stdin reader thread exiting");
    });

    rx
}
