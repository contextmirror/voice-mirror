# MCP Tool Access Issues in the Tauri Migration

**Status:** Investigation only — do not attempt to fix without reading this first.
**Branch:** `tauri-migration`
**Date:** 2026-02-19

---

## What's Happening

When Claude is spawned from the Tauri app:
- The **system prompt injection works** — Claude receives the Voice Mirror instructions and the voice loop command.
- The **voice loop command injection works** — the ready-queue mechanism sends "Use voice_listen to wait for voice input..." after the TUI is ready.
- The **MCP tools do not work** — `voice_listen`, `voice_send`, and friends are not available as callable tools.

Claude knows what it's *supposed* to do (from the system prompt), but can't actually do it (no tool access). That's the gap.

---

## Root Causes

### 1. Two MCP Servers Now Exist — Claude Uses Neither Correctly

The Tauri migration introduced a **Rust MCP server** (`tauri/src-tauri/src/mcp/`) alongside the existing **Node.js MCP server** (`mcp-server/`). These are two separate implementations.

**Critical naming mismatch:**

| Server | Tool Names |
|--------|-----------|
| Node.js (`mcp-server/handlers/core.js`) | `voice_listen`, `voice_send`, `voice_inbox`, `voice_status` |
| Rust (`tauri/src-tauri/src/mcp/handlers/core.rs`) | `claude_listen`, `claude_send`, `claude_inbox`, `claude_status` |
| System prompt (`tauri/src-tauri/src/providers/cli.rs:265-280`) | `voice_listen`, `voice_send`, `voice_inbox`, `voice_status` |

The system prompt tells Claude to call `voice_listen` — which only exists in the Node.js server. The Rust server has `claude_listen`. If Claude ever does connect to the Rust server, all the tool calls in the instructions will fail.

The Claude Code PTY is configured (via `write_mcp_config` in `cli.rs:171`) to use the Node.js server, so the name mismatch in the Rust server isn't the immediate blocker — but it's a landmine for when the Rust server gets wired in.

---

### 2. `find_project_root()` Must Succeed or Nothing Works

In `tauri/src-tauri/src/providers/cli.rs:140-163`, `find_project_root()` walks up the directory tree from the executable looking for `mcp-server/index.js`. The entire MCP setup depends on this returning a valid path:

```rust
// cli.rs:409-415
if is_claude {
    if let Some(ref root) = project_root {
        if let Err(e) = write_mcp_config(root) {
            warn!("Failed to write MCP config: {}", e);
        }
    }
    // If project_root is None → write_mcp_config is silently skipped
```

**If `find_project_root()` returns `None`, the MCP config is never written, and Claude Code never learns the MCP server exists.** The failure is silent — only a `warn!` log at the Rust level, nothing shown to the user.

**When does it return None?**

- **Production builds**: The Tauri app is installed to `AppData\Local\voice-mirror\` or similar. The exe walks up 6 levels from there and will never find `mcp-server/index.js` because the Node.js MCP server is not bundled with the Tauri installer. `find_project_root()` returns `None` 100% of the time in production.

- **Dev mode**: The exe is at `tauri/src-tauri/target/debug/voice-mirror.exe`. Walking up 4 levels reaches the project root where `mcp-server/index.js` lives. This *should* work — but only if the current process isn't launched from an unexpected working directory.

---

### 3. The Node.js MCP Server Has Unresolved Dependencies at Runtime

Even when `find_project_root()` succeeds and `write_mcp_config` writes the correct path into `~/.claude/settings.json`, Claude Code then tries to spawn:

```
node E:/Projects/Voice Mirror Electron/mcp-server/index.js --enabled-groups core,meta,screen,memory,browser
```

For this to work:
- `node` must be on the PATH that Claude Code inherits (not guaranteed when spawned from a Tauri process)
- `node_modules/@modelcontextprotocol/sdk` must exist at the project root (requires `npm install` to have been run)
- All the paths referenced inside `mcp-server/` must resolve correctly

The Tauri spawn in `cli.rs:461-472` does not set a working directory for the MCP server child process explicitly — that's handled by Claude Code internally. The paths in `settings.json` are absolute, so Claude Code should be able to find the file, but there's no guarantee `node` is on the inherited PATH.

---

### 4. The Node.js MCP Server Was Modified for Tauri

Git status shows:
```
M mcp-server/index.js
M mcp-server/handlers/core.js
```

The core handler (`handlers/core.js`) implements `voice_listen`, `voice_send`, etc. using **file-based IPC**: it reads/writes `inbox.json`, `status.json`, and `listener_lock.json` in `HOME_DATA_DIR`.

In the Tauri migration, the voice pipeline architecture changed significantly:
```
M tauri/src-tauri/src/voice/pipeline.rs
M tauri/src-tauri/src/services/platform.rs
```

If `platform.rs` changed where `HOME_DATA_DIR` is, or if the Tauri voice pipeline no longer writes messages to `inbox.json` in the same location the Node.js MCP server reads from, the tools will exist but return errors or block forever when called. The tools would *appear* registered but be broken at call time.

---

### 5. Tool Profile and User Name Are Hardcoded

In `cli.rs:186`, the enabled groups are hardcoded:
```rust
let enabled_groups = "core,meta,screen,memory,browser";
```

And in `cli.rs:418`:
```rust
let user_name = "user"; // TODO: read from config
```

The Electron version read both from the app config (`config.ai.toolProfile`, `config.ai.toolProfiles`, `config.userName`). The Tauri version does neither. Consequences:

- **User name**: `from_sender` in `voice_listen` is hardcoded to `"user"`. If the user's name is configured as something else, the voice pipeline's sender filter may not match and messages may not route correctly.
- **Tool profile**: Customized tool profiles (e.g., disabling browser tools) are ignored. Minor issue compared to the above.

---

## Why the Auto-Injected Message Doesn't Lead to Tool Use

The "auto-injected message" (`Use voice_listen to wait for voice input from user...`) does reach Claude via the ready-queue mechanism in `cli.rs:426-430`. Claude reads it and tries to act on it.

But the instruction tells Claude to call `voice_listen` — a tool that must exist in Claude Code's registered MCP tool list. If the MCP connection failed (any of the causes above), the tool simply isn't in the list. Claude either:
- Ignores the instruction (no matching tool available)
- Attempts to call it and gets an "unknown tool" error from Claude Code
- Falls back to treating it as a text conversation

The system prompt and the ready-queue injection work in isolation but are useless without a live MCP connection.

---

## Summary Table

| Component | Status | File(s) |
|-----------|--------|---------|
| System prompt injection | ✅ Works | `cli.rs:417-421` |
| Voice loop command injection | ✅ Works | `cli.rs:426-430` |
| MCP config write (dev mode) | ⚠️ Fragile | `cli.rs:140-163, 171-250` |
| MCP config write (production) | ❌ Broken | `find_project_root()` never finds `mcp-server/` |
| Node.js MCP server startup | ⚠️ Unknown | depends on `node` PATH + `npm install` |
| Node.js MCP server IPC | ⚠️ Possibly broken | `mcp-server/handlers/core.js` modified |
| Tool names in system prompt vs Rust server | ❌ Mismatch | `cli.rs:275` vs `core.rs:1` |
| User name in voice_listen | ⚠️ Hardcoded | `cli.rs:418` |
| Tool profile from config | ❌ Missing | `cli.rs:186` |

---

## Before Attempting Fixes

1. **Check `~/.claude/settings.json`** after launching the Tauri app — does the `voice-mirror` entry appear? If not, `find_project_root()` is returning None.
2. **Check Tauri logs** (tracing output) for any `warn!` calls from `write_mcp_config`.
3. **Confirm `npm install` has been run** in the project root (the Node.js MCP server needs `node_modules/`).
4. **Confirm `node` is on PATH** when launched from Tauri (not just in the terminal).
5. **Diff `mcp-server/handlers/core.js`** against the last stable commit to see what IPC paths changed.
6. **Decide on one MCP server** — Rust or Node.js. Having both with different tool names will cause ongoing confusion.
