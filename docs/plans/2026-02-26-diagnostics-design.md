# Output & Diagnostics System — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** VS Code-style Output panel with categorized log channels, an MCP tool for programmatic log access, and a real Debug Mode toggle.

**Architecture:** Custom `tracing` Layer routes log events to per-channel in-memory ring buffers. Frontend subscribes via Tauri events for live streaming. MCP binary queries logs through the named pipe. Existing file logging (`tracing_appender`) continues unchanged for crash forensics.

**Motivation:** Debugging the CLI provider tonight took 2+ hours of guessing from raw console output. With structured, queryable logs, `get_logs --channel cli --level debug --last 50` would have revealed `CLAUDECODE=1` inheritance in seconds.

---

## 1. Rust Backend — OutputLayer + Ring Buffers

### New file: `src-tauri/src/services/output.rs`

**OutputLayer** — a custom `tracing::Layer` that intercepts log events and routes them to per-channel ring buffers based on the tracing target (module path).

**Channel routing (prefix match):**

| Target prefix | Channel |
|---------------|---------|
| `voice_mirror_lib::providers::cli` | `cli` |
| `voice_mirror_lib::voice` | `voice` |
| `voice_mirror_lib::mcp` | `mcp` |
| `voice_mirror_lib::services::browser` | `browser` |
| Everything else | `app` |

**LogEntry struct:**

```rust
struct LogEntry {
    timestamp: u64,    // millis since epoch
    level: Level,      // ERROR, WARN, INFO, DEBUG, TRACE
    channel: Channel,  // enum: App, Cli, Voice, Mcp, Browser
    message: String,   // formatted log message
}
```

**Ring buffer:** `VecDeque<LogEntry>` per channel, capped at 2000 entries. Wrapped in `Arc<RwLock<>>`. When full, `pop_front()` before `push_back()`.

**Global state:** `Arc<OutputStore>` stored in Tauri managed state. Contains the 5 ring buffers + a `reload::Handle` for dynamic filter adjustment.

**Live streaming:** On each new entry, emit Tauri event `output-log` with the entry. Batched at 100ms intervals to avoid flooding the event bus.

**Debug Mode integration:** Uses `tracing_subscriber::reload` to dynamically adjust the OutputLayer's filter level:
- Debug Mode OFF → INFO and above captured
- Debug Mode ON → DEBUG and TRACE also captured
- No restart required — toggle takes effect immediately

### MCP binary log forwarding

The MCP binary runs as a separate process. Its logs won't be captured by Tauri's tracing Layer. New pipe protocol message:

- `McpToApp::LogForward { level, message }` — MCP binary sends its log entries through the named pipe
- Tauri's pipe server injects them into the `mcp` ring buffer

---

## 2. MCP Tool — `get_logs`

Added to the `core` tool group (always loaded).

**Input schema:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `channel` | string? | (all) | `app`, `cli`, `voice`, `mcp`, `browser` |
| `level` | string? | `info` | minimum level: `error`, `warn`, `info`, `debug`, `trace` |
| `last` | number? | 100 | return last N entries |
| `search` | string? | (none) | case-insensitive text filter |

**Behavior:**
- No channel specified → returns summary of all channels (entry counts per level) so the caller knows where to look
- Channel specified → returns formatted log lines matching the filters

**Example output (summary mode):**
```
Output Channels:
  app:     142 entries (0 error, 2 warn, 140 info)
  cli:     847 entries (1 error, 3 warn, 843 info)
  voice:    23 entries (0 error, 0 warn, 23 info)
  mcp:     312 entries (0 error, 1 warn, 311 info)
  browser:  56 entries (0 error, 0 warn, 56 info)
```

**Example output (channel mode):**
```
20:13:05 [ERROR] PTY spawn failed: CLAUDECODE=1 detected
20:13:06 [ERROR] child process exited code=1

--- 2 entries (filtered from 847 total) ---
```

**Pipe protocol additions:**
- `McpToApp::GetLogs { channel, level, last, search }` — request
- `AppToMcp::LogEntries { entries, total, channel_summaries }` — response

Routed through the existing `PipeRouter` oneshot pattern.

---

## 3. Frontend — Output Panel

### New component: `src/components/lens/OutputPanel.svelte`

Lives as a tab alongside Terminal in the bottom panel of LensWorkspace.

**UI elements:**
- Channel dropdown in the panel header — select which channel to view (one at a time, VS Code style)
- Level filter buttons — toggle ERROR/WARN/INFO/DEBUG/TRACE visibility
- Clear button — clears the view (not the backend buffer)
- Read-only monospace text area — auto-scrolls to bottom, pauses auto-scroll when user scrolls up

**Color coding:**
- ERROR → red (`var(--danger)`)
- WARN → yellow (`var(--warn)`)
- INFO → default text color
- DEBUG → muted (`var(--muted)`)
- TRACE → very muted (50% opacity)

**Implementation:** Simple `<pre>` with CSS, NOT CodeMirror. Log lines don't need syntax highlighting, folding, or search. A styled `<pre>` with `overflow-y: auto` is lighter weight.

### New store: `src/lib/stores/output.svelte.js`

- Listens to `output-log` Tauri event
- Maintains per-channel entry arrays (capped client-side to match backend 2000 limit)
- Tracks: active channel, level filter, auto-scroll state
- Exports: `outputStore` (reactive), `switchChannel()`, `setLevelFilter()`, `clearChannel()`

### Tab integration in LensWorkspace

Bottom panel tabs: `[Terminal] [Output]`

The Output tab renders `OutputPanel.svelte`. Tab switching is lightweight — both components stay mounted, visibility toggled.

---

## 4. Wiring & Config

**Config:** `debug_mode` in `AdvancedConfig` stays as-is. Now actually controls the OutputLayer's filter level.

**New Tauri command:** `set_log_level(level: String)` — called when Debug Mode is toggled. Adjusts the OutputLayer filter via `reload::Handle`.

**New Tauri command:** `get_output_logs(channel, level, last, search)` — frontend can also query logs directly (used for initial load when switching channels).

**New api.js wrappers:** `setLogLevel(level)`, `getOutputLogs(params)`

**Startup in lib.rs:**
1. Create `OutputStore` with 5 channels
2. Create `OutputLayer` with `reload` wrapper
3. Add to `tracing_subscriber::registry()` alongside existing file + console layers
4. Store `Arc<OutputStore>` in Tauri managed state

**Pipe server handler:** New match arm in `pipe_server.rs` for `McpToApp::GetLogs` that reads from `OutputStore` and responds.

---

## 5. Memory & Performance

| Metric | Value |
|--------|-------|
| Ring buffer per channel | 2000 entries |
| Estimated entry size | ~200 bytes |
| Total memory (5 channels) | ~2MB max |
| Event batching interval | 100ms |
| Filter change latency | Immediate (no restart) |
| Existing file logging | Unchanged |

No disk I/O for the Output system. No polling. No file watching. The only cost is the `RwLock` acquisition per log event, which is negligible.

---

## 6. Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `src-tauri/src/services/output.rs` | OutputLayer, OutputStore, ring buffers |
| Modify | `src-tauri/src/services/mod.rs` | Export output module |
| Modify | `src-tauri/src/services/logger.rs` | Add OutputLayer to subscriber registry |
| Modify | `src-tauri/src/lib.rs` | Init OutputStore, add managed state, register new commands |
| Create | `src-tauri/src/commands/output.rs` | `get_output_logs`, `set_log_level` commands |
| Modify | `src-tauri/src/commands/mod.rs` | Export output module |
| Modify | `src-tauri/src/ipc/protocol.rs` | Add GetLogs/LogEntries/LogForward messages |
| Modify | `src-tauri/src/ipc/pipe_server.rs` | Handle GetLogs requests |
| Modify | `src-tauri/src/mcp/tools.rs` | Register get_logs tool in core group |
| Modify | `src-tauri/src/mcp/handlers/core.rs` | Implement get_logs handler |
| Modify | `src-tauri/src/bin/mcp.rs` | Add log forwarding via pipe |
| Create | `src/components/lens/OutputPanel.svelte` | Output panel UI |
| Create | `src/lib/stores/output.svelte.js` | Output store |
| Modify | `src/components/lens/LensWorkspace.svelte` | Add Output tab to bottom panel |
| Modify | `src/lib/api.js` | Add getOutputLogs, setLogLevel wrappers |
| Modify | `src/components/settings/BehaviorSettings.svelte` | Wire Debug Mode to setLogLevel |
