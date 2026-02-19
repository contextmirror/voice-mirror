use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tracing::{error, info, warn};

use super::IpcResponse;

/// A registered shortcut entry stored in managed state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutEntry {
    /// Unique identifier (e.g. "toggle-voice", "toggle-mute").
    pub id: String,
    /// Key combination string (e.g. "Ctrl+Shift+Space").
    pub keys: String,
    /// Whether this shortcut is currently registered as a global hotkey.
    pub active: bool,
}

/// Managed state for all registered shortcuts.
pub struct ShortcutManagerState(pub Mutex<ShortcutManager>);

pub struct ShortcutManager {
    /// Map of shortcut ID -> entry.
    pub entries: HashMap<String, ShortcutEntry>,
}

impl Default for ShortcutManager {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
}

impl ShortcutManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Payload emitted when a global shortcut fires.
#[derive(Clone, Serialize)]
struct ShortcutTriggered {
    id: String,
    keys: String,
}

/// Register a global hotkey. When triggered, emits "shortcut-triggered" with the shortcut ID.
#[tauri::command]
pub fn register_shortcut(
    app: AppHandle,
    state: tauri::State<'_, ShortcutManagerState>,
    id: String,
    keys: String,
) -> IpcResponse {
    // Validate inputs
    if id.is_empty() || id.len() > 100 {
        return IpcResponse::err("Shortcut ID must be 1-100 characters");
    }
    if keys.is_empty() || keys.len() > 100 {
        return IpcResponse::err("Keys string must be 1-100 characters");
    }

    // Parse the shortcut string
    let shortcut: Shortcut = match keys.parse() {
        Ok(s) => s,
        Err(e) => {
            return IpcResponse::err(format!("Invalid key combination '{}': {}", keys, e));
        }
    };

    // If this ID was already registered, unregister the old one first
    {
        let manager = match state.0.lock() {
            Ok(g) => g,
            Err(e) => return IpcResponse::err(format!("Failed to lock shortcut state: {}", e)),
        };
        if let Some(existing) = manager.entries.get(&id) {
            if existing.active {
                if let Ok(old_shortcut) = existing.keys.parse::<Shortcut>() {
                    let _ = app
                        .global_shortcut()
                        .unregister(old_shortcut);
                }
            }
        }
    }

    // Register the new global shortcut
    let shortcut_id = id.clone();
    let shortcut_keys = keys.clone();
    let app_handle = app.clone();

    let result = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        let event_name = match event.state {
            ShortcutState::Pressed => "shortcut-pressed",
            ShortcutState::Released => "shortcut-released",
        };
        let payload = ShortcutTriggered {
            id: shortcut_id.clone(),
            keys: shortcut_keys.clone(),
        };
        info!("Global shortcut {}: {} ({})", event_name, payload.id, payload.keys);
        if let Err(e) = app_handle.emit(event_name, &payload) {
            error!("Failed to emit {} event: {}", event_name, e);
        }
    });

    match result {
        Ok(_) => {
            let mut manager = match state.0.lock() {
                Ok(g) => g,
                Err(e) => return IpcResponse::err(format!("Failed to lock shortcut state: {}", e)),
            };
            manager.entries.insert(
                id.clone(),
                ShortcutEntry {
                    id: id.clone(),
                    keys: keys.clone(),
                    active: true,
                },
            );
            info!("Registered global shortcut: {} -> {}", id, keys);
            IpcResponse::ok_empty()
        }
        Err(e) => {
            warn!("Failed to register global shortcut {} ({}): {}", id, keys, e);
            // Still store it but mark as inactive
            let mut manager = match state.0.lock() {
                Ok(g) => g,
                Err(e) => return IpcResponse::err(format!("Failed to lock shortcut state: {}", e)),
            };
            manager.entries.insert(
                id.clone(),
                ShortcutEntry {
                    id: id.clone(),
                    keys: keys.clone(),
                    active: false,
                },
            );
            IpcResponse::err(format!("Failed to register shortcut: {}", e))
        }
    }
}

/// Unregister a global hotkey by its ID.
#[tauri::command]
pub fn unregister_shortcut(
    app: AppHandle,
    state: tauri::State<'_, ShortcutManagerState>,
    id: String,
) -> IpcResponse {
    let mut manager = match state.0.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock shortcut state: {}", e)),
    };

    if let Some(entry) = manager.entries.remove(&id) {
        if entry.active {
            if let Ok(shortcut) = entry.keys.parse::<Shortcut>() {
                if let Err(e) = app.global_shortcut().unregister(shortcut) {
                    warn!("Failed to unregister shortcut {} ({}): {}", id, entry.keys, e);
                    return IpcResponse::err(format!("Failed to unregister: {}", e));
                }
            }
        }
        info!("Unregistered shortcut: {} ({})", id, entry.keys);
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err(format!("Shortcut '{}' not found", id))
    }
}

/// List all registered shortcuts and their status.
#[tauri::command]
pub fn list_shortcuts(
    state: tauri::State<'_, ShortcutManagerState>,
) -> IpcResponse {
    let manager = match state.0.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock shortcut state: {}", e)),
    };
    let entries: Vec<&ShortcutEntry> = manager.entries.values().collect();

    match serde_json::to_value(&entries) {
        Ok(data) => IpcResponse::ok(data),
        Err(e) => IpcResponse::err(format!("Serialize error: {}", e)),
    }
}

/// Unregister all global shortcuts. Called during app cleanup.
#[tauri::command]
pub fn unregister_all_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, ShortcutManagerState>,
) -> IpcResponse {
    let mut manager = match state.0.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("Failed to lock shortcut state: {}", e)),
    };

    if let Err(e) = app.global_shortcut().unregister_all() {
        warn!("Failed to unregister all shortcuts: {}", e);
        return IpcResponse::err(format!("Failed to unregister all: {}", e));
    }

    // Mark all as inactive
    for entry in manager.entries.values_mut() {
        entry.active = false;
    }
    manager.entries.clear();

    info!("Unregistered all global shortcuts");
    IpcResponse::ok_empty()
}
