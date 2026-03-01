# Bug Fix: Pipe Path Missing Project Channel Support in get_logs

## Problem

The MCP `get_logs` tool has two code paths:
1. **Named pipe** (in-app Claude) — handled by `src-tauri/src/ipc/pipe_server.rs` lines 297-342
2. **File fallback** (terminal Claude) — handled by `src-tauri/src/mcp/handlers/core.rs` lines 973-1074

The file fallback path correctly supports project channels (listing them in summary, querying by name). But the **pipe path does NOT** — it only handles system channels.

## Evidence

- Project channel JSONL file exists at `%APPDATA%/voice-mirror/logs/current/project-contextmirror.com-(astro--4321).jsonl` with 30 entries
- MCP `get_logs` (no channel) only shows 6 system channels — no project channels listed
- MCP `get_logs` with `channel=project-contextmirror.com-(astro--4321)` returns: `"Unknown channel: ... Available: app, cli, voice, mcp, browser"`
- The `OutputStore` already has `project_summary()` and `query_project()` methods — they're just not called from the pipe handler

## Fix: `src-tauri/src/ipc/pipe_server.rs`

### Change 1: Add project channels to summary (line 321-331)

**Current code (lines 321-331):**
```rust
None => {
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
```

**Replace with:**
```rust
None => {
    let summaries = store.summary();
    let mut text = String::from("Output Channels:\n");
    for s in &summaries {
        text.push_str(&format!(
            "  {:<10} {:>4} entries ({} error, {} warn, {} info)\n",
            format!("{}:", s.channel),
            s.total, s.error, s.warn, s.info
        ));
    }

    let project_summaries = store.project_summary();
    if !project_summaries.is_empty() {
        text.push_str("\nProject Channels:\n");
        for ps in &project_summaries {
            text.push_str(&format!(
                "  {} ({} entries, {} error, {} warn)\n",
                ps.label, ps.total, ps.error, ps.warn
            ));
        }
    }
    text
}
```

### Change 2: Fall through to project channels when system channel not found (lines 304-319)

**Current code (lines 304-319):**
```rust
Some(ch_str) => {
    if let Some(ch) = crate::services::output::Channel::from_str(ch_str) {
        let (entries, total) = store.query(
            ch,
            level.as_deref(),
            last.or(Some(100)),
            search.as_deref(),
        );
        let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
        let count = lines.len();
        let mut result = lines.join("\n");
        result.push_str(&format!("\n\n--- {} entries (filtered from {} total) ---", count, total));
        result
    } else {
        format!("Unknown channel: {}. Available: app, cli, voice, mcp, browser", ch_str)
    }
}
```

**Replace with:**
```rust
Some(ch_str) => {
    if let Some(ch) = crate::services::output::Channel::from_str(ch_str) {
        let (entries, total) = store.query(
            ch,
            level.as_deref(),
            last.or(Some(100)),
            search.as_deref(),
        );
        let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
        let count = lines.len();
        let mut result = lines.join("\n");
        result.push_str(&format!("\n\n--- {} entries (filtered from {} total) ---", count, total));
        result
    } else {
        // Try project channel
        let (entries, total) = store.query_project(
            ch_str,
            level.as_deref(),
            last.or(Some(100)),
            search.as_deref(),
        );
        if total > 0 {
            let lines: Vec<String> = entries.iter().map(|e| e.format_line()).collect();
            let count = lines.len();
            let mut result = lines.join("\n");
            result.push_str(&format!(
                "\n\n--- {} entries (filtered from {} total, project channel) ---",
                count, total
            ));
            result
        } else {
            let project_labels: Vec<String> = store.project_summary()
                .iter()
                .map(|ps| ps.label.clone())
                .collect();
            let available = if project_labels.is_empty() {
                String::new()
            } else {
                format!(" Project: {}", project_labels.join(", "))
            };
            format!(
                "Unknown channel: {}. System: app, cli, voice, mcp, browser, frontend.{}",
                ch_str, available
            )
        }
    }
}
```

## Verify OutputStore Methods Exist

The fix uses these methods on `OutputStore` (in `src-tauri/src/services/output.rs`):
- `project_summary()` — line 508 — returns `Vec<ProjectChannelSummary>` with fields: `label`, `total`, `error`, `warn`
- `query_project()` — line 455 — returns `(Vec<LogEntry>, usize)` — same signature as `query()` but for project channels

Both already exist and are tested. They just aren't called from the pipe handler.

## Testing

After applying the fix:
1. `cargo build --bin voice-mirror-mcp` (rebuild MCP binary)
2. `npm run dev` to restart with new binary
3. Start a dev server from Lens workspace
4. `get_logs` with no channel should now show "Project Channels:" section
5. `get_logs` with `channel=<project-label>` should return project logs

The project channel label format is: `{folderName} ({framework} :{port})` — e.g., `contextmirror.com (Astro :4321)`.
Note: The JSONL filename is sanitized (lowercase, spaces→dashes) but `query_project()` uses the original label, not the filename.

## Also: Warn/Error Classification

The JSONL entries all have `"channel":"app"` and most are `"level":"INFO"` even for warnings and errors. The `classify_terminal_line()` function in `services/output.rs` handles this during PTY mirroring, but the entries in the JSONL still show the original app-level classification. This is a separate issue — the Output panel UI likely classifies correctly based on content patterns, but the JSONL metadata could be improved in a future pass.
