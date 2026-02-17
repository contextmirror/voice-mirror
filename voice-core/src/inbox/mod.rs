//! File-based inbox manager for MCP communication.
//!
//! Mirrors the protocol in `python/providers/inbox.py`.
//! Messages are stored in `<data_dir>/inbox.json` as:
//! ```json
//! {
//!   "messages": [
//!     {
//!       "id": "msg-<hex12>",
//!       "from": "user",
//!       "message": "...",
//!       "timestamp": "2024-01-01T12:00:00.000000",
//!       "thread_id": "voice-mirror",
//!       "read_by": []
//!     }
//!   ]
//! }
//! ```

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

/// Maximum number of messages to keep in inbox.
const MAX_MESSAGES: usize = 100;

/// Maximum age of messages before cleanup (2 hours).
const MAX_AGE_SECS: f64 = 2.0 * 3600.0;

/// Minimum interval between periodic cleanups (30 min).
const CLEANUP_INTERVAL_SECS: f64 = 1800.0;

/// Deduplication window in seconds.
const DEDUP_WINDOW_SECS: f64 = 2.0;

/// Default poll interval for waiting on responses.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Default timeout for waiting on responses.
/// Must be long enough for Claude to receive the message via claude_listen,
/// process it, and call claude_send. 5 minutes handles most cases.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

// ---------------------------------------------------------------------------
// JSON schema
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxData {
    #[serde(default)]
    pub messages: Vec<InboxMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxMessage {
    pub id: String,
    pub from: String,
    pub message: String,
    pub timestamp: String,
    pub thread_id: String,
    #[serde(default)]
    pub read_by: Vec<String>,
    /// Optional: system events use this field.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub msg_type: Option<String>,
    /// Optional: system event name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    /// Optional: whether a system event has been read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read: Option<bool>,
}

// ---------------------------------------------------------------------------
// InboxManager
// ---------------------------------------------------------------------------

struct InboxState {
    last_message_hash: Option<u64>,
    last_message_time: f64,
    last_cleanup_time: f64,
}

pub struct InboxManager {
    inbox_path: PathBuf,
    sender_name: String,
    state: Mutex<InboxState>,
}

impl InboxManager {
    pub fn new(data_dir: &Path, sender_name: Option<&str>) -> Self {
        let inbox_path = data_dir.join("inbox.json");
        Self {
            inbox_path,
            sender_name: sender_name.unwrap_or("user").to_string(),
            state: Mutex::new(InboxState {
                last_message_hash: None,
                last_message_time: 0.0,
                last_cleanup_time: now_epoch(),
            }),
        }
    }

    /// Send a user message to the inbox. Returns the message ID, or `None` if
    /// the message was deduplicated.
    pub fn send(&self, text: &str) -> anyhow::Result<Option<String>> {
        let mut st = self.state.lock().unwrap();
        let now = now_epoch();

        // Deduplication
        let msg_hash = hash_str(&text.trim().to_lowercase());
        if st.last_message_hash == Some(msg_hash) && (now - st.last_message_time) < DEDUP_WINDOW_SECS
        {
            debug!(text = &text[..text.len().min(30)], "Skipping duplicate message");
            return Ok(None);
        }
        st.last_message_hash = Some(msg_hash);
        st.last_message_time = now;

        // Ensure directory exists
        if let Some(parent) = self.inbox_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Periodic cleanup
        self.maybe_cleanup(&mut st);

        // Read existing data
        let mut data = self.read_inbox();

        // Build message (matches Python inbox.py format exactly)
        let id = format!("msg-{}", &uuid::Uuid::new_v4().to_string().replace('-', "")[..12]);
        let msg = InboxMessage {
            id: id.clone(),
            from: self.sender_name.clone(),
            message: text.to_string(),
            timestamp: Local::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string(),
            thread_id: "voice-mirror".to_string(),
            read_by: vec![],
            msg_type: None,
            event: None,
            read: None,
        };

        data.messages.push(msg);

        // Enforce cap
        if data.messages.len() > MAX_MESSAGES {
            let excess = data.messages.len() - MAX_MESSAGES;
            data.messages.drain(..excess);
        }

        // Atomic write
        self.write_inbox(&data)?;

        info!(id = %id, text = &text[..text.len().min(50)], "Sent to inbox");
        Ok(Some(id))
    }

    /// Wait for an AI response to our message. Polls the inbox file at 100 ms
    /// intervals. Returns the response text, or `None` on timeout.
    pub async fn wait_for_response(
        &self,
        message_id: &str,
        timeout: Option<Duration>,
    ) -> anyhow::Result<Option<String>> {
        let timeout = timeout.unwrap_or(DEFAULT_TIMEOUT);
        let start = Instant::now();
        let msg_id = message_id.to_string();

        info!(msg_id = %msg_id, "Waiting for AI response...");

        loop {
            if start.elapsed() >= timeout {
                warn!("Timeout waiting for AI response");
                return Ok(None);
            }

            tokio::time::sleep(POLL_INTERVAL).await;

            let data = self.read_inbox();

            // Find our message index
            let my_idx = data
                .messages
                .iter()
                .position(|m| m.id == msg_id);

            let my_idx = match my_idx {
                Some(i) => i,
                None => continue,
            };

            // Look for any response after our message that isn't from us
            for msg in &data.messages[my_idx + 1..] {
                let sender = msg.from.to_lowercase();
                if sender != self.sender_name.to_lowercase()
                    && msg.thread_id == "voice-mirror"
                    && !msg.message.is_empty()
                {
                    info!(from = %msg.from, "Got AI response");
                    return Ok(Some(msg.message.clone()));
                }
            }
        }
    }

    /// Run startup cleanup: remove messages older than `max_age_hours`.
    /// Returns the number of messages removed.
    pub fn cleanup(&self, max_age_hours: f64) -> usize {
        let mut data = self.read_inbox();
        if data.messages.is_empty() {
            return 0;
        }

        let cutoff = now_epoch() - (max_age_hours * 3600.0);
        let original = data.messages.len();

        data.messages.retain(|msg| {
            match DateTime::parse_from_rfc3339(&msg.timestamp)
                .or_else(|_| {
                    // Python uses local timestamps without timezone info.
                    // Try parsing as NaiveDateTime and assume local.
                    chrono::NaiveDateTime::parse_from_str(&msg.timestamp, "%Y-%m-%dT%H:%M:%S%.f")
                        .map(|naive| {
                            naive
                                .and_local_timezone(Local)
                                .single()
                                .unwrap_or_else(|| Utc::now().with_timezone(&Local))
                                .fixed_offset()
                        })
                })
            {
                Ok(dt) => dt.timestamp() as f64 > cutoff,
                Err(_) => true, // keep messages we can't parse (conservative)
            }
        });

        let removed = original - data.messages.len();
        if removed > 0 {
            if let Err(e) = self.write_inbox(&data) {
                warn!("Cleanup write failed: {}", e);
            } else {
                info!(removed, "Inbox cleanup complete");
            }
        }
        removed
    }

    // -- internal helpers --

    fn read_inbox(&self) -> InboxData {
        match std::fs::read_to_string(&self.inbox_path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or(InboxData {
                messages: vec![],
            }),
            Err(_) => InboxData { messages: vec![] },
        }
    }

    /// Atomic write: write to a temp file in the same directory, then rename.
    fn write_inbox(&self, data: &InboxData) -> anyhow::Result<()> {
        let dir = self
            .inbox_path
            .parent()
            .unwrap_or_else(|| Path::new("."));
        let tmp = dir.join(format!(".inbox.{}.tmp", std::process::id()));
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(&tmp, &json)?;
        std::fs::rename(&tmp, &self.inbox_path)?;
        Ok(())
    }

    fn maybe_cleanup(&self, st: &mut InboxState) {
        let now = now_epoch();
        if now - st.last_cleanup_time < CLEANUP_INTERVAL_SECS {
            return;
        }
        st.last_cleanup_time = now;

        let mut data = self.read_inbox();
        if data.messages.is_empty() {
            return;
        }

        let cutoff = now - MAX_AGE_SECS;
        let original = data.messages.len();

        data.messages.retain(|msg| {
            match chrono::NaiveDateTime::parse_from_str(&msg.timestamp, "%Y-%m-%dT%H:%M:%S%.f") {
                Ok(naive) => {
                    let ts = naive
                        .and_local_timezone(Local)
                        .single()
                        .map(|dt| dt.timestamp() as f64)
                        .unwrap_or(now);
                    ts > cutoff
                }
                Err(_) => true,
            }
        });

        // Enforce cap
        if data.messages.len() > MAX_MESSAGES {
            let excess = data.messages.len() - MAX_MESSAGES;
            data.messages.drain(..excess);
        }

        let removed = original - data.messages.len();
        if removed > 0 {
            if let Err(e) = self.write_inbox(&data) {
                warn!("Periodic cleanup write failed: {}", e);
            } else {
                info!(removed, "Periodic inbox cleanup");
            }
        }
    }
}

fn now_epoch() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn hash_str(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}
