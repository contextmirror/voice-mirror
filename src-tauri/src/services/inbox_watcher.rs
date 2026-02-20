//! Inbox watcher service for MCP message bridge.
//!
//! Watches the MCP inbox JSON file for changes and forwards messages
//! as Tauri events (`mcp-inbox-message`). This bridges the Node.js
//! MCP server with the Tauri frontend.
//!
//! Port of `electron/services/inbox-watcher.js`.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{debug, error, info, warn};

/// Inbox JSON structure matching the MCP server format.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InboxData {
    #[serde(default)]
    pub messages: Vec<InboxMessage>,
}

/// A single message in the inbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxMessage {
    pub id: String,
    pub from: String,
    pub message: String,
    pub timestamp: String,
    #[serde(default)]
    pub read_by: Vec<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub image_data_url: Option<String>,
}

/// Event payload emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxEvent {
    /// Message type: "ai_message", "user_message", "status_update"
    pub kind: String,
    /// The message text
    pub text: String,
    /// Who sent this message
    pub from: String,
    /// Message ID for dedup
    pub id: String,
    /// ISO timestamp
    pub timestamp: String,
    /// Thread ID if present
    pub thread_id: Option<String>,
    /// Reply-to ID if present
    pub reply_to: Option<String>,
}

/// Shared state for the inbox watcher.
struct WatcherState {
    /// IDs of messages we've already emitted events for.
    seen_ids: HashSet<String>,
}

impl WatcherState {
    fn new() -> Self {
        Self {
            seen_ids: HashSet::new(),
        }
    }

    /// Seed seen IDs from existing messages to avoid re-emitting old ones.
    fn seed_from_messages(&mut self, messages: &[InboxMessage]) {
        for msg in messages {
            self.seen_ids.insert(msg.id.clone());
        }
        // Cap at 200 entries
        if self.seen_ids.len() > 200 {
            let excess = self.seen_ids.len() - 200;
            let to_remove: Vec<String> = self.seen_ids.iter().take(excess).cloned().collect();
            for id in to_remove {
                self.seen_ids.remove(&id);
            }
        }
    }

    /// Check if we've already seen this message ID.
    fn is_seen(&self, id: &str) -> bool {
        self.seen_ids.contains(id)
    }

    /// Mark a message ID as seen.
    fn mark_seen(&mut self, id: String) {
        self.seen_ids.insert(id);
        // Keep bounded
        if self.seen_ids.len() > 200 {
            if let Some(first) = self.seen_ids.iter().next().cloned() {
                self.seen_ids.remove(&first);
            }
        }
    }
}

/// Get the MCP server data directory.
///
/// The MCP server uses `voice-mirror-electron` as its app name, which differs
/// from the Tauri app's `voice-mirror`. We must use the MCP server's path
/// to find the inbox file.
///
/// - Windows: `%APPDATA%\voice-mirror-electron\data\`
/// - macOS:   `~/Library/Application Support/voice-mirror-electron/data/`
/// - Linux:   `~/.config/voice-mirror-electron/data/`
pub fn get_mcp_data_dir() -> PathBuf {
    // The MCP server uses config_dir (APPDATA on Windows, ~/.config on Linux,
    // ~/Library/Application Support on macOS) + "voice-mirror-electron/data"
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror-electron")
        .join("data")
}

/// Get the path to the MCP inbox file.
pub fn get_inbox_path() -> PathBuf {
    get_mcp_data_dir().join("inbox.json")
}

/// Read and parse the inbox file.
fn read_inbox(path: &std::path::Path) -> Option<InboxData> {
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<InboxData>(&raw) {
            Ok(data) => Some(data),
            Err(e) => {
                // SyntaxError is expected during atomic writes
                debug!("Failed to parse inbox.json: {}", e);
                None
            }
        },
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                debug!("Failed to read inbox.json: {}", e);
            }
            None
        }
    }
}

/// Classify a message sender as AI or user.
///
/// Messages from AI providers (voice_send) use instance IDs like
/// "voice-claude", "voice-mirror", "voice-opencode", etc.
/// Messages from users use their configured name (e.g. "some-user").
fn classify_sender(from: &str) -> &'static str {
    let lower = from.to_lowercase();
    if lower.starts_with("voice-") || lower.contains("claude") {
        "ai_message"
    } else {
        "user_message"
    }
}

/// Process the inbox: find new messages and emit events.
fn process_inbox(
    inbox_path: &std::path::Path,
    state: &mut WatcherState,
    app_handle: &AppHandle,
) {
    let data = match read_inbox(inbox_path) {
        Some(d) => d,
        None => return,
    };

    if data.messages.is_empty() {
        return;
    }

    for msg in &data.messages {
        if state.is_seen(&msg.id) {
            continue;
        }

        state.mark_seen(msg.id.clone());

        let kind = classify_sender(&msg.from);

        let event = InboxEvent {
            kind: kind.to_string(),
            text: msg.message.clone(),
            from: msg.from.clone(),
            id: msg.id.clone(),
            timestamp: msg.timestamp.clone(),
            thread_id: msg.thread_id.clone(),
            reply_to: msg.reply_to.clone(),
        };

        debug!(
            "New inbox message: kind={}, from={}, id={}, text={}...",
            kind,
            msg.from,
            msg.id,
            &msg.message[..msg.message.len().min(50)]
        );

        if let Err(e) = app_handle.emit("mcp-inbox-message", &event) {
            warn!("Failed to emit mcp-inbox-message event: {}", e);
        }
    }
}

/// Handle for controlling the inbox watcher lifecycle.
pub struct InboxWatcherHandle {
    /// Set to false to signal the watcher to stop.
    running: Arc<Mutex<bool>>,
    /// The notify watcher (kept alive to maintain the watch).
    _watcher: Option<RecommendedWatcher>,
}

impl InboxWatcherHandle {
    /// Check if the watcher is running.
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Stop the watcher.
    pub fn stop(&mut self) {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        *running = false;
        self._watcher = None;
        info!("Inbox watcher stopped");
    }
}

/// Write a new message to the MCP inbox file.
///
/// Used to bridge voice transcriptions to the AI provider. The AI reads
/// inbox.json via the `voice_listen` MCP tool.
pub fn write_inbox_message(from: &str, message: &str, thread_id: Option<&str>) -> Result<(), String> {
    write_inbox_message_with_image(from, message, thread_id, None)
}

/// Write a new message with an optional image attachment to the MCP inbox file.
///
/// When `image_path` is provided, the image is base64-encoded and included
/// as a data URL so the MCP tool consumer can access the image content.
pub fn write_inbox_message_with_image(
    from: &str,
    message: &str,
    thread_id: Option<&str>,
    image_path: Option<&str>,
) -> Result<(), String> {
    let inbox_path = get_inbox_path();
    let data_dir = get_mcp_data_dir();

    // Ensure data directory exists
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    // Read existing inbox or create empty
    let mut data = read_inbox(&inbox_path).unwrap_or_default();

    // Generate RFC3339-like timestamp without chrono dependency
    let timestamp = {
        let dur = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let secs = dur.as_secs();
        // Format as ISO-8601 epoch seconds with 'Z' suffix
        // Not a true RFC3339 but parseable by JS: new Date(secs * 1000)
        format!("{}.000Z", secs)
    };

    // Build image data URL if an image path was provided
    let (img_path, img_data_url) = if let Some(path) = image_path {
        let data_url = match std::fs::read(path) {
            Ok(bytes) => {
                let b64 = crate::voice::tts::crypto::base64_encode(&bytes);
                Some(format!("data:image/png;base64,{}", b64))
            }
            Err(e) => {
                tracing::warn!("Failed to read image for inbox: {}", e);
                None
            }
        };
        (Some(path.to_string()), data_url)
    } else {
        (None, None)
    };

    // Create new message with UUID
    let msg = InboxMessage {
        id: uuid::Uuid::new_v4().to_string(),
        from: from.to_string(),
        message: message.to_string(),
        timestamp,
        read_by: vec![],
        thread_id: thread_id.map(|s| s.to_string()),
        reply_to: None,
        image_path: img_path,
        image_data_url: img_data_url,
    };

    data.messages.push(msg);

    // Keep inbox bounded (last 100 messages)
    if data.messages.len() > 100 {
        let excess = data.messages.len() - 100;
        data.messages.drain(..excess);
    }

    // Atomic write: write to .tmp, then rename
    let tmp_path = inbox_path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize inbox: {}", e))?;
    std::fs::write(&tmp_path, &json)
        .map_err(|e| format!("Failed to write inbox.tmp: {}", e))?;
    std::fs::rename(&tmp_path, &inbox_path)
        .map_err(|e| format!("Failed to rename inbox.tmp: {}", e))?;

    info!(
        "Wrote inbox message from '{}': {}...",
        from,
        &message[..message.len().min(50)]
    );
    Ok(())
}

/// Start the inbox watcher.
///
/// Watches the MCP inbox JSON file for changes and emits `mcp-inbox-message`
/// events to the Tauri frontend when new messages appear.
///
/// Returns a handle to control the watcher lifecycle.
pub fn start_inbox_watcher(app_handle: AppHandle) -> Result<InboxWatcherHandle, String> {
    let data_dir = get_mcp_data_dir();
    let inbox_path = data_dir.join("inbox.json");

    // Ensure data directory exists
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        return Err(format!("Failed to create MCP data dir: {}", e));
    }

    // Initialize state and seed with existing messages
    let state = Arc::new(Mutex::new(WatcherState::new()));

    if let Some(data) = read_inbox(&inbox_path) {
        let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
        s.seed_from_messages(&data.messages);
        info!(
            "Inbox watcher seeded with {} existing message IDs",
            s.seen_ids.len()
        );
    }

    let running = Arc::new(Mutex::new(true));

    // Set up file watcher
    let state_clone = Arc::clone(&state);
    let running_clone = Arc::clone(&running);
    let inbox_path_clone = inbox_path.clone();
    let app_handle_clone = app_handle.clone();

    // Debounce: use a channel to coalesce rapid file change events
    let (tx, rx) = std::sync::mpsc::channel::<()>();

    let watcher_result = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
            Ok(event) => {
                // Only react to modify/create events on our file
                let dominated = matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_)
                );
                if !dominated {
                    return;
                }

                let is_inbox = event.paths.iter().any(|p| {
                    p.file_name()
                        .map(|f| f == "inbox.json" || f == "inbox.json.tmp")
                        .unwrap_or(false)
                });

                if is_inbox {
                    let _ = tx.send(());
                }
            }
            Err(e) => {
                error!("File watcher error: {}", e);
            }
        }
    });

    let mut watcher = watcher_result.map_err(|e| format!("Failed to create file watcher: {}", e))?;

    // Watch the data directory (not recursive)
    watcher
        .watch(&data_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch data dir: {}", e))?;

    // Spawn debounce + processing thread
    std::thread::Builder::new()
        .name("inbox-watcher".into())
        .spawn(move || {
            info!("Inbox watcher thread started");

            loop {
                // Wait for a file change notification (with timeout for shutdown check)
                match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                    Ok(()) => {
                        // Debounce: drain any queued notifications
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        while rx.try_recv().is_ok() {}
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        // Check if we should stop
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        info!("Inbox watcher channel disconnected, stopping");
                        break;
                    }
                }

                // Check running flag
                let is_running = *running_clone
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if !is_running {
                    info!("Inbox watcher stopping (running=false)");
                    break;
                }

                // Process inbox
                let mut s = state_clone.lock().unwrap_or_else(|e| e.into_inner());
                process_inbox(&inbox_path_clone, &mut s, &app_handle_clone);
            }

            info!("Inbox watcher thread exited");
        })
        .map_err(|e| format!("Failed to spawn inbox watcher thread: {}", e))?;

    info!("Inbox watcher started, watching {:?}", inbox_path);

    Ok(InboxWatcherHandle {
        running,
        _watcher: Some(watcher),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_mcp_data_dir_contains_voice_mirror() {
        let dir = get_mcp_data_dir();
        let path_str = dir.to_string_lossy();
        assert!(
            path_str.contains("voice-mirror-electron"),
            "MCP data dir should contain 'voice-mirror-electron', got: {}",
            path_str
        );
    }

    #[test]
    fn test_get_inbox_path() {
        let path = get_inbox_path();
        assert!(path.to_string_lossy().ends_with("inbox.json"));
    }

    #[test]
    fn test_classify_sender() {
        // AI instance IDs (voice-* prefix or contains "claude")
        assert_eq!(classify_sender("voice-claude"), "ai_message");
        assert_eq!(classify_sender("voice-mirror"), "ai_message");
        assert_eq!(classify_sender("voice-opencode"), "ai_message");
        assert_eq!(classify_sender("Claude"), "ai_message");
        // User names (from config) — any string without voice-* prefix
        assert_eq!(classify_sender("user"), "user_message");
        assert_eq!(classify_sender("jane"), "user_message");
        assert_eq!(classify_sender("my-name"), "user_message");
    }

    #[test]
    fn test_watcher_state_seed_and_seen() {
        let mut state = WatcherState::new();

        let msgs = vec![
            InboxMessage {
                id: "msg-1".into(),
                from: "user".into(),
                message: "hello".into(),
                timestamp: "2025-01-01T00:00:00Z".into(),
                read_by: vec![],
                thread_id: None,
                reply_to: None,
                image_path: None,
                image_data_url: None,
            },
            InboxMessage {
                id: "msg-2".into(),
                from: "voice-claude".into(),
                message: "hi there".into(),
                timestamp: "2025-01-01T00:00:01Z".into(),
                read_by: vec![],
                thread_id: Some("voice-mirror".into()),
                reply_to: None,
                image_path: None,
                image_data_url: None,
            },
        ];

        state.seed_from_messages(&msgs);
        assert!(state.is_seen("msg-1"));
        assert!(state.is_seen("msg-2"));
        assert!(!state.is_seen("msg-3"));
    }

    #[test]
    fn test_watcher_state_mark_seen() {
        let mut state = WatcherState::new();
        assert!(!state.is_seen("msg-1"));
        state.mark_seen("msg-1".into());
        assert!(state.is_seen("msg-1"));
    }

    #[test]
    fn test_read_inbox_missing_file() {
        let result = read_inbox(std::path::Path::new("/nonexistent/inbox.json"));
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_inbox_json() {
        let json = r#"{"messages":[{"id":"msg-1","from":"user","message":"test","timestamp":"2025-01-01T00:00:00Z","read_by":[],"thread_id":"voice-mirror"}]}"#;
        let data: InboxData = serde_json::from_str(json).unwrap();
        assert_eq!(data.messages.len(), 1);
        assert_eq!(data.messages[0].id, "msg-1");
        assert_eq!(data.messages[0].from, "user");
    }
}
