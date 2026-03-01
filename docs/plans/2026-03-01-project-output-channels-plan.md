# Project Output Channels — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dynamic project output channels that capture dev server build logs and browser console runtime logs, giving Claude full debugging visibility into projects built in the Lens workspace.

**Architecture:** Two-tier channel system — fixed system channels (existing 6) plus a dynamic `HashMap<String, ProjectChannel>` registry. Terminal PTY stdout mirrors to project channels tagged with framework name. WebView2 `ConsoleApiCalled` COM hook captures browser console output. Both sources merge chronologically into one channel per project. MCP `get_logs` extends to query project channels.

**Tech Stack:** Rust (services/output.rs, commands/output.rs, commands/lens.rs, terminal/mod.rs), WebView2 COM APIs (webview2-com 0.38), Svelte 5 runes (output.svelte.js, dev-server-manager.svelte.js), source-inspection tests (node:test)

---

### Task 1: Backend — Project Channel Registry in OutputStore

Add the dynamic project channel registry to the Rust backend. This is the foundation everything else builds on.

**Files:**
- Modify: `src-tauri/src/services/output.rs`

**Step 1: Write Rust tests for project channel operations**

Add to the existing `#[cfg(test)] mod tests` block in `output.rs` (after line 1098):

```rust
#[test]
fn test_project_channel_register_and_push() {
    let store = OutputStore::new();
    store.register_project_channel("my-app (Vite :5173)", "E:/Projects/my-app", Some("Vite"), Some(5173));

    store.push_project("my-app (Vite :5173)", "INFO", "[vite] hmr update /src/App.svelte");
    store.push_project("my-app (Vite :5173)", "ERROR", "[console:error] TypeError: x is undefined");

    let (entries, total) = store.query_project("my-app (Vite :5173)", None, None, None);
    assert_eq!(total, 2);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].message, "[vite] hmr update /src/App.svelte");
    assert_eq!(entries[1].level, "ERROR");
}

#[test]
fn test_project_channel_unregister() {
    let store = OutputStore::new();
    store.register_project_channel("my-app (Vite :5173)", "E:/Projects/my-app", Some("Vite"), Some(5173));
    store.push_project("my-app (Vite :5173)", "INFO", "test");

    store.unregister_project_channel("my-app (Vite :5173)");
    let (entries, _) = store.query_project("my-app (Vite :5173)", None, None, None);
    assert!(entries.is_empty());
}

#[test]
fn test_project_channel_summary() {
    let store = OutputStore::new();
    store.register_project_channel("app-a", "/a", None, None);
    store.register_project_channel("app-b", "/b", Some("Next"), Some(3000));

    store.push_project("app-a", "ERROR", "boom");
    store.push_project("app-a", "INFO", "ok");
    store.push_project("app-b", "WARN", "hmm");

    let summaries = store.project_summary();
    assert_eq!(summaries.len(), 2);
}

#[test]
fn test_project_channel_ring_buffer_cap() {
    let store = OutputStore::new();
    store.register_project_channel("test", "/test", None, None);

    for i in 0..2500 {
        store.push_project("test", "INFO", &format!("entry {}", i));
    }

    let (entries, total) = store.query_project("test", None, None, None);
    assert_eq!(total, 2000);
    assert_eq!(entries[0].message, "entry 500");
}

#[test]
fn test_project_channel_query_filters() {
    let store = OutputStore::new();
    store.register_project_channel("test", "/test", None, None);

    store.push_project("test", "ERROR", "crash");
    store.push_project("test", "INFO", "boot");
    store.push_project("test", "DEBUG", "tick");

    // Level filter
    let (entries, _) = store.query_project("test", Some("error"), None, None);
    assert_eq!(entries.len(), 1);

    // Search filter
    let (entries, _) = store.query_project("test", None, None, Some("boot"));
    assert_eq!(entries.len(), 1);

    // Last (tail) filter
    let (entries, _) = store.query_project("test", None, Some(2), None);
    assert_eq!(entries.len(), 2);
}

#[test]
fn test_push_to_nonexistent_project_channel_is_noop() {
    let store = OutputStore::new();
    // Should not panic or error
    store.push_project("nonexistent", "INFO", "lost");
    let (entries, _) = store.query_project("nonexistent", None, None, None);
    assert!(entries.is_empty());
}

#[test]
fn test_list_project_channels() {
    let store = OutputStore::new();
    store.register_project_channel("app-a (Vite :5173)", "/a", Some("Vite"), Some(5173));
    store.register_project_channel("app-b", "/b", None, None);

    let channels = store.list_project_channels();
    assert_eq!(channels.len(), 2);
    assert!(channels.iter().any(|c| c.label == "app-a (Vite :5173)"));
    assert!(channels.iter().any(|c| c.label == "app-b"));
}
```

**Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib -- test_project_channel`
Expected: FAIL — `register_project_channel`, `push_project`, `query_project` etc. don't exist yet.

**Step 3: Implement the project channel registry**

Add these types and methods to `output.rs`:

After `ChannelBuffer` (line 230), add:

```rust
// ---------------------------------------------------------------------------
// ProjectChannelInfo (public metadata)
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

/// Summary for a project channel (mirrors ChannelSummary but with string label).
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
```

Modify `OutputStore` struct (line 249-252) to add the project map:

```rust
pub struct OutputStore {
    buffers: RwLock<Vec<ChannelBuffer>>,
    project_channels: RwLock<HashMap<String, ProjectChannelEntry>>,
    app_handle: RwLock<Option<AppHandle>>,
}
```

Add `use std::collections::HashMap;` at top if not already present.

Update `OutputStore::new()` to initialize the project_channels map:

```rust
pub fn new() -> Self {
    let buffers: Vec<ChannelBuffer> = Channel::ALL.iter().map(|_| ChannelBuffer::new()).collect();
    Self {
        buffers: RwLock::new(buffers),
        project_channels: RwLock::new(HashMap::new()),
        app_handle: RwLock::new(None),
    }
}
```

Add project channel methods to `impl OutputStore`:

```rust
/// Register a dynamic project channel.
pub fn register_project_channel(
    &self,
    label: &str,
    project_path: &str,
    framework: Option<&str>,
    port: Option<u16>,
) {
    let mut channels = self.project_channels.write().unwrap_or_else(|e| e.into_inner());
    channels.insert(label.to_string(), ProjectChannelEntry {
        info: ProjectChannelInfo {
            label: label.to_string(),
            project_path: project_path.to_string(),
            framework: framework.map(String::from),
            port,
        },
        buffer: ChannelBuffer::new(),
    });
}

/// Unregister a dynamic project channel, dropping its buffer.
pub fn unregister_project_channel(&self, label: &str) {
    let mut channels = self.project_channels.write().unwrap_or_else(|e| e.into_inner());
    channels.remove(label);
}

/// Push a log entry to a project channel. No-op if channel doesn't exist.
pub fn push_project(&self, label: &str, level: &str, message: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let entry = LogEntry {
        id: NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed),
        timestamp,
        level: level.to_ascii_uppercase(),
        channel: Channel::App, // placeholder — project entries use label for routing
        message: message.to_string(),
    };

    let mut channels = self.project_channels.write().unwrap_or_else(|e| e.into_inner());
    if let Some(ch) = channels.get_mut(label) {
        ch.buffer.push(entry.clone());
        drop(channels); // Release lock before emitting
        // Emit with project channel label in a wrapper event
        self.emit_project_entry(label, &entry);
    }
}

/// Emit a project channel log entry as a Tauri event.
fn emit_project_entry(&self, label: &str, entry: &LogEntry) {
    if let Ok(ah) = self.app_handle.read() {
        if let Some(handle) = ah.as_ref() {
            let _ = handle.emit("project-output-log", serde_json::json!({
                "channel": label,
                "entry": entry,
            }));
        }
    }
}

/// Query a project channel.
pub fn query_project(
    &self,
    label: &str,
    min_level: Option<&str>,
    last: Option<usize>,
    search: Option<&str>,
) -> (Vec<LogEntry>, usize) {
    let channels = self.project_channels.read().unwrap_or_else(|e| e.into_inner());
    match channels.get(label) {
        Some(ch) => ch.buffer.query(min_level, last, search),
        None => (Vec::new(), 0),
    }
}

/// Get summaries for all project channels.
pub fn project_summary(&self) -> Vec<ProjectChannelSummary> {
    let channels = self.project_channels.read().unwrap_or_else(|e| e.into_inner());
    channels.values().map(|ch| {
        let (error, warn, info, debug, trace) = ch.buffer.count_by_level();
        ProjectChannelSummary {
            label: ch.info.label.clone(),
            project_path: ch.info.project_path.clone(),
            framework: ch.info.framework.clone(),
            port: ch.info.port,
            total: ch.buffer.entries.len(),
            error,
            warn,
            info,
            debug,
            trace,
        }
    }).collect()
}

/// List all registered project channels.
pub fn list_project_channels(&self) -> Vec<ProjectChannelInfo> {
    let channels = self.project_channels.read().unwrap_or_else(|e| e.into_inner());
    channels.values().map(|ch| ch.info.clone()).collect()
}
```

**Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib -- test_project_channel`
Expected: All 7 new tests PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/services/output.rs
git commit -m "feat: add dynamic project channel registry to OutputStore"
```

---

### Task 2: Backend — Project Channel JSONL Persistence

Add JSONL file read/write support for project channels so terminal Claude can access them.

**Files:**
- Modify: `src-tauri/src/services/output.rs`

**Step 1: Write tests for project channel JSONL operations**

Add to `mod tests` in `output.rs`:

```rust
#[test]
fn test_project_file_writer_append_and_read() {
    let dir = std::env::temp_dir().join(format!("vm_test_proj_fw_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);

    let writer = LogFileWriter::new(dir.clone()).unwrap();

    let entry1 = make_entry(1, "INFO", Channel::App, "[vite] hmr update");
    let entry2 = make_entry(2, "ERROR", Channel::App, "[console:error] TypeError");

    writer.append_project("my-app", &entry1);
    writer.append_project("my-app", &entry2);

    let (entries, total) = LogFileWriter::read_project_channel(&dir, "my-app", None, None, None);
    assert_eq!(total, 2);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].message, "[vite] hmr update");
    assert_eq!(entries[1].message, "[console:error] TypeError");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_project_file_list_channels() {
    let dir = std::env::temp_dir().join(format!("vm_test_proj_list_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);

    let writer = LogFileWriter::new(dir.clone()).unwrap();
    writer.append_project("app-a", &make_entry(1, "INFO", Channel::App, "test"));
    writer.append_project("app-b", &make_entry(2, "INFO", Channel::App, "test"));

    let channels = LogFileWriter::list_project_channels(&dir);
    assert_eq!(channels.len(), 2);
    assert!(channels.contains(&"app-a".to_string()));
    assert!(channels.contains(&"app-b".to_string()));

    let _ = fs::remove_dir_all(&dir);
}
```

**Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib -- test_project_file`
Expected: FAIL — `append_project`, `read_project_channel`, `list_project_channels` don't exist.

**Step 3: Implement project JSONL methods on LogFileWriter**

Add to `impl LogFileWriter`:

```rust
/// Path to the JSONL file for a project channel.
fn project_channel_path(&self, label: &str) -> PathBuf {
    let sanitized = label.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', ' '], "-")
        .to_ascii_lowercase();
    self.dir.join(format!("project-{}.jsonl", sanitized))
}

/// Append a log entry to a project channel's JSONL file.
pub fn append_project(&self, label: &str, entry: &LogEntry) {
    let line = match serde_json::to_string(entry) {
        Ok(s) => s,
        Err(_) => return,
    };

    let path = self.project_channel_path(label);
    let mut file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let _ = writeln!(file, "{}", line);
    let _ = file.flush();
}

/// Truncate a project channel's JSONL file if over limit.
pub fn maybe_truncate_project(&self, label: &str) {
    let path = self.project_channel_path(label);
    // Reuse the same truncation logic as system channels
    Self::truncate_file_if_needed(&path);
}

/// Read entries from a project channel's JSONL file.
pub fn read_project_channel(
    dir: &Path,
    label: &str,
    min_level: Option<&str>,
    last: Option<usize>,
    search: Option<&str>,
) -> (Vec<LogEntry>, usize) {
    let sanitized = label.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', ' '], "-")
        .to_ascii_lowercase();
    let path = dir.join(format!("project-{}.jsonl", sanitized));
    Self::read_entries_from_file(&path, min_level, last, search)
}

/// List all project channels that have JSONL files.
pub fn list_project_channels(dir: &Path) -> Vec<String> {
    let mut channels = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(label) = name.strip_prefix("project-").and_then(|s| s.strip_suffix(".jsonl")) {
                channels.push(label.to_string());
            }
        }
    }
    channels
}
```

Also refactor the common file-reading logic by extracting a shared helper from the existing `read_channel` method:

```rust
/// Read and filter entries from any JSONL file (shared logic).
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

        if level_priority(&entry.level) < min_pri {
            continue;
        }

        if let Some(s) = search {
            if !entry.message.to_ascii_lowercase().contains(&s.to_ascii_lowercase()) {
                continue;
            }
        }

        filtered.push(entry);
    }

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

/// Shared truncation logic for any JSONL file.
fn truncate_file_if_needed(path: &Path) {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let lines: Vec<String> = StdBufReader::new(file).lines().filter_map(|l| l.ok()).collect();

    if lines.len() <= MAX_FILE_ENTRIES {
        return;
    }

    let keep = &lines[lines.len() - TRUNCATE_KEEP..];
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
        let _ = fs::rename(&tmp_path, path);
    } else {
        let _ = fs::remove_file(&tmp_path);
    }
}
```

Update the existing `read_channel` and `maybe_truncate` methods to use the shared helpers.

**Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib -- test_project_file`
Expected: Both PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/services/output.rs
git commit -m "feat: add JSONL persistence for project output channels"
```

---

### Task 3: Backend — Tauri Commands for Project Channels

Add Tauri commands to register/unregister project channels and query their logs.

**Files:**
- Modify: `src-tauri/src/commands/output.rs`
- Modify: `src-tauri/src/lib.rs` (register commands in invoke_handler)

**Step 1: Add the new Tauri commands to `commands/output.rs`**

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterProjectChannelParams {
    pub label: String,
    pub project_path: String,
    pub framework: Option<String>,
    pub port: Option<u16>,
}

#[tauri::command]
pub fn register_project_channel(
    params: RegisterProjectChannelParams,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    output_store.register_project_channel(
        &params.label,
        &params.project_path,
        params.framework.as_deref(),
        params.port,
    );
    Ok(())
}

#[tauri::command]
pub fn unregister_project_channel(
    label: String,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    output_store.unregister_project_channel(&label);
    Ok(())
}

#[tauri::command]
pub fn push_project_log(
    label: String,
    level: String,
    message: String,
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<(), String> {
    output_store.push_project(&label, &level, &message);
    Ok(())
}

#[tauri::command]
pub fn list_project_channels(
    output_store: State<'_, Arc<OutputStore>>,
) -> Result<serde_json::Value, String> {
    let channels = output_store.list_project_channels();
    Ok(serde_json::to_value(channels).unwrap_or_default())
}
```

Also update `get_output_logs` to try project channels when system channel lookup fails:

```rust
// In get_output_logs, replace the channel match:
Some(ch_str) => {
    // Try system channel first
    if let Some(channel) = Channel::from_str(ch_str) {
        let (entries, total) = output_store.query(
            channel,
            params.level.as_deref(),
            params.last,
            params.search.as_deref(),
        );
        Ok(serde_json::json!({
            "channel": ch_str,
            "entries": entries,
            "total": total,
            "returned": entries.len(),
        }))
    } else {
        // Try project channel
        let (entries, total) = output_store.query_project(
            ch_str,
            params.level.as_deref(),
            params.last,
            params.search.as_deref(),
        );
        if total > 0 || output_store.list_project_channels().iter().any(|c| c.label == ch_str) {
            Ok(serde_json::json!({
                "channel": ch_str,
                "entries": entries,
                "total": total,
                "returned": entries.len(),
                "type": "project",
            }))
        } else {
            Err(format!("Unknown channel: {}", ch_str))
        }
    }
}
```

And update the summary mode (None branch) to include project channels:

```rust
None => {
    let system_summaries = output_store.summary();
    let project_summaries = output_store.project_summary();
    Ok(serde_json::json!({
        "channels": system_summaries,
        "projectChannels": project_summaries,
    }))
}
```

**Step 2: Register commands in lib.rs**

Add to the `.invoke_handler(tauri::generate_handler![...])` chain:

```rust
register_project_channel,
unregister_project_channel,
push_project_log,
list_project_channels,
```

**Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add src-tauri/src/commands/output.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for project output channel management"
```

---

### Task 4: Backend — Browser Console Capture via WebView2 COM

Hook `ConsoleApiCalled` on the Lens preview webview to capture browser console output.

**Files:**
- Modify: `src-tauri/src/commands/lens.rs`

**Step 1: Add console serialization initialization script**

Near the top of `lens.rs` (near the existing `CACHE_SCRIPT` constant), add:

```rust
/// Initialization script injected into preview webviews to improve
/// console output quality. Patches console.* to JSON-serialize objects
/// instead of producing "[object Object]".
const CONSOLE_SERIALIZE_SCRIPT: &str = r#"
(function() {
    ['log','warn','error','info','debug'].forEach(function(method) {
        var orig = console[method];
        console[method] = function() {
            var args = Array.prototype.slice.call(arguments);
            orig.apply(console, args.map(function(a) {
                if (a === null) return 'null';
                if (a === undefined) return 'undefined';
                if (a instanceof Error) return a.stack || a.toString();
                if (typeof a === 'object') {
                    try { return JSON.stringify(a, null, 2); }
                    catch(e) { return String(a); }
                }
                return a;
            }));
        };
    });
})();
"#;
```

**Step 2: Add ConsoleApiCalled hook in `create_tab_webview()`**

After the webview is successfully created (after the `Ok(_webview)` block at line 276), add the console hook. This runs on a blocking thread since it needs COM access:

```rust
// After successful webview creation, set up console capture
let app_for_console = app.clone();
let label_for_console = create_result.clone();
tokio::task::spawn_blocking(move || {
    // Small delay to ensure WebView2 is fully initialized
    std::thread::sleep(std::time::Duration::from_millis(200));

    if let Some(webview) = app_for_console.get_webview(&label_for_console) {
        #[cfg(windows)]
        {
            let output_store: Option<Arc<OutputStore>> = app_for_console
                .try_state::<Arc<OutputStore>>()
                .map(|s| s.inner().clone());

            if let Some(store) = output_store {
                let _ = webview.with_webview(move |platform_wv| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        ICoreWebView2,
                        ICoreWebView2ConsoleMessageReceivedEventArgs,
                        COREWEBVIEW2_CONSOLE_MESSAGE_LEVEL,
                        COREWEBVIEW2_CONSOLE_MESSAGE_LEVEL_LOG,
                        COREWEBVIEW2_CONSOLE_MESSAGE_LEVEL_WARNING,
                        COREWEBVIEW2_CONSOLE_MESSAGE_LEVEL_ERROR,
                        COREWEBVIEW2_CONSOLE_MESSAGE_LEVEL_INFO,
                        COREWEBVIEW2_CONSOLE_MESSAGE_LEVEL_DEBUG,
                    };
                    use windows_core::HSTRING;

                    unsafe {
                        let controller = platform_wv.controller();
                        let core_wv: ICoreWebView2 = controller.CoreWebView2().unwrap();

                        // Note: The exact handler type depends on webview2-com version.
                        // Use add_ConsoleApiCalled or DevTools protocol as fallback.
                        // Implementation will use CallDevToolsProtocolMethod to subscribe
                        // to Runtime.consoleAPICalled if the direct COM event is not
                        // available in webview2-com 0.38.
                    }
                });
            }
        }
    }
});
```

> **IMPORTANT NOTE FOR IMPLEMENTER:** The `webview2-com` 0.38 crate may not expose `add_ConsoleApiCalled` directly. Check the available API. If not available, use the **CDP (Chrome DevTools Protocol) fallback approach** which is already proven in this codebase:
>
> 1. Call `CallDevToolsProtocolMethod("Runtime.enable", "{}")` to enable runtime domain
> 2. Call `add_DevToolsProtocolEventReceived("Runtime.consoleAPICalled", handler)` to subscribe
> 3. Parse the CDP event args for `type` (log/warning/error/info/debug) and `args` array
>
> This is the same pattern already used for `Accessibility.getFullAXTree` and `Emulation.setDeviceMetricsOverride` in this codebase. Reference: `src-tauri/src/commands/lens.rs` lines 994-1054.

**Step 3: Also inject the serialization script**

Add `.initialization_script(CONSOLE_SERIALIZE_SCRIPT)` to the `WebviewBuilder` chain (after line 255, alongside the existing init scripts):

```rust
let builder =
    WebviewBuilder::new(&label_clone, tauri::WebviewUrl::External(parsed_url))
        .initialization_script(&shortcut_script)
        .initialization_script(CACHE_SCRIPT)
        .initialization_script(CONSOLE_SERIALIZE_SCRIPT)  // NEW
        .on_page_load(move |webview, payload| {
```

**Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation.

**Step 5: Commit**

```bash
git add src-tauri/src/commands/lens.rs
git commit -m "feat: capture browser console output via WebView2 CDP events"
```

---

### Task 5: Backend — Terminal Output Mirroring

Mirror dev server terminal PTY output to project output channels.

**Files:**
- Modify: `src-tauri/src/terminal/mod.rs`
- Modify: `src-tauri/src/commands/terminal.rs`

**Step 1: Add `output_channel` to terminal spawn**

In `terminal/mod.rs`, modify the `spawn` method to accept an optional output channel parameter. In the reader thread (line 384), when `output_channel` is set, mirror each stdout chunk to the output store.

Add a field to `TerminalSession`:

```rust
struct TerminalSession {
    // ... existing fields
    output_channel: Option<String>,
}
```

Modify `spawn()` signature:

```rust
pub fn spawn(
    &mut self,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    profile_id: Option<String>,
    output_channel: Option<String>,      // NEW
    output_store: Option<Arc<OutputStore>>, // NEW
) -> Result<(String, Option<String>), String>
```

In the reader thread (around line 393), add mirroring:

```rust
Ok(n) => {
    let text = String::from_utf8_lossy(&buf[..n]).to_string();

    // Mirror to project output channel if configured
    if let (Some(ref channel), Some(ref store)) = (&output_channel_clone, &output_store_clone) {
        // Split by newlines and push each line
        for line in text.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let level = classify_terminal_line(trimmed);
                store.push_project(channel, level, trimmed);
            }
        }
    }

    let _ = event_tx.send(TerminalEvent {
        id: session_id.clone(),
        event_type: "stdout".to_string(),
        text: Some(text),
        code: None,
    });
}
```

Add a helper function for level classification:

```rust
/// Classify a terminal output line into a log level based on content heuristics.
fn classify_terminal_line(line: &str) -> &'static str {
    let lower = line.to_ascii_lowercase();
    if lower.contains("error") || lower.contains("failed") || lower.starts_with("✘") {
        "ERROR"
    } else if lower.contains("warn") || lower.contains("deprecat") {
        "WARN"
    } else {
        "INFO"
    }
}
```

**Step 2: Update `terminal_spawn` command to accept `output_channel`**

In `commands/terminal.rs`:

```rust
#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, TerminalManagerState>,
    output_state: State<'_, Arc<OutputStore>>,  // NEW
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    profile_id: Option<String>,
    output_channel: Option<String>,  // NEW
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    let store = if output_channel.is_some() {
        Some(output_state.inner().clone())
    } else {
        None
    };

    match manager.spawn(cols, rows, cwd, profile_id, output_channel, store) {
        Ok((id, profile_name)) => IpcResponse::ok(json!({ "id": id, "profileName": profile_name })),
        Err(e) => IpcResponse::err(e),
    }
}
```

**Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add src-tauri/src/terminal/mod.rs src-tauri/src/commands/terminal.rs
git commit -m "feat: mirror dev server terminal output to project channels"
```

---

### Task 6: Frontend — API Wrappers and Output Store

Add API wrappers for the new commands and extend the output store to handle project channels.

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src/lib/stores/output.svelte.js`
- Test: `test/api/api-signatures.test.cjs`
- Test: `test/stores/output-project-channels.test.cjs` (new)

**Step 1: Write the failing tests**

In `test/api/api-signatures.test.cjs`, add to the `criticalCommands` array:

```javascript
'register_project_channel',
'unregister_project_channel',
'push_project_log',
'list_project_channels',
```

Add to the `expectedExports` array:

```javascript
'registerProjectChannel',
'unregisterProjectChannel',
'pushProjectLog',
'listProjectChannels',
```

Update the expected function count.

Create `test/stores/output-project-channels.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, '../../src/lib/stores/output.svelte.js');
const src = fs.readFileSync(STORE_PATH, 'utf-8');

describe('output.svelte.js -- project channels', () => {
  it('listens for project-output-log event', () => {
    assert.ok(src.includes("'project-output-log'"), 'Should listen for project-output-log event');
  });

  it('exports registerProjectChannel method', () => {
    assert.ok(src.includes('registerProjectChannel'), 'Should export registerProjectChannel');
  });

  it('exports unregisterProjectChannel method', () => {
    assert.ok(src.includes('unregisterProjectChannel'), 'Should export unregisterProjectChannel');
  });

  it('exports projectChannels getter', () => {
    assert.ok(src.includes('projectChannels'), 'Should have projectChannels state');
  });

  it('has SYSTEM_CHANNELS constant', () => {
    assert.ok(
      src.includes('SYSTEM_CHANNELS') || src.includes('systemChannels'),
      'Should distinguish system from project channels'
    );
  });

  it('has channel separator concept', () => {
    assert.ok(
      src.includes('allChannels') || src.includes('get channels'),
      'Should combine system and project channels'
    );
  });

  it('handles switchChannel for project channels', () => {
    assert.ok(
      src.includes('projectChannels') || src.includes('project_channels'),
      'Should track project channel entries'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: New tests FAIL.

**Step 3: Add API wrappers to `api.js`**

In the Git section (or a new "Project Output" section) of `api.js`:

```javascript
// ============ Project Output Channels ============

export async function registerProjectChannel(label, projectPath, framework, port) {
  return invoke('register_project_channel', { label, projectPath, framework: framework || null, port: port || null });
}

export async function unregisterProjectChannel(label) {
  return invoke('unregister_project_channel', { label });
}

export async function pushProjectLog(label, level, message) {
  return invoke('push_project_log', { label, level, message });
}

export async function listProjectChannels() {
  return invoke('list_project_channels');
}
```

**Step 4: Update `output.svelte.js` to handle project channels**

Replace the store contents. Key changes:
- Rename `CHANNELS` to `SYSTEM_CHANNELS`
- Add `projectChannels` reactive map
- Listen for `project-output-log` event
- `switchChannel` works for both system and project channels
- Export `registerProjectChannel`, `unregisterProjectChannel`

Add to the store:

```javascript
import { registerProjectChannel as apiRegister, unregisterProjectChannel as apiUnregister, listProjectChannels as apiList } from '../api.js';

const SYSTEM_CHANNELS = ['app', 'cli', 'voice', 'mcp', 'browser', 'frontend'];
// ... keep existing CHANNEL_LABELS

let projectChannelEntries = $state({});
let projectChannelList = $state([]);

// In startListening(), add:
await listen('project-output-log', (event) => {
  const { channel, entry } = event.payload;
  if (!channel || !entry) return;

  if (!projectChannelEntries[channel]) {
    projectChannelEntries[channel] = [];
  }
  const arr = projectChannelEntries[channel];
  arr.push(entry);
  if (arr.length > MAX_ENTRIES) {
    projectChannelEntries[channel] = arr.slice(arr.length - MAX_ENTRIES);
  } else {
    projectChannelEntries[channel] = [...arr];
  }
});

// New methods
async function registerProjectChannel(label, projectPath, framework, port) {
  await apiRegister(label, projectPath, framework, port);
  projectChannelEntries[label] = [];
  projectChannelList = [...projectChannelList, { label, projectPath, framework, port }];
}

async function unregisterProjectChannel(label) {
  await apiUnregister(label);
  delete projectChannelEntries[label];
  projectChannelList = projectChannelList.filter(c => c.label !== label);
}
```

Update `switchChannel` to accept project channels:

```javascript
function switchChannel(ch) {
  if (SYSTEM_CHANNELS.includes(ch) || projectChannelEntries[ch] !== undefined) {
    activeChannel = ch;
  }
}
```

Update `getFilteredEntries` to check project channels:

```javascript
function getFilteredEntries() {
  const channelEntries = entries[activeChannel] || projectChannelEntries[activeChannel] || [];
  // ... rest unchanged
}
```

Export new methods and state from the store.

**Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/lib/api.js src/lib/stores/output.svelte.js test/
git commit -m "feat: frontend API wrappers and output store for project channels"
```

---

### Task 7: Frontend — Dev Server Manager Integration

Wire the dev server manager to register project channels and pass `output_channel` when spawning terminals.

**Files:**
- Modify: `src/lib/stores/dev-server-manager.svelte.js`
- Test: `test/stores/dev-server-manager-output.test.cjs` (new)

**Step 1: Write failing tests**

Create `test/stores/dev-server-manager-output.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/dev-server-manager.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('dev-server-manager -- project output channel wiring', () => {
  it('imports registerProjectChannel from output store', () => {
    assert.ok(
      src.includes('registerProjectChannel') || src.includes('outputStore'),
      'Should import output store integration'
    );
  });

  it('builds channel label from project folder name, framework and port', () => {
    assert.ok(src.includes('channelLabel') || src.includes('outputChannel'), 'Should build channel label');
  });

  it('registers project channel when starting server', () => {
    assert.ok(
      src.includes('registerProjectChannel') || src.includes('register_project_channel'),
      'Should register project channel on server start'
    );
  });

  it('passes outputChannel to terminalSpawn', () => {
    assert.ok(
      src.includes('outputChannel') || src.includes('output_channel'),
      'Should pass outputChannel to terminal spawn'
    );
  });

  it('unregisters project channel when stopping server', () => {
    assert.ok(
      src.includes('unregisterProjectChannel') || src.includes('unregister_project_channel'),
      'Should unregister project channel on server stop'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL

**Step 3: Implement integration**

In `dev-server-manager.svelte.js`, import the output store:

```javascript
import { outputStore } from './output.svelte.js';
```

In `startServer()`, after spawning the terminal:

```javascript
// Build output channel label
const folderName = projectPath.split(/[/\\]/).filter(Boolean).pop() || 'project';
const channelLabel = server.framework
  ? `${folderName} (${server.framework} :${server.port})`
  : `${folderName} (:${server.port})`;

// Register project output channel
await outputStore.registerProjectChannel(channelLabel, projectPath, server.framework, server.port);
updateState(projectPath, { outputChannel: channelLabel });

// Spawn PTY with output mirroring
const result = await terminalSpawn({ cwd: projectPath, outputChannel: channelLabel });
```

In `stopServer()`:

```javascript
// Unregister project output channel
if (state.outputChannel) {
  await outputStore.unregisterProjectChannel(state.outputChannel);
}
updateState(projectPath, { outputChannel: null });
```

Add `outputChannel: null` to the initial `ServerState` in `getOrCreateState()`.

**Step 4: Update `terminalSpawn` API wrapper**

In `api.js`, update `terminalSpawn` to pass `outputChannel`:

```javascript
export async function terminalSpawn(opts = {}) {
  return invoke('terminal_spawn', {
    cols: opts.cols || null,
    rows: opts.rows || null,
    cwd: opts.cwd || null,
    profileId: opts.profileId || null,
    outputChannel: opts.outputChannel || null,
  });
}
```

**Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All PASS.

**Step 6: Commit**

```bash
git add src/lib/stores/dev-server-manager.svelte.js src/lib/api.js test/
git commit -m "feat: wire dev server manager to register project output channels"
```

---

### Task 8: Frontend — Output Panel UI (Dropdown Separator + Error Badge)

Add the visual separator in the Output panel dropdown and project channel support.

**Files:**
- Identify the dropdown component (likely in `TerminalTabs.svelte` or `OutputPanel.svelte`)
- Test: `test/components/output-panel-project.test.cjs` (new)

**Step 1: Write failing tests**

Create `test/components/output-panel-project.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Read both files that may contain the dropdown
const files = [
  'src/components/terminal/TerminalTabs.svelte',
  'src/components/lens/OutputPanel.svelte',
].map(f => {
  const p = path.join(__dirname, '../..', f);
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
});
const allSrc = files.join('\n');

describe('Output panel -- project channel dropdown', () => {
  it('has a separator between project and system channels', () => {
    assert.ok(
      allSrc.includes('channel-separator') || allSrc.includes('channel-divider'),
      'Should have a visual separator element'
    );
  });

  it('renders project channels from outputStore', () => {
    assert.ok(
      allSrc.includes('projectChannels') || allSrc.includes('projectChannelList'),
      'Should reference project channels from the store'
    );
  });

  it('renders project channels above system channels', () => {
    // Project channels should come first in the iteration
    assert.ok(
      allSrc.includes('projectChannel') || allSrc.includes('project-channel'),
      'Should render project channels'
    );
  });
});
```

**Step 2: Implement dropdown separator**

Find the channel selector dropdown (in whichever component renders it). Add:
- A loop over `outputStore.projectChannelList` rendering project channels first
- A `<div class="channel-divider">` separator
- Then the existing system channels

Style the divider:

```css
.channel-divider {
  height: 1px;
  background: var(--muted);
  margin: 4px 8px;
  opacity: 0.3;
}
```

**Step 3: Add error badge**

When a project channel has unread errors, show a red dot on the Output tab. Add a derived value in the output store:

```javascript
get hasProjectErrors() {
  for (const [label, entries] of Object.entries(projectChannelEntries)) {
    if (entries.some(e => e.level === 'ERROR')) return true;
  }
  return false;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/components/ src/lib/stores/output.svelte.js test/
git commit -m "feat: output panel dropdown with project channel separator and error badge"
```

---

### Task 9: MCP — Extend get_logs for Project Channels

Update the MCP file fallback to discover and read project channel JSONL files.

**Files:**
- Modify: `src-tauri/src/mcp/handlers/core.rs`
- Modify: `src-tauri/src/mcp/tools.rs` (update tool description)

**Step 1: Update `handle_get_logs_via_files()` in `core.rs`**

```rust
fn handle_get_logs_via_files(args: &Value) -> McpToolResult {
    use crate::services::output::{Channel, LogFileWriter};
    use crate::services::platform;

    let logs_dir = platform::get_log_dir().join("current");
    if !logs_dir.exists() {
        return McpToolResult::error("Log directory not found. Is the Voice Mirror app running?");
    }

    let channel = args.get("channel").and_then(|v| v.as_str());
    let level = args.get("level").and_then(|v| v.as_str());
    let last = args.get("last").and_then(|v| v.as_u64()).map(|n| n as usize);
    let search = args.get("search").and_then(|v| v.as_str());

    match channel {
        Some(ch_str) => {
            // Try system channel first
            if let Some(ch) = Channel::from_str(ch_str) {
                // ... existing system channel logic unchanged ...
            } else {
                // Try project channel
                let (entries, total) = LogFileWriter::read_project_channel(
                    &logs_dir, ch_str, level, last.or(Some(100)), search,
                );
                if total > 0 {
                    let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
                    let count = lines.len();
                    let mut result = lines.join("\n");
                    result.push_str(&format!(
                        "\n\n--- {} entries (filtered from {} total, project channel via file fallback) ---",
                        count, total
                    ));
                    McpToolResult::text(result)
                } else {
                    // List available channels to help the user
                    let project_channels = LogFileWriter::list_project_channels(&logs_dir);
                    let available = if project_channels.is_empty() {
                        "No project channels found.".to_string()
                    } else {
                        format!("Available project channels: {}", project_channels.join(", "))
                    };
                    McpToolResult::error(format!(
                        "Unknown channel: {}. System: app, cli, voice, mcp, browser, frontend. {}",
                        ch_str, available
                    ))
                }
            }
        }
        None => {
            // Summary mode — include project channels
            let summaries = LogFileWriter::read_summary(&logs_dir);
            let project_channels = LogFileWriter::list_project_channels(&logs_dir);

            let mut text = String::from("System Output Channels (via file fallback):\n");
            for s in &summaries {
                text.push_str(&format!(
                    "  {:<8} {:>4} entries ({} error, {} warn, {} info)\n",
                    format!("{}:", s.channel), s.total, s.error, s.warn, s.info
                ));
            }

            if !project_channels.is_empty() {
                text.push_str("\nProject Channels:\n");
                for ch_name in &project_channels {
                    let (_, total) = LogFileWriter::read_project_channel(&logs_dir, ch_name, None, None, None);
                    text.push_str(&format!("  {} ({} entries)\n", ch_name, total));
                }
            }

            McpToolResult::text(text)
        }
    }
}
```

**Step 2: Update tool description in `tools.rs`**

Find the `get_logs` tool definition (line 529) and update the description to mention project channels:

```rust
"Query Voice Mirror's structured output logs. Without a channel, returns a summary of all channels (system + project) with entry counts. With a channel name, returns actual log lines. System channels: app, cli, voice, mcp, browser, frontend. Project channels are dynamic — created when dev servers start — and contain build logs + browser console output for the project being developed."
```

**Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add src-tauri/src/mcp/handlers/core.rs src-tauri/src/mcp/tools.rs
git commit -m "feat: extend MCP get_logs to discover and query project channels"
```

---

### Task 10: Tests — Full Integration Tests + npm test

Write comprehensive JS tests and verify everything passes.

**Files:**
- Test: `test/api/api-signatures.test.cjs` (update counts)
- Test: `test/stores/output-project-channels.test.cjs` (verify)
- Test: `test/stores/dev-server-manager-output.test.cjs` (verify)
- Test: `test/components/output-panel-project.test.cjs` (verify)

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS, no regressions in existing 5869+ tests.

**Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test --lib`
Expected: All tests PASS including the new project channel tests.

**Step 3: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: Clean.

**Step 4: Commit any test fixes**

```bash
git add test/
git commit -m "test: comprehensive tests for project output channels"
```

---

### Task 11: Docs — Update IDE-GAPS.md

Update the IDE gaps tracker to reflect the new capability.

**Files:**
- Modify: `docs/source-of-truth/IDE-GAPS.md`

**Step 1: Add entry for project output channels**

Add "Project Output Channels (Build + Runtime Logs)" to the completed features table with today's date. Note that this gives Claude full debugging visibility: code + screenshots + build logs + runtime logs.

**Step 2: Commit**

```bash
git add docs/source-of-truth/IDE-GAPS.md
git commit -m "docs: mark project output channels as implemented in IDE-GAPS"
```

---

## Dependency Graph

```
Task 1 (OutputStore registry) ← Task 2 (JSONL persistence) ← Task 9 (MCP extension)
Task 1 ← Task 3 (Tauri commands)
Task 1 ← Task 5 (Terminal mirroring)
Task 3 ← Task 6 (Frontend API + store)
Task 5 ← Task 6
Task 6 ← Task 7 (Dev server manager wiring)
Task 6 ← Task 8 (Output panel UI)
All ← Task 10 (Integration tests)
Task 10 ← Task 11 (Docs)
```

**Parallelizable pairs:**
- Task 2 + Task 3 (JSONL + Tauri commands — both depend on Task 1 only)
- Task 4 + Task 5 (Browser console + terminal mirroring — independent Rust work)
- Task 8 + Task 9 (UI + MCP — both depend on Task 6 but don't touch same files)
