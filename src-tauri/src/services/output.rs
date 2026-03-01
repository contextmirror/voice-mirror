use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader as StdBufReader, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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
    Frontend,
}

impl Channel {
    /// All channels, in definition order.
    pub const ALL: [Channel; 6] = [
        Channel::App,
        Channel::Cli,
        Channel::Voice,
        Channel::Mcp,
        Channel::Browser,
        Channel::Frontend,
    ];

    /// String label for the channel.
    pub fn as_str(&self) -> &'static str {
        match self {
            Channel::App => "app",
            Channel::Cli => "cli",
            Channel::Voice => "voice",
            Channel::Mcp => "mcp",
            Channel::Browser => "browser",
            Channel::Frontend => "frontend",
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
            "frontend" => Some(Channel::Frontend),
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

/// Monotonic ID counter for unique log entry identification.
static NEXT_ENTRY_ID: AtomicU64 = AtomicU64::new(1);

/// A single log entry stored in the ring buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Unique monotonic ID for keying in UI lists.
    pub id: u64,
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
// Project Channels (dynamic)
// ---------------------------------------------------------------------------

/// Metadata for a registered project channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelInfo {
    pub label: String,
    pub project_path: String,
    pub framework: Option<String>,
    pub port: Option<u16>,
}

/// Summary for a project channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelSummary {
    pub label: String,
    pub project_path: String,
    pub framework: Option<String>,
    pub port: Option<u16>,
    pub total: usize,
    pub error: usize,
    pub warn: usize,
    pub info: usize,
    pub debug: usize,
    pub trace: usize,
}

/// A dynamic project channel with metadata + ring buffer.
struct ProjectChannelEntry {
    info: ProjectChannelInfo,
    buffer: ChannelBuffer,
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
    project_channels: RwLock<HashMap<String, ProjectChannelEntry>>,
    app_handle: RwLock<Option<AppHandle>>,
    /// Optional JSONL file writer for project channel persistence.
    /// Set via `set_file_writer()` during app setup.
    file_writer: RwLock<Option<LogFileWriter>>,
}

impl OutputStore {
    /// Create an empty store with one buffer per channel.
    pub fn new() -> Self {
        let buffers: Vec<ChannelBuffer> = Channel::ALL.iter().map(|_| ChannelBuffer::new()).collect();
        Self {
            buffers: RwLock::new(buffers),
            project_channels: RwLock::new(HashMap::new()),
            app_handle: RwLock::new(None),
            file_writer: RwLock::new(None),
        }
    }

    /// Set the JSONL file writer for project channel persistence.
    /// Called once during app setup after the `OutputLayer` creates the writer.
    pub fn set_file_writer(&self, writer: LogFileWriter) {
        if let Ok(mut fw) = self.file_writer.write() {
            *fw = Some(writer);
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
            Channel::Frontend => 5,
        }
    }

    /// Push an already-constructed `LogEntry`.
    pub fn push(&self, entry: LogEntry) {
        let idx = Self::idx(entry.channel);
        // Recover from poison — a panicked writer shouldn't block all logging.
        let mut bufs = self.buffers.write().unwrap_or_else(|e| e.into_inner());
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
            id: NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed),
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
        let bufs = self.buffers.read().unwrap_or_else(|e| e.into_inner());
        bufs[Self::idx(channel)].query(min_level, last, search)
    }

    /// Get a summary of all channels.
    pub fn summary(&self) -> Vec<ChannelSummary> {
        let bufs = self.buffers.read().unwrap_or_else(|e| e.into_inner());
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

    // -----------------------------------------------------------------------
    // Project channels (dynamic)
    // -----------------------------------------------------------------------

    /// Register a new project channel. If a channel with the same label already
    /// exists, its metadata is updated but the buffer is preserved.
    pub fn register_project_channel(
        &self,
        label: String,
        project_path: String,
        framework: Option<String>,
        port: Option<u16>,
    ) {
        let mut pcs = self
            .project_channels
            .write()
            .unwrap_or_else(|e| e.into_inner());

        let info = ProjectChannelInfo {
            label: label.clone(),
            project_path,
            framework,
            port,
        };

        pcs.entry(label)
            .and_modify(|entry| entry.info = info.clone())
            .or_insert_with(|| ProjectChannelEntry {
                info,
                buffer: ChannelBuffer::new(),
            });
    }

    /// Remove a project channel and discard its buffer.
    pub fn unregister_project_channel(&self, label: &str) {
        let mut pcs = self
            .project_channels
            .write()
            .unwrap_or_else(|e| e.into_inner());
        pcs.remove(label);
    }

    /// Push a log entry into a project channel's buffer.
    ///
    /// If the channel does not exist, this is a no-op (never panics).
    /// Also persists to JSONL file if a file writer is configured.
    pub fn push_project(&self, label: &str, level: &str, message: &str) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let entry = LogEntry {
            id: NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed),
            timestamp,
            level: level.to_ascii_uppercase(),
            channel: Channel::App, // placeholder — project entries identified by label
            message: message.to_string(),
        };

        let mut pcs = self
            .project_channels
            .write()
            .unwrap_or_else(|e| e.into_inner());

        if let Some(pc) = pcs.get_mut(label) {
            pc.buffer.push(entry.clone());
            drop(pcs); // release write lock before emitting

            // Persist to JSONL file for terminal Claude's file fallback path
            if let Ok(fw) = self.file_writer.read() {
                if let Some(ref writer) = *fw {
                    writer.append_project(label, &entry);
                    // Truncate every 100 writes to prevent unbounded disk growth
                    if entry.id % 100 == 0 {
                        writer.maybe_truncate_project(label);
                    }
                }
            }

            self.emit_project_entry(label, &entry);
        }
    }

    /// Query a project channel's buffer.
    ///
    /// Returns `(matching_entries, total_count)`. If the channel does not exist,
    /// returns `([], 0)`.
    pub fn query_project(
        &self,
        label: &str,
        min_level: Option<&str>,
        last: Option<usize>,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let pcs = self
            .project_channels
            .read()
            .unwrap_or_else(|e| e.into_inner());

        match pcs.get(label) {
            Some(pc) => pc.buffer.query(min_level, last, search),
            None => (Vec::new(), 0),
        }
    }

    /// Return a summary for every registered project channel.
    pub fn project_summary(&self) -> Vec<ProjectChannelSummary> {
        let pcs = self
            .project_channels
            .read()
            .unwrap_or_else(|e| e.into_inner());

        pcs.values()
            .map(|pc| {
                let (error, warn, info, debug, trace) = pc.buffer.count_by_level();
                ProjectChannelSummary {
                    label: pc.info.label.clone(),
                    project_path: pc.info.project_path.clone(),
                    framework: pc.info.framework.clone(),
                    port: pc.info.port,
                    total: pc.buffer.entries.len(),
                    error,
                    warn,
                    info,
                    debug,
                    trace,
                }
            })
            .collect()
    }

    /// Return metadata for every registered project channel.
    pub fn list_project_channels(&self) -> Vec<ProjectChannelInfo> {
        let pcs = self
            .project_channels
            .read()
            .unwrap_or_else(|e| e.into_inner());

        pcs.values().map(|pc| pc.info.clone()).collect()
    }

    /// Emit a Tauri event for a project channel log entry (best-effort).
    fn emit_project_entry(&self, label: &str, entry: &LogEntry) {
        if let Ok(ah) = self.app_handle.read() {
            if let Some(handle) = ah.as_ref() {
                let _ = handle.emit(
                    "project-output-log",
                    serde_json::json!({ "channel": label, "entry": entry }),
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// LogFileWriter (JSONL file sink)
// ---------------------------------------------------------------------------

/// Maximum JSONL lines per channel file before truncation.
const MAX_FILE_ENTRIES: usize = 2000;

/// After truncation, keep this many entries (75% of max to avoid churn).
const TRUNCATE_KEEP: usize = 1500;

/// Writes log entries as JSONL to per-channel files in a directory.
///
/// Each channel gets its own file: `{dir}/{channel}.jsonl`
/// (e.g., `app.jsonl`, `cli.jsonl`, `voice.jsonl`, etc.)
///
/// This is used as a pipe-free fallback: the Tauri app writes these files,
/// and external MCP binaries can read them when they can't connect via
/// named pipe.
pub struct LogFileWriter {
    dir: PathBuf,
}

// ---------------------------------------------------------------------------
// Shared JSONL file helpers (used by both system + project channels)
// ---------------------------------------------------------------------------

/// Read and filter log entries from a JSONL file on disk.
///
/// Returns `(matching_entries, total_lines_in_file)`.
fn read_entries_from_file(
    path: &Path,
    min_level: Option<&str>,
    last: Option<usize>,
    search: Option<&str>,
) -> (Vec<LogEntry>, usize) {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return (Vec::new(), 0),
    };

    let min_pri = min_level.map(level_priority).unwrap_or(0);
    let mut total: usize = 0;
    let mut filtered: Vec<LogEntry> = Vec::new();

    for line in StdBufReader::new(file).lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        total += 1;

        let entry: LogEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Level filter
        if level_priority(&entry.level) < min_pri {
            continue;
        }

        // Text search filter (case-insensitive)
        if let Some(s) = search {
            if !entry
                .message
                .to_ascii_lowercase()
                .contains(&s.to_ascii_lowercase())
            {
                continue;
            }
        }

        filtered.push(entry);
    }

    // Apply `last` (tail) limit
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

/// If a JSONL file exceeds `MAX_FILE_ENTRIES` lines, truncate it to keep
/// only the most recent `TRUNCATE_KEEP` lines. Atomic write via temp file.
fn truncate_file_if_needed(path: &Path) {
    // Read all lines
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let lines: Vec<String> = StdBufReader::new(file)
        .lines()
        .filter_map(|l| l.ok())
        .collect();

    if lines.len() <= MAX_FILE_ENTRIES {
        return;
    }

    // Keep the most recent TRUNCATE_KEEP lines
    let keep = &lines[lines.len() - TRUNCATE_KEEP..];

    // Write to a temp file, then rename (atomic on most OSes)
    let tmp_path = path.with_extension("jsonl.tmp");
    let write_result = (|| -> io::Result<()> {
        let mut tmp = File::create(&tmp_path)?;
        for line in keep {
            writeln!(tmp, "{}", line)?;
        }
        tmp.flush()?;
        Ok(())
    })();

    if write_result.is_ok() {
        let _ = fs::rename(&tmp_path, &path);
    } else {
        let _ = fs::remove_file(&tmp_path);
    }
}

/// Append a single JSON line to a file. Errors are silently ignored
/// because logging infrastructure must never crash the app.
fn append_entry_to_file(path: &Path, entry: &LogEntry) {
    let line = match serde_json::to_string(entry) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut file = match OpenOptions::new().create(true).append(true).open(path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let _ = writeln!(file, "{}", line);
    let _ = file.flush();
}

/// Sanitize a label for use as a filename component.
/// Replaces `/\:*?"<>| ` with `-` and lowercases.
fn sanitize_label(label: &str) -> String {
    label
        .chars()
        .map(|c| {
            if "/\\:*?\"<>| ".contains(c) {
                '-'
            } else {
                c.to_ascii_lowercase()
            }
        })
        .collect()
}

impl LogFileWriter {
    /// Create a new writer, ensuring the target directory exists.
    pub fn new(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    /// The directory this writer uses.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Path to the JSONL file for a given system channel.
    fn channel_path(&self, channel: Channel) -> PathBuf {
        self.dir.join(format!("{}.jsonl", channel.as_str()))
    }

    /// Path to the JSONL file for a project channel.
    fn project_channel_path(&self, label: &str) -> PathBuf {
        self.dir.join(format!("project-{}.jsonl", sanitize_label(label)))
    }

    /// Append a log entry as a single JSON line. Errors are silently ignored
    /// because logging infrastructure must never crash the app.
    pub fn append(&self, entry: &LogEntry) {
        append_entry_to_file(&self.channel_path(entry.channel), entry);
    }

    /// Append a log entry to a project channel's JSONL file.
    pub fn append_project(&self, label: &str, entry: &LogEntry) {
        append_entry_to_file(&self.project_channel_path(label), entry);
    }

    /// If the system channel file exceeds `MAX_FILE_ENTRIES` lines, truncate it.
    pub fn maybe_truncate(&self, channel: Channel) {
        truncate_file_if_needed(&self.channel_path(channel));
    }

    /// If the project channel file exceeds `MAX_FILE_ENTRIES` lines, truncate it.
    pub fn maybe_truncate_project(&self, label: &str) {
        truncate_file_if_needed(&self.project_channel_path(label));
    }

    /// Read and filter entries from a system channel's JSONL file.
    ///
    /// This is a **static** method — it does not require an instance. The MCP
    /// handler calls this directly with the log directory path.
    ///
    /// Returns `(matching_entries, total_lines_in_file)`.
    pub fn read_channel(
        dir: &Path,
        channel: Channel,
        min_level: Option<&str>,
        last: Option<usize>,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let path = dir.join(format!("{}.jsonl", channel.as_str()));
        read_entries_from_file(&path, min_level, last, search)
    }

    /// Read and filter entries from a project channel's JSONL file.
    ///
    /// This is a **static** method — it does not require an instance.
    ///
    /// Returns `(matching_entries, total_lines_in_file)`.
    pub fn read_project_channel(
        dir: &Path,
        label: &str,
        min_level: Option<&str>,
        last: Option<usize>,
        search: Option<&str>,
    ) -> (Vec<LogEntry>, usize) {
        let path = dir.join(format!("project-{}.jsonl", sanitize_label(label)));
        read_entries_from_file(&path, min_level, last, search)
    }

    /// List all project channels that have JSONL files on disk.
    ///
    /// Scans the directory for `project-*.jsonl` files and returns the label
    /// parts (the part after `project-` and before `.jsonl`).
    ///
    /// This is a **static** method.
    pub fn list_project_channels(dir: &Path) -> Vec<String> {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("project-") && name.ends_with(".jsonl") {
                    let label = name
                        .strip_prefix("project-")?
                        .strip_suffix(".jsonl")?
                        .to_string();
                    Some(label)
                } else {
                    None
                }
            })
            .collect()
    }

    /// Read summary information for all system channels from their JSONL files.
    ///
    /// This is a **static** method — it does not require an instance.
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
                        }
                    }
                };

                let mut total = 0usize;
                let mut error = 0usize;
                let mut warn = 0usize;
                let mut info = 0usize;
                let mut debug = 0usize;
                let mut trace = 0usize;

                for line in StdBufReader::new(file).lines() {
                    let line = match line {
                        Ok(l) => l,
                        Err(_) => continue,
                    };
                    if line.trim().is_empty() {
                        continue;
                    }
                    total += 1;

                    // Parse just enough to get the level
                    if let Ok(entry) = serde_json::from_str::<LogEntry>(&line) {
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

/// A `tracing_subscriber::Layer` that captures events into the `OutputStore`
/// and optionally persists them to JSONL files on disk.
pub struct OutputLayer {
    store: std::sync::Arc<OutputStore>,
    file_writer: Option<LogFileWriter>,
    write_count: AtomicU64,
}

impl OutputLayer {
    pub fn new(store: std::sync::Arc<OutputStore>) -> Self {
        let logs_dir = super::platform::get_log_dir().join("current");
        let file_writer = LogFileWriter::new(logs_dir).ok();
        Self {
            store,
            file_writer,
            write_count: AtomicU64::new(0),
        }
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

        let entry = LogEntry {
            id: NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed),
            timestamp,
            level: level.to_string(),
            channel,
            message,
        };

        // Write to JSONL file (before push, which consumes via clone internally)
        if let Some(ref writer) = self.file_writer {
            writer.append(&entry);
            let count = self.write_count.fetch_add(1, Ordering::Relaxed);
            // Truncate check every 100 writes to avoid excessive filesystem ops
            if count % 100 == 0 {
                writer.maybe_truncate(channel);
            }
        }

        self.store.push(entry);
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
                id: i as u64,
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
            id: 1,
            timestamp: 1,
            level: "ERROR".to_string(),
            channel: Channel::App,
            message: "an error".to_string(),
        });
        store.push(LogEntry {
            id: 2,
            timestamp: 2,
            level: "INFO".to_string(),
            channel: Channel::App,
            message: "some info".to_string(),
        });
        store.push(LogEntry {
            id: 3,
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
            id: 1,
            timestamp: 1,
            level: "INFO".to_string(),
            channel: Channel::Cli,
            message: "PTY opened for claude".to_string(),
        });
        store.push(LogEntry {
            id: 2,
            timestamp: 2,
            level: "INFO".to_string(),
            channel: Channel::Cli,
            message: "Provider started".to_string(),
        });
        store.push(LogEntry {
            id: 3,
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
        assert_eq!(summaries.len(), 6);

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
            id: 1,
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
            id: 2,
            // 01:02:03 UTC => (1*3600 + 2*60 + 3) * 1000 = 3723000
            timestamp: 3723000,
            level: "ERROR".to_string(),
            channel: Channel::Mcp,
            message: "pipe broken".to_string(),
        };
        assert_eq!(entry2.format_line(), "01:02:03 [ERROR] pipe broken");
    }

    // -----------------------------------------------------------------------
    // LogFileWriter tests
    // -----------------------------------------------------------------------

    fn make_entry(id: u64, level: &str, channel: Channel, msg: &str) -> LogEntry {
        LogEntry {
            id,
            timestamp: id * 1000,
            level: level.to_string(),
            channel,
            message: msg.to_string(),
        }
    }

    #[test]
    fn test_file_writer_append_and_read() {
        let dir = std::env::temp_dir().join(format!("vm_test_fw_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        writer.append(&make_entry(1, "INFO", Channel::App, "hello"));
        writer.append(&make_entry(2, "ERROR", Channel::App, "boom"));
        writer.append(&make_entry(3, "DEBUG", Channel::App, "tick"));

        let (entries, total) = LogFileWriter::read_channel(&dir, Channel::App, None, None, None);
        assert_eq!(total, 3);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].message, "hello");
        assert_eq!(entries[2].message, "tick");

        // Level filter: ERROR only
        let (entries, _) =
            LogFileWriter::read_channel(&dir, Channel::App, Some("error"), None, None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, "ERROR");

        // Search filter
        let (entries, _) =
            LogFileWriter::read_channel(&dir, Channel::App, None, None, Some("ello"));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].message, "hello");

        // Last (tail) filter
        let (entries, _) =
            LogFileWriter::read_channel(&dir, Channel::App, None, Some(2), None);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "boom");
        assert_eq!(entries[1].message, "tick");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_writer_read_missing_channel() {
        let dir = std::env::temp_dir().join(format!("vm_test_fw_miss_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);

        // Reading a channel that has no file should return empty
        let (entries, total) = LogFileWriter::read_channel(&dir, Channel::Voice, None, None, None);
        assert_eq!(total, 0);
        assert!(entries.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_writer_summary() {
        let dir = std::env::temp_dir().join(format!("vm_test_fw_sum_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        writer.append(&make_entry(1, "ERROR", Channel::App, "e1"));
        writer.append(&make_entry(2, "WARN", Channel::App, "w1"));
        writer.append(&make_entry(3, "INFO", Channel::Cli, "i1"));
        writer.append(&make_entry(4, "DEBUG", Channel::Cli, "d1"));

        let summaries = LogFileWriter::read_summary(&dir);
        assert_eq!(summaries.len(), 6);

        let app = &summaries[0];
        assert_eq!(app.channel, Channel::App);
        assert_eq!(app.total, 2);
        assert_eq!(app.error, 1);
        assert_eq!(app.warn, 1);

        let cli = &summaries[1];
        assert_eq!(cli.channel, Channel::Cli);
        assert_eq!(cli.total, 2);
        assert_eq!(cli.info, 1);
        assert_eq!(cli.debug, 1);

        // Channels with no file should show zero
        let voice = &summaries[2];
        assert_eq!(voice.channel, Channel::Voice);
        assert_eq!(voice.total, 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_writer_truncation() {
        let dir = std::env::temp_dir().join(format!("vm_test_fw_trunc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        // Write more than MAX_FILE_ENTRIES lines
        for i in 0..(MAX_FILE_ENTRIES + 200) {
            writer.append(&make_entry(
                i as u64,
                "INFO",
                Channel::App,
                &format!("line {}", i),
            ));
        }

        // Before truncation, file has MAX_FILE_ENTRIES + 200 lines
        let (_, total_before) =
            LogFileWriter::read_channel(&dir, Channel::App, None, None, None);
        assert_eq!(total_before, MAX_FILE_ENTRIES + 200);

        // Trigger truncation
        writer.maybe_truncate(Channel::App);

        // After truncation, should have TRUNCATE_KEEP lines
        let (entries, total_after) =
            LogFileWriter::read_channel(&dir, Channel::App, None, None, None);
        assert_eq!(total_after, TRUNCATE_KEEP);
        assert_eq!(entries.len(), TRUNCATE_KEEP);

        // The kept entries should be the most recent ones
        let first_kept_id = (MAX_FILE_ENTRIES + 200) - TRUNCATE_KEEP;
        assert_eq!(entries[0].message, format!("line {}", first_kept_id));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_writer_no_truncation_under_limit() {
        let dir = std::env::temp_dir().join(format!("vm_test_fw_notrunc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        // Write exactly MAX_FILE_ENTRIES lines (at the limit, not over)
        for i in 0..MAX_FILE_ENTRIES {
            writer.append(&make_entry(i as u64, "INFO", Channel::App, &format!("l{}", i)));
        }

        writer.maybe_truncate(Channel::App);

        // Should NOT truncate — still at the limit
        let (_, total) = LogFileWriter::read_channel(&dir, Channel::App, None, None, None);
        assert_eq!(total, MAX_FILE_ENTRIES);

        let _ = fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // Project channel tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_project_channel_register_and_push() {
        let store = OutputStore::new();

        store.register_project_channel(
            "my-app".to_string(),
            "/projects/my-app".to_string(),
            Some("vite".to_string()),
            Some(3000),
        );

        store.push_project("my-app", "INFO", "Server started");
        store.push_project("my-app", "WARN", "Deprecation warning");

        let (entries, total) = store.query_project("my-app", None, None, None);
        assert_eq!(total, 2);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "Server started");
        assert_eq!(entries[0].level, "INFO");
        assert_eq!(entries[1].message, "Deprecation warning");
        assert_eq!(entries[1].level, "WARN");
    }

    #[test]
    fn test_project_channel_unregister() {
        let store = OutputStore::new();

        store.register_project_channel(
            "temp-proj".to_string(),
            "/tmp/proj".to_string(),
            None,
            None,
        );

        store.push_project("temp-proj", "INFO", "hello");

        // Verify it exists
        let (entries, total) = store.query_project("temp-proj", None, None, None);
        assert_eq!(total, 1);
        assert_eq!(entries.len(), 1);

        // Unregister
        store.unregister_project_channel("temp-proj");

        // Query should return empty now
        let (entries, total) = store.query_project("temp-proj", None, None, None);
        assert_eq!(total, 0);
        assert!(entries.is_empty());

        // list_project_channels should not include it
        let channels = store.list_project_channels();
        assert!(channels.iter().all(|c| c.label != "temp-proj"));
    }

    #[test]
    fn test_project_channel_summary() {
        let store = OutputStore::new();

        store.register_project_channel(
            "alpha".to_string(),
            "/projects/alpha".to_string(),
            Some("next".to_string()),
            Some(3000),
        );
        store.register_project_channel(
            "beta".to_string(),
            "/projects/beta".to_string(),
            Some("vite".to_string()),
            Some(5173),
        );

        store.push_project("alpha", "ERROR", "crash");
        store.push_project("alpha", "WARN", "slow");
        store.push_project("alpha", "INFO", "ok");

        store.push_project("beta", "DEBUG", "tick");
        store.push_project("beta", "TRACE", "noise");

        let summaries = store.project_summary();
        assert_eq!(summaries.len(), 2);

        // Sort by label for deterministic ordering (HashMap iteration is unordered)
        let mut summaries = summaries;
        summaries.sort_by(|a, b| a.label.cmp(&b.label));

        let alpha = &summaries[0];
        assert_eq!(alpha.label, "alpha");
        assert_eq!(alpha.project_path, "/projects/alpha");
        assert_eq!(alpha.framework.as_deref(), Some("next"));
        assert_eq!(alpha.port, Some(3000));
        assert_eq!(alpha.total, 3);
        assert_eq!(alpha.error, 1);
        assert_eq!(alpha.warn, 1);
        assert_eq!(alpha.info, 1);
        assert_eq!(alpha.debug, 0);
        assert_eq!(alpha.trace, 0);

        let beta = &summaries[1];
        assert_eq!(beta.label, "beta");
        assert_eq!(beta.total, 2);
        assert_eq!(beta.debug, 1);
        assert_eq!(beta.trace, 1);
    }

    #[test]
    fn test_project_channel_ring_buffer_cap() {
        let store = OutputStore::new();

        store.register_project_channel(
            "big".to_string(),
            "/projects/big".to_string(),
            None,
            None,
        );

        for i in 0..2500 {
            store.push_project("big", "INFO", &format!("entry {}", i));
        }

        let (entries, total) = store.query_project("big", None, None, None);
        assert_eq!(total, MAX_ENTRIES_PER_CHANNEL); // 2000
        assert_eq!(entries.len(), MAX_ENTRIES_PER_CHANNEL);

        // Oldest retained should be entry 500 (0..499 evicted)
        assert_eq!(entries[0].message, "entry 500");

        // Newest should be entry 2499
        assert_eq!(entries[1999].message, "entry 2499");
    }

    #[test]
    fn test_project_channel_query_filters() {
        let store = OutputStore::new();

        store.register_project_channel(
            "filtered".to_string(),
            "/projects/filtered".to_string(),
            None,
            None,
        );

        store.push_project("filtered", "ERROR", "fatal crash in module A");
        store.push_project("filtered", "WARN", "deprecation in module B");
        store.push_project("filtered", "INFO", "server started");
        store.push_project("filtered", "DEBUG", "request handled");
        store.push_project("filtered", "TRACE", "byte-level trace");

        // Level filter: WARN and above
        let (entries, _) = store.query_project("filtered", Some("WARN"), None, None);
        assert_eq!(entries.len(), 2); // ERROR + WARN
        assert_eq!(entries[0].level, "ERROR");
        assert_eq!(entries[1].level, "WARN");

        // Search filter
        let (entries, _) = store.query_project("filtered", None, None, Some("module"));
        assert_eq!(entries.len(), 2);
        assert!(entries[0].message.contains("module A"));
        assert!(entries[1].message.contains("module B"));

        // Last (tail) filter
        let (entries, _) = store.query_project("filtered", None, Some(2), None);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].level, "DEBUG");
        assert_eq!(entries[1].level, "TRACE");

        // Combined: level + search
        let (entries, _) = store.query_project("filtered", Some("WARN"), None, Some("module"));
        assert_eq!(entries.len(), 2); // ERROR has "module A", WARN has "module B"
    }

    #[test]
    fn test_push_to_nonexistent_project_channel_is_noop() {
        let store = OutputStore::new();

        // Should not panic
        store.push_project("does-not-exist", "ERROR", "boom");

        // Query returns empty
        let (entries, total) = store.query_project("does-not-exist", None, None, None);
        assert_eq!(total, 0);
        assert!(entries.is_empty());
    }

    #[test]
    fn test_list_project_channels() {
        let store = OutputStore::new();

        store.register_project_channel(
            "proj-a".to_string(),
            "/projects/a".to_string(),
            Some("vite".to_string()),
            Some(5173),
        );
        store.register_project_channel(
            "proj-b".to_string(),
            "/projects/b".to_string(),
            None,
            Some(8080),
        );

        let mut channels = store.list_project_channels();
        assert_eq!(channels.len(), 2);

        // Sort for deterministic assertion (HashMap iteration order is not guaranteed)
        channels.sort_by(|a, b| a.label.cmp(&b.label));

        assert_eq!(channels[0].label, "proj-a");
        assert_eq!(channels[0].project_path, "/projects/a");
        assert_eq!(channels[0].framework.as_deref(), Some("vite"));
        assert_eq!(channels[0].port, Some(5173));

        assert_eq!(channels[1].label, "proj-b");
        assert_eq!(channels[1].project_path, "/projects/b");
        assert!(channels[1].framework.is_none());
        assert_eq!(channels[1].port, Some(8080));
    }

    // -----------------------------------------------------------------------
    // sanitize_label tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_sanitize_label() {
        assert_eq!(sanitize_label("my-app"), "my-app");
        assert_eq!(sanitize_label("My App"), "my-app");
        assert_eq!(sanitize_label("C:\\Users\\proj"), "c--users-proj");
        assert_eq!(sanitize_label("feat/branch"), "feat-branch");
        assert_eq!(sanitize_label("file:name*?.jsonl"), "file-name--.jsonl");
        assert_eq!(sanitize_label("a<b>c\"d|e"), "a-b-c-d-e");
    }

    // -----------------------------------------------------------------------
    // Project channel JSONL file persistence tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_project_file_writer_append_and_read() {
        let dir = std::env::temp_dir().join(format!("vm_test_pfw_ar_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        let e1 = make_entry(1, "INFO", Channel::App, "server started");
        let e2 = make_entry(2, "ERROR", Channel::App, "crash detected");

        writer.append_project("my-app", &e1);
        writer.append_project("my-app", &e2);

        // Read back
        let (entries, total) =
            LogFileWriter::read_project_channel(&dir, "my-app", None, None, None);
        assert_eq!(total, 2);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "server started");
        assert_eq!(entries[1].message, "crash detected");

        // Level filter: ERROR only
        let (entries, _) =
            LogFileWriter::read_project_channel(&dir, "my-app", Some("error"), None, None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, "ERROR");

        // Search filter
        let (entries, _) =
            LogFileWriter::read_project_channel(&dir, "my-app", None, None, Some("started"));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].message, "server started");

        // Last (tail) filter
        let (entries, _) =
            LogFileWriter::read_project_channel(&dir, "my-app", None, Some(1), None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].message, "crash detected");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_project_file_list_channels() {
        let dir = std::env::temp_dir().join(format!("vm_test_pfw_list_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        let e1 = make_entry(1, "INFO", Channel::App, "hello from alpha");
        let e2 = make_entry(2, "INFO", Channel::App, "hello from beta");

        writer.append_project("alpha", &e1);
        writer.append_project("beta", &e2);

        // Also write a system channel to verify it's not included
        writer.append(&make_entry(3, "INFO", Channel::App, "system entry"));

        let mut channels = LogFileWriter::list_project_channels(&dir);
        channels.sort();
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0], "alpha");
        assert_eq!(channels[1], "beta");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_project_file_writer_truncation() {
        let dir = std::env::temp_dir().join(format!("vm_test_pfw_trunc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let writer = LogFileWriter::new(dir.clone()).unwrap();

        // Write more than MAX_FILE_ENTRIES lines
        for i in 0..(MAX_FILE_ENTRIES + 100) {
            writer.append_project(
                "big-proj",
                &make_entry(i as u64, "INFO", Channel::App, &format!("line {}", i)),
            );
        }

        // Before truncation
        let (_, total_before) =
            LogFileWriter::read_project_channel(&dir, "big-proj", None, None, None);
        assert_eq!(total_before, MAX_FILE_ENTRIES + 100);

        // Trigger truncation
        writer.maybe_truncate_project("big-proj");

        // After truncation
        let (entries, total_after) =
            LogFileWriter::read_project_channel(&dir, "big-proj", None, None, None);
        assert_eq!(total_after, TRUNCATE_KEEP);
        assert_eq!(entries.len(), TRUNCATE_KEEP);

        // The kept entries should be the most recent ones
        let first_kept_id = (MAX_FILE_ENTRIES + 100) - TRUNCATE_KEEP;
        assert_eq!(entries[0].message, format!("line {}", first_kept_id));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_project_file_read_nonexistent() {
        let dir = std::env::temp_dir().join(format!("vm_test_pfw_miss_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);

        let (entries, total) =
            LogFileWriter::read_project_channel(&dir, "nope", None, None, None);
        assert_eq!(total, 0);
        assert!(entries.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_project_file_list_empty_dir() {
        let dir = std::env::temp_dir().join(format!("vm_test_pfw_empty_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);

        let channels = LogFileWriter::list_project_channels(&dir);
        assert!(channels.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }
}
