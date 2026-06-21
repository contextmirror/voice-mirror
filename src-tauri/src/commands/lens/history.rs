//! Browser history persistence (JSON file, newest-first).

use super::super::IpcResponse;

/// Maximum number of history entries kept on disk.
const MAX_HISTORY_ENTRIES: usize = 1000;

fn history_path() -> std::path::PathBuf {
    crate::services::platform::get_data_dir().join("browser-history.json")
}

fn read_history() -> Vec<serde_json::Value> {
    let path = history_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn write_history(entries: &[serde_json::Value]) {
    let path = history_path();
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(path, json);
    }
}

/// Add a history entry (newest-first, deduplicated against the last entry).
/// Skips empty URLs and "about:blank".
#[tauri::command]
pub fn lens_add_history_entry(url: String, title: String) -> IpcResponse {
    if url.is_empty() || url == "about:blank" {
        return IpcResponse::ok_empty();
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let mut entries = read_history();

    // Dedup: skip if the last entry has the same URL
    if let Some(last) = entries.first() {
        if last.get("url").and_then(|v| v.as_str()) == Some(&url) {
            return IpcResponse::ok_empty();
        }
    }

    // Prepend new entry (newest first)
    entries.insert(0, serde_json::json!({
        "url": url,
        "title": title,
        "timestamp": timestamp,
    }));

    // Truncate to max
    entries.truncate(MAX_HISTORY_ENTRIES);

    write_history(&entries);
    IpcResponse::ok_empty()
}

/// Return all history entries (newest first).
#[tauri::command]
pub fn lens_get_history() -> IpcResponse {
    let entries = read_history();
    IpcResponse::ok(serde_json::json!({ "entries": entries }))
}

/// Clear all browser history.
#[tauri::command]
pub fn lens_clear_history() -> IpcResponse {
    write_history(&[]);
    IpcResponse::ok_empty()
}

/// Delete a single history entry by its timestamp.
#[tauri::command]
pub fn lens_delete_history_entry(timestamp: u128) -> IpcResponse {
    let mut entries = read_history();
    entries.retain(|e| {
        e.get("timestamp")
            .and_then(|v| v.as_u64())
            .map(|t| t as u128)
            != Some(timestamp)
    });
    write_history(&entries);
    IpcResponse::ok_empty()
}
