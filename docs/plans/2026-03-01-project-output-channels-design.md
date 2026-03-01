# Project Output Channels — Design

**Date:** 2026-03-01
**Status:** Approved
**Branch:** feature/lens

## Problem

Voice Mirror's Output panel currently shows only internal IDE logs (App, CLI Provider, Voice Pipeline, etc.). When a user is building a project (e.g., a Discord clone, a portfolio site), Claude has no visibility into:

1. **Build-time logs** — Vite HMR updates, compilation errors, module resolution failures
2. **Runtime logs** — `console.log/warn/error` from the project running in the Lens browser preview

This means Claude can read the code (hands) and take screenshots (eyes), but is blind to runtime behavior. Developers rely on DevTools Console + terminal output to debug — Claude needs the same.

## Solution

Add **dynamic project output channels** above a separator in the Output dropdown, following VS Code's pattern. Each project gets a single combined channel that merges dev server terminal output and browser console capture into one chronological stream, exposed via MCP for Claude to query.

```
┌──────────────────────────────────┐
│ my-discord-clone (Vite :5173) ✓  │  ← User's project logs
│ portfolio-site (Next :3000)      │  ← Another open project
│──────────────────────────────────│  ← Separator
│ App                              │  ← Voice Mirror internals
│ CLI Provider                     │
│ Voice Pipeline                   │
│ MCP Server                       │
│ Browser Bridge                   │
│ Frontend                         │
└──────────────────────────────────┘
```

## Architecture

### Two-Tier Channel System

| Tier | Type | Lifecycle | Examples |
|------|------|-----------|----------|
| **System** | Fixed enum (existing 6) | App lifetime | App, Cli, Voice, Mcp, Browser, Frontend |
| **Project** | Dynamic registry | Created on project open / dev server start. Destroyed when dev server stops + project closed. | `my-discord-clone (Vite :5173)` |

### Backend Data Structure

```rust
struct OutputStore {
    // Existing: fixed system channels
    system_channels: [ChannelBuffer; 6],

    // New: dynamic project channels
    project_channels: HashMap<String, ProjectChannel>,

    next_id: u64,  // monotonic ID shared across ALL channels
}

struct ProjectChannel {
    label: String,              // "my-discord-clone (Vite :5173)"
    project_path: String,       // "E:/Projects/my-discord-clone"
    buffer: VecDeque<LogEntry>, // ring buffer, 2000 cap
    framework: Option<String>,  // "Vite", "Next.js", etc.
    port: Option<u16>,          // 5173, 3000, etc.
}
```

**Channel naming:** `{folder_name} ({framework} :{port})`. If no dev server detected: just `{folder_name}`.

**JSONL files:** Dynamic channels write to `logs/current/project-{sanitized_name}.jsonl`. Same truncation rules (2000 max, trim to 1500) as system channels.

## Data Flow — Two Capture Sources Into One Channel

```
Source 1: Dev Server Terminal (build-time)
  Terminal PTY stdout → mirror to project channel
  Tagged: [vite], [next], etc.

Source 2: Browser Console (runtime)
  WebView2 ConsoleApiCalled → project channel
  Tagged: [console], [console:warn], [console:error]
```

### Combined Output Example

```
10:32:15 [vite]           hmr update /src/Chat.svelte
10:32:16 [console]        WebSocket connected to gateway
10:32:17 [console:error]  TypeError: messages.map is not a function
                            at Chat.svelte:42
                            at Array.forEach (<anonymous>)
10:32:18 [vite]           ERROR: Missing export 'formatTime' from utils.js
10:32:19 [console:warn]   React: Each child should have unique key
```

Chronological interleaving shows cause and effect — Vite rebuilds, then the browser crashes 1 second later.

### Level Mapping

| Source | Maps to |
|--------|---------|
| `console.error` | ERROR |
| `console.warn` | WARN |
| `console.log`, `console.info` | INFO |
| `console.debug` | DEBUG |
| Vite error lines (regex: `ERROR`, stack traces) | ERROR |
| Vite warning lines | WARN |
| Vite normal output | INFO |

The existing Output panel level filter works naturally — set to "Errors" to see both build and runtime errors together.

## Terminal Output Mirroring

When the dev server manager starts a dev server in a terminal:

1. `dev-server-manager.svelte.js` calls `terminalSpawn()` with the start command
2. **New:** Terminal spawn accepts an `output_channel` option
3. When set, the terminal PTY reader mirrors each stdout line to `OutputStore::push()` on the named project channel
4. Lines are tagged with the framework name (e.g., `[vite]`)

```rust
pub struct TerminalSpawnOptions {
    // ... existing fields
    output_channel: Option<String>,  // NEW: mirror output to this project channel
}
```

The dev-server-manager passes `output_channel: "my-discord-clone (Vite :5173)"` when starting the server. The terminal still works normally — mirroring is additive, not redirecting.

## Browser Console Capture

### WebView2 ConsoleApiCalled Hook

When a browser tab is created in `create_tab_webview()`, register a COM event handler:

```rust
// After webview is ready
webview.with_webview(move |platform_wv| {
    unsafe {
        let controller = platform_wv.controller();
        let core_wv = controller.CoreWebView2()?;

        let handler = ConsoleApiCalledEventHandler::create(Box::new(move |_, args| {
            let level = args.Level()?;      // Log, Warning, Error, Info, Debug
            let message = args.Message()?;   // Console message text
            let uri = args.Uri()?;           // Source URL (optional)
            let line = args.LineNumber()?;    // Source line (optional)

            // Route to project channel
            output_store.push_project(&channel_name, level, message, uri, line);
            Ok(())
        }));

        core_wv.add_ConsoleApiCalled(&handler, &mut token)?;
    }
});
```

### Linking Browser Tab to Project

The browser preview URL determines which project channel receives console output:
- URL is `localhost:5173` → dev-server-manager knows port 5173 = Project A → route to Project A's channel
- If no dev server match, route to the active workspace's channel
- Each browser tab gets its own listener; tabs pointing to the same project route to the same channel

### Console Object Serialization

Inject a small script into the preview webview that patches `console.*` methods to JSON-serialize complex objects before they hit the native ConsoleApiCalled handler:

```javascript
// Injected as initialization script
['log','warn','error','info','debug'].forEach(method => {
  const orig = console[method];
  console[method] = (...args) => {
    orig.apply(console, args.map(a =>
      typeof a === 'object' ? JSON.stringify(a, null, 2) : a
    ));
  };
});
```

This ensures Claude sees `{"user": "george", "data": [1,2,3]}` instead of `[object Object]`.

### Stack Trace Preservation

Multi-line stack traces are captured in full. The `LogEntry` message field stores the complete trace:

```
TypeError: messages.map is not a function
    at Chat.svelte:42:15
    at Array.forEach (<anonymous>)
    at renderMessages (Chat.svelte:38:5)
```

### Source Location

When available from ConsoleApiCalled args, source URL and line number are prepended to the message tag: `[console:error src/Chat.svelte:42]`. This helps Claude map runtime errors back to source files (Vite's source maps mean the browser often reports original file paths, not bundle paths).

### Browser Console Without Dev Server

If someone manually navigates the Lens preview to any URL (not a detected dev server), console output is still captured. The channel uses the workspace folder name without framework tag — e.g., `my-project`. This covers static HTML files or externally started servers.

### Don't Clear on Navigation

When the browser does a full page reload (not HMR), log history is preserved. Chronological context across reloads is valuable for debugging — mirrors Chrome DevTools' "Preserve log" behavior.

## Output Panel UI Changes

### Dropdown with Separator

The channel selector dropdown renders project channels above a visual separator, system channels below:

- Project channels listed first, sorted by most recently active
- System channels below separator, in fixed order
- On project switch (`project.svelte.js` change), auto-select the new project's channel
- Active channel marked with checkmark or highlight

### Error Badge

When a project channel receives an ERROR-level entry, show a red dot on the Output tab in the bottom panel tab strip. Same pattern as the Problems panel badge. Runtime errors are visible even when not viewing the Output panel.

### Channel Lifecycle

- **Created:** When dev server starts for a project, OR when browser console output arrives for a workspace with no dev server
- **Persists:** Channel stays alive even when switching to another project. Logs keep accumulating in the background.
- **Destroyed:** When dev server stops AND the project is no longer the active workspace. Or after idle timeout (e.g., 10 minutes with no new entries after server stop).

## MCP Exposure

### get_logs Tool Extension

The existing `get_logs` MCP tool extends naturally:

```
// List all channels (system + project) — existing summary mode
get_logs({})
→ returns channel summaries including project channels

// Query project channel logs
get_logs({ channel: "my-discord-clone (Vite :5173)", last: 50 })
→ returns last 50 entries (build + runtime interleaved)

// Filter to errors only
get_logs({ channel: "my-discord-clone (Vite :5173)", level: "ERROR", last: 20 })
→ returns build errors + runtime errors from the project
```

No new MCP tool needed. Channel name is a string — dynamic channels work with the same API.

**JSONL fallback** for terminal Claude: project channels write to `logs/current/project-{name}.jsonl`. Terminal Claude reads the same files via `LogFileWriter::read_channel()`.

## What This Enables

Claude now has full project debugging visibility:

| Capability | Source | Status |
|-----------|--------|--------|
| **Read/edit code** | File editor, MCP file tools | Already have |
| **See the product** | Browser screenshots via WebView2 | Already have |
| **Build errors** | Dev server terminal → project channel | **New** |
| **Runtime errors** | Browser console → project channel | **New** |
| **Query logs** | MCP `get_logs` tool | Extended |

This closes the debugging loop for ~95% of cases. The remaining gap (network request details) can be addressed later via WebView2's `add_WebResourceResponseReceived` if needed.

## Files to Modify

### Rust Backend
- `src-tauri/src/services/output.rs` — Add `ProjectChannel`, `HashMap` registry, `push_project()`, unified query API
- `src-tauri/src/commands/output.rs` — Extend `get_output_logs` to query project channels, add `register_project_channel` / `unregister_project_channel` commands
- `src-tauri/src/commands/lens.rs` — Add `ConsoleApiCalled` hook in `create_tab_webview()`
- `src-tauri/src/commands/terminal.rs` — Add `output_channel` option to terminal spawn, mirror stdout
- `src-tauri/src/lib.rs` — Register new commands

### Frontend
- `src/lib/stores/output.svelte.js` — Add `projectChannels` state, register/unregister, event routing
- `src/lib/stores/dev-server-manager.svelte.js` — Pass `output_channel` when spawning dev server terminal
- `src/components/lens/OutputPanel.svelte` (or TerminalTabs) — Dropdown separator, project channels above, error badge
- `src/lib/api.js` — New API wrappers for register/unregister project channel

### Tests
- `test/api/api-signatures.test.cjs` — Updated exports
- New test files for project channel registration, terminal mirroring, dropdown UI

### Docs
- `docs/source-of-truth/IDE-GAPS.md` — Update with new capability
