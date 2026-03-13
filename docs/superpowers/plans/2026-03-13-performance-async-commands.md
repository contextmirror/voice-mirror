# Performance: Async Commands & Terminal Output Batching — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI freezes by moving blocking operations off tokio worker threads and batching terminal output events.

**Architecture:** Five independent changes: (1) batch terminal output events in the forwarding loop with session-ID grouping, (2) bound the terminal event channel to prevent OOM, (3-5) wrap synchronous commands in `spawn_blocking()` for dev server detection, CLI tool scanning, and git operations.

**Tech Stack:** Rust, Tauri 2, tokio (`spawn_blocking`, `mpsc::channel`, `tokio::select!`, `tokio::time`)

**Spec:** `docs/superpowers/specs/2026-03-13-performance-async-commands-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src-tauri/src/terminal/mod.rs` | Modify | Remove project channel logging from reader thread; switch to bounded channel |
| `src-tauri/src/lib.rs` | Modify | Rewrite forwarding loop with batching + project channel logging |
| `src-tauri/src/commands/dev_server.rs` | Modify | Wrap all 3 commands in `spawn_blocking()` |
| `src-tauri/src/commands/tools.rs` | Modify | Wrap all 3 commands in `spawn_blocking()` |
| `src-tauri/src/commands/files/git.rs` | Modify | Add `run_git()` helper, convert all 20 commands to async |

---

## Chunk 1: Terminal Output Batching + Bounded Channel

### Task 1: Bounded Channel + Remove Project Logging from Reader Thread

**Files:**
- Modify: `src-tauri/src/terminal/mod.rs:132` (channel creation)
- Modify: `src-tauri/src/terminal/mod.rs:143` (take_event_rx return type)
- Modify: `src-tauri/src/terminal/mod.rs:410-443` (reader thread loop)

- [ ] **Step 1: Change unbounded channel to bounded**

In `src-tauri/src/terminal/mod.rs`, change line 132 from:
```rust
let (tx, rx) = mpsc::unbounded_channel();
```
to:
```rust
let (tx, rx) = mpsc::channel(2048);
```

Update the struct fields and types. The `event_tx` field type changes from `mpsc::UnboundedSender<TerminalEvent>` to `mpsc::Sender<TerminalEvent>`, and `event_rx` changes from `Option<mpsc::UnboundedReceiver<TerminalEvent>>` to `Option<mpsc::Receiver<TerminalEvent>>`.

Find the struct definition (search for `event_tx: mpsc::Unbounded`) and update both field types. Also update `take_event_rx()` return type at line 143.

- [ ] **Step 2: Change send to try_send in reader thread**

In the reader thread (line 438), change:
```rust
let _ = event_tx.send(TerminalEvent {
```
to:
```rust
if event_tx.try_send(TerminalEvent {
    id: session_id.clone(),
    event_type: "stdout".to_string(),
    text: Some(text),
    code: None,
}).is_err() {
    warn!("Terminal {} channel full, dropping {} bytes", session_id, n);
}
```

Also update the exit event send at line 456 to use `try_send` with the same pattern (but log "exit event" instead of bytes).

- [ ] **Step 3: Remove project channel logging from reader thread**

Remove lines 422-436 (the `if let (Some(ref channel), Some(ref store))` block) from the reader thread entirely. The forwarding loop in `lib.rs` will handle this instead.

Also add the `output_channel` and `output_store` to the `TerminalEvent` struct so the forwarding loop has them available. Add two new fields:

```rust
/// Project output channel label (for forwarding loop to do project logging).
#[serde(skip)]
pub output_channel: Option<String>,
/// Project output store reference (for forwarding loop to do project logging).
#[serde(skip)]
pub output_store: Option<Arc<crate::services::output::OutputStore>>,
```

Set these fields on the stdout event:
```rust
if event_tx.try_send(TerminalEvent {
    id: session_id.clone(),
    event_type: "stdout".to_string(),
    text: Some(text),
    code: None,
    output_channel: output_channel_clone.clone(),
    output_store: output_store_clone.clone(),
}).is_err() {
    warn!("Terminal {} channel full, dropping {} bytes", session_id, n);
}
```

And on the exit event, set both to `None`.

- [ ] **Step 4: Compile check**

Run: `cd src-tauri && cargo check --lib`
Expected: Clean compilation (warnings OK, errors not).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/terminal/mod.rs
git commit -m "perf(terminal): bounded channel + move project logging off reader thread"
```

---

### Task 2: Batched Forwarding Loop

**Files:**
- Modify: `src-tauri/src/lib.rs:617-643` (terminal event forwarding loop)

- [ ] **Step 1: Add imports to lib.rs**

At the top of `lib.rs`, ensure these are available (add if not present):
```rust
use std::collections::HashMap;
```

- [ ] **Step 2: Rewrite the forwarding loop**

Replace the forwarding loop block at lines 632-641:

```rust
// OLD:
tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        let event_name = format!("terminal-output-{}", event.id);
        if app_handle_terminal.emit(&event_name, &event).is_err() {
            warn!("Failed to emit {} event, stopping loop", event_name);
            break;
        }
    }
    info!("Terminal event forwarding loop ended");
});
```

With the new batched version:

```rust
tauri::async_runtime::spawn(async move {
    /// How long to drain after receiving the first event in a batch.
    const BATCH_DRAIN_MS: u64 = 5;

    loop {
        // Wait for the first event (no latency for sparse output)
        let first = match rx.recv().await {
            Some(e) => e,
            None => break, // channel closed
        };

        // Drain additional ready events for up to BATCH_DRAIN_MS
        let mut batch: Vec<terminal::TerminalEvent> = vec![first];
        if BATCH_DRAIN_MS > 0 {
            let deadline = tokio::time::Instant::now()
                + tokio::time::Duration::from_millis(BATCH_DRAIN_MS);
            loop {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match tokio::time::timeout(remaining, rx.recv()).await {
                    Ok(Some(event)) => batch.push(event),
                    _ => break, // timeout or channel closed
                }
            }
        }

        // Group by session ID
        let mut grouped: HashMap<String, (String, Option<String>, Option<std::sync::Arc<crate::services::output::OutputStore>>)> = HashMap::new();
        let mut exit_events: Vec<terminal::TerminalEvent> = Vec::new();

        for event in batch {
            if event.event_type == "exit" {
                exit_events.push(event);
                continue;
            }
            if let Some(text) = &event.text {
                let entry = grouped.entry(event.id.clone()).or_insert_with(|| {
                    (String::new(), event.output_channel.clone(), event.output_store.clone())
                });
                entry.0.push_str(text);
            }
        }

        // Emit batched stdout events (one per session)
        let mut should_break = false;
        for (session_id, (text, output_channel, output_store)) in &grouped {
            // Project channel logging (moved from reader thread)
            if let (Some(channel), Some(store)) = (output_channel, output_store) {
                for line in text.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        let clean = crate::util::strip_ansi_codes(trimmed);
                        let clean = clean.trim();
                        if !clean.is_empty() {
                            let level = terminal::classify_terminal_line(clean);
                            store.push_project(channel, level, clean);
                        }
                    }
                }
            }

            let event_name = format!("terminal-output-{}", session_id);
            let batched_event = terminal::TerminalEvent {
                id: session_id.clone(),
                event_type: "stdout".to_string(),
                text: Some(text.clone()),
                code: None,
                output_channel: None,
                output_store: None,
            };
            if app_handle_terminal.emit(&event_name, &batched_event).is_err() {
                warn!("Failed to emit {} event, stopping loop", event_name);
                should_break = true;
                break;
            }
        }
        if should_break {
            break;
        }

        // Emit exit events individually (they're rare and important)
        for event in exit_events {
            let event_name = format!("terminal-output-{}", event.id);
            if app_handle_terminal.emit(&event_name, &event).is_err() {
                warn!("Failed to emit {} exit event", event_name);
            }
        }
    }
    info!("Terminal event forwarding loop ended");
});
```

- [ ] **Step 3: Make classify_terminal_line public**

In `src-tauri/src/terminal/mod.rs`, find the `fn classify_terminal_line` function and ensure it is `pub(crate)` (or `pub`) so `lib.rs` can call it:

```rust
pub(crate) fn classify_terminal_line(line: &str) -> &'static str {
```

- [ ] **Step 4: Compile check**

Run: `cd src-tauri && cargo check --lib`
Expected: Clean compilation.

- [ ] **Step 5: Run frontend tests**

Run: `npm test`
Expected: All tests pass (no frontend changes).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/terminal/mod.rs src-tauri/src/lib.rs
git commit -m "perf(terminal): batch output events with drain-after-first pattern"
```

---

## Chunk 2: Async Commands (dev_server, tools, git)

### Task 3: Async Dev Server Commands

**Files:**
- Modify: `src-tauri/src/commands/dev_server.rs` (all 3 commands)

- [ ] **Step 1: Convert detect_dev_servers to async**

Replace the function at lines 16-38:

```rust
#[tauri::command]
pub async fn detect_dev_servers(project_root: String) -> IpcResponse {
    tokio::task::spawn_blocking(move || {
        let servers = dev_server::detect_dev_servers(&project_root);
        let pkg_manager = dev_server::detect_package_manager(&project_root);

        tracing::info!(
            "[dev-server] detect_dev_servers root={} found={} pkg_manager={}",
            project_root,
            servers.len(),
            pkg_manager
        );
        for s in &servers {
            tracing::info!(
                "[dev-server]   {} :{} running={} source={}",
                s.framework, s.port, s.running, s.source
            );
        }

        IpcResponse::ok(serde_json::json!({
            "servers": servers,
            "packageManager": pkg_manager,
        }))
    })
    .await
    .unwrap_or_else(|e| IpcResponse::err(format!("Detection failed: {}", e)))
}
```

- [ ] **Step 2: Convert probe_port to async**

Replace lines 43-50:

```rust
#[tauri::command]
pub async fn probe_port(port: u16) -> IpcResponse {
    tokio::task::spawn_blocking(move || {
        let listening = dev_server::is_port_listening(port);
        IpcResponse::ok(serde_json::json!({ "listening": listening }))
    })
    .await
    .unwrap_or_else(|e| IpcResponse::err(format!("Port probe failed: {}", e)))
}
```

- [ ] **Step 3: Convert kill_port_process to async**

Replace lines 56-69:

```rust
#[tauri::command]
pub async fn kill_port_process(port: u16) -> IpcResponse {
    tokio::task::spawn_blocking(move || {
        tracing::info!("[dev-server] kill_port_process port={}", port);
        match dev_server::kill_port_process(port) {
            Ok(()) => IpcResponse::ok(serde_json::json!({ "killed": true })),
            Err(e) => {
                tracing::warn!("[dev-server] kill_port_process failed: {}", e);
                IpcResponse::err(&e)
            }
        }
    })
    .await
    .unwrap_or_else(|e| IpcResponse::err(format!("Kill failed: {}", e)))
}
```

- [ ] **Step 4: Update tests to use tokio::test**

The existing tests call the functions directly. Since they're now async, update:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_detect_dev_servers_empty_dir() {
        let resp = detect_dev_servers("/nonexistent/path".to_string()).await;
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(data["servers"].as_array().unwrap().is_empty());
        assert_eq!(data["packageManager"].as_str().unwrap(), "npm");
    }

    #[tokio::test]
    async fn test_probe_port_closed() {
        let resp = probe_port(1).await;
        assert!(resp.success);
        assert!(!resp.data.unwrap()["listening"].as_bool().unwrap());
    }
}
```

- [ ] **Step 5: Compile check**

Run: `cd src-tauri && cargo check --tests --lib`
Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/dev_server.rs
git commit -m "perf(dev-server): async commands with spawn_blocking"
```

---

### Task 4: Async CLI Tool Commands

**Files:**
- Modify: `src-tauri/src/commands/tools.rs` (3 commands)

- [ ] **Step 1: Convert scan_cli_tools to async**

Replace lines 186-198:

```rust
#[tauri::command]
pub async fn scan_cli_tools() -> IpcResponse {
    tokio::task::spawn_blocking(|| {
        let tools = vec!["claude", "opencode", "ollama", "cargo"];
        let results: Vec<ToolInfo> = tools.into_iter().map(detect_tool).collect();
        IpcResponse::ok(serde_json::json!({ "tools": results }))
    })
    .await
    .unwrap_or_else(|e| IpcResponse::err(format!("Tool scan failed: {}", e)))
}
```

- [ ] **Step 2: Convert check_npm_versions to async**

Replace lines 236-286. Wrap the entire function body in `spawn_blocking`:

```rust
#[tauri::command]
pub async fn check_npm_versions() -> IpcResponse {
    tokio::task::spawn_blocking(|| {
        let system_tools = vec![
            ("claude", "claude"),
            ("opencode", "opencode"),
            ("ollama", "ollama"),
            ("ffmpeg", "ffmpeg"),
        ];

        let mut system = serde_json::Map::new();
        for (tool_name, key) in &system_tools {
            let info = detect_tool(tool_name);
            let (latest, update_available) = match *tool_name {
                "claude" => {
                    let latest = get_npm_registry_version("@anthropic-ai/claude-code");
                    let update = match (&info.version, &latest) {
                        (Some(inst), Some(lat)) => inst != lat,
                        _ => false,
                    };
                    (latest, update)
                }
                "opencode" => {
                    let latest = get_npm_registry_version("opencode-ai");
                    let update = match (&info.version, &latest) {
                        (Some(inst), Some(lat)) => inst != lat,
                        _ => false,
                    };
                    (latest, update)
                }
                _ => (None, false),
            };

            system.insert(
                key.to_string(),
                serde_json::json!({
                    "version": info.version,
                    "installed": info.available,
                    "path": info.path,
                    "latest": latest,
                    "updateAvailable": update_available,
                }),
            );
        }

        IpcResponse::ok(serde_json::json!({ "system": system }))
    })
    .await
    .unwrap_or_else(|e| IpcResponse::err(format!("Version check failed: {}", e)))
}
```

- [ ] **Step 3: Convert update_npm_package to async**

Replace lines 298-320:

```rust
#[tauri::command]
pub async fn update_npm_package(package: String) -> IpcResponse {
    tokio::task::spawn_blocking(move || {
        let npm_name = match package.as_str() {
            "claude" | "@anthropic-ai/claude-code" => "@anthropic-ai/claude-code",
            "opencode" | "opencode-ai" => "opencode-ai",
            _ => {
                return IpcResponse::err(format!(
                    "Package '{}' is not updatable via npm",
                    package
                ));
            }
        };

        let install_arg = format!("{}@latest", npm_name);
        match run_npm(&["install", "-g", &install_arg]) {
            Ok(_) => IpcResponse::ok(serde_json::json!({
                "updated": true,
                "package": npm_name,
            })),
            Err(e) => IpcResponse::err(format!("npm install failed: {}", e)),
        }
    })
    .await
    .unwrap_or_else(|e| IpcResponse::err(format!("Update failed: {}", e)))
}
```

- [ ] **Step 4: Update tests to use tokio::test**

Change the tests that call async functions:

```rust
#[tokio::test]
async fn test_scan_cli_tools_returns_all() {
    let response = scan_cli_tools().await;
    assert!(response.success);
    let data = response.data.unwrap();
    let tools = data["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 4);

    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"claude"));
    assert!(names.contains(&"opencode"));
    assert!(names.contains(&"ollama"));
    assert!(names.contains(&"cargo"));
}

#[tokio::test]
async fn test_check_npm_versions_returns_system() {
    let response = check_npm_versions().await;
    assert!(response.success);
    let data = response.data.unwrap();
    let system = data["system"].as_object().unwrap();
    assert!(system.contains_key("claude"));
    assert!(system.contains_key("opencode"));
    assert!(system.contains_key("ollama"));
    assert!(system.contains_key("ffmpeg"));
}
```

Tests that don't call async functions (`test_parse_version_*`, `test_detect_tool_returns_struct`) stay unchanged.

- [ ] **Step 5: Compile check**

Run: `cd src-tauri && cargo check --tests --lib`
Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/tools.rs
git commit -m "perf(tools): async commands with spawn_blocking"
```

---

### Task 5: Async Git Commands

**Files:**
- Modify: `src-tauri/src/commands/files/git.rs` (20 command functions)

This is the largest task. All 20 functions follow the same pattern: resolve root, build args, run `std::process::Command::new("git").output()`, check status, return `IpcResponse`.

- [ ] **Step 1: Add the run_git helper function**

At the top of `git.rs` (after the imports), add:

```rust
/// Run a git command asynchronously using spawn_blocking.
///
/// Moves the blocking `std::process::Command::output()` call off the tokio
/// worker thread to prevent command starvation.
async fn run_git(args: &[&str], cwd: &std::path::Path) -> Result<std::process::Output, String> {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let cwd = cwd.to_path_buf();
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

/// Run a git command with owned String args (for dynamic arg lists).
async fn run_git_owned(args: Vec<String>, cwd: &std::path::Path) -> Result<std::process::Output, String> {
    let cwd = cwd.to_path_buf();
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

Two helpers: `run_git` for static `&str` args (most commands), `run_git_owned` for dynamic `String` args (stage/unstage/discard which build args from user paths).

- [ ] **Step 2: Convert get_git_changes to async**

Change signature from `pub fn get_git_changes(root: Option<String>) -> IpcResponse` to `pub async fn get_git_changes(root: Option<String>) -> IpcResponse`.

Replace all `std::process::Command::new("git")...output()` calls with `run_git()`. This function has two git calls (`status --porcelain` and `rev-parse --abbrev-ref HEAD`).

Example for the first call (lines 23-33):
```rust
// OLD:
let output = match std::process::Command::new("git")
    .args(["status", "--porcelain=v1"])
    .current_dir(&root)
    .output()
{
    Ok(o) => o,
    Err(e) => { ... }
};

// NEW:
let output = match run_git(&["status", "--porcelain=v1"], &root).await {
    Ok(o) => o,
    Err(e) => {
        info!("git status failed (git may not be installed): {}", e);
        return IpcResponse::ok(serde_json::json!({ "changes": [], "branch": null }));
    }
};
```

And the second call (branch detection):
```rust
let branch = match run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &root).await {
    Ok(o) if o.status.success() => {
        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
    }
    _ => None,
}.unwrap_or_default();
```

- [ ] **Step 3: Convert simple single-command functions to async**

These functions all follow the same pattern — one git command, check result:
- `git_stage_all` — args: `["add", "-A"]`
- `git_unstage_all` — args: `["reset", "HEAD"]`
- `git_push` — args: `["push"]`
- `git_fetch` — args: `["fetch"]`
- `git_force_push` — args: `["push", "--force"]`

For each: add `async` to signature, replace `std::process::Command::new("git")...output()` with `run_git(&[...], &root).await`.

Example for `git_push`:
```rust
#[tauri::command]
pub async fn git_push(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let output = match run_git(&["push"], &root).await {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git push: {}", e)),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git push failed: {}", stderr.trim()));
    }
    info!("git_push: pushed successfully");
    IpcResponse::ok_empty()
}
```

- [ ] **Step 4: Convert functions with dynamic args to async**

These functions build args from user input and need `run_git_owned`:
- `git_stage(paths, root)` — builds `["add", "--", ...normalized_paths]`
- `git_unstage(paths, root)` — builds `["reset", "HEAD", "--", ...normalized_paths]`
- `git_discard(paths, root)` — builds `["checkout", "--", ...normalized_paths]`

For each: add `async`, replace `std::process::Command` with `run_git_owned(args, &root).await`.

Example for `git_stage`:
```rust
#[tauri::command]
pub async fn git_stage(paths: Vec<String>, root: Option<String>) -> IpcResponse {
    if paths.is_empty() {
        return IpcResponse::err("No paths provided to stage");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let normalized = normalize_git_paths(&paths);
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(normalized);

    let output = match run_git_owned(args, &root).await {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git add: {}", e)),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git add failed: {}", stderr.trim()));
    }
    info!("git_stage: staged {} files", paths.len());
    IpcResponse::ok_empty()
}
```

- [ ] **Step 5: Convert remaining functions to async**

These have slightly different patterns:
- `git_commit(message, root)` — two sequential git calls (commit + rev-parse)
- `git_ahead_behind(root)` — one call with special error handling
- `git_pull(rebase, root)` — dynamic args based on `rebase` flag
- `git_checkout_branch(branch, root)` — one call with dynamic branch arg
- `git_stash_save(message, root)` — dynamic args based on optional message. **Must use `run_git_owned`** because it borrows from local `msg` variable (`args.push(&msg)`) which won't outlive the `spawn_blocking` closure. Convert all args to `String` first.
- `git_stash_list(root)` — one call, complex output parsing
- `git_stash_pop(index, root)` — one call with formatted stash ref
- `git_stash_apply(index, root)` — same pattern as pop
- `git_stash_drop(index, root)` — same pattern
- `git_list_branches(root)` — three sequential git calls

For each: add `async`, replace `std::process::Command` with `run_git` or `run_git_owned` as appropriate, add `.await` after each call.

For `git_commit` (two sequential calls):
```rust
#[tauri::command]
pub async fn git_commit(message: String, root: Option<String>) -> IpcResponse {
    if message.trim().is_empty() {
        return IpcResponse::err("Commit message cannot be empty");
    }
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let output = match run_git(&["commit", "-m", &message], &root).await {
        Ok(o) => o,
        Err(e) => return IpcResponse::err(format!("Failed to run git commit: {}", e)),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return IpcResponse::err(format!("git commit failed: {}", stderr.trim()));
    }
    let hash = match run_git(&["rev-parse", "--short", "HEAD"], &root).await {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    };
    info!("git_commit: committed {}", hash);
    IpcResponse::ok(serde_json::json!({ "hash": hash }))
}
```

For `git_list_branches` (three sequential calls):
```rust
#[tauri::command]
pub async fn git_list_branches(root: Option<String>) -> IpcResponse {
    let root = match resolve_root(root) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let current = match run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &root).await {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    };

    let mut branches: Vec<serde_json::Value> = Vec::new();

    if let Ok(output) = run_git(&["branch", "--format=%(refname:short)"], &root).await {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim();
                if name.is_empty() { continue; }
                branches.push(serde_json::json!({
                    "name": name,
                    "isCurrent": name == current,
                    "isRemote": false,
                }));
            }
        }
    }

    if let Ok(output) = run_git(&["branch", "-r", "--format=%(refname:short)"], &root).await {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim();
                if name.is_empty() || name.contains("HEAD") || !name.contains('/') { continue; }
                let short = name.split('/').skip(1).collect::<Vec<_>>().join("/");
                if branches.iter().any(|b| b["name"].as_str() == Some(&short)) {
                    continue;
                }
                branches.push(serde_json::json!({
                    "name": name,
                    "isCurrent": false,
                    "isRemote": true,
                }));
            }
        }
    }

    branches.sort_by(|a, b| {
        let a_current = a["isCurrent"].as_bool().unwrap_or(false);
        let b_current = b["isCurrent"].as_bool().unwrap_or(false);
        let a_remote = a["isRemote"].as_bool().unwrap_or(false);
        let b_remote = b["isRemote"].as_bool().unwrap_or(false);
        b_current.cmp(&a_current).then(a_remote.cmp(&b_remote))
    });

    info!("git_list_branches: {} branches (current={})", branches.len(), current);
    IpcResponse::ok(serde_json::json!({ "branches": branches, "current": current }))
}
```

Also `get_file_git_content` (lines 158-206) — one git call (`git show HEAD:<path>`), convert the same way:
```rust
#[tauri::command]
pub async fn get_file_git_content(path: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };
    let git_path = path.replace('\\', "/");
    let output = match run_git(&["show", &format!("HEAD:{}", git_path)], &root).await {
        Ok(o) => o,
        Err(e) => {
            info!("git show failed: {}", e);
            return IpcResponse::ok(serde_json::json!({
                "content": "", "path": path, "isNew": true
            }));
        }
    };
    if !output.status.success() {
        return IpcResponse::ok(serde_json::json!({
            "content": "", "path": path, "isNew": true
        }));
    }
    match String::from_utf8(output.stdout) {
        Ok(content) => IpcResponse::ok(serde_json::json!({
            "content": content, "path": path, "isNew": false
        })),
        Err(_) => IpcResponse::ok(serde_json::json!({
            "binary": true, "path": path
        })),
    }
}
```

- [ ] **Step 6: Update tests to use tokio::test**

The existing tests that call sync functions directly now need `async`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_git_stage_empty_paths_returns_error() {
        let result = git_stage(vec![], None).await;
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("No paths provided"));
    }

    #[tokio::test]
    async fn test_git_unstage_empty_paths_returns_error() {
        let result = git_unstage(vec![], None).await;
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("No paths provided"));
    }

    #[tokio::test]
    async fn test_git_discard_empty_paths_returns_error() {
        let result = git_discard(vec![], None).await;
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("No paths provided"));
    }

    #[tokio::test]
    async fn test_git_commit_empty_message_returns_error() {
        let result = git_commit("".to_string(), None).await;
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("empty"));
    }

    #[tokio::test]
    async fn test_git_commit_whitespace_message_returns_error() {
        let result = git_commit("   ".to_string(), None).await;
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap().contains("empty"));
    }

    #[test]
    fn test_normalize_git_paths() {
        // This test doesn't call async functions — stays sync
        let paths = vec!["src\\lib\\api.js".to_string(), "src/main.rs".to_string()];
        let normalized = normalize_git_paths(&paths);
        assert_eq!(normalized, vec!["src/lib/api.js", "src/main.rs"]);
    }
}
```

- [ ] **Step 7: Compile check**

Run: `cd src-tauri && cargo check --tests --lib`
Expected: Clean compilation.

- [ ] **Step 8: Run frontend tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/files/git.rs
git commit -m "perf(git): async commands with run_git helper"
```
