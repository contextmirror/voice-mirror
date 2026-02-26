# Output & Diagnostics System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VS Code-style Output panel with 5 categorized log channels, an MCP `get_logs` tool for programmatic access, and a real Debug Mode toggle — all backed by in-memory ring buffers in Rust.

**Architecture:** Custom `tracing::Layer` → per-channel ring buffers (`VecDeque`, 2000 cap) → Tauri events for live UI streaming + pipe protocol for MCP queries. Existing file logging unchanged.

**Tech Stack:** Rust (`tracing`, `tracing-subscriber` with `reload`), Svelte 5, Tauri 2 IPC

---

### Task 1: Ring Buffer Backend — `output.rs`

Create the core Output store with ring buffers, channel routing, and the custom tracing Layer.

**Files:**
- Create: `src-tauri/src/services/output.rs`
- Modify: `src-tauri/src/services/mod.rs`

**Step 1: Create `src-tauri/src/services/output.rs`**

```rust
//! Output channel system — in-memory ring buffers for structured log capture.
//!
//! A custom `tracing::Layer` intercepts log events and routes them to per-channel
//! ring buffers based on the tracing target (module path). The frontend subscribes
//! via Tauri events for live streaming; MCP queries read directly from memory.

use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

/// Maximum entries per channel ring buffer.
const MAX_ENTRIES_PER_CHANNEL: usize = 2000;

// ---------------------------------------------------------------------------
// Channel enum
// ---------------------------------------------------------------------------

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
    pub const ALL: [Channel; 5] = [
        Channel::App,
        Channel::Cli,
        Channel::Voice,
        Channel::Mcp,
        Channel::Browser,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            Channel::App => "app",
            Channel::Cli => "cli",
            Channel::Voice => "voice",
            Channel::Mcp => "mcp",
            Channel::Browser => "browser",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "app" => Some(Channel::App),
            "cli" => Some(Channel::Cli),
            "voice" => Some(Channel::Voice),
            "mcp" => Some(Channel::Mcp),
            "browser" => Some(Channel::Browser),
            _ => None,
        }
    }

    /// Route a tracing target (module path) to a channel.
    fn from_target(target: &str) -> Self {
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
// Log entry
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Milliseconds since Unix epoch.
    pub timestamp: u64,
    /// Log level as string: "ERROR", "WARN", "INFO", "DEBUG", "TRACE".
    pub level: String,
    /// Channel name.
    pub channel: Channel,
    /// Formatted message text.
    pub message: String,
}

impl LogEntry {
    /// Format as a display line: `HH:MM:SS [LEVEL] message`
    pub fn format_line(&self) -> String {
        // Convert timestamp to HH:MM:SS (local time approximation via seconds)
        let secs = (self.timestamp / 1000) % 86400;
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;
        format!("{:02}:{:02}:{:02} [{}] {}", h, m, s, self.level, self.message)
    }
}

// ---------------------------------------------------------------------------
// Output store (shared state)
// ---------------------------------------------------------------------------

/// Per-channel ring buffer.
struct ChannelBuffer {
    entries: VecDeque<LogEntry>,
}

impl ChannelBuffer {
    fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(MAX_ENTRIES_PER_CHANNEL),
        }
    }

    fn push(&mut self, entry: LogEntry) {
        if self.entries.len() >= MAX_ENTRIES_PER_CHANNEL {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    fn query(
        &self,
        min_level: Option<&str>,
        last: usize,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let total = self.entries.len();
        let level_ord = level_priority(min_level.unwrap_or("trace"));

        let filtered: Vec<LogEntry> = self
            .entries
            .iter()
            .filter(|e| level_priority(&e.level) >= level_ord)
            .filter(|e| {
                search
                    .map(|s| e.message.to_lowercase().contains(&s.to_lowercase()))
                    .unwrap_or(true)
            })
            .cloned()
            .collect();

        let start = filtered.len().saturating_sub(last);
        (filtered[start..].to_vec(), total)
    }

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

/// Map level string to a priority number (higher = more severe).
fn level_priority(level: &str) -> u8 {
    match level.to_uppercase().as_str() {
        "ERROR" => 5,
        "WARN" => 4,
        "INFO" => 3,
        "DEBUG" => 2,
        "TRACE" => 1,
        _ => 0,
    }
}

/// The shared output store — holds all channel buffers behind a RwLock.
pub struct OutputStore {
    buffers: RwLock<[ChannelBuffer; 5]>,
}

impl OutputStore {
    pub fn new() -> Self {
        Self {
            buffers: RwLock::new([
                ChannelBuffer::new(), // App
                ChannelBuffer::new(), // Cli
                ChannelBuffer::new(), // Voice
                ChannelBuffer::new(), // Mcp
                ChannelBuffer::new(), // Browser
            ]),
        }
    }

    /// Push a log entry into the appropriate channel buffer.
    pub fn push(&self, entry: LogEntry) {
        let idx = channel_index(entry.channel);
        if let Ok(mut buffers) = self.buffers.write() {
            buffers[idx].push(entry);
        }
    }

    /// Inject an entry directly (used for MCP binary log forwarding).
    pub fn inject(&self, channel: Channel, level: String, message: String) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.push(LogEntry {
            timestamp: ts,
            level,
            channel,
            message,
        });
    }

    /// Query a specific channel with filters.
    pub fn query(
        &self,
        channel: Channel,
        min_level: Option<&str>,
        last: usize,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let idx = channel_index(channel);
        if let Ok(buffers) = self.buffers.read() {
            buffers[idx].query(min_level, last, search)
        } else {
            (Vec::new(), 0)
        }
    }

    /// Get summary counts for all channels.
    pub fn summary(&self) -> Vec<ChannelSummary> {
        if let Ok(buffers) = self.buffers.read() {
            Channel::ALL
                .iter()
                .enumerate()
                .map(|(i, ch)| {
                    let (error, warn, info, debug, trace) = buffers[i].count_by_level();
                    let total = buffers[i].entries.len();
                    ChannelSummary {
                        channel: *ch,
                        total,
                        error,
                        warn,
                        info,
                        debug,
                        trace,
                    }
                })
                .collect()
        } else {
            Vec::new()
        }
    }
}

fn channel_index(ch: Channel) -> usize {
    match ch {
        Channel::App => 0,
        Channel::Cli => 1,
        Channel::Voice => 2,
        Channel::Mcp => 3,
        Channel::Browser => 4,
    }
}

/// Summary of a single channel for the MCP tool's summary mode.
#[derive(Debug, Clone, Serialize)]
pub struct ChannelSummary {
    pub channel: Channel,
    pub total: usize,
    pub error: usize,
    pub warn: usize,
    pub info: usize,
    pub debug: usize,
    pub trace: usize,
}

// ---------------------------------------------------------------------------
// Custom tracing Layer
// ---------------------------------------------------------------------------

/// A message visitor that extracts the `message` field from a tracing event.
struct MessageVisitor {
    message: String,
}

impl MessageVisitor {
    fn new() -> Self {
        Self {
            message: String::new(),
        }
    }
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
        } else if self.message.is_empty() {
            // Fallback: use first field
            self.message = format!("{} = {:?}", field.name(), value);
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        }
    }
}

/// Custom tracing Layer that routes events to the OutputStore ring buffers.
pub struct OutputLayer {
    store: Arc<OutputStore>,
}

impl OutputLayer {
    pub fn new(store: Arc<OutputStore>) -> Self {
        Self { store }
    }
}

impl<S: Subscriber> Layer<S> for OutputLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let level = metadata.level();
        let target = metadata.target();
        let channel = Channel::from_target(target);

        let mut visitor = MessageVisitor::new();
        event.record(&mut visitor);

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let level_str = match *level {
            Level::ERROR => "ERROR",
            Level::WARN => "WARN",
            Level::INFO => "INFO",
            Level::DEBUG => "DEBUG",
            Level::TRACE => "TRACE",
        };

        self.store.push(LogEntry {
            timestamp: ts,
            level: level_str.to_string(),
            channel,
            message: visitor.message,
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
        assert_eq!(
            Channel::from_target("voice_mirror_lib::providers::cli::status_line"),
            Channel::Cli
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::voice::stt"),
            Channel::Voice
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::mcp::server"),
            Channel::Mcp
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::services::browser_bridge"),
            Channel::Browser
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::config::schema"),
            Channel::App
        );
        assert_eq!(
            Channel::from_target("voice_mirror_lib::providers::manager"),
            Channel::Cli
        );
    }

    #[test]
    fn test_ring_buffer_cap() {
        let store = OutputStore::new();
        for i in 0..2500 {
            store.inject(Channel::App, "INFO".into(), format!("msg {}", i));
        }
        let (entries, total) = store.query(Channel::App, None, 2500, None);
        assert_eq!(total, MAX_ENTRIES_PER_CHANNEL);
        assert_eq!(entries.len(), MAX_ENTRIES_PER_CHANNEL);
        // Oldest entries should have been evicted
        assert!(entries[0].message.contains("500"));
    }

    #[test]
    fn test_query_level_filter() {
        let store = OutputStore::new();
        store.inject(Channel::Cli, "ERROR".into(), "bad".into());
        store.inject(Channel::Cli, "INFO".into(), "ok".into());
        store.inject(Channel::Cli, "DEBUG".into(), "detail".into());

        let (entries, _) = store.query(Channel::Cli, Some("error"), 100, None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].message, "bad");

        let (entries, _) = store.query(Channel::Cli, Some("info"), 100, None);
        assert_eq!(entries.len(), 2); // ERROR + INFO
    }

    #[test]
    fn test_query_search_filter() {
        let store = OutputStore::new();
        store.inject(Channel::Cli, "INFO".into(), "PTY spawn started".into());
        store.inject(Channel::Cli, "INFO".into(), "TUI ready detected".into());
        store.inject(Channel::Cli, "ERROR".into(), "PTY spawn failed".into());

        let (entries, _) = store.query(Channel::Cli, None, 100, Some("PTY"));
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn test_summary() {
        let store = OutputStore::new();
        store.inject(Channel::Cli, "ERROR".into(), "e1".into());
        store.inject(Channel::Cli, "WARN".into(), "w1".into());
        store.inject(Channel::Cli, "INFO".into(), "i1".into());
        store.inject(Channel::Cli, "INFO".into(), "i2".into());
        store.inject(Channel::App, "INFO".into(), "app1".into());

        let summaries = store.summary();
        let cli_summary = summaries.iter().find(|s| s.channel == Channel::Cli).unwrap();
        assert_eq!(cli_summary.total, 4);
        assert_eq!(cli_summary.error, 1);
        assert_eq!(cli_summary.warn, 1);
        assert_eq!(cli_summary.info, 2);
    }

    #[test]
    fn test_channel_from_str() {
        assert_eq!(Channel::from_str("cli"), Some(Channel::Cli));
        assert_eq!(Channel::from_str("app"), Some(Channel::App));
        assert_eq!(Channel::from_str("bogus"), None);
    }

    #[test]
    fn test_format_line() {
        let entry = LogEntry {
            timestamp: 72_000_000, // 20:00:00 UTC
            level: "INFO".into(),
            channel: Channel::Cli,
            message: "TUI ready detected".into(),
        };
        assert_eq!(entry.format_line(), "20:00:00 [INFO] TUI ready detected");
    }
}
```

**Step 2: Add module export in `src-tauri/src/services/mod.rs`**

Add `pub mod output;` after `pub mod logger;` (line 6).

**Step 3: Verify Rust tests pass**

Run: `cd src-tauri && cargo test --lib services::output`
Expected: All 7 tests PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/services/output.rs src-tauri/src/services/mod.rs
git commit -m "feat: add OutputStore ring buffer backend with channel routing and tracing Layer"
```

---

### Task 2: Wire OutputLayer into Logger + Tauri Managed State

Integrate the OutputLayer into the tracing subscriber stack and make the OutputStore available as Tauri managed state.

**Files:**
- Modify: `src-tauri/src/services/logger.rs`
- Modify: `src-tauri/src/lib.rs:108-112` (logger init) and `:180-188` (managed state)

**Step 1: Modify `logger.rs` to accept and return OutputStore**

Replace the `init()` function. The key change: create an `OutputStore`, wrap it in `Arc`, build the `OutputLayer`, add it to the subscriber, and return the `Arc<OutputStore>` so `lib.rs` can store it as managed state.

New signature: `pub fn init() -> Arc<OutputStore>`

```rust
// At top of file, add imports:
use std::sync::Arc;
use tracing_subscriber::reload;
use super::output::{OutputLayer, OutputStore};

// Replace the init() function body to:
// 1. Create Arc<OutputStore>
// 2. Create OutputLayer wrapping it
// 3. Wrap OutputLayer in reload::Layer for dynamic filter changes
// 4. Add to subscriber registry
// 5. Return Arc<OutputStore>
```

The full updated `init()`:

```rust
pub fn init() -> Arc<OutputStore> {
    let log_dir = platform::get_log_dir();
    let _ = fs::create_dir_all(&log_dir);

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("vmr")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&log_dir)
        .expect("Failed to create log file appender");

    let file_layer = fmt::layer()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true);

    let console_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .with_target(true)
        .compact();

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("info,ort=warn,tao=warn,reqwest=warn,mio=warn,hyper=warn")
    });

    // Output channel system — ring buffers for live diagnostics
    let output_store = Arc::new(OutputStore::new());
    let output_layer = OutputLayer::new(Arc::clone(&output_store));

    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(console_layer)
        .with(output_layer)
        .init();

    tracing::info!(
        log_dir = %log_dir.display(),
        "Logger initialized"
    );

    output_store
}
```

Also update `try_init()` to return `Result<Arc<OutputStore>, String>`.

**Step 2: Update `lib.rs` to store OutputStore as managed state**

At line 110 in `lib.rs`, change:
```rust
services::logger::init();
```
to:
```rust
let output_store = services::logger::init();
```

Then add `.manage(output_store)` after the existing `.manage()` calls (around line 188), e.g.:
```rust
.manage(output_store)
```

This is `Arc<OutputStore>` which Tauri will wrap as `State<Arc<OutputStore>>`.

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 4: Commit**

```bash
git add src-tauri/src/services/logger.rs src-tauri/src/lib.rs
git commit -m "feat: wire OutputLayer into tracing subscriber and store OutputStore as Tauri state"
```

---

### Task 3: Tauri Commands — `get_output_logs` and `set_log_level`

Create Tauri commands so the frontend can query logs and toggle debug mode.

**Files:**
- Create: `src-tauri/src/commands/output.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands in invoke_handler)

**Step 1: Create `src-tauri/src/commands/output.rs`**

```rust
//! Output channel commands for frontend log viewing.

use std::sync::Arc;

use serde::Deserialize;
use tauri::State;

use crate::services::output::{Channel, OutputStore};

#[derive(Debug, Deserialize)]
pub struct GetLogsParams {
    pub channel: Option<String>,
    pub level: Option<String>,
    pub last: Option<usize>,
    pub search: Option<String>,
}

#[tauri::command]
pub fn get_output_logs(
    params: GetLogsParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<serde_json::Value, String> {
    let last = params.last.unwrap_or(200);

    match &params.channel {
        Some(ch_str) => {
            let channel = Channel::from_str(ch_str)
                .ok_or_else(|| format!("Unknown channel: {}", ch_str))?;
            let (entries, total) = output_store.query(
                channel,
                params.level.as_deref(),
                last,
                params.search.as_deref(),
            );
            Ok(serde_json::json!({
                "channel": ch_str,
                "entries": entries,
                "total": total,
                "returned": entries.len(),
            }))
        }
        None => {
            // Summary mode
            let summaries = output_store.summary();
            Ok(serde_json::json!({
                "channels": summaries,
            }))
        }
    }
}
```

**Step 2: Add `pub mod output;` to `src-tauri/src/commands/mod.rs`**

Add after `pub mod design;` (line 14).

**Step 3: Register commands in `lib.rs`**

Add import at the top alongside other command imports:
```rust
use commands::output as output_cmds;
```

Add to the `invoke_handler` macro (after `design_cmds::design_get_element`):
```rust
// Output / diagnostics
output_cmds::get_output_logs,
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 5: Commit**

```bash
git add src-tauri/src/commands/output.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add get_output_logs Tauri command for frontend log queries"
```

---

### Task 4: Tauri Event Emission — Live Log Streaming

Add Tauri event emission so the frontend receives log entries in real time. We need the AppHandle inside the OutputLayer. The approach: store the AppHandle in the OutputStore after app setup, and emit events from the Layer's `on_event`.

**Files:**
- Modify: `src-tauri/src/services/output.rs`
- Modify: `src-tauri/src/lib.rs` (set app handle after setup)

**Step 1: Add AppHandle to OutputStore**

In `output.rs`, add an `app_handle` field to `OutputStore`:
```rust
use tauri::AppHandle;

pub struct OutputStore {
    buffers: RwLock<[ChannelBuffer; 5]>,
    app_handle: RwLock<Option<AppHandle>>,
}
```

Add method:
```rust
/// Set the app handle for event emission (called once during setup).
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
```

Call `self.emit_entry(&entry)` inside the `push()` method, after inserting into the buffer.

Update `new()`:
```rust
Self {
    buffers: RwLock::new([...]),
    app_handle: RwLock::new(None),
}
```

**Step 2: Set AppHandle in `lib.rs` setup**

In the `.setup(|app| { ... })` block (around line 348), add after `migrate_electron_data()`:
```rust
// Set app handle on OutputStore for live event emission
{
    let output_store = app.state::<Arc<crate::services::output::OutputStore>>();
    output_store.set_app_handle(app.handle().clone());
}
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 4: Commit**

```bash
git add src-tauri/src/services/output.rs src-tauri/src/lib.rs
git commit -m "feat: emit output-log Tauri events for live frontend streaming"
```

---

### Task 5: MCP `get_logs` Tool — Pipe Protocol + Tool Registration

Add the `get_logs` MCP tool that queries logs through the named pipe.

**Files:**
- Modify: `src-tauri/src/ipc/protocol.rs` (add GetLogs/LogEntries messages)
- Modify: `src-tauri/src/ipc/pipe_server.rs` (handle GetLogs)
- Modify: `src-tauri/src/mcp/tools.rs` (register get_logs in core group)
- Modify: `src-tauri/src/mcp/handlers/core.rs` (implement handler)
- Modify: `src-tauri/src/mcp/server.rs` (add route)

**Step 1: Add pipe protocol messages**

In `protocol.rs`, add to `McpToApp` enum:
```rust
/// Query output logs from the Tauri app's ring buffers.
GetLogs {
    request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    search: Option<String>,
},
```

Add to `AppToMcp` enum:
```rust
/// Response to GetLogs with log entries.
LogEntries {
    request_id: String,
    /// Formatted log text (ready for MCP output).
    text: String,
},
```

**Step 2: Handle GetLogs in pipe_server.rs**

In the `dispatch_message` function, add a new match arm:
```rust
McpToApp::GetLogs { request_id, channel, level, last, search } => {
    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        let text = if let Some(store) = app.try_state::<Arc<crate::services::output::OutputStore>>() {
            match &channel {
                Some(ch_str) => {
                    if let Some(ch) = crate::services::output::Channel::from_str(ch_str) {
                        let (entries, total) = store.query(
                            ch,
                            level.as_deref(),
                            last.unwrap_or(100),
                            search.as_deref(),
                        );
                        let mut lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                        lines.push(format!("\n--- {} entries (filtered from {} total) ---", lines.len(), total));
                        lines.join("\n")
                    } else {
                        format!("Unknown channel: {}. Available: app, cli, voice, mcp, browser", ch_str)
                    }
                }
                None => {
                    // Summary mode
                    let summaries = store.summary();
                    let mut text = String::from("Output Channels:\n");
                    for s in &summaries {
                        text.push_str(&format!(
                            "  {:<8} {:>4} entries ({} error, {} warn, {} info)\n",
                            format!("{}:", s.channel),
                            s.total, s.error, s.warn, s.info
                        ));
                    }
                    text
                }
            }
        } else {
            "OutputStore not available".into()
        };

        if let Some(pipe_state) = app.try_state::<crate::ipc::pipe_server::PipeServerState>() {
            let _ = pipe_state.send(AppToMcp::LogEntries { request_id, text });
        }
    });
}
```

**Step 3: Register get_logs tool in tools.rs**

In the `build_all_groups()` function, add to the `core` group's `tools` vec (after `voice_status`):
```rust
ToolDef {
    name: "get_logs".into(),
    description: "Query Voice Mirror's structured output logs. Without a channel, returns a summary of all channels with entry counts. With a channel, returns the actual log lines. Use this to diagnose issues with the CLI provider, voice pipeline, MCP server, or browser bridge.".into(),
    input_schema: json!({
        "type": "object",
        "properties": {
            "channel": {
                "type": "string",
                "enum": ["app", "cli", "voice", "mcp", "browser"],
                "description": "Which log channel to query. Omit for a summary of all channels."
            },
            "level": {
                "type": "string",
                "enum": ["error", "warn", "info", "debug", "trace"],
                "description": "Minimum log level to include (default: info)"
            },
            "last": {
                "type": "number",
                "description": "Return the last N entries (default: 100)"
            },
            "search": {
                "type": "string",
                "description": "Case-insensitive text filter on log messages"
            }
        }
    }),
},
```

**Step 4: Add handler in core.rs**

Add at the end of the file:
```rust
/// Handle `get_logs` -- query output channel logs via pipe.
pub async fn handle_get_logs(
    args: &Value,
    _data_dir: &Path,
    router: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    let router = match router {
        Some(r) => r,
        None => return McpToolResult::error("Named pipe not connected — cannot query logs"),
    };

    let request_id = format!("logs-{}", uuid_v4());
    let channel = args.get("channel").and_then(|v| v.as_str()).map(String::from);
    let level = args.get("level").and_then(|v| v.as_str()).map(String::from);
    let last = args.get("last").and_then(|v| v.as_u64()).map(|n| n as usize);
    let search = args.get("search").and_then(|v| v.as_str()).map(String::from);

    // Send request through pipe
    let msg = McpToApp::GetLogs {
        request_id: request_id.clone(),
        channel,
        level,
        last,
        search,
    };

    match router.send_and_wait(msg, &request_id, Duration::from_secs(5)).await {
        Ok(response) => {
            if let AppToMcp::LogEntries { text, .. } = response {
                McpToolResult::text(text)
            } else {
                McpToolResult::error("Unexpected response type from app")
            }
        }
        Err(e) => McpToolResult::error(format!("Log query failed: {}", e)),
    }
}
```

Note: `uuid_v4()` — check what the existing code uses for request IDs. Look at how `BrowserRequest` IDs are generated in `handlers/browser.rs`. Use the same pattern.

**Step 5: Add route in server.rs**

In the `route_tool_call` function, add after the `"voice_status"` line:
```rust
"get_logs" => handlers::core::handle_get_logs(args, data_dir, router).await,
```

**Step 6: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 7: Run Rust tests**

Run: `cd src-tauri && cargo test --bin voice-mirror-mcp`
Expected: All existing tests pass. Protocol roundtrip tests may need updates for the new variants.

**Step 8: Commit**

```bash
git add src-tauri/src/ipc/protocol.rs src-tauri/src/ipc/pipe_server.rs \
        src-tauri/src/mcp/tools.rs src-tauri/src/mcp/handlers/core.rs \
        src-tauri/src/mcp/server.rs
git commit -m "feat: add get_logs MCP tool with pipe protocol for log queries"
```

---

### Task 6: Frontend — Output Store + API Wrappers

Create the Svelte store and API wrappers for the Output panel.

**Files:**
- Create: `src/lib/stores/output.svelte.js`
- Modify: `src/lib/api.js`

**Step 1: Create `src/lib/stores/output.svelte.js`**

```javascript
/**
 * output.svelte.js -- Reactive store for Output panel log channels.
 *
 * Listens to `output-log` Tauri events and maintains per-channel arrays.
 * Tracks active channel, level filter, and auto-scroll state.
 */

import { listen } from '@tauri-apps/api/event';
import { getOutputLogs } from '../api.js';

const MAX_ENTRIES = 2000;
const CHANNELS = ['app', 'cli', 'voice', 'mcp', 'browser'];
const CHANNEL_LABELS = {
  app: 'App',
  cli: 'CLI Provider',
  voice: 'Voice Pipeline',
  mcp: 'MCP Server',
  browser: 'Browser Bridge',
};

let entries = $state({
  app: [],
  cli: [],
  voice: [],
  mcp: [],
  browser: [],
});

let activeChannel = $state('app');
let levelFilter = $state('info'); // minimum level shown
let autoScroll = $state(true);
let listening = false;

/** Level priority for filtering */
function levelPriority(level) {
  const map = { ERROR: 5, WARN: 4, INFO: 3, DEBUG: 2, TRACE: 1 };
  return map[level?.toUpperCase()] || 0;
}

/** Get filtered entries for the active channel */
function getFilteredEntries() {
  const channelEntries = entries[activeChannel] || [];
  const minPriority = levelPriority(levelFilter);
  return channelEntries.filter(e => levelPriority(e.level) >= minPriority);
}

/** Start listening for output-log events */
async function startListening() {
  if (listening) return;
  listening = true;

  // Load initial entries from backend
  for (const ch of CHANNELS) {
    try {
      const result = await getOutputLogs({ channel: ch, last: MAX_ENTRIES });
      if (result?.entries) {
        entries[ch] = result.entries;
      }
    } catch {
      // Backend may not be ready yet — that's fine
    }
  }

  // Subscribe to live events
  await listen('output-log', (event) => {
    const entry = event.payload;
    if (!entry?.channel || !entries[entry.channel]) return;

    const arr = entries[entry.channel];
    arr.push(entry);
    if (arr.length > MAX_ENTRIES) {
      entries[entry.channel] = arr.slice(arr.length - MAX_ENTRIES);
    }
  });
}

/** Switch active channel */
function switchChannel(ch) {
  if (CHANNELS.includes(ch)) {
    activeChannel = ch;
  }
}

/** Set minimum log level filter */
function setLevelFilter(level) {
  levelFilter = level;
}

/** Clear the display for the active channel (frontend only) */
function clearChannel() {
  entries[activeChannel] = [];
}

/** Toggle auto-scroll */
function setAutoScroll(value) {
  autoScroll = value;
}

export const outputStore = {
  get entries() { return entries; },
  get activeChannel() { return activeChannel; },
  get levelFilter() { return levelFilter; },
  get autoScroll() { return autoScroll; },
  get filteredEntries() { return getFilteredEntries(); },
  get channels() { return CHANNELS; },
  get channelLabels() { return CHANNEL_LABELS; },
  switchChannel,
  setLevelFilter,
  clearChannel,
  setAutoScroll,
  startListening,
};
```

**Step 2: Add API wrapper in `src/lib/api.js`**

Add at the end of the file (before the closing):
```javascript
// ============ Output / Diagnostics ============

export async function getOutputLogs(params) {
  return invoke('get_output_logs', { params });
}
```

**Step 3: Run JS tests**

Run: `npm test`
Expected: All 3400+ tests pass (new store has no tests yet — we'll add source-inspection tests in Task 8).

**Step 4: Commit**

```bash
git add src/lib/stores/output.svelte.js src/lib/api.js
git commit -m "feat: add output store and API wrapper for frontend log channel system"
```

---

### Task 7: Frontend — OutputPanel Component + LensWorkspace Integration

Create the Output panel UI and wire it into the bottom panel as a tab alongside Terminal.

**Files:**
- Create: `src/components/lens/OutputPanel.svelte`
- Modify: `src/components/lens/LensWorkspace.svelte`
- Modify: `src/components/terminal/TerminalTabs.svelte`

**Step 1: Create `src/components/lens/OutputPanel.svelte`**

```svelte
<script>
  /**
   * OutputPanel.svelte -- VS Code-style output log viewer.
   *
   * Shows one log channel at a time with a dropdown to switch.
   * Auto-scrolls to bottom; pauses when user scrolls up.
   * Level filter buttons toggle visibility by severity.
   */
  import { onMount } from 'svelte';
  import { outputStore } from '../../lib/stores/output.svelte.js';

  let logContainer;

  // Auto-scroll on new entries
  $effect(() => {
    // Access filteredEntries to create dependency
    const _ = outputStore.filteredEntries.length;
    if (outputStore.autoScroll && logContainer) {
      requestAnimationFrame(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
      });
    }
  });

  function handleScroll() {
    if (!logContainer) return;
    const atBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 30;
    outputStore.setAutoScroll(atBottom);
  }

  function levelClass(level) {
    switch (level) {
      case 'ERROR': return 'log-error';
      case 'WARN': return 'log-warn';
      case 'DEBUG': return 'log-debug';
      case 'TRACE': return 'log-trace';
      default: return '';
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  }

  const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

  onMount(() => {
    outputStore.startListening();
  });
</script>

<div class="output-panel">
  <div class="output-toolbar">
    <select
      class="channel-select"
      value={outputStore.activeChannel}
      onchange={(e) => outputStore.switchChannel(e.target.value)}
    >
      {#each outputStore.channels as ch}
        <option value={ch}>{outputStore.channelLabels[ch]}</option>
      {/each}
    </select>

    <div class="level-filters">
      {#each LEVELS as lvl}
        <button
          class="level-btn"
          class:active={LEVELS.indexOf(outputStore.levelFilter) <= LEVELS.indexOf(lvl)}
          class:is-error={lvl === 'error'}
          class:is-warn={lvl === 'warn'}
          onclick={() => outputStore.setLevelFilter(lvl)}
          title="Show {lvl} and above"
        >
          {lvl.charAt(0).toUpperCase()}
        </button>
      {/each}
    </div>

    <div class="toolbar-spacer"></div>

    {#if !outputStore.autoScroll}
      <button class="scroll-btn" onclick={() => {
        outputStore.setAutoScroll(true);
        if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
      }} title="Scroll to bottom">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    {/if}

    <button class="clear-btn" onclick={() => outputStore.clearChannel()} title="Clear output">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
        <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
      </svg>
    </button>
  </div>

  <div
    class="output-log"
    bind:this={logContainer}
    onscroll={handleScroll}
  >
    {#each outputStore.filteredEntries as entry (entry.timestamp + entry.message)}
      <div class="log-line {levelClass(entry.level)}">
        <span class="log-time">{formatTime(entry.timestamp)}</span>
        <span class="log-level">[{entry.level}]</span>
        <span class="log-msg">{entry.message}</span>
      </div>
    {/each}
    {#if outputStore.filteredEntries.length === 0}
      <div class="log-empty">No log entries{outputStore.levelFilter !== 'trace' ? ` at ${outputStore.levelFilter} level or above` : ''}</div>
    {/if}
  </div>
</div>

<style>
  .output-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .output-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    min-height: 32px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    user-select: none;
  }

  .channel-select {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-family);
    padding: 2px 6px;
    cursor: pointer;
    outline: none;
  }

  .channel-select:focus {
    border-color: var(--accent);
  }

  .level-filters {
    display: flex;
    gap: 1px;
  }

  .level-btn {
    padding: 2px 6px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    opacity: 0.5;
  }

  .level-btn.active {
    opacity: 1;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--text);
  }

  .level-btn.is-error.active {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }

  .level-btn.is-warn.active {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }

  .toolbar-spacer {
    flex: 1;
  }

  .scroll-btn, .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .scroll-btn:hover, .clear-btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .output-log {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 8px;
    font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: 11px;
    line-height: 1.5;
  }

  .log-line {
    white-space: pre-wrap;
    word-break: break-all;
  }

  .log-time {
    color: var(--muted);
    margin-right: 6px;
  }

  .log-level {
    margin-right: 4px;
    font-weight: 600;
  }

  .log-line.log-error .log-level { color: var(--danger); }
  .log-line.log-error .log-msg { color: var(--danger); }
  .log-line.log-warn .log-level { color: var(--warn); }
  .log-line.log-warn .log-msg { color: var(--warn); }
  .log-line.log-debug { opacity: 0.65; }
  .log-line.log-trace { opacity: 0.4; }

  .log-empty {
    color: var(--muted);
    padding: 20px;
    text-align: center;
    font-size: 12px;
    opacity: 0.6;
  }
</style>
```

**Step 2: Add Output tab to TerminalTabs.svelte**

The Output panel needs to be a tab in the bottom panel alongside the terminal tabs. Add an "Output" tab button to the `TerminalTabs` tab bar.

In `TerminalTabs.svelte`, add after the imports:
```javascript
import OutputPanel from '../lens/OutputPanel.svelte';
```

Add state:
```javascript
let bottomPanelMode = $state('terminal'); // 'terminal' | 'output'
```

Add an "Output" tab button next to the terminal tabs (in the tab bar, before the spacer):
```svelte
<!-- Output panel tab -->
<div
  class="terminal-tab"
  class:active={bottomPanelMode === 'output'}
  role="tab"
  tabindex="0"
  aria-selected={bottomPanelMode === 'output'}
  onclick={() => bottomPanelMode = 'output'}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') bottomPanelMode = 'output'; }}
>
  <svg class="tab-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
  </svg>
  <span class="tab-label">Output</span>
</div>
```

Make terminal tabs activate `bottomPanelMode = 'terminal'` when clicked (add to existing onclick).

In the terminal panels section, conditionally show Output panel:
```svelte
<!-- Terminal panels (hidden when Output is active) -->
<div class="terminal-panels" class:hidden={bottomPanelMode === 'output'}>
  ...existing terminal panels...
</div>

<!-- Output panel (hidden when Terminal is active) -->
{#if bottomPanelMode === 'output'}
  <div class="output-panel-container">
    <OutputPanel />
  </div>
{/if}
```

Add style:
```css
.output-panel-container {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
```

**Step 3: Run JS tests**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/components/lens/OutputPanel.svelte \
        src/components/terminal/TerminalTabs.svelte
git commit -m "feat: add OutputPanel component with channel dropdown, level filters, and auto-scroll"
```

---

### Task 8: Debug Mode Wiring + Tests

Wire the Debug Mode toggle to actually control the log level, and add source-inspection tests.

**Files:**
- Modify: `src/components/settings/BehaviorSettings.svelte` (update description)
- Create: `test/components/output-panel.test.cjs`
- Create: `test/stores/output-store.test.cjs`

**Step 1: Update Debug Mode toggle description**

In `BehaviorSettings.svelte` (around line 158-159), change the description:
```
description="Enable debug logging"
```
to:
```
description="Capture DEBUG and TRACE level logs in the Output panel"
```

**Step 2: Create source-inspection test for OutputPanel**

Create `test/components/output-panel.test.cjs`:
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/OutputPanel.svelte'),
  'utf-8'
);

describe('OutputPanel.svelte', () => {
  it('imports outputStore', () => {
    assert.ok(src.includes("from '../../lib/stores/output.svelte.js'"));
  });

  it('has channel dropdown', () => {
    assert.ok(src.includes('channel-select'));
    assert.ok(src.includes('outputStore.switchChannel'));
  });

  it('has level filter buttons', () => {
    assert.ok(src.includes('level-filters'));
    assert.ok(src.includes('outputStore.setLevelFilter'));
  });

  it('renders log entries with level classes', () => {
    assert.ok(src.includes('log-error'));
    assert.ok(src.includes('log-warn'));
    assert.ok(src.includes('log-debug'));
    assert.ok(src.includes('log-trace'));
  });

  it('has auto-scroll behavior', () => {
    assert.ok(src.includes('autoScroll'));
    assert.ok(src.includes('scrollTop'));
  });

  it('has clear button', () => {
    assert.ok(src.includes('clearChannel'));
    assert.ok(src.includes('clear-btn'));
  });

  it('color-codes error and warn levels', () => {
    assert.ok(src.includes('var(--danger)'));
    assert.ok(src.includes('var(--warn)'));
  });
});
```

**Step 3: Create source-inspection test for output store**

Create `test/stores/output-store.test.cjs`:
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/output.svelte.js'),
  'utf-8'
);

describe('output.svelte.js store', () => {
  it('exports outputStore', () => {
    assert.ok(src.includes('export const outputStore'));
  });

  it('defines all 5 channels', () => {
    assert.ok(src.includes("'app'"));
    assert.ok(src.includes("'cli'"));
    assert.ok(src.includes("'voice'"));
    assert.ok(src.includes("'mcp'"));
    assert.ok(src.includes("'browser'"));
  });

  it('listens to output-log Tauri event', () => {
    assert.ok(src.includes("'output-log'"));
    assert.ok(src.includes('listen'));
  });

  it('has MAX_ENTRIES cap', () => {
    assert.ok(src.includes('MAX_ENTRIES'));
    assert.ok(src.includes('2000'));
  });

  it('exports switchChannel function', () => {
    assert.ok(src.includes('switchChannel'));
  });

  it('exports setLevelFilter function', () => {
    assert.ok(src.includes('setLevelFilter'));
  });

  it('exports clearChannel function', () => {
    assert.ok(src.includes('clearChannel'));
  });

  it('imports getOutputLogs from api', () => {
    assert.ok(src.includes("from '../api.js'"));
    assert.ok(src.includes('getOutputLogs'));
  });

  it('has level priority function', () => {
    assert.ok(src.includes('levelPriority'));
  });

  it('has auto-scroll state', () => {
    assert.ok(src.includes('autoScroll'));
  });
});
```

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass including the new ones.

Run: `cd src-tauri && cargo test --lib services::output`
Expected: All Rust tests pass.

**Step 5: Commit**

```bash
git add src/components/settings/BehaviorSettings.svelte \
        test/components/output-panel.test.cjs \
        test/stores/output-store.test.cjs
git commit -m "test: add source-inspection tests for OutputPanel and output store"
```

---

### Task 9: Verify Full Compilation + Manual Test

Final verification: full build check, all tests pass, and manual smoke test.

**Step 1: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 2: Run all Rust tests**

Run: `cd src-tauri && cargo test --bin voice-mirror-mcp`
Expected: All pass. If protocol tests fail due to new variants, update them.

**Step 3: Run all JS tests**

Run: `npm test`
Expected: All 3400+ tests pass.

**Step 4: Manual smoke test**

Run: `npm run dev`

Verify:
1. App starts with no errors in console
2. Switch to Lens mode
3. Click "Output" tab in the bottom panel
4. Channel dropdown shows: App, CLI Provider, Voice Pipeline, MCP Server, Browser Bridge
5. Log entries appear in real time (at minimum, startup logs from "App" channel)
6. Level filter buttons work (clicking "E" shows only errors, "I" shows info+warn+error)
7. Clear button clears the display
8. Auto-scroll works (scrolls to bottom on new entries, pauses when scrolled up)
9. Toggle Debug Mode in Settings → more verbose entries appear

**Step 5: Commit any fixes from smoke test**

```bash
git add -A
git commit -m "fix: address issues found during manual smoke test"
```

---

## Summary

| Task | Description | Files | Commit |
|------|-------------|-------|--------|
| 1 | Ring buffer backend | `output.rs` (new), `services/mod.rs` | `feat: add OutputStore ring buffer backend` |
| 2 | Wire into logger + state | `logger.rs`, `lib.rs` | `feat: wire OutputLayer into tracing subscriber` |
| 3 | Tauri commands | `commands/output.rs` (new), `commands/mod.rs`, `lib.rs` | `feat: add get_output_logs Tauri command` |
| 4 | Live event emission | `output.rs`, `lib.rs` | `feat: emit output-log Tauri events` |
| 5 | MCP get_logs tool | `protocol.rs`, `pipe_server.rs`, `tools.rs`, `core.rs`, `server.rs` | `feat: add get_logs MCP tool` |
| 6 | Frontend store + API | `output.svelte.js` (new), `api.js` | `feat: add output store and API wrapper` |
| 7 | OutputPanel UI | `OutputPanel.svelte` (new), `TerminalTabs.svelte` | `feat: add OutputPanel component` |
| 8 | Debug Mode + tests | `BehaviorSettings.svelte`, 2 test files | `test: add tests for output system` |
| 9 | Full verification | Any fixes | `fix: smoke test fixes` |
