# Log File Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable external MCP clients (terminal Claude Code) to query logs via JSONL files when the named pipe is unavailable.

**Architecture:** The Tauri app's `OutputLayer` writes each log entry to channel-specific JSONL files under `logs/current/`. On startup, the previous session's `current/` is rotated to `session-{timestamp}/` and old sessions beyond 5 are pruned. The MCP `get_logs` handler falls back to reading these files when no pipe is connected.

**Tech Stack:** Rust (serde_json for JSONL, std::fs for file I/O, tracing for logging)

---

### Task 1: Add `LogFileWriter` to `services/output.rs`

**Files:**
- Modify: `src-tauri/src/services/output.rs`

**Step 1: Add the `LogFileWriter` struct after the `OutputStore` implementation (after line 342)**

```rust
// ---------------------------------------------------------------------------
// LogFileWriter (JSONL file sink)
// ---------------------------------------------------------------------------

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader as StdBufReader, Write as IoWrite};
use std::path::{Path, PathBuf};

/// Maximum JSONL lines per channel file before truncation.
const MAX_FILE_ENTRIES: usize = 2000;

/// After truncation, keep this many entries (75% of max to avoid churn).
const TRUNCATE_KEEP: usize = 1500;

/// Writes log entries as JSONL to per-channel files in a directory.
pub struct LogFileWriter {
    dir: PathBuf,
}

impl LogFileWriter {
    /// Create a new writer targeting the given directory.
    /// Creates the directory if it doesn't exist.
    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    /// Append a log entry as a JSONL line to the channel's file.
    pub fn append(&self, entry: &LogEntry) {
        let path = self.dir.join(format!("{}.jsonl", entry.channel.as_str()));
        let line = match serde_json::to_string(entry) {
            Ok(json) => json,
            Err(_) => return,
        };

        let mut file = match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(f) => f,
            Err(_) => return,
        };

        let _ = writeln!(file, "{}", line);
        let _ = file.flush();
    }

    /// Check if a channel file exceeds MAX_FILE_ENTRIES and truncate if needed.
    /// Called periodically (e.g., every 100 entries) to avoid checking on every write.
    pub fn maybe_truncate(&self, channel: Channel) {
        let path = self.dir.join(format!("{}.jsonl", channel.as_str()));
        let line_count = match fs::read_to_string(&path) {
            Ok(content) => content.lines().count(),
            Err(_) => return,
        };

        if line_count > MAX_FILE_ENTRIES {
            self.truncate_file(&path, TRUNCATE_KEEP);
        }
    }

    /// Keep only the last `keep` lines of a file.
    fn truncate_file(&self, path: &Path, keep: usize) {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return,
        };

        let lines: Vec<&str> = content.lines().collect();
        if lines.len() <= keep {
            return;
        }

        let kept = &lines[lines.len() - keep..];
        let _ = fs::write(path, kept.join("\n") + "\n");
    }

    /// Read and parse entries from a channel's JSONL file, applying filters.
    /// Used by the MCP handler as a pipe-free fallback.
    pub fn read_channel(
        dir: &Path,
        channel: Channel,
        min_level: Option<&str>,
        last: Option<usize>,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let path = dir.join(format!("{}.jsonl", channel.as_str()));
        let file = match File::open(&path) {
            Ok(f) => f,
            Err(_) => return (vec![], 0),
        };

        let reader = StdBufReader::new(file);
        let all_entries: Vec<LogEntry> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect();

        let total = all_entries.len();
        let min_pri = min_level.map(level_priority).unwrap_or(0);

        let filtered: Vec<LogEntry> = all_entries
            .into_iter()
            .filter(|e| level_priority(&e.level) >= min_pri)
            .filter(|e| {
                search
                    .map(|s| e.message.to_ascii_lowercase().contains(&s.to_ascii_lowercase()))
                    .unwrap_or(true)
            })
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

    /// Read summaries from all channel files in a directory.
    /// Used by the MCP handler when no specific channel is requested.
    pub fn read_summary(dir: &Path) -> Vec<ChannelSummary> {
        Channel::ALL
            .iter()
            .map(|&ch| {
                let path = dir.join(format!("{}.jsonl", ch.as_str()));
                let file = match File::open(&path) {
                    Ok(f) => f,
                    Err(_) => {
                        return ChannelSummary {
                            channel: ch,
                            total: 0,
                            error: 0,
                            warn: 0,
                            info: 0,
                            debug: 0,
                            trace: 0,
                        };
                    }
                };

                let reader = StdBufReader::new(file);
                let mut error = 0;
                let mut warn = 0;
                let mut info = 0;
                let mut debug = 0;
                let mut trace = 0;
                let mut total = 0;

                for line in reader.lines().filter_map(|l| l.ok()) {
                    if let Ok(entry) = serde_json::from_str::<LogEntry>(&line) {
                        total += 1;
                        match entry.level.as_str() {
                            "ERROR" => error += 1,
                            "WARN" => warn += 1,
                            "INFO" => info += 1,
                            "DEBUG" => debug += 1,
                            "TRACE" => trace += 1,
                            _ => {}
                        }
                    }
                }

                ChannelSummary {
                    channel: ch,
                    total,
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
```

**Step 2: Add `LogFileWriter` to `OutputLayer` and call `append` in `on_event`**

Modify `OutputLayer` to hold an optional `LogFileWriter`:

```rust
pub struct OutputLayer {
    store: std::sync::Arc<OutputStore>,
    file_writer: Option<LogFileWriter>,
    write_count: std::sync::atomic::AtomicU64,
}

impl OutputLayer {
    pub fn new(store: std::sync::Arc<OutputStore>) -> Self {
        // Resolve logs/current/ directory
        let logs_dir = crate::services::platform::get_log_dir().join("current");
        let file_writer = LogFileWriter::new(logs_dir).ok();

        Self {
            store,
            file_writer,
            write_count: std::sync::atomic::AtomicU64::new(0),
        }
    }
}
```

In `on_event`, after `self.store.push(entry)`, add:

```rust
if let Some(ref writer) = self.file_writer {
    writer.append(&entry);
    let count = self.write_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if count % 100 == 0 {
        writer.maybe_truncate(channel);
    }
}
```

**Step 3: Run `cargo check` to verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

**Step 4: Commit**

```bash
git add src-tauri/src/services/output.rs
git commit -m "feat: add LogFileWriter for JSONL log file sink"
```

---

### Task 2: Add session rotation to `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add a `rotate_log_session` function before `pub fn run()`**

```rust
/// Rotate the current log session directory to a timestamped archive,
/// then prune archives beyond the retention limit.
fn rotate_log_sessions() {
    let logs_dir = services::platform::get_log_dir();
    let current_dir = logs_dir.join("current");

    // If current/ exists and has files, rotate it
    if current_dir.exists() {
        let has_files = std::fs::read_dir(&current_dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);

        if has_files {
            let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
            let archive_name = format!("session-{}", timestamp);
            let archive_dir = logs_dir.join(&archive_name);

            if let Err(e) = std::fs::rename(&current_dir, &archive_dir) {
                warn!("Failed to rotate log session: {}", e);
            } else {
                info!("Rotated log session to {}", archive_name);
            }
        }
    }

    // Create fresh current/
    let _ = std::fs::create_dir_all(&current_dir);

    // Prune old sessions (keep 5 most recent)
    let max_sessions = 5;
    let mut sessions: Vec<_> = std::fs::read_dir(&logs_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with("session-"))
                .unwrap_or(false)
        })
        .collect();

    // Sort by name (timestamps sort lexicographically)
    sessions.sort_by_key(|e| e.file_name());

    if sessions.len() > max_sessions {
        let to_remove = sessions.len() - max_sessions;
        for entry in &sessions[..to_remove] {
            if let Err(e) = std::fs::remove_dir_all(entry.path()) {
                warn!("Failed to prune old log session {:?}: {}", entry.file_name(), e);
            } else {
                info!("Pruned old log session: {:?}", entry.file_name());
            }
        }
    }
}
```

**Step 2: Call `rotate_log_sessions()` in `pub fn run()` before the Tauri builder**

Add it right after `let output_store = services::logger::init();` (line 111):

```rust
let output_store = services::logger::init();
rotate_log_sessions();
```

**Step 3: Verify `chrono` is available in Cargo.toml**

Run: `grep chrono src-tauri/Cargo.toml`

If not present, we can use a simple manual timestamp instead (SystemTime-based). Check and adapt.

**Step 4: Run `cargo check`**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: rotate log sessions on startup, keep last 5"
```

---

### Task 3: Add JSONL fallback to `handle_get_logs` in MCP handler

**Files:**
- Modify: `src-tauri/src/mcp/handlers/core.rs`

**Step 1: Replace the early-return in `handle_get_logs` with a file-based fallback**

Currently line 927-929:
```rust
let router = match router {
    Some(r) => r,
    None => return McpToolResult::error("Named pipe not connected — cannot query logs"),
};
```

Change the function to try pipe first, fall back to file:

```rust
pub async fn handle_get_logs(
    args: &Value,
    data_dir: &Path,
    router: Option<&Arc<PipeRouter>>,
) -> McpToolResult {
    // If pipe is available, use it (fast path — existing behavior)
    if let Some(router) = router {
        return handle_get_logs_via_pipe(args, router).await;
    }

    // Fallback: read JSONL files from logs/current/ directory
    handle_get_logs_via_files(args)
}

/// Query logs via named pipe (original implementation).
async fn handle_get_logs_via_pipe(
    args: &Value,
    router: &Arc<PipeRouter>,
) -> McpToolResult {
    let request_id = generate_request_id_for_logs();
    let channel = args.get("channel").and_then(|v| v.as_str()).map(String::from);
    let level = args.get("level").and_then(|v| v.as_str()).map(String::from);
    let last = args.get("last").and_then(|v| v.as_u64()).map(|n| n as usize);
    let search = args.get("search").and_then(|v| v.as_str()).map(String::from);

    let rx = router.wait_for_browser_response(&request_id).await;

    let msg = McpToApp::GetLogs {
        request_id: request_id.clone(),
        channel,
        level,
        last,
        search,
    };

    if let Err(e) = router.send(&msg).await {
        router.remove_waiter(&request_id).await;
        return McpToolResult::error(format!("Failed to send log request: {}", e));
    }

    match tokio::time::timeout(Duration::from_secs(5), rx).await {
        Ok(Ok(AppToMcp::LogEntries { text, .. })) => {
            McpToolResult::text(text)
        }
        Ok(Ok(_)) => McpToolResult::error("Unexpected response type from app"),
        Ok(Err(_)) => McpToolResult::error("Log response channel closed unexpectedly"),
        Err(_) => {
            router.remove_waiter(&request_id).await;
            McpToolResult::error("Log query timed out after 5 seconds")
        }
    }
}

/// Query logs by reading JSONL files directly (pipe-free fallback).
fn handle_get_logs_via_files(args: &Value) -> McpToolResult {
    use crate::services::output::{Channel, LogFileWriter, ChannelSummary};

    // Resolve the logs/current/ directory (same path the Tauri app writes to)
    let logs_dir = resolve_logs_current_dir();

    if !logs_dir.exists() {
        return McpToolResult::error(
            "Log directory not found. Is the Voice Mirror app running?"
        );
    }

    let channel = args.get("channel").and_then(|v| v.as_str());
    let level = args.get("level").and_then(|v| v.as_str());
    let last = args.get("last").and_then(|v| v.as_u64()).map(|n| n as usize);
    let search = args.get("search").and_then(|v| v.as_str());

    match channel {
        Some(ch_str) => {
            if let Some(ch) = Channel::from_str(ch_str) {
                let (entries, total) = LogFileWriter::read_channel(
                    &logs_dir,
                    ch,
                    level,
                    last.or(Some(100)),
                    search,
                );
                let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                let count = lines.len();
                let mut result = lines.join("\n");
                result.push_str(&format!(
                    "\n\n--- {} entries (filtered from {} total, via file fallback) ---",
                    count, total
                ));
                McpToolResult::text(result)
            } else {
                McpToolResult::error(format!(
                    "Unknown channel: {}. Available: app, cli, voice, mcp, browser",
                    ch_str
                ))
            }
        }
        None => {
            let summaries = LogFileWriter::read_summary(&logs_dir);
            let mut text = String::from("Output Channels (via file fallback):\n");
            for s in &summaries {
                text.push_str(&format!(
                    "  {:<8} {:>4} entries ({} error, {} warn, {} info)\n",
                    format!("{}:", s.channel),
                    s.total, s.error, s.warn, s.info
                ));
            }
            McpToolResult::text(text)
        }
    }
}

/// Resolve the logs/current/ directory path.
/// Uses the same platform logic as the Tauri app.
fn resolve_logs_current_dir() -> std::path::PathBuf {
    // In the MCP binary context, we resolve the same way as platform::get_log_dir()
    dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("voice-mirror")
        .join("logs")
        .join("current")
}
```

**Step 2: Run `cargo check`**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

**Step 3: Commit**

```bash
git add src-tauri/src/mcp/handlers/core.rs
git commit -m "feat: add JSONL file fallback for get_logs when pipe unavailable"
```

---

### Task 4: Integration test — rebuild MCP binary and verify

**Step 1: Rebuild the MCP binary**

Run: `cd src-tauri && cargo build --bin voice-mirror-mcp 2>&1 | tail -5`
Expected: successful build

**Step 2: Run existing Rust tests**

Run: `cd src-tauri && cargo test --bin voice-mirror-mcp 2>&1 | tail -20`
Expected: all tests pass

**Step 3: Run JS tests**

Run: `npm test 2>&1 | tail -5`
Expected: all tests pass

**Step 4: Manual verification — call get_logs from terminal Claude**

With Voice Mirror running, call `get_logs` MCP tool. It should:
- Return log entries (not "Named pipe not connected")
- Show "(via file fallback)" in the output

**Step 5: Commit any fixes and the plan doc**

```bash
git add docs/plans/
git commit -m "docs: add log file fallback design and plan"
```
