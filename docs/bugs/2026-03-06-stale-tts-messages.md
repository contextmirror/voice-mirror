# Bug: Stale TTS Messages Leak Across Sessions

**Reported:** 2026-03-06
**Status:** Open
**Severity:** Medium (cosmetic/UX — causes confusion but no data loss)

## Symptom

When starting a new Claude Code voice session, the user occasionally hears TTS responses from a **previous** conversation. These messages appear in the chat UI as "Assistant" messages and are spoken aloud, even though the current Claude session never sent them.

## Root Cause

Two contributing factors:

### 1. `inbox.json` persists messages across sessions

`%APPDATA%/voice-mirror/data/inbox.json` stores up to 100 messages (MAX_MESSAGES) and is never cleared between Claude Code sessions. Old AI responses remain in the file indefinitely.

**File:** `src-tauri/src/mcp/handlers/core.rs` — `handle_voice_send()` (line ~386-390)

### 2. Frontend dedup set is bounded and has no session awareness

The `seenMessageIds` Set in `voice.svelte.js` is capped at 100 entries. When older IDs cycle out and those messages are re-emitted (e.g., inbox watcher re-processes after a file change), the frontend treats them as new → adds to chat + triggers TTS.

**File:** `src/lib/stores/voice.svelte.js` — `initVoiceListeners()` (line ~208-222)

### 3. No session boundary concept

There is no mechanism to signal "a new Claude Code session started" to the frontend. When a new MCP binary connects via pipe, nothing clears old state or resets dedup tracking.

## Message Flow (how the leak happens)

```
Session A:
  voice_send → inbox.json (persists) + pipe → frontend (dedup Set adds ID)

Session A ends, Session B starts:
  inbox.json still has Session A messages
  seenMessageIds Set may have evicted old IDs (100 cap)
  If inbox watcher re-processes → old messages appear "new" → TTS speaks them
```

## Key Files

| File | Role |
|------|------|
| `src/lib/stores/voice.svelte.js:208-222` | Frontend dedup Set (100 cap) |
| `src-tauri/src/services/inbox_watcher.rs:162-208` | Inbox watcher process_inbox + seed |
| `src-tauri/src/mcp/handlers/core.rs:325-420` | voice_send (writes inbox.json + pipe) |
| `src-tauri/src/ipc/pipe_server.rs:180-207` | Pipe dispatch (emits mcp-inbox-message) |
| `%APPDATA%/voice-mirror/data/inbox.json` | Persistent message store |

## Proposed Fixes (pick one or combine)

### Option A: Clear inbox on new pipe connection (simplest)
When `PipeServer` accepts a new client connection, truncate `inbox.json` to remove old AI messages. This gives each Claude Code session a clean slate.

### Option B: Session-aware dedup reset
Emit a `session-start` Tauri event when a new MCP pipe client connects. Frontend listens for this event and:
- Clears `seenMessageIds`
- Seeds it with all current `inbox.json` message IDs
- Optionally clears the chat store

### Option C: Increase dedup + add timestamps
- Remove the 100-entry cap on `seenMessageIds` (or raise to 500+)
- Add timestamp filtering: ignore messages older than N minutes
- Messages in `inbox.json` get a `session_id` field

### Option D: Session ID tracking (most robust)
- Generate a `session_id` when MCP binary connects
- Tag all messages with session_id
- Frontend only processes messages matching current session_id
- Old sessions' messages are ignored entirely

## Workaround

User can manually clear the inbox by calling `voice_inbox` with `mark_as_read: true` at the start of each session, or by deleting `inbox.json` before starting Claude Code.
