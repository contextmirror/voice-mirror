//! Browser panel (Lens) commands.
//!
//! ## Module structure
//!
//! - `webview_setup` — WebView2 creation internals, init scripts, scheme handlers
//! - `tabs` — tab create/close/switch commands
//! - `navigation` — navigate, back/forward, reload, resize, visibility, cache
//! - `devtools` — DevTools panel + CDP method calls
//! - `device_preview` — responsive design preview webviews + emulation
//! - `find` — find on page (window.find wrappers)
//! - `zoom` — tab zoom factor commands
//! - `history` — browser history persistence
//! - `downloads` — download manager queries

mod webview_setup;
pub mod devtools;
pub mod device_preview;
pub mod find;
pub mod history;
pub mod downloads;
pub mod zoom;

pub mod tabs;
pub mod navigation;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use super::IpcResponse;

// ── Types & State ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub total_bytes: i64,
    pub received_bytes: i64,
    pub state: String, // "downloading", "completed", "interrupted"
    pub path: String,
    pub timestamp: u128,
}

/// A single browser tab backed by a native WebView2 instance.
pub struct BrowserTab {
    pub webview_label: String,
    pub zoom_factor: f64,
}

/// A device-preview webview tied to a responsive-design preset.
pub struct DeviceWebview {
    pub preset_id: String,
    pub webview_label: String,
}

/// Managed state tracking all browser tabs, the active tab, and shared bounds.
pub struct LensState {
    pub tabs: Mutex<HashMap<String, BrowserTab>>,
    pub active_tab_id: Mutex<Option<String>>,
    /// Last-known webview bounds (x, y, width, height) in logical pixels.
    pub bounds: Mutex<Option<(f64, f64, f64, f64)>>,
    /// Device-preview webviews for responsive design mode.
    pub device_webviews: Mutex<Vec<DeviceWebview>>,
    /// In-memory download tracker. Arc allows cloning into COM handler closures.
    pub downloads: Arc<Mutex<Vec<DownloadEntry>>>,
    /// Label of the DevTools side-panel webview (if open).
    pub devtools_label: Mutex<Option<String>>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Get the active lens webview from state, or return an IpcResponse error.
fn get_lens_webview(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, LensState>,
) -> Result<tauri::Webview, IpcResponse> {
    let active_id = state
        .active_tab_id
        .lock()
        .map_err(|e| IpcResponse::err(format!("Lock error: {}", e)))?
        .clone()
        .ok_or_else(|| IpcResponse::err("No active browser tab"))?;
    let tabs = state
        .tabs
        .lock()
        .map_err(|e| IpcResponse::err(format!("Lock error: {}", e)))?;
    let tab = tabs
        .get(&active_id)
        .ok_or_else(|| IpcResponse::err("Active tab not found"))?;
    app.get_webview(&tab.webview_label)
        .ok_or_else(|| IpcResponse::err("Lens webview not found"))
}

/// Get the current active tab ID (cloned out of the lock).
fn get_active_tab_id(
    state: &tauri::State<'_, LensState>,
) -> Result<Option<String>, String> {
    state
        .active_tab_id
        .lock()
        .map(|g| g.clone())
        .map_err(|e| format!("Lock error: {}", e))
}

// ── Re-exports ───────────────────────────────────────────────────────────────
// All pub commands are re-exported so `lib.rs` can use `lens_cmds::lens_*`.

pub use tabs::{
    lens_create_tab,
    lens_close_tab,
    switch_tab_impl,
    lens_switch_tab,
    lens_close_all_tabs,
    lens_create_webview,
};

pub use navigation::{
    lens_navigate,
    lens_go_back,
    lens_go_forward,
    lens_reload,
    lens_resize_webview,
    lens_close_webview,
    lens_set_visible,
    lens_hard_refresh,
    lens_clear_cache,
};

pub use devtools::{
    lens_find_devtools_url,
    lens_open_devtools,
    lens_close_devtools,
    lens_resize_devtools,
    lens_set_devtools_visible,
};

pub use device_preview::{
    lens_create_device_webview,
    lens_close_device_webview,
    lens_close_all_device_webviews,
    lens_resize_device_webview,
    lens_set_device_emulation,
    lens_eval_device_js,
};

pub use zoom::{lens_set_zoom, lens_get_zoom};

pub use find::{
    lens_find_on_page,
    lens_eval_tab_js,
    lens_find_next,
    lens_find_previous,
    lens_close_find,
};

pub use history::{
    lens_add_history_entry,
    lens_get_history,
    lens_clear_history,
    lens_delete_history_entry,
};

pub use downloads::{
    lens_get_downloads,
    lens_clear_downloads,
    lens_open_download,
    lens_open_download_folder,
};
