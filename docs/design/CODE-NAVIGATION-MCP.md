# Code Navigation MCP — Design Doc

> Internal design doc. A new MCP tool group that lets the AI control the Lens workspace — open files, show diffs, switch projects, navigate to symbols. Voice-first IDE features that no other editor has.

---

## Why This Matters

Today, Claude Code runs in a terminal panel inside Lens. It can edit files, run commands, search code — but it has **zero awareness of the IDE**. It doesn't know:

- What project is open
- Which files are in tabs
- Whether you're looking at a diff or the editor
- What line you're on

And it can't **act** on the IDE:

- It can't open a file for you to review
- It can't show you a diff
- It can't switch projects

This creates a disconnect. The AI works in the terminal. The user works in the editor. They don't talk to each other.

**Code Navigation MCP bridges that gap.** The AI becomes a first-class citizen of the IDE. Voice commands like "show me what changed" or "open the auth module" translate directly into IDE actions — no clicking, no typing, just intent.

**This is the feature that makes Voice Mirror an IDE that only makes sense if voice and AI exist.**

---

## Architecture

The communication path already exists. We just add new message types:

```
User (voice) → Claude Code → MCP tool call → voice-mirror-mcp
                                                    ↓
                                              Named pipe IPC
                                                    ↓
                                              Tauri app (pipe_server.rs)
                                                    ↓
                                              Tauri event emission
                                                    ↓
                                              LensWorkspace.svelte
                                                    ↓
                                              tabsStore / projectStore / etc.
```

This follows the exact same pattern as browser tools: MCP sends a request over the pipe, Tauri dispatches it, the frontend reacts.

---

## Tool Group Definition

**Group:** `code-nav`
**Always loaded:** No (loaded when Lens workspace is active)
**Keywords:** `["open", "file", "editor", "project", "diff", "navigate", "tab", "workspace"]`

### Tools (8 tools)

#### 1. `workspace_info` — Get Current Workspace State

Returns what the user is currently looking at.

```json
{
  "name": "workspace_info",
  "description": "Get the current workspace state — active project, open tabs, active file, and cursor position. Call this first to understand what the user is working on before taking action.",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response example:**
```json
{
  "project": {
    "path": "E:\\Projects\\Voice Mirror",
    "name": "Voice Mirror",
    "index": 0
  },
  "tabs": [
    { "id": "src/lib/api.js", "type": "file", "title": "api.js", "dirty": false, "active": true },
    { "id": "diff:src/lib/stores/config.svelte.js", "type": "diff", "title": "config.svelte.js", "dirty": false, "active": false },
    { "id": "browser", "type": "browser", "title": "localhost:1420", "active": false }
  ],
  "activeFile": {
    "path": "src/lib/api.js",
    "line": 142,
    "dirty": false
  },
  "mode": "lens"
}
```

**Why it matters:** Before opening files or showing diffs, the AI should know what's already open. Avoids opening duplicate tabs or switching away from something the user is actively editing.

---

#### 2. `open_file` — Open a File in the Editor

Opens a file in the Lens editor tab bar. If the file is already open, switches to it.

```json
{
  "name": "open_file",
  "description": "Open a file in the Lens editor. Optionally navigate to a specific line and column. If the file is already open in a tab, switches to it.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path, relative to project root or absolute"
      },
      "line": {
        "type": "integer",
        "description": "Line number to jump to (1-based, optional)"
      },
      "column": {
        "type": "integer",
        "description": "Column number to jump to (1-based, optional)"
      },
      "pin": {
        "type": "boolean",
        "description": "If true, pin the tab (won't be replaced by next preview). Default: false"
      }
    },
    "required": ["path"]
  }
}
```

**Voice example:** "Open the config store, line 50" → `open_file({ path: "src/lib/stores/config.svelte.js", line: 50 })`

---

#### 3. `open_diff` — Show Git Diff for a File

Opens the diff viewer for a file, comparing the working copy against the git HEAD version.

```json
{
  "name": "open_diff",
  "description": "Open the diff viewer for a file, showing changes between the working copy and git HEAD. Shows additions, deletions, and modifications with chunk navigation.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path, relative to project root or absolute"
      }
    },
    "required": ["path"]
  }
}
```

**Voice example:** "Show me what changed in the tab store" → `open_diff({ path: "src/lib/stores/tabs.svelte.js" })`

---

#### 4. `compare_files` — Diff Two Arbitrary Files

Opens a diff view comparing any two files — not just git changes. Useful for comparing implementations, reviewing before/after, or diffing across branches.

```json
{
  "name": "compare_files",
  "description": "Open a diff view comparing two files side by side. Use for comparing implementations, reviewing alternatives, or diffing arbitrary files.",
  "input_schema": {
    "type": "object",
    "properties": {
      "left": {
        "type": "string",
        "description": "Path to the left (original) file"
      },
      "right": {
        "type": "string",
        "description": "Path to the right (modified) file"
      },
      "label": {
        "type": "string",
        "description": "Optional label for the diff tab (default: 'left vs right')"
      }
    },
    "required": ["left", "right"]
  }
}
```

**Voice example:** "Compare the old auth module with the new one" → `compare_files({ left: "src/auth.old.js", right: "src/auth.js" })`

---

#### 5. `close_file` — Close a Tab

Closes a file tab. If the file has unsaved changes, returns an error (won't force-close dirty tabs).

```json
{
  "name": "close_file",
  "description": "Close a file tab in the editor. Refuses to close tabs with unsaved changes — save first or use force.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path of the tab to close"
      },
      "force": {
        "type": "boolean",
        "description": "If true, close even with unsaved changes. Default: false"
      }
    },
    "required": ["path"]
  }
}
```

---

#### 6. `open_project` — Switch or Open a Project

Switches to a different project in the project strip, or opens a new project by path.

```json
{
  "name": "open_project",
  "description": "Switch to a project by name or index, or open a new project folder by path. Triggers file tree refresh and LSP restart.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to the project folder (opens new if not already in project list)"
      },
      "name": {
        "type": "string",
        "description": "Project name to switch to (if already in project list)"
      },
      "index": {
        "type": "integer",
        "description": "Project index to switch to (0-based)"
      }
    },
    "required": []
  }
}
```

**Voice example:** "Switch to the ghostty-web project" → `open_project({ name: "ghostty-web" })`

---

#### 7. `get_open_files` — List Open Tabs with Details

Returns detailed information about every open tab, including dirty state, file size, and type.

```json
{
  "name": "get_open_files",
  "description": "List all open editor tabs with their state — dirty (unsaved changes), active, file type, and preview status.",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response example:**
```json
{
  "tabs": [
    {
      "path": "src/lib/api.js",
      "title": "api.js",
      "type": "file",
      "dirty": true,
      "active": true,
      "preview": false,
      "language": "javascript"
    },
    {
      "path": "src/components/lens/FileEditor.svelte",
      "title": "FileEditor.svelte",
      "type": "file",
      "dirty": false,
      "active": false,
      "preview": true,
      "language": "svelte"
    }
  ],
  "count": 2,
  "dirtyCount": 1
}
```

---

#### 8. `navigate_to_symbol` — Jump to a Symbol by Name

Uses LSP document symbols to find and navigate to a function, class, or variable by name. Searches the active file first, then falls back to workspace-wide symbol search.

```json
{
  "name": "navigate_to_symbol",
  "description": "Navigate to a symbol (function, class, variable) by name. Searches the active file first, then the workspace. Opens the file and jumps to the symbol's definition.",
  "input_schema": {
    "type": "object",
    "properties": {
      "symbol": {
        "type": "string",
        "description": "Symbol name to find (e.g., 'handleSave', 'McpClient', 'DEFAULT_CONFIG')"
      },
      "file": {
        "type": "string",
        "description": "Optional: specific file to search in (default: active file, then workspace)"
      }
    },
    "required": ["symbol"]
  }
}
```

**Voice example:** "Go to the handleSave function" → `navigate_to_symbol({ symbol: "handleSave" })`

---

## IPC Protocol Changes

### New `McpToApp` variants

Add to `src-tauri/src/ipc/protocol.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpToApp {
    // ... existing variants ...

    /// Request workspace state (tabs, project, active file)
    WorkspaceInfoRequest {
        request_id: String,
    },

    /// Open a file in the editor
    OpenFile {
        request_id: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        line: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        column: Option<u32>,
        #[serde(default)]
        pin: bool,
    },

    /// Open diff viewer for a file
    OpenDiff {
        request_id: String,
        path: String,
    },

    /// Compare two files
    CompareFiles {
        request_id: String,
        left: String,
        right: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },

    /// Close a file tab
    CloseFile {
        request_id: String,
        path: String,
        #[serde(default)]
        force: bool,
    },

    /// Switch or open a project
    OpenProject {
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        index: Option<usize>,
    },
}
```

### New `AppToMcp` variant

```rust
pub enum AppToMcp {
    // ... existing variants ...

    /// Response to workspace / navigation requests
    NavigationResponse {
        request_id: String,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}
```

This mirrors the `BrowserResponse` pattern — same request/response flow with `request_id` routing.

---

## Pipe Router Changes

The `PipeRouter` (`src-tauri/src/mcp/pipe_router.rs`) already handles concurrent routing with oneshot channels. Navigation requests use the **same pattern as browser requests**:

1. MCP handler calls `pipe_router.send_and_wait(McpToApp::OpenFile { ... })`
2. Router assigns `request_id`, sends over pipe, registers oneshot waiter
3. Tauri pipe server receives message, dispatches to frontend via event
4. Frontend performs action, sends result back via Tauri command
5. Tauri sends `AppToMcp::NavigationResponse` over pipe
6. Router delivers to waiting oneshot → handler gets result

---

## Frontend Integration

### Tauri Event Listeners (LensWorkspace.svelte)

```svelte
<script>
  import { listen } from '@tauri-apps/api/event';

  // Listen for MCP navigation requests
  $effect(() => {
    const unlisteners = [];

    listen('mcp-open-file', ({ payload }) => {
      const { path, line, column, pin, requestId } = payload;
      const name = path.split(/[\\/]/).pop();
      tabsStore.openFile({ name, path });
      if (pin) tabsStore.pinTab(path);
      // TODO: signal FileEditor to goto line/column
      // Send success back to Tauri
      invoke('mcp_navigation_response', { requestId, success: true });
    }).then(u => unlisteners.push(u));

    listen('mcp-open-diff', ({ payload }) => {
      const { path, requestId } = payload;
      tabsStore.openDiff(path);
      invoke('mcp_navigation_response', { requestId, success: true });
    }).then(u => unlisteners.push(u));

    listen('mcp-workspace-info', ({ payload }) => {
      const { requestId } = payload;
      const info = {
        project: projectStore.activeProject,
        tabs: tabsStore.tabs,
        activeFile: tabsStore.activeTab,
        mode: configStore.value?.sidebar?.mode || 'mirror',
      };
      invoke('mcp_navigation_response', { requestId, success: true, result: info });
    }).then(u => unlisteners.push(u));

    return () => unlisteners.forEach(u => u());
  });
</script>
```

### FileEditor Goto Support

FileEditor needs to accept a "goto" signal when a file is opened with a line number:

```svelte
// In FileEditor.svelte — listen for goto events after tab becomes active
$effect(() => {
  if (!editorView) return;
  const handler = (e) => {
    const { line, column } = e.detail;
    const lineInfo = editorView.state.doc.line(line);
    const pos = lineInfo.from + (column || 0);
    editorView.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    editorView.focus();
  };
  window.addEventListener('lens-goto-position', handler);
  return () => window.removeEventListener('lens-goto-position', handler);
});
```

---

## Handler Implementation

### New file: `src-tauri/src/mcp/handlers/code_nav.rs`

```rust
use serde_json::Value;
use crate::mcp::pipe_router::PipeRouter;
use crate::mcp::tools::McpToolResult;

pub async fn handle_workspace_info(
    _args: &Value,
    router: &PipeRouter,
) -> McpToolResult {
    match router.send_and_wait(McpToApp::WorkspaceInfoRequest {
        request_id: String::new(), // router fills this
    }).await {
        Ok(response) => McpToolResult::text(
            serde_json::to_string_pretty(&response.result).unwrap_or_default()
        ),
        Err(e) => McpToolResult::error(format!("Failed to get workspace info: {e}")),
    }
}

pub async fn handle_open_file(
    args: &Value,
    router: &PipeRouter,
) -> McpToolResult {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return McpToolResult::error("Missing required field: path"),
    };
    let line = args.get("line").and_then(|v| v.as_u64()).map(|n| n as u32);
    let column = args.get("column").and_then(|v| v.as_u64()).map(|n| n as u32);
    let pin = args.get("pin").and_then(|v| v.as_bool()).unwrap_or(false);

    match router.send_and_wait(McpToApp::OpenFile {
        request_id: String::new(),
        path: path.clone(),
        line,
        column,
        pin,
    }).await {
        Ok(_) => {
            let mut msg = format!("Opened {path} in the editor");
            if let Some(l) = line {
                msg.push_str(&format!(" at line {l}"));
            }
            McpToolResult::text(msg)
        },
        Err(e) => McpToolResult::error(format!("Failed to open file: {e}")),
    }
}

// ... similar pattern for open_diff, compare_files, close_file, open_project
```

---

## Voice Interaction Examples

These scenarios show why this group is transformative for voice-driven development:

### Code Review Flow
```
User: "What changed since my last commit?"

Claude:
  1. workspace_info() → learns project is Voice Mirror
  2. Runs `git diff --name-only` in terminal → gets list of changed files
  3. open_diff({ path: "src/lib/stores/tabs.svelte.js" }) → diff opens in Lens
  4. "I've opened the diff for tabs.svelte.js — you added a moveTab method
      and fixed the close logic. The other changed file is config.svelte.js,
      want me to open that diff next?"
```

### Onboarding Flow
```
User: "Walk me through the MCP architecture"

Claude:
  1. workspace_info() → confirms project root
  2. open_file({ path: "src-tauri/src/mcp/server.rs", line: 1 }) → opens server
  3. "This is the MCP server entry point. It handles JSON-RPC over stdio.
      The key function is route_tool_call at line 85 — let me take you there."
  4. open_file({ path: "src-tauri/src/mcp/server.rs", line: 85 })
  5. "This dispatches tool calls to handlers. Let me show you the tool registry."
  6. open_file({ path: "src-tauri/src/mcp/tools.rs", line: 441 })
```

### Multi-File Refactor
```
User: "Rename the config store's updateConfig to patchConfig everywhere"

Claude:
  1. workspace_info() → gets project info
  2. Uses LSP rename (already available) to do the rename
  3. get_open_files() → sees which files were affected
  4. open_file({ path: "src/lib/stores/config.svelte.js", line: 45 })
  5. "Done. I renamed updateConfig to patchConfig across 12 files.
      I've opened the main store file so you can verify the change.
      Want me to walk through the other affected files?"
```

### Project Switching
```
User: "Switch to the ghostty-web project"

Claude:
  1. open_project({ name: "ghostty-web" })
  2. "Switched to ghostty-web. What would you like to work on?"
```

---

## File Changes Summary

| File | Change | Phase |
|------|--------|-------|
| `src-tauri/src/mcp/handlers/code_nav.rs` | **NEW** — 8 handler functions | 1 |
| `src-tauri/src/mcp/handlers/mod.rs` | Register `code_nav` module | 1 |
| `src-tauri/src/mcp/tools.rs` | Add `code-nav` group (8 tools) | 1 |
| `src-tauri/src/mcp/server.rs` | Route 8 new tool calls to handlers | 1 |
| `src-tauri/src/ipc/protocol.rs` | Add 6 new `McpToApp` variants + 1 `AppToMcp` | 2 |
| `src-tauri/src/ipc/pipe_server.rs` | Dispatch new message types, emit Tauri events | 2 |
| `src/components/lens/LensWorkspace.svelte` | Listen for `mcp-*` events, call stores | 3 |
| `src/components/lens/FileEditor.svelte` | Handle `lens-goto-position` event | 3 |
| `src/lib/stores/tabs.svelte.js` | Add `openDiff()` if not already present | 3 |
| `src-tauri/src/commands/mcp.rs` | Add `mcp_navigation_response` command | 2 |

### Tests

| File | Type |
|------|------|
| `test/stores/tabs.test.cjs` | Update — assert openDiff exists |
| `test/components/lens-workspace.test.cjs` | Update — assert mcp event listeners |
| `test/components/file-editor.test.cjs` | Update — assert goto-position listener |

---

## Implementation Order

1. **IPC protocol** — Add message types to `protocol.rs`
2. **Pipe server dispatch** — Route new messages, emit events
3. **MCP handler** — `code_nav.rs` with all 8 handlers
4. **Tool group** — Register in `tools.rs`, route in `server.rs`
5. **Frontend listeners** — LensWorkspace + FileEditor event handling
6. **Navigation response command** — Tauri command for frontend → backend response
7. **Tests** — Structural tests for all new code
8. **`npm test`** + manual verification

---

## Why Not Tauri Commands?

Alternative: skip the pipe and use Tauri commands directly (like `open_file` → `invoke('open_file_in_editor', { path })`).

**Problem:** The MCP binary is a separate process. It can't call Tauri commands — those are only available from the webview (frontend JS). The MCP binary communicates exclusively via the named pipe. So the pipe route is the only viable architecture.

The frontend **can** call Tauri commands to send responses back — that's how `BrowserResponse` already works.

---

## Future Extensions

Once the base group works, natural additions:

- **`show_terminal`** — Switch to a specific terminal tab or spawn a new one
- **`run_command`** — Open a shell tab, run a command, return output
- **`show_preview`** — Open the browser preview with a URL
- **`toggle_panel`** — Show/hide chat, terminal, file tree panels
- **`get_diagnostics`** — Return LSP errors/warnings for a file or project
- **`search_files`** — Project-wide text search, return results (pairs with global search when built)

These turn the AI into a full IDE controller — not just a code generator, but an interactive coding partner that can orchestrate the entire development environment by voice.
