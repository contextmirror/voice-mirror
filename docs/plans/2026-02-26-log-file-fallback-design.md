# JSONL Log File Fallback for External MCP Clients

## Problem

The MCP `get_logs` tool requires a named pipe connection to the Tauri app. The pipe only accepts one client (`.first_pipe_instance(true)` on Windows). When the in-app Claude's MCP binary holds the pipe, terminal Claude Code instances get "Named pipe not connected" and cannot diagnose issues.

## Solution

Write log entries to JSONL files on disk alongside the existing ring buffer. External MCP binaries read these files directly when the pipe is unavailable.

## Design

### File Layout

```
%APPDATA%/voice-mirror/logs/
  current/          <- active session
    app.jsonl
    cli.jsonl
    voice.jsonl
    mcp.jsonl
    browser.jsonl
  session-2026-02-26T14-30-00/   <- rotated sessions
  session-2026-02-26T12-00-00/
```

### Write Path (Tauri App — `services/output.rs`)

`OutputLayer::on_event()` already captures every tracing event. After pushing to the ring buffer and emitting the Tauri event, also append the serialized `LogEntry` as a JSONL line to `logs/current/{channel}.jsonl`.

- Flush immediately per entry (append + flush is cheap for ~200 byte lines)
- Cap at 2000 lines per file (matches ring buffer). When exceeded, truncate to 1500 lines.

### Read Path (MCP Binary — `mcp/handlers/core.rs`)

`handle_get_logs`: if `router` is `None`, read JSONL files from `logs/current/` directory. Apply channel/level/last/search filters client-side after parsing. Same output format as the pipe path.

### Session Rotation (Tauri App — `lib.rs`)

On app startup:
1. If `logs/current/` exists, rename to `logs/session-{timestamp}/`
2. Create fresh `logs/current/`
3. Delete all but the 5 most recent `session-*` directories

### Data Flow

```
tracing event -> OutputLayer.on_event()
  |-- push to ring buffer (existing)
  |-- emit Tauri event (existing)
  +-- append to logs/current/{channel}.jsonl (NEW)

get_logs MCP tool
  |-- pipe connected? -> query via pipe (existing)
  +-- no pipe? -> read JSONL from logs/current/ (NEW)
```

### Files Changed

| File | Change |
|------|--------|
| `services/output.rs` | Add `LogFileWriter` with append + rotation logic |
| `mcp/handlers/core.rs` | Fallback in `handle_get_logs` to read JSONL when no pipe |
| `lib.rs` | Create logs dir on startup, rotate sessions, prune old ones |
| `bin/mcp.rs` | Resolve logs dir path, pass to handler |
