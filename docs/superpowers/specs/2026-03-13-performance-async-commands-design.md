# Performance: Async Commands & Terminal Output Batching

## Problem

Voice Mirror becomes unresponsive during three scenarios:

1. **Startup** — synchronous CLI tool detection spawns 4+ `where`/`--version` commands, blocking a tokio worker thread for 3-10s. The frontend `await invoke()` stalls, preventing reactive updates.
2. **Project switching** — synchronous TCP port probing (400ms timeout x 2 x N ports) blocks a tokio worker thread for 2-4s, starving other commands.
3. **Builds running in terminal** — every 4KB PTY chunk fires an individual Tauri event with no batching, saturating the WebView2 IPC bridge at 100+ events/sec. Project channel logging also does sync RwLock + file I/O per line on the reader thread, blocking PTY reads.

**Threading model note:** Tauri 2 runs synchronous `#[tauri::command]` functions on tokio worker threads, not the UI thread. The freezes are caused by command starvation — when blocking work occupies worker threads, other `invoke()` calls queue behind them. The frontend appears frozen because it's `await`-ing responses that can't be dispatched. The terminal output flooding is the most direct cause of UI sluggishness since it saturates the IPC bridge between Rust and WebView2.

Additionally, all 20 git command functions (containing 24 `std::process::Command` calls) use synchronous `.output()`. While not currently painful on small repos, any large repo or network operation (push/pull/fetch) would stall the tokio runtime for seconds.

## Scope

Five changes across 5 Rust files. No frontend changes required — the frontend already calls these via async `invoke()` and handles variable-size terminal chunks.

## Design

### 1. Terminal Output Batching

**Current state:** `terminal/mod.rs:410-443` — reader thread reads 4KB chunks, immediately sends each as a `TerminalEvent` via `mpsc::unbounded_channel()`. The forwarding loop in `lib.rs:632-639` emits each event to the frontend individually, one per channel receive.

Project channel logging (`terminal/mod.rs:422-436`) runs on the reader thread: ANSI stripping, level classification, RwLock acquisition, file I/O, and Tauri event emission — all synchronous, per line.

**Changes:**

- **Reader thread:** Remove project channel logging from the reader thread. Only send raw text via the channel. Include output channel label and store handle in the `TerminalEvent` struct so the forwarding loop can perform logging.
- **Forwarding loop (`lib.rs`):** Rewrite to use `tokio::select!` with a drain-after-first-chunk pattern:
  1. Await first event from channel (no latency for sparse output — interactive typing stays instant)
  2. After receiving the first event, drain additional ready events for up to 5ms
  3. Group accumulated events by session ID (`HashMap<String, Vec<String>>`)
  4. Emit one batched event per session
  5. Perform project channel logging on the batched text (still splitting by lines for per-line classification)
- **Why drain-after-first:** A fixed `interval(50ms)` would add up to 50ms latency on the first chunk after idle, making interactive terminal use feel sluggish. The drain-after-first approach gives zero latency for sparse output and batches dense output.
- **Batching constant:** `BATCH_DRAIN_MS = 5` — configurable constant so batching can be tuned or disabled (set to 0 for pass-through mode).

### 2. Bounded Terminal Channel

**Current state:** `terminal/mod.rs:132` — `mpsc::unbounded_channel()` with no size limit.

**Changes:**

- Replace with `mpsc::channel(2048)` (bounded).
- Reader thread uses `try_send()` — if channel is full, log a warning with session ID and byte count, then drop the event.
- 2048 capacity at ~4KB per event = ~8MB worst case, which is acceptable. A smaller bound (256) risks dropping chunks mid-ANSI-sequence, which corrupts terminal display state (cursor positions, colors, alternate screen). 2048 provides ample headroom while still preventing OOM.

### 3. Async Dev Server Detection

**Current state:** `commands/dev_server.rs:17` — synchronous `#[tauri::command]` calls `dev_server::detect_dev_servers()` which probes ports via `is_port_listening()` (200ms TCP timeout x 2 per port). Also `probe_port` (line 44) and `kill_port_process` (line 57) in the same file are synchronous.

**Changes:**

- Change all three commands (`detect_dev_servers`, `probe_port`, `kill_port_process`) to `async` and wrap in `tokio::task::spawn_blocking()`.
- No changes to the service layer — the blocking work just moves off tokio worker threads.

```rust
#[tauri::command]
pub async fn detect_dev_servers(project_root: String) -> IpcResponse {
    tokio::task::spawn_blocking(move || {
        let servers = dev_server::detect_dev_servers(&project_root);
        let pkg_manager = dev_server::detect_package_manager(&project_root);
        // ... logging + IpcResponse::ok(...)
    }).await.unwrap_or_else(|e| IpcResponse::err(format!("Detection failed: {}", e)))
}
```

### 4. Async CLI Tool Detection

**Current state:** `commands/tools.rs:187-198` — `scan_cli_tools()` iterates tool names, calling `detect_tool()` which spawns synchronous `where`/`--version` commands. `check_npm_versions()` (line 237) does the same plus npm registry lookups.

**Changes:**

- Wrap all three commands (`scan_cli_tools`, `check_npm_versions`, `update_npm_package`) in `spawn_blocking()`, same pattern as #3.

### 5. Async Git Commands

**Current state:** `commands/files/git.rs` — 20 synchronous command functions containing 24 `std::process::Command::new("git").output()` calls. Some functions (e.g., `get_git_changes`, `git_commit`, `git_list_branches`) run 2-3 sequential git subprocesses.

**Changes:**

- Create a helper function that wraps `std::process::Command` execution in `spawn_blocking()`:

```rust
async fn run_git(args: &[&str], cwd: &str) -> Result<std::process::Output, String> {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let cwd = cwd.to_string();
    tokio::task::spawn_blocking(move || {
        std::process::Command::new("git")
            .args(&args)
            .current_dir(&cwd)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
```

- Convert each git command function to `async`, replace direct `Command::output()` calls with `run_git()`.
- Functions that run multiple sequential git commands (e.g., `git_commit` runs `git commit` then `git rev-parse`) keep the sequential `.await` pattern — each subprocess still runs in `spawn_blocking`.
- Return type stays `IpcResponse` — Tauri handles async commands transparently.

## What's NOT in scope

- Frontend changes (none needed)
- Output store RwLock partitioning (moderate issue, not user-felt)
- DevicePreview ResizeObserver optimization (medium, not user-felt)
- Chat array cloning optimization (medium, not user-felt)
- File watcher gitignore optimization (medium, not user-felt)

These can be addressed in a future pass if needed.

## Testing

- `cargo check --tests --lib` for compilation verification (cargo test --lib crashes on Windows due to WebView2 DLL)
- `npm test` for frontend tests (should be unaffected since no frontend changes)
- Manual testing: startup time, project switch responsiveness, browser input during `npm install`
- Existing git command tests call synchronous functions directly — they will need updating to use `tokio::test` since the functions become async

## Risk

Low. The `spawn_blocking` pattern is already established in the codebase (WebView2 creation in `lens.rs:753`). The terminal batching is the most complex change; the `BATCH_DRAIN_MS` constant provides an escape hatch if tuning is needed.
