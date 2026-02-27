# Follow the Agent — Design Document

## Overview

"Follow the Agent" lets users watch their AI agent work in real-time. As the agent reads files, makes edits, and navigates the codebase, the Lens editor automatically opens and scrolls to the same location — like pair programming where you watch over the agent's shoulder.

Inspired by Zed's "Follow the Zed Agent" feature, adapted for Voice Mirror's CLI-agent architecture.

## How Zed Does It

Zed's implementation is clean because the agent is **native** — it runs inside the editor process and can directly update a shared `AgentLocation` struct.

### Architecture (Traced from Zed Source)

```
Agent Thread (tool execution)
  ↓ calls set_agent_location(buffer, anchor)
Project (central state)
  ↓ emits Event::AgentLocationChanged
Workspace (listener)
  ↓ checks if user is following (FollowerState)
Editor (update)
  ↓ set_selections_from_remote() + request_autoscroll_remotely()
UI renders agent cursor at file:line
```

### Key Components

| File | Purpose |
|------|---------|
| `crates/project/src/project.rs` | `AgentLocation { buffer, position }` struct + `set_agent_location()` |
| `crates/agent/src/tools/read_file_tool.rs` | Calls `set_agent_location()` when reading files |
| `crates/agent/src/edit_agent.rs` | Calls `set_agent_location()` at each edit position |
| `crates/workspace/src/workspace.rs` | `follow(CollaboratorId::Agent)` + `handle_agent_location_changed()` |
| `crates/editor/src/items.rs` | `update_agent_location()` — sets cursor + autoscrolls |
| `crates/agent_ui/src/acp/thread_view/active_thread.rs` | Toggle button (crosshair icon) |

### Key Design Decisions

1. **Purely local** — No network RPC needed (unlike multi-user following which uses peer IDs)
2. **Lazy editor creation** — Editors for agent-visited files are created on-demand, reused if already open
3. **Anchor-based positions** — Uses `language::Anchor` (gap-aware markers) so positions stay valid across edits
4. **Event-driven** — Tool execution emits location events; workspace only acts if user is actively following
5. **Selection management** — Following clears user selections to avoid visual conflicts with agent cursor

### Toggle UX

- **Button:** Crosshair icon in agent panel, toggles between "Follow" / "Stop Following"
- **Auto-activate:** When `should_be_following` is true and agent starts generating, following activates automatically
- **Auto-deactivate:** User clicking elsewhere or manually editing breaks follow mode

## Our Challenge: CLI Agents

Unlike Zed, our agents (Claude Code, OpenCode) run in a **PTY terminal** — they're external processes, not native code. We can't call `set_agent_location()` directly.

**Critical insight:** Claude Code's file operations (Read, Write, Edit, Grep, Glob) are **built-in tools** that hit the filesystem directly. They do NOT flow through our MCP server. Our MCP connection is only used for Voice Mirror-specific tools (`voice_send`, `voice_inbox`, `browser_*`, etc.).

This means MCP tool interception is useless for tracking file reads/edits. We need a different approach.

### Why PTY Parsing Won't Work

- Claude Code runs in **alternate screen mode** (TUI) — output is raw ANSI escape sequences
- No structured markers for tool invocations in terminal output
- Tool names (Read, Write, Edit) are rendered as styled text, not machine-readable
- Fragile: any UI change in Claude Code breaks our parser
- **Confidence: ~10%** — not viable

## Recommended: Claude Code Hooks

Claude Code has a comprehensive **hooks system** with 16 lifecycle events. The two that matter:

| Event | When | Can Block? | Async? |
|-------|------|-----------|--------|
| `PreToolUse` | Before a tool executes | Yes | Yes |
| `PostToolUse` | After a tool succeeds | No (feedback only) | Yes |

### What Hooks Receive

Hooks receive **structured JSON on stdin** with full tool details:

**Read:**
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": {
    "file_path": "/absolute/path/to/file.txt",
    "offset": 10,
    "limit": 50
  },
  "session_id": "abc-123",
  "cwd": "/project/root"
}
```

**Edit:**
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/absolute/path/to/file.txt",
    "old_string": "original text",
    "new_string": "replacement text"
  }
}
```

**Write:**
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/absolute/path/to/file.txt",
    "content": "..."
  }
}
```

**Grep:**
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Grep",
  "tool_input": {
    "pattern": "TODO",
    "path": "/project/src",
    "glob": "*.ts"
  }
}
```

**Glob:**
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Glob",
  "tool_input": {
    "pattern": "**/*.svelte",
    "path": "/project/src"
  }
}
```

### Hook Configuration

Three scope levels (all JSON):

| Location | Scope |
|----------|-------|
| `.claude/settings.json` | Project (committable, shared) |
| `.claude/settings.local.json` | Project (gitignored, personal) |
| `~/.claude/settings.json` | Global (all projects) |

### Data Flow

```
Claude Code executes Read("src/App.svelte")
  ↓ PostToolUse hook fires
  ↓ async shell command receives JSON on stdin
Hook script extracts file_path + tool_name
  ↓ writes to shared location OR sends to Tauri
Tauri app reads agent location
  ↓ emits "agent-location-changed" event
Frontend listener
  ↓ opens file in Lens editor, scrolls to line
  ↓ shows agent cursor indicator
```

### Hook Script → Tauri Communication

The hook script needs to send data to the running Tauri app. Options:

#### Option A: Named Pipe (Preferred)

Reuse the existing named pipe infrastructure. The hook script writes a length-prefixed JSON frame to `\\.\pipe\voice-mirror`:

```bash
#!/bin/bash
# .claude/hooks/on-tool-use.sh
INPUT=$(cat)  # Read JSON from stdin

TOOL=$(echo "$INPUT" | jq -r '.tool_name')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -n "$FILE" ]; then
  # Write to named pipe (or a simpler mechanism)
  echo "{\"type\":\"AgentLocation\",\"tool\":\"$TOOL\",\"file\":\"$FILE\"}" \
    > /tmp/voice-mirror-agent-location
fi
```

**Challenge:** Writing to a Windows named pipe from bash is awkward. May need a small helper binary or use a simpler mechanism.

#### Option B: Temp File (Simplest)

Hook writes to a known temp file; Tauri polls or watches it:

```bash
#!/bin/bash
INPUT=$(cat)
echo "$INPUT" | jq '{tool: .tool_name, file: .tool_input.file_path, ts: now}' \
  > "$APPDATA/voice-mirror/agent-location.json"
```

Tauri side: file watcher on `agent-location.json`, debounced reads.

#### Option C: HTTP to Dev Server

If the Tauri dev server (`services/dev_server.rs`) is running, POST to a local endpoint:

```bash
#!/bin/bash
INPUT=$(cat)
curl -s -X POST http://localhost:1421/agent-location \
  -H "Content-Type: application/json" \
  -d "$INPUT" > /dev/null 2>&1 &
```

#### Option D: Tauri Deep Link / Custom Protocol

Register a `voice-mirror://` protocol handler. Hook opens a URL:

```bash
#!/bin/bash
FILE=$(cat | jq -r '.tool_input.file_path // empty')
[ -n "$FILE" ] && start "voice-mirror://follow?file=$FILE" &
```

### Recommended: Option B (Temp File) for MVP, Option A (Named Pipe) for Production

Temp file is dead simple, works on all platforms, and the latency (~50-100ms with file watching) is acceptable for a "follow" feature. For production, a proper named pipe client in the hook script (or a tiny Rust helper) gives sub-10ms latency.

### Hook Configuration for Voice Mirror

Add to `.claude/settings.json` (or `.claude/settings.local.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Write|Edit|Glob|Grep",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/agent-location.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

Key: **`"async": true`** — the hook fires in the background, so Claude Code doesn't wait for it. Zero performance impact on the agent.

### Tool-to-Action Mapping

| Claude Code Tool | `file_path` Source | Line Source | Action |
|-----------------|-------------------|------------|--------|
| `Read` | `tool_input.file_path` | `tool_input.offset` | Read |
| `Write` | `tool_input.file_path` | — | Write |
| `Edit` | `tool_input.file_path` | (can infer from `old_string` position) | Edit |
| `Grep` | `tool_input.path` | — | Search |
| `Glob` | `tool_input.path` | — | Search |
| `Bash` | (parse `cd` commands, `npm test`, etc.) | — | Command |
| `Task` | (subagent — may have own file ops) | — | Delegate |

### Protocol: Agent Location Event

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLocation {
    pub tool_name: String,       // "Read", "Write", "Edit", "Grep", "Glob"
    pub file_path: Option<String>,
    pub line_number: Option<usize>,
    pub action: AgentAction,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentAction {
    Read,
    Write,
    Edit,
    Search,
    Command,
}
```

### Frontend Store

New store: `src/lib/stores/agent-location.svelte.js`

```js
// Reactive agent location state
let agentLocation = $state(null);
let isFollowing = $state(false);
let locationHistory = $state([]);  // Trail of visited files

// Listen for Tauri events
listen('agent-location-changed', (event) => {
    agentLocation = event.payload;
    locationHistory.push(event.payload);

    if (isFollowing && event.payload.file_path) {
        // Open file in editor + scroll to line
        tabsStore.openFile({ path: event.payload.file_path });
        if (event.payload.line_number) {
            // Jump to line in CodeMirror
        }
    }
});
```

### UI: Follow Button

In the Lens toolbar or status bar:

```svelte
<button
    class="follow-agent-btn"
    class:active={isFollowing}
    onclick={() => isFollowing = !isFollowing}
    title={isFollowing
        ? "Stop following the agent"
        : "Follow the agent — track file reads and edits"}
>
    <CrosshairIcon />
    {#if agentLocation?.file_path}
        <span class="agent-file">{basename(agentLocation.file_path)}</span>
    {/if}
</button>
```

## Secondary Signal: File Watcher

The existing file watcher (`services/file_watcher.rs`) serves as a **fallback for agents without hooks** (e.g., OpenCode):

1. Agent writes to `src/App.svelte`
2. File watcher detects `Modify` event (150ms debounce)
3. If follow mode is active → open/focus that file in Lens

**Limitations:** Can't detect reads (only writes), can't distinguish agent writes from user writes or build tools. Best used as confirmation signal alongside hooks.

## What About OpenCode?

OpenCode doesn't have a hooks system like Claude Code. Options:

1. **File watcher only** — catch writes, miss reads. Acceptable for MVP.
2. **Custom MCP tools** — if OpenCode supports MCP, we could provide `follow_read_file` / `follow_write_file` wrappers. But this requires OpenCode to use our MCP tools instead of its built-ins (unlikely).
3. **Future:** If OpenCode adds hooks or structured output, integrate similarly to Claude Code.

For now, **Claude Code hooks = primary, file watcher = universal fallback**.

## Comparison: Zed vs Voice Mirror

| Aspect | Zed | Voice Mirror |
|--------|-----|-------------|
| Agent runtime | Native (same process) | External (PTY terminal) |
| Location signal | Direct `set_agent_location()` | Claude Code hooks (PostToolUse) |
| Position precision | `Anchor` (character-level) | File + line number |
| Latency | Instant (<1ms) | Hook async + file/pipe (~50-100ms) |
| Coverage | 100% of tool calls | 100% of Claude Code tools via hooks |
| Reads tracked? | Yes | Yes (PostToolUse fires on Read) |
| Edits tracked? | Yes | Yes (PostToolUse fires on Edit/Write) |
| Works for any agent? | No (Zed-native only) | Claude Code (hooks) + any agent (file watcher) |
| Multi-agent support | Single agent | Yes (session_id in hook JSON) |
| Setup required | None (built-in) | Hook config in `.claude/settings.json` |

### Advantages Over Zed

1. **More data** — We get the full tool input (file content for Write, old/new strings for Edit, grep patterns, etc.)
2. **History trail** — Can log every tool call for post-session review
3. **Agent-agnostic fallback** — File watcher works for any agent that writes files
4. **Async by default** — Zero performance impact on the agent

### Disadvantages vs Zed

1. **Higher latency** — ~50-100ms vs instant
2. **Setup required** — User must have hooks configured (can auto-configure on first run)
3. **No character-level precision** — File + line, not character position within line
4. **OpenCode gap** — No hooks system, limited to file watcher

## Implementation Plan

### Phase 1: Hook Infrastructure + Temp File MVP

| Item | Details |
|------|---------|
| `.claude/hooks/agent-location.sh` | Bash script: reads JSON stdin, writes to `$APPDATA/voice-mirror/agent-location.json` |
| `.claude/settings.json` | Add PostToolUse hook config for `Read\|Write\|Edit\|Grep\|Glob` |
| `src-tauri/src/services/` | New service or extension: watch `agent-location.json`, emit Tauri event |
| Tauri event | `agent-location-changed` with `AgentLocation` payload |

### Phase 2: Frontend Follow UX

| Item | Details |
|------|---------|
| `src/lib/stores/agent-location.svelte.js` | New store: location state, follow toggle, history |
| `src/components/lens/LensWorkspace.svelte` | Follow button (crosshair icon) in toolbar |
| `src/components/lens/FileEditor.svelte` | Agent cursor indicator overlay |
| `src/components/lens/FileTree.svelte` | Highlight file agent is currently in |
| `src/components/lens/TabBar.svelte` | Agent activity indicator on tabs |

### Phase 3: Production Hardening

| Item | Details |
|------|---------|
| Named pipe client | Replace temp file with proper pipe write from hook script |
| Auto-configuration | On first CLI provider launch, auto-add hooks to `.claude/settings.json` |
| File watcher fallback | Correlate `fs-file-changed` events when no hook data available |
| Debouncing | 200ms debounce on rapid tool calls (agent reading 20 files in sequence) |

## Edge Cases

| Case | Handling |
|------|----------|
| Agent reads file outside project | Show full path in status, open as read-only |
| Rapid tool calls (20+ reads) | Debounce 200ms, only follow latest |
| User is actively editing | Follow mode auto-pauses on user keystroke, resumes on next agent action |
| Agent stops (idle/done) | Show "Last: src/App.svelte (2m ago)" with fade |
| Hook script fails | Silent failure (async), file watcher fallback |
| Multiple Claude Code sessions | Differentiate by `session_id` in hook JSON |
| File deleted by agent | Close tab, show notification |
| `.claude/settings.json` already has hooks | Merge, don't overwrite existing hooks |

## Known Issues

- [Claude Code #6305](https://github.com/anthropics/claude-code/issues/6305): PreToolUse/PostToolUse hooks sometimes don't fire (may be version-specific)
- Hooks are **snapshotted at session startup** — config changes require session restart or `/hooks` review
- Windows: bash hook scripts need Git Bash or WSL; alternatively write hook in PowerShell or as a tiny Rust/Node binary

## Open Questions

1. **Auto-configure hooks on first run?** When Voice Mirror launches Claude Code, should it auto-add the hooks to `.claude/settings.json`? Pro: zero setup. Con: modifying user's Claude Code config without asking.
2. **Agent cursor styling?** Zed uses player colors. We could use the accent color with a pulsing animation.
3. **Sound on file switch?** Subtle audio cue when agent jumps to a new file.
4. **History panel?** List of agent-visited files for review after the agent finishes — like a breadcrumb trail.
5. **PowerShell vs Bash hook?** On Windows, bash requires Git Bash. A PowerShell hook or compiled Rust binary would be more reliable.
