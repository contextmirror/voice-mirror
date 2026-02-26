use std::collections::VecDeque;
use std::fmt;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::field::{Field, Visit};
use tracing::Subscriber;
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/// Logical output channel for routing log entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    App,
    Cli,
    Voice,
    Mcp,
    Browser,
}

impl Channel {
    /// All channels, in definition order.
    pub const ALL: [Channel; 5] = [
        Channel::App,
        Channel::Cli,
        Channel::Voice,
        Channel::Mcp,
        Channel::Browser,
    ];

    /// String label for the channel.
    pub fn as_str(&self) -> &'static str {
        match self {
            Channel::App => "app",
            Channel::Cli => "cli",
            Channel::Voice => "voice",
            Channel::Mcp => "mcp",
            Channel::Browser => "browser",
        }
    }

    /// Parse a channel name (case-insensitive).
    pub fn from_str(s: &str) -> Option<Channel> {
        match s.to_ascii_lowercase().as_str() {
            "app" => Some(Channel::App),
            "cli" => Some(Channel::Cli),
            "voice" => Some(Channel::Voice),
            "mcp" => Some(Channel::Mcp),
            "browser" => Some(Channel::Browser),
            _ => None,
        }
    }

    /// Route a tracing `target` (module path) to a channel.
    pub fn from_target(target: &str) -> Channel {
        if target.starts_with("voice_mirror_lib::providers::cli")
            || target.starts_with("voice_mirror_lib::providers::manager")
        {
            Channel::Cli
        } else if target.starts_with("voice_mirror_lib::voice") {
            Channel::Voice
        } else if target.starts_with("voice_mirror_lib::mcp")
            || target.starts_with("voice_mirror_mcp")
        {
            Channel::Mcp
        } else if target.starts_with("voice_mirror_lib::services::browser") {
            Channel::Browser
        } else {
            Channel::App
        }
    }
}

impl fmt::Display for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---------------------------------------------------------------------------
// LogEntry
// ---------------------------------------------------------------------------

/// A single log entry stored in the ring buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Milliseconds since UNIX epoch.
    pub timestamp: u64,
    /// Log level (ERROR, WARN, INFO, DEBUG, TRACE).
    pub level: String,
    /// Logical channel this entry belongs to.
    pub channel: Channel,
    /// Human-readable message.
    pub message: String,
}

impl LogEntry {
    /// Format as `"HH:MM:SS [LEVEL] message"`.
    pub fn format_line(&self) -> String {
        // Convert epoch millis to HH:MM:SS (UTC).
        let total_secs = (self.timestamp / 1000) % 86400;
        let h = total_secs / 3600;
        let m = (total_secs % 3600) / 60;
        let s = total_secs % 60;
        format!("{:02}:{:02}:{:02} [{}] {}", h, m, s, self.level, self.message)
    }
}

// ---------------------------------------------------------------------------
// Level priority helper
// ---------------------------------------------------------------------------

/// Map a level string to a numeric priority (higher = more severe).
pub fn level_priority(level: &str) -> u8 {
    match level.to_ascii_uppercase().as_str() {
        "ERROR" => 5,
        "WARN" => 4,
        "INFO" => 3,
        "DEBUG" => 2,
        "TRACE" => 1,
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// ChannelBuffer (private)
// ---------------------------------------------------------------------------

/// Maximum entries retained per channel.
const MAX_ENTRIES_PER_CHANNEL: usize = 2000;

/// Ring buffer for a single channel.
struct ChannelBuffer {
    entries: VecDeque<LogEntry>,
}

impl ChannelBuffer {
    fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(MAX_ENTRIES_PER_CHANNEL),
        }
    }

    /// Push an entry, evicting the oldest if at capacity.
    fn push(&mut self, entry: LogEntry) {
        if self.entries.len() >= MAX_ENTRIES_PER_CHANNEL {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    /// Query entries with optional level filter, tail count, and text search.
    ///
    /// Returns `(matching_entries, total_count_in_buffer)`.
    fn query(
        &self,
        min_level: Option<&str>,
        last: Option<usize>,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let total = self.entries.len();
        let min_pri = min_level.map(level_priority).unwrap_or(0);

        let filtered: Vec<LogEntry> = self
            .entries
            .iter()
            .filter(|e| level_priority(&e.level) >= min_pri)
            .filter(|e| {
                search
                    .map(|s| e.message.to_ascii_lowercase().contains(&s.to_ascii_lowercase()))
                    .unwrap_or(true)
            })
            .cloned()
            .collect();

        let result = if let Some(n) = last {
            if n >= filtered.len() {
                filtered
            } else {
                filtered[filtered.len() - n..].to_vec()
            }
        } else {
            filtered
        };

        (result, total)
    }

    /// Count entries by level: `(error, warn, info, debug, trace)`.
    fn count_by_level(&self) -> (usize, usize, usize, usize, usize) {
        let mut error = 0;
        let mut warn = 0;
        let mut info = 0;
        let mut debug = 0;
        let mut trace = 0;

        for e in &self.entries {
            match e.level.as_str() {
                "ERROR" => error += 1,
                "WARN" => warn += 1,
                "INFO" => info += 1,
                "DEBUG" => debug += 1,
                "TRACE" => trace += 1,
                _ => {}
            }
        }

        (error, warn, info, debug, trace)
    }
}

// ---------------------------------------------------------------------------
// OutputStore
// ---------------------------------------------------------------------------

/// Summary for a single channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSummary {
    pub channel: Channel,
    pub total: usize,
    pub error: usize,
    pub warn: usize,
    pub info: usize,
    pub debug: usize,
    pub trace: usize,
}

/// Central store holding ring buffers for all channels.
pub struct OutputStore {
    buffers: RwLock<Vec<ChannelBuffer>>,
    app_handle: RwLock<Option<AppHandle>>,
}

impl OutputStore {
    /// Create an empty store with one buffer per channel.
    pub fn new() -> Self {
        let buffers: Vec<ChannelBuffer> = Channel::ALL.iter().map(|_| ChannelBuffer::new()).collect();
        Self {
            buffers: RwLock::new(buffers),
            app_handle: RwLock::new(None),
        }
    }

    /// Set the app handle for Tauri event emission (called once during setup).
    pub fn set_app_handle(&self, handle: AppHandle) {
        if let Ok(mut ah) = self.app_handle.write() {
            *ah = Some(handle);
        }
    }

    /// Emit a Tauri event with the log entry (best-effort, non-blocking).
    fn emit_entry(&self, entry: &LogEntry) {
        if let Ok(ah) = self.app_handle.read() {
            if let Some(handle) = ah.as_ref() {
                let _ = handle.emit("output-log", entry);
            }
        }
    }

    /// Index into the buffer array for a given channel.
    fn idx(ch: Channel) -> usize {
        match ch {
            Channel::App => 0,
            Channel::Cli => 1,
            Channel::Voice => 2,
            Channel::Mcp => 3,
            Channel::Browser => 4,
        }
    }

    /// Push an already-constructed `LogEntry`.
    pub fn push(&self, entry: LogEntry) {
        let idx = Self::idx(entry.channel);
        let mut bufs = self.buffers.write().unwrap();
        bufs[idx].push(entry.clone());
        drop(bufs); // Release write lock before emitting
        self.emit_entry(&entry);
    }

    /// Create and push a log entry from parts.
    pub fn inject(&self, channel: Channel, level: &str, message: &str) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        self.push(LogEntry {
            timestamp,
            level: level.to_ascii_uppercase(),
            channel,
            message: message.to_string(),
        });
    }

    /// Query a specific channel.
    pub fn query(
        &self,
        channel: Channel,
        min_level: Option<&str>,
        last: Option<usize>,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let bufs = self.buffers.read().unwrap();
        bufs[Self::idx(channel)].query(min_level, last, search)
    }

    /// Get a summary of all channels.
    pub fn summary(&self) -> Vec<ChannelSummary> {
        let bufs = self.buffers.read().unwrap();
        Channel::ALL
            .iter()
            .map(|&ch| {
                let buf = &bufs[Self::idx(ch)];
                let (error, warn, info, debug, trace) = buf.count_by_level();
                ChannelSummary {
                    channel: ch,
                    total: buf.entries.len(),
                    error,
                    warn,
                    info,
                    debug,
                    trace,
                }
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// MessageVisitor (tracing field extractor)
// ---------------------------------------------------------------------------

/// Extracts the "message" field from a tracing event. Falls back to the first
/// field value if no explicit "message" field is present.
struct MessageVisitor {
    message: Option<String>,
    first: Option<String>,
}

impl MessageVisitor {
    fn new() -> Self {
        Self {
            message: None,
            first: None,
        }
    }

    fn into_message(self) -> String {
        self.message
            .or(self.first)
            .unwrap_or_default()
    }
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        let val = format!("{:?}", value);
        if field.name() == "message" {
            self.message = Some(val);
        } else if self.first.is_none() {
            self.first = Some(val);
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        } else if self.first.is_none() {
            self.first = Some(value.to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// OutputLayer (tracing_subscriber::Layer)
// ---------------------------------------------------------------------------

/// A `tracing_subscriber::Layer` that captures events into the `OutputStore`.
pub struct OutputLayer {
    store: std::sync::Arc<OutputStore>,
}

impl OutputLayer {
    pub fn new(store: std::sync::Arc<OutputStore>) -> Self {
        Self { store }
    }
}

impl<S: Subscriber> Layer<S> for OutputLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();

        let level = match *metadata.level() {
            tracing::Level::ERROR => "ERROR",
            tracing::Level::WARN => "WARN",
            tracing::Level::INFO => "INFO",
            tracing::Level::DEBUG => "DEBUG",
            tracing::Level::TRACE => "TRACE",
        };

        let target = metadata.target();
        let channel = Channel::from_target(target);

        let mut visitor = MessageVisitor::new();
        event.record(&mut visitor);
        let message = visitor.into_message();

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        self.store.push(LogEntry {
            timestamp,
            level: level.to_string(),
            channel,
            message,
        });
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_routing() {
        // CLI provider paths
        assert_eq!(
            Channel::from_target("voice_mirror_lib::providers::cli::something"),
            Channel::Cli
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::providers::manager"),
            Channel::Cli
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::providers::manager::inner"),
            Channel::Cli
        );

        // Voice paths
        assert_eq!(
            Channel::from_target("voice_mirror_lib::voice"),
            Channel::Voice
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::voice::stt"),
            Channel::Voice
        );

        // MCP paths
        assert_eq!(
            Channel::from_target("voice_mirror_lib::mcp::server"),
            Channel::Mcp
        );
        assert_eq!(
            Channel::from_target("voice_mirror_mcp"),
            Channel::Mcp
        );
        assert_eq!(
            Channel::from_target("voice_mirror_mcp::handlers"),
            Channel::Mcp
        );

        // Browser paths
        assert_eq!(
            Channel::from_target("voice_mirror_lib::services::browser_bridge"),
            Channel::Browser
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::services::browser"),
            Channel::Browser
        );

        // Everything else → App
        assert_eq!(
            Channel::from_target("voice_mirror_lib::config"),
            Channel::App
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::commands::lens"),
            Channel::App
        );
        assert_eq!(
            Channel::from_target("reqwest::connect"),
            Channel::App
        );
    }

    #[test]
    fn test_ring_buffer_cap() {
        let store = OutputStore::new();

        for i in 0..2500 {
            store.push(LogEntry {
                timestamp: i as u64,
                level: "INFO".to_string(),
                channel: Channel::App,
                message: format!("entry {}", i),
            });
        }

        let (entries, total) = store.query(Channel::App, None, None, None);
        assert_eq!(total, 2000);
        assert_eq!(entries.len(), 2000);

        // Oldest retained should be entry 500 (0..499 evicted)
        assert_eq!(entries[0].timestamp, 500);
        assert_eq!(entries[0].message, "entry 500");

        // Newest should be entry 2499
        assert_eq!(entries[1999].timestamp, 2499);
        assert_eq!(entries[1999].message, "entry 2499");
    }

    #[test]
    fn test_query_level_filter() {
        let store = OutputStore::new();

        store.push(LogEntry {
            timestamp: 1,
            level: "ERROR".to_string(),
            channel: Channel::App,
            message: "an error".to_string(),
        });
        store.push(LogEntry {
            timestamp: 2,
            level: "INFO".to_string(),
            channel: Channel::App,
            message: "some info".to_string(),
        });
        store.push(LogEntry {
            timestamp: 3,
            level: "DEBUG".to_string(),
            channel: Channel::App,
            message: "debug stuff".to_string(),
        });

        // Filter: ERROR only
        let (entries, _) = store.query(Channel::App, Some("error"), None, None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, "ERROR");

        // Filter: INFO and above (INFO + ERROR = 2)
        let (entries, _) = store.query(Channel::App, Some("info"), None, None);
        assert_eq!(entries.len(), 2);

        // Filter: DEBUG and above (all 3)
        let (entries, _) = store.query(Channel::App, Some("debug"), None, None);
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn test_query_search_filter() {
        let store = OutputStore::new();

        store.push(LogEntry {
            timestamp: 1,
            level: "INFO".to_string(),
            channel: Channel::Cli,
            message: "PTY opened for claude".to_string(),
        });
        store.push(LogEntry {
            timestamp: 2,
            level: "INFO".to_string(),
            channel: Channel::Cli,
            message: "Provider started".to_string(),
        });
        store.push(LogEntry {
            timestamp: 3,
            level: "INFO".to_string(),
            channel: Channel::Cli,
            message: "PTY closed".to_string(),
        });

        let (entries, _) = store.query(Channel::Cli, None, None, Some("PTY"));
        assert_eq!(entries.len(), 2);
        assert!(entries[0].message.contains("PTY"));
        assert!(entries[1].message.contains("PTY"));
    }

    #[test]
    fn test_summary() {
        let store = OutputStore::new();

        store.inject(Channel::App, "ERROR", "boom");
        store.inject(Channel::App, "WARN", "hmm");
        store.inject(Channel::App, "INFO", "ok");
        store.inject(Channel::Cli, "DEBUG", "tick");
        store.inject(Channel::Cli, "TRACE", "noise");

        let summaries = store.summary();
        assert_eq!(summaries.len(), 5);

        let app_sum = &summaries[0];
        assert_eq!(app_sum.channel, Channel::App);
        assert_eq!(app_sum.total, 3);
        assert_eq!(app_sum.error, 1);
        assert_eq!(app_sum.warn, 1);
        assert_eq!(app_sum.info, 1);

        let cli_sum = &summaries[1];
        assert_eq!(cli_sum.channel, Channel::Cli);
        assert_eq!(cli_sum.total, 2);
        assert_eq!(cli_sum.debug, 1);
        assert_eq!(cli_sum.trace, 1);
    }

    #[test]
    fn test_channel_from_str() {
        for ch in Channel::ALL {
            let s = ch.as_str();
            let round_tripped = Channel::from_str(s).unwrap();
            assert_eq!(round_tripped, ch);
        }

        // Case-insensitive
        assert_eq!(Channel::from_str("APP"), Some(Channel::App));
        assert_eq!(Channel::from_str("Cli"), Some(Channel::Cli));
        assert_eq!(Channel::from_str("VOICE"), Some(Channel::Voice));

        // Unknown
        assert_eq!(Channel::from_str("unknown"), None);
    }

    #[test]
    fn test_format_line() {
        let entry = LogEntry {
            // 2024-01-01 13:45:30 UTC => 13*3600 + 45*60 + 30 = 49530 seconds
            // 49530 * 1000 = 49530000 ms
            timestamp: 49530000,
            level: "INFO".to_string(),
            channel: Channel::App,
            message: "hello world".to_string(),
        };
        assert_eq!(entry.format_line(), "13:45:30 [INFO] hello world");

        // Check zero-padding
        let entry2 = LogEntry {
            // 01:02:03 UTC => (1*3600 + 2*60 + 3) * 1000 = 3723000
            timestamp: 3723000,
            level: "ERROR".to_string(),
            channel: Channel::Mcp,
            message: "pipe broken".to_string(),
        };
        assert_eq!(entry2.format_line(), "01:02:03 [ERROR] pipe broken");
    }
}
