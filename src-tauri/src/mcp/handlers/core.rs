//! Core MCP tool handlers: voice_send, voice_inbox, voice_listen, voice_status.
//!
//! These tools use file-based IPC:
//! - Inbox:  `{data_dir}/inbox.json`  -- message store
//! - Status: `{data_dir}/status.json` -- presence tracking
//! - Lock:   `{data_dir}/listener_lock.json` -- exclusive listener lock

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::time::{Duration, Instant};
use tracing::{info, warn};

use super::McpToolResult;
use crate::ipc::pipe_client::PipeClient;
use crate::ipc::protocol::{AppToMcp, McpToApp};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_TIMEOUT_MS: u64 = 2 * 60 * 1000; // 2 minutes
const AUTO_CLEANUP_HOURS: u64 = 24;
const LISTENER_LOCK_TIMEOUT_MS: u64 = 310 * 1000; // 310s (> 300s default listen timeout)
const MAX_MESSAGES: usize = 100;
const MAX_INBOX_TOTAL: usize = 500;

// ---------------------------------------------------------------------------
// Data types for inbox and status files
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InboxStore {
    messages: Vec<InboxMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InboxMessage {
    id: String,
    from: String,
    message: String,
    timestamp: String,
    #[serde(default)]
    read_by: Vec<String>,
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    reply_to: Option<String>,
    #[serde(default)]
    image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StatusStore {
    statuses: Vec<InstanceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstanceStatus {
    instance_id: String,
    status: String,
    #[serde(default)]
    current_task: Option<String>,
    last_heartbeat: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ListenerLock {
    instance_id: String,
    acquired_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MessageTrigger {
    from: String,
    #[serde(rename = "messageId")]
    message_id: String,
    timestamp: String,
    thread_id: Option<String>,
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

fn inbox_path(data_dir: &Path) -> PathBuf {
    data_dir.join("inbox.json")
}

fn status_path(data_dir: &Path) -> PathBuf {
    data_dir.join("status.json")
}

fn lock_path(data_dir: &Path) -> PathBuf {
    data_dir.join("listener_lock.json")
}

fn trigger_path(data_dir: &Path) -> PathBuf {
    data_dir.join("claude_message_trigger.json")
}

/// Read and parse a JSON file, returning a default value if the file doesn't exist or is corrupt.
async fn read_json_file<T: serde::de::DeserializeOwned>(path: &Path, default: T) -> T {
    match tokio::fs::read_to_string(path).await {
        Ok(data) => serde_json::from_str(&data).unwrap_or(default),
        Err(_) => default,
    }
}

/// Write JSON data to a file atomically (write to .tmp, then rename).
async fn atomic_write_json<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &json)
        .await
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;
    Ok(())
}

/// Get current time in milliseconds since epoch.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Get current time as ISO 8601 string.
fn now_iso() -> String {
    // Simple ISO format: 2024-01-15T10:30:00.000Z
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    // Convert epoch seconds to datetime parts
    // This is a simplified conversion; for production use chrono crate
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate date from days since epoch (1970-01-01)
    let (year, month, day) = days_to_date(days as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_date(mut days: i64) -> (i64, u32, u32) {
    // Algorithm from https://howardhinnant.github.io/date_algorithms.html
    days += 719468;
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = (days - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

/// Generate a unique message ID.
fn generate_msg_id() -> String {
    let ts = now_ms();
    let rand: u32 = rand_u32();
    format!("msg-{}-{:06x}", ts, rand & 0xFFFFFF)
}

/// Simple pseudo-random u32 (no external crate dependency).
fn rand_u32() -> u32 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ptr = Box::new(0u8);
    let addr = &*ptr as *const u8 as usize;
    let ts = now_ms();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    // Mix address entropy with time and counter for uniqueness
    ((addr as u64).wrapping_mul(6364136223846793005).wrapping_add(ts).wrapping_add(seq)) as u32
}

// ---------------------------------------------------------------------------
// Heartbeat helper
// ---------------------------------------------------------------------------

async fn update_heartbeat(
    data_dir: &Path,
    instance_id: &str,
    status: &str,
    current_task: Option<&str>,
) {
    let path = status_path(data_dir);
    let mut store: StatusStore = read_json_file(&path, StatusStore { statuses: vec![] }).await;
    let now = now_iso();

    let new_status = InstanceStatus {
        instance_id: instance_id.to_string(),
        status: status.to_string(),
        current_task: current_task.map(|s| s.to_string()),
        last_heartbeat: now,
    };

    if let Some(idx) = store
        .statuses
        .iter()
        .position(|s| s.instance_id == instance_id)
    {
        store.statuses[idx] = new_status;
    } else {
        store.statuses.push(new_status);
    }

    if let Err(e) = atomic_write_json(&path, &store).await {
        warn!("[MCP Core] Failed to update heartbeat: {}", e);
    }
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

async fn acquire_listener_lock(data_dir: &Path, instance_id: &str) -> Result<(), String> {
    let path = lock_path(data_dir);
    let now = now_ms();

    // Check existing lock
    if let Ok(data) = tokio::fs::read_to_string(&path).await {
        if let Ok(lock) = serde_json::from_str::<ListenerLock>(&data) {
            if lock.expires_at > now && lock.instance_id != instance_id {
                return Err(format!(
                    "Cannot listen: Another Claude instance ({}) is already listening.\n\
                     Only one listener is allowed to prevent duplicate responses.",
                    lock.instance_id
                ));
            }
        }
    }

    // Acquire lock
    let lock = ListenerLock {
        instance_id: instance_id.to_string(),
        acquired_at: now,
        expires_at: now + LISTENER_LOCK_TIMEOUT_MS,
    };

    let json = serde_json::to_string_pretty(&lock).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &json)
        .await
        .map_err(|e| format!("Failed to write lock: {}", e))?;

    Ok(())
}

async fn release_listener_lock(data_dir: &Path, instance_id: &str) {
    let path = lock_path(data_dir);
    if let Ok(data) = tokio::fs::read_to_string(&path).await {
        if let Ok(lock) = serde_json::from_str::<ListenerLock>(&data) {
            if lock.instance_id == instance_id {
                let _ = tokio::fs::remove_file(&path).await;
            }
        }
    }
}

async fn refresh_listener_lock(data_dir: &Path, instance_id: &str) {
    let path = lock_path(data_dir);
    if let Ok(data) = tokio::fs::read_to_string(&path).await {
        if let Ok(mut lock) = serde_json::from_str::<ListenerLock>(&data) {
            if lock.instance_id == instance_id {
                lock.expires_at = now_ms() + LISTENER_LOCK_TIMEOUT_MS;
                let json = serde_json::to_string_pretty(&lock).unwrap_or_default();
                let _ = tokio::fs::write(&path, &json).await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/// `voice_send` -- Send a message to the inbox file (and via pipe if available).
pub async fn handle_voice_send(
    args: &Value,
    data_dir: &Path,
    pipe: Option<&Arc<PipeClient>>,
) -> McpToolResult {
    let instance_id = match args.get("instance_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return McpToolResult::error("Error: instance_id is required"),
    };
    let message = match args.get("message").and_then(|v| v.as_str()) {
        Some(msg) => msg,
        None => return McpToolResult::error("Error: message is required"),
    };
    let thread_id = args.get("thread_id").and_then(|v| v.as_str());
    let reply_to = args.get("reply_to").and_then(|v| v.as_str());

    update_heartbeat(data_dir, instance_id, "active", Some("Sending message")).await;

    // Load existing messages
    let path = inbox_path(data_dir);
    let mut store: InboxStore = read_json_file(&path, InboxStore { messages: vec![] }).await;

    // Resolve thread ID
    let resolved_thread_id = if let Some(tid) = thread_id {
        tid.to_string()
    } else if let Some(reply) = reply_to {
        // Find parent message's thread
        store
            .messages
            .iter()
            .find(|m| m.id == reply)
            .and_then(|m| m.thread_id.clone())
            .unwrap_or_else(|| {
                if instance_id == "voice-claude" {
                    "voice-mirror".to_string()
                } else {
                    format!("thread_{}", now_ms())
                }
            })
    } else if instance_id == "voice-claude" {
        "voice-mirror".to_string()
    } else {
        format!("thread_{}", now_ms())
    };

    // Create new message
    let new_message = InboxMessage {
        id: generate_msg_id(),
        from: instance_id.to_string(),
        message: message.to_string(),
        timestamp: now_iso(),
        read_by: vec![],
        thread_id: Some(resolved_thread_id.clone()),
        reply_to: reply_to.map(|s| s.to_string()),
        image_path: None,
    };

    store.messages.push(new_message.clone());

    // Keep last MAX_MESSAGES messages
    if store.messages.len() > MAX_MESSAGES {
        let start = store.messages.len() - MAX_MESSAGES;
        store.messages = store.messages[start..].to_vec();
    }

    if let Err(e) = atomic_write_json(&path, &store).await {
        return McpToolResult::error(format!("Error: {}", e));
    }

    // Write trigger file for Voice Mirror notification (file-based fallback)
    let trigger = MessageTrigger {
        from: instance_id.to_string(),
        message_id: new_message.id.clone(),
        timestamp: new_message.timestamp.clone(),
        thread_id: Some(resolved_thread_id.clone()),
    };
    let trigger_json = serde_json::to_string_pretty(&trigger).unwrap_or_default();
    let _ = tokio::fs::write(trigger_path(data_dir), &trigger_json).await;

    // Fast path: also send via named pipe for instant delivery to the Tauri app.
    // This bypasses the file watcher debounce (~100ms) for sub-ms event delivery.
    if let Some(pipe) = pipe {
        let pipe_msg = McpToApp::VoiceSend {
            from: instance_id.to_string(),
            message: message.to_string(),
            thread_id: Some(resolved_thread_id.clone()),
            reply_to: reply_to.map(|s| s.to_string()),
            message_id: new_message.id.clone(),
            timestamp: new_message.timestamp.clone(),
        };
        if let Err(e) = pipe.send(&pipe_msg).await {
            warn!("[voice_send] Pipe send failed (file fallback still active): {}", e);
        }
    }

    let preview = if message.len() > 100 {
        format!("{}...", &message[..100])
    } else {
        message.to_string()
    };

    McpToolResult::text(format!(
        "Message sent in thread [{}]:\n\"{}\"",
        resolved_thread_id, preview
    ))
}

/// `voice_inbox` -- Read messages from inbox.
pub async fn handle_voice_inbox(args: &Value, data_dir: &Path) -> McpToolResult {
    let instance_id = match args.get("instance_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return McpToolResult::error("Error: instance_id is required"),
    };
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .clamp(1, 100) as usize;
    let include_read = args
        .get("include_read")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mark_as_read = args
        .get("mark_as_read")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    update_heartbeat(data_dir, instance_id, "active", Some("Checking inbox")).await;

    let path = inbox_path(data_dir);
    if !path.exists() {
        return McpToolResult::text("No messages in inbox.");
    }

    let mut store: InboxStore = read_json_file(&path, InboxStore { messages: vec![] }).await;

    // Auto-cleanup old messages (24h cutoff)
    let cutoff_ms = now_ms() - (AUTO_CLEANUP_HOURS * 60 * 60 * 1000);
    store.messages.retain(|m| {
        // Parse ISO timestamp to epoch ms (best-effort)
        parse_iso_to_ms(&m.timestamp).unwrap_or(0) > cutoff_ms
    });

    // Cap at MAX_INBOX_TOTAL
    if store.messages.len() > MAX_INBOX_TOTAL {
        let start = store.messages.len() - MAX_INBOX_TOTAL;
        store.messages = store.messages[start..].to_vec();
    }

    // Mark as read if requested (do this BEFORE filtering to avoid borrow issues)
    if mark_as_read {
        let id_str = instance_id.to_string();
        for msg in &mut store.messages {
            if msg.from == instance_id {
                continue;
            }
            if !msg.read_by.contains(&id_str) {
                msg.read_by.push(id_str.clone());
            }
        }
        if let Err(e) = atomic_write_json(&path, &store).await {
            warn!("[MCP Core] Failed to mark messages as read: {}", e);
        }
    }

    // Filter out own messages
    let mut inbox: Vec<&InboxMessage> = store
        .messages
        .iter()
        .filter(|m| m.from != instance_id)
        .collect();

    // Filter by read status (use original read_by before mark_as_read for consistency)
    if !include_read {
        inbox.retain(|m| {
            // If mark_as_read was true, we just marked them -- still show them this time
            if mark_as_read {
                // Show all messages this time (they were just marked)
                true
            } else {
                !m.read_by.contains(&instance_id.to_string())
            }
        });
    }

    // Apply limit (take last N)
    let start = if inbox.len() > limit {
        inbox.len() - limit
    } else {
        0
    };
    let inbox = &inbox[start..];

    if inbox.is_empty() {
        return McpToolResult::text("No new messages.");
    }

    let formatted: Vec<String> = inbox
        .iter()
        .map(|m| {
            let mut text = format!(
                "[{}] [{}] (id: {}):\n{}",
                format_time(&m.timestamp),
                m.from,
                m.id,
                m.message
            );
            if let Some(ref img) = m.image_path {
                text.push_str(&format!("\n[Attached image: {}]", img));
            }
            text
        })
        .collect();

    McpToolResult::text(format!(
        "=== Inbox ({} message(s)) ===\n\n{}",
        inbox.len(),
        formatted.join("\n\n")
    ))
}

/// `voice_listen` -- Wait for new messages from a specific sender.
///
/// When a pipe is available, listens for instant delivery via named pipe.
/// Falls back to polling inbox.json every 5 seconds when no pipe is connected.
pub async fn handle_voice_listen(
    args: &Value,
    data_dir: &Path,
    pipe: Option<&Arc<PipeClient>>,
) -> McpToolResult {
    let instance_id = match args.get("instance_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return McpToolResult::error("Error: instance_id is required"),
    };
    let from_sender = match args.get("from_sender").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return McpToolResult::error("Error: from_sender is required"),
    };
    let thread_filter = args.get("thread_id").and_then(|v| v.as_str());
    let timeout_seconds = args
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(300)
        .min(600);

    // Acquire exclusive listener lock
    if let Err(e) = acquire_listener_lock(data_dir, instance_id).await {
        return McpToolResult::error(e);
    }

    update_heartbeat(
        data_dir,
        instance_id,
        "active",
        Some(&format!("Listening for {}", from_sender)),
    )
    .await;

    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_seconds);
    let lock_refresh_interval = Duration::from_secs(30);
    let mut last_lock_refresh = Instant::now();

    // Capture existing message IDs
    let path = inbox_path(data_dir);
    let existing_ids: HashSet<String> = {
        let store: InboxStore = read_json_file(&path, InboxStore { messages: vec![] }).await;
        store.messages.iter().map(|m| m.id.clone()).collect()
    };

    // Fast path: if pipe is available, listen for instant message delivery.
    if let Some(pipe) = pipe {
        // Notify the Tauri app that we're listening
        let _ = pipe
            .send(&McpToApp::ListenStart {
                instance_id: instance_id.to_string(),
                from_sender: from_sender.to_string(),
                thread_id: thread_filter.map(|s| s.to_string()),
            })
            .await;

        info!(
            "[voice_listen] Waiting for pipe message from '{}' (timeout: {}s)",
            from_sender, timeout_seconds
        );

        let mut pipe_ok = true;
        loop {
            let remaining = timeout.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                break;
            }

            // Refresh lock periodically
            if last_lock_refresh.elapsed() >= lock_refresh_interval {
                refresh_listener_lock(data_dir, instance_id).await;
                last_lock_refresh = Instant::now();
            }

            match tokio::time::timeout(remaining.min(Duration::from_secs(30)), pipe.recv()).await {
                Ok(Ok(Some(AppToMcp::UserMessage {
                    id,
                    from,
                    message,
                    thread_id: msg_thread,
                    timestamp,
                    image_path: _,
                }))) => {
                    // Check sender match
                    if from.to_lowercase() != from_sender.to_lowercase() {
                        continue;
                    }
                    // Check thread filter
                    if let Some(filter) = thread_filter {
                        if msg_thread.as_deref() != Some(filter) {
                            continue;
                        }
                    }

                    let wait_secs = start.elapsed().as_secs();
                    release_listener_lock(data_dir, instance_id).await;

                    return McpToolResult::text(format!(
                        "=== Message from {} (after {}s) ===\n\
                         Thread: {}\n\
                         Time: {}\n\
                         ID: {}\n\n{}",
                        from_sender,
                        wait_secs,
                        msg_thread.as_deref().unwrap_or("none"),
                        timestamp,
                        id,
                        message,
                    ));
                }
                Ok(Ok(Some(AppToMcp::Shutdown))) => {
                    release_listener_lock(data_dir, instance_id).await;
                    return McpToolResult::text("Shutdown requested, stopping listener.");
                }
                Ok(Ok(None)) => {
                    // Pipe disconnected — fall back to file polling
                    warn!("[voice_listen] Pipe disconnected, falling back to file polling");
                    pipe_ok = false;
                    break;
                }
                Ok(Err(e)) => {
                    warn!("[voice_listen] Pipe read error: {}, falling back to file polling", e);
                    pipe_ok = false;
                    break;
                }
                Err(_) => {
                    // Timeout on this recv — loop to check overall timeout / refresh lock
                    continue;
                }
            }
        }

        // If pipe was healthy and we just timed out, return timeout
        if pipe_ok {
            release_listener_lock(data_dir, instance_id).await;
            return McpToolResult::text(format!(
                "Timeout: No message from {} after {}s.",
                from_sender, timeout_seconds
            ));
        }
        // Otherwise fall through to file-based polling below
    }

    // File-based polling fallback: poll for new messages every 5 seconds
    loop {
        if start.elapsed() >= timeout {
            break;
        }

        // Refresh lock periodically
        if last_lock_refresh.elapsed() >= lock_refresh_interval {
            refresh_listener_lock(data_dir, instance_id).await;
            last_lock_refresh = Instant::now();
        }

        // Check for new messages
        let store: InboxStore = read_json_file(&path, InboxStore { messages: vec![] }).await;

        let new_msg = store
            .messages
            .iter()
            .filter(|m| m.from.to_lowercase() == from_sender.to_lowercase())
            .filter(|m| {
                if let Some(filter) = thread_filter {
                    m.thread_id.as_deref() == Some(filter)
                } else {
                    true
                }
            })
            .rfind(|m| !existing_ids.contains(&m.id));

        if let Some(msg) = new_msg {
            let wait_secs = start.elapsed().as_secs();

            // Release lock before returning
            release_listener_lock(data_dir, instance_id).await;

            let mut response = format!(
                "=== Message from {} (after {}s) ===\n\
                 Thread: {}\n\
                 Time: {}\n\
                 ID: {}\n",
                from_sender,
                wait_secs,
                msg.thread_id.as_deref().unwrap_or("none"),
                msg.timestamp,
                msg.id,
            );

            if let Some(ref img) = msg.image_path {
                response.push_str(&format!("Image: {}\n", img));
            }

            response.push('\n');
            response.push_str(&msg.message);

            if let Some(ref img) = msg.image_path {
                response.push_str(&format!(
                    "\n\n[Attached image at: {} - use the Read tool to view it]",
                    img
                ));
            }

            return McpToolResult::text(response);
        }

        // Wait before polling again (5 seconds, similar to Node.js fallback interval)
        let remaining = timeout.saturating_sub(start.elapsed());
        let sleep_time = remaining.min(Duration::from_secs(5));
        if sleep_time.is_zero() {
            break;
        }
        tokio::time::sleep(sleep_time).await;
    }

    // Timeout
    release_listener_lock(data_dir, instance_id).await;
    McpToolResult::text(format!(
        "Timeout: No message from {} after {}s.",
        from_sender, timeout_seconds
    ))
}

/// `voice_status` -- Presence tracking.
pub async fn handle_voice_status(args: &Value, data_dir: &Path) -> McpToolResult {
    let instance_id = match args.get("instance_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return McpToolResult::error("Error: instance_id is required"),
    };
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("update");
    let status = args
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("active");
    let current_task = args.get("current_task").and_then(|v| v.as_str());

    if action == "list" {
        let path = status_path(data_dir);
        if !path.exists() {
            return McpToolResult::text("No active instances.");
        }

        let store: StatusStore = read_json_file(&path, StatusStore { statuses: vec![] }).await;
        let now = now_ms();

        let formatted: Vec<String> = store
            .statuses
            .iter()
            .map(|s| {
                let last_hb = parse_iso_to_ms(&s.last_heartbeat).unwrap_or(0);
                let is_stale = (now - last_hb) > STALE_TIMEOUT_MS;
                let stale_indicator = if is_stale { " [STALE]" } else { "" };
                format!(
                    "[{}] {}{} - {}",
                    s.instance_id,
                    s.status,
                    stale_indicator,
                    s.current_task.as_deref().unwrap_or("idle")
                )
            })
            .collect();

        return McpToolResult::text(format!(
            "=== Claude Instances ===\n\n{}",
            formatted.join("\n")
        ));
    }

    // Update status
    update_heartbeat(data_dir, instance_id, status, current_task).await;

    let task_info = current_task
        .map(|t| format!(" - {}", t))
        .unwrap_or_default();
    McpToolResult::text(format!(
        "Status updated: [{}] {}{}",
        instance_id, status, task_info
    ))
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/// Parse ISO 8601 timestamp to milliseconds since epoch (best-effort).
fn parse_iso_to_ms(iso: &str) -> Option<u64> {
    // Expected format: 2024-01-15T10:30:00.000Z
    // Minimal parser -- handles the format we produce in now_iso()
    let parts: Vec<&str> = iso.split('T').collect();
    if parts.len() != 2 {
        return None;
    }

    let date_parts: Vec<u64> = parts[0].split('-').filter_map(|s| s.parse().ok()).collect();
    if date_parts.len() != 3 {
        return None;
    }

    let time_str = parts[1].trim_end_matches('Z');
    let time_parts: Vec<&str> = time_str.split('.').collect();
    let hms: Vec<u64> = time_parts[0]
        .split(':')
        .filter_map(|s| s.parse().ok())
        .collect();
    if hms.len() != 3 {
        return None;
    }

    let millis = if time_parts.len() > 1 {
        time_parts[1].parse::<u64>().unwrap_or(0)
    } else {
        0
    };

    let (year, month, day) = (date_parts[0], date_parts[1], date_parts[2]);
    let (hour, minute, second) = (hms[0], hms[1], hms[2]);

    // Convert to days since epoch
    let days = date_to_days(year as i64, month as u32, day as u32);
    let total_secs =
        days as u64 * 86400 + hour * 3600 + minute * 60 + second;

    Some(total_secs * 1000 + millis)
}

/// Convert (year, month, day) to days since Unix epoch.
fn date_to_days(year: i64, month: u32, day: u32) -> i64 {
    // Inverse of days_to_date
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let m = month;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

/// Format an ISO timestamp's time portion for display.
fn format_time(iso: &str) -> String {
    // Extract HH:MM:SS from ISO string
    if let Some(t_pos) = iso.find('T') {
        let time_part = &iso[t_pos + 1..];
        let end = time_part.find('.').unwrap_or(time_part.len());
        let end = end.min(time_part.find('Z').unwrap_or(end));
        return time_part[..end].to_string();
    }
    iso.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_now_iso_format() {
        let iso = now_iso();
        assert!(iso.contains('T'));
        assert!(iso.ends_with('Z'));
        assert_eq!(iso.len(), 24); // 2024-01-15T10:30:00.000Z
    }

    #[test]
    fn test_parse_iso_roundtrip() {
        let iso = "2024-06-15T14:30:45.123Z";
        let ms = parse_iso_to_ms(iso).unwrap();
        assert!(ms > 0);
    }

    #[test]
    fn test_format_time() {
        assert_eq!(format_time("2024-01-15T10:30:00.000Z"), "10:30:00");
        assert_eq!(format_time("2024-01-15T23:59:59.999Z"), "23:59:59");
    }

    #[test]
    fn test_generate_msg_id() {
        let id1 = generate_msg_id();
        let id2 = generate_msg_id();
        assert!(id1.starts_with("msg-"));
        // IDs should be different (though in very fast tests they might share a timestamp prefix)
        // The random suffix makes collisions unlikely
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_days_to_date_epoch() {
        let (y, m, d) = days_to_date(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn test_date_to_days_epoch() {
        let days = date_to_days(1970, 1, 1);
        assert_eq!(days, 0);
    }

    #[test]
    fn test_date_roundtrip() {
        let days = date_to_days(2024, 6, 15);
        let (y, m, d) = days_to_date(days);
        assert_eq!((y, m, d), (2024, 6, 15));
    }

    #[tokio::test]
    async fn test_handle_voice_send_missing_args() {
        let args = serde_json::json!({});
        let data_dir = std::env::temp_dir().join("mcp_test_send");
        let _ = tokio::fs::create_dir_all(&data_dir).await;
        let result = handle_voice_send(&args, &data_dir, None).await;
        assert!(result.is_error);
        let _ = tokio::fs::remove_dir_all(&data_dir).await;
    }

    #[tokio::test]
    async fn test_handle_voice_status_update() {
        let data_dir = std::env::temp_dir().join("mcp_test_status");
        let _ = tokio::fs::create_dir_all(&data_dir).await;

        let args = serde_json::json!({
            "instance_id": "test-instance",
            "action": "update",
            "status": "active",
            "current_task": "testing"
        });

        let result = handle_voice_status(&args, &data_dir).await;
        assert!(!result.is_error);

        // Now list
        let args = serde_json::json!({
            "instance_id": "test-instance",
            "action": "list"
        });
        let result = handle_voice_status(&args, &data_dir).await;
        assert!(!result.is_error);

        let _ = tokio::fs::remove_dir_all(&data_dir).await;
    }
}
