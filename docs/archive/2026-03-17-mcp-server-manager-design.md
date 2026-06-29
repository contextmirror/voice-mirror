# MCP Server Manager — Settings Page

**Date:** 2026-03-17
**Status:** Approved

## Problem

Users manage MCP servers by manually editing JSON config files (`~/.claude/settings.json` for global, `.mcp.json` for project-scoped). There's no UI to see all servers, add/edit/delete them, or verify they work. The per-project toggles we built only control enable/disable — they can't create or modify server configurations.

## Solution

A dedicated "MCP Servers" tab in the Settings page with full CRUD management: list all discovered servers, add new ones (choosing global or project scope), edit configs, delete entries, and test connections via a real MCP handshake.

## Server List

New tab in Settings, using the same card-row pattern as the Dependencies tab.

```
MCP SERVERS                                        [+ Add Server]
┌──────────────────────────────────────────────────────────────────┐
│ filesystem          npx @anthropic/...       global       [⋮]   │
│ brave-search        brave-search-mc...       global       [⋮]   │
│ github              docker run ghcr...       global       [⋮]   │
│ my-tools            /home/me/tools/...   project: myapp   [⋮]   │
└──────────────────────────────────────────────────────────────────┘
```

Each row shows:
- **Name** — server identifier
- **Command** — truncated command string
- **Scope badge** — `global` or `project: {name}` with muted styling
- **Overflow menu** `[⋮]` — Edit, Test Connection, Delete

Server list populated via the existing `discover_mcp_servers` Tauri command (reads both `~/.claude/settings.json` and `{workspace}/.mcp.json`, deduplicates, sorts by name). The `voice-mirror` entry is hidden from this list (it's managed automatically).

Empty state: "No MCP servers configured. Click + Add Server to get started."

## Add/Edit Modal

Overlay modal matching the existing Edit Project modal pattern:

```
┌─ Add MCP Server ─────────────────────────────┐
│                                               │
│ Name           [filesystem                 ]  │
│ Command        [npx                        ]  │
│ Args           [-y @anthropic/mcp-fs       ]  │
│ Env Vars       [+ Add Variable]               │
│   HOME = /home/user              [×]          │
│   API_KEY = sk-...               [×]          │
│ Scope          [Global               ▾]       │
│                                               │
│                [Cancel]  [Test]  [Save]        │
└───────────────────────────────────────────────┘
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text input | Yes | Alphanumeric + hyphens only. Validated for uniqueness within target scope. |
| Command | Text input | Yes | The executable (e.g., `npx`, `docker`, `/usr/local/bin/mcp-server`) |
| Args | Textarea | No | One argument per line. Stored as JSON array. Preserves args with spaces. |
| Env Vars | Dynamic key/value rows | No | Add/remove buttons. Each row: key input + value input + delete button. |
| Scope | Dropdown | Yes | "Global" or each project entry by name. |

### Behaviors

- **Add mode:** All fields empty. Scope defaults to "Global".
- **Edit mode:** Fields pre-filled from existing config. Scope is **read-only** (displayed but not changeable — to move a server between scopes, delete and re-add).
- **Name validation:** On save, check if name already exists in the target scope's config file. Show inline error if duplicate.
- **Test button:** Runs `mcp_test_connection` with current form values. Shows result inline below the button: green "Connected — N tools available" or red error message. Does not block saving.
- **Save button:** Writes to config file, closes modal, refreshes server list.

## Test Connection

A Tauri command that performs a real MCP protocol handshake:

1. Spawn the server process with the provided command, args, and env vars
2. Send `initialize` JSON-RPC request via stdin
3. Read `initialize` response from stdout
4. Send `initialized` JSON-RPC notification (required by MCP protocol before any other requests)
5. Send `tools/list` JSON-RPC request
6. Read response, extract tool count
7. Kill the process
8. Return result

**Timeout:** 5 seconds. If the server doesn't respond, return a timeout error.

**Result format:**
```rust
pub struct McpTestResult {
    pub success: bool,
    pub tool_count: Option<u32>,     // number of tools if successful
    pub server_name: Option<String>, // server's reported name
    pub error: Option<String>,       // error message if failed
}
```

**Error cases:**
- Command not found: "Command not found: {command}"
- Process crashed: "Server exited with code {N}: {stderr}"
- Invalid response: "Invalid MCP response: expected JSON-RPC"
- Timeout: "Server did not respond within 5 seconds"
- Protocol error: "MCP handshake failed: {details}"

## Write Operations

### Scope Resolution

The `scope` field in write/delete commands is either `"global"` or an absolute project path (e.g., `E:\Projects\myapp`). The frontend resolves this from `projectStore.entries[i].path` when the user selects a project in the scope dropdown.

- **Global** → writes to `~/.claude/settings.json` → `mcpServers` object
- **Project path** → writes to `{path}/.mcp.json` → `mcpServers` object

### Interaction with `write_mcp_config`

`write_mcp_config()` rewrites the entire `.mcp.json` on every CLI provider start, merging voice-mirror + all discovered servers. This means project-scoped `.mcp.json` entries survive because:

1. `discover_mcp_servers_impl` reads `.mcp.json` and collects all non-voice-mirror entries
2. `write_mcp_config` writes them back (with enable/disable applied)

So the cycle is: user adds server to `.mcp.json` → discovery finds it → `write_mcp_config` includes it in the next write. **This is safe.** The only risk is if the user adds a server and immediately starts the provider before the write completes — but file writes are synchronous and fast.

Global servers in `~/.claude/settings.json` are never overwritten by `write_mcp_config` (it only writes to `.mcp.json`). Claude Code reads `settings.json` directly as a global config source.

**After write/delete:** The Settings UI calls `discover_mcp_servers` to refresh the list. No need to restart the running provider — the `.mcp.json` will be regenerated on next provider start with the updated servers.

### Add Server (`mcp_write_server`)

1. Determine target file based on scope
2. Read existing file (or start with `{}` / `{ "mcpServers": {} }`)
3. Check name doesn't already exist in that file
4. Insert the new entry:
   ```json
   {
     "command": "npx",
     "args": ["-y", "@anthropic/mcp-fs"],
     "env": { "HOME": "/home/user" }
   }
   ```
5. Write back with pretty-print
6. Return success

### Edit Server (`mcp_write_server` — same command, upsert behavior)

Same as add, but the name already exists. Overwrites the entry with the new config. Only the specific server entry is modified — all other entries in the file remain untouched.

### Delete Server (`mcp_delete_server`)

1. Determine target file based on scope
2. Read file, parse JSON
3. Remove the named entry from `mcpServers`
4. Write back with pretty-print
5. Return success

**Confirmation:** Frontend shows a confirmation dialog before calling delete: "Delete '{name}' from {scope} config?"

### Error Handling

- **File doesn't exist (add):** Create it. For `.mcp.json`: `{ "mcpServers": { ... } }`. For `settings.json`: read existing or create with `{ "mcpServers": { ... } }`.
- **File malformed:** Return error. Do not overwrite a file that can't be parsed — the user may have comments or structure we don't understand. Show toast: "Could not parse {file}. Please fix it manually."
- **Permission denied:** Return error with path.

## Backend Commands

Three new Tauri commands in a new `src-tauri/src/commands/mcp.rs` module:

### `mcp_test_connection`

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestParams {
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
}

#[tauri::command]
pub async fn mcp_test_connection(params: McpTestParams) -> IpcResponse
```

### `mcp_write_server`

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpWriteParams {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
    pub scope: String,          // "global" or a project path
}

#[tauri::command]
pub fn mcp_write_server(params: McpWriteParams) -> IpcResponse
```

### `mcp_delete_server`

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDeleteParams {
    pub name: String,
    pub scope: String,          // "global" or a project path
}

#[tauri::command]
pub fn mcp_delete_server(params: McpDeleteParams) -> IpcResponse
```

## Frontend Components

### `McpServerSettings.svelte`

New settings tab component registered in `SettingsPanel.svelte` as the 6th tab (after "AI & Tools").

Responsibilities:
- Call `discoverMcpServers` on mount to populate the list
- Render server rows with name, command preview, scope badge, overflow menu
- Handle Add button → open `McpServerModal` in add mode
- Handle Edit → open modal in edit mode with pre-filled data
- Handle Test → call `mcp_test_connection`, show toast with result
- Handle Delete → confirmation dialog → call `mcp_delete_server` → refresh list

### `McpServerModal.svelte`

Add/Edit modal component.

Props:
- `mode`: `'add'` | `'edit'`
- `server`: existing server data (for edit mode, null for add)
- `projects`: list of project entries (for scope dropdown)
- `onClose`: callback
- `onSave`: callback (triggers list refresh in parent)

State:
- Form fields: name, command, args, envVars array, scope
- testResult: null | { success, toolCount, error }
- testing: boolean (loading state)
- saving: boolean

### Tab Registration

In `SettingsPanel.svelte`, add between "AI & Tools" and "Appearance" (or after "AI & Tools"):

```javascript
{ id: 'mcp', label: 'MCP Servers', component: McpServerSettings }
```

Placed after "AI & Tools" as the 3rd tab. Always visible (not feature-flagged — MCP management is a core user-facing feature, unlike the Dependencies tab which is developer-oriented).

Tab order becomes: General, AI & Tools, **MCP Servers**, Voice & Audio, Appearance, Dependencies.

## API Wrappers

In `src/lib/api.js`:

```javascript
export async function mcpTestConnection(command, args, env) {
  return invoke('mcp_test_connection', { params: { command, args, env: env || null } });
}

export async function mcpWriteServer(name, command, args, env, scope) {
  return invoke('mcp_write_server', { params: { name, command, args, env: env || null, scope } });
}

export async function mcpDeleteServer(name, scope) {
  return invoke('mcp_delete_server', { params: { name, scope } });
}
```

## Data Flow

```
Settings → MCP Servers tab opens
  → discoverMcpServers(activeProject.path, prefs)
  → filter out voice-mirror
  → render server list

User clicks [+ Add Server]
  → McpServerModal opens (add mode)
  → User fills form
  → [Test]: mcpTestConnection(command, args, env) → inline result
  → [Save]: mcpWriteServer(name, command, args, env, scope)
    → re-discover → list updates

User clicks [⋮] → Edit
  → McpServerModal opens (edit mode, pre-filled)
  → same flow as add

User clicks [⋮] → Test Connection
  → mcpTestConnection(command, args, env) → toast result

User clicks [⋮] → Delete
  → Confirmation dialog: "Delete '{name}' from {scope} config?"
  → mcpDeleteServer(name, scope) → re-discover → list updates
```

## Edge Cases

- **Duplicate name on add:** Validate before write. Show inline error "Server '{name}' already exists in {scope}".
- **Config file doesn't exist:** Create it with the new entry.
- **Config file malformed:** Show error toast, don't overwrite.
- **Test timeout:** 5s limit. Show "Server did not respond within 5 seconds".
- **No projects added:** Scope dropdown only shows "Global".
- **Server command is relative path:** Pass through as-is. The shell/OS resolves it. Test connection will catch if it doesn't work.
- **Env vars with empty keys:** Strip empty key/value rows before saving.
- **Long command strings:** Truncate in list view with ellipsis, show full in modal.
- **Concurrent edits:** Read-modify-write is not atomic. Unlikely to matter for a desktop app with single user, but log a warning if file changed between read and write.

## Files to Create/Modify

| File | Change |
|------|--------|
| `src-tauri/src/commands/mcp.rs` | New: `mcp_test_connection`, `mcp_write_server`, `mcp_delete_server` |
| `src-tauri/src/commands/mod.rs` | Add `pub mod mcp;` |
| `src-tauri/src/lib.rs` | Register 3 new commands |
| `src/lib/api.js` | Add 3 API wrappers |
| `src/components/settings/McpServerSettings.svelte` | New: server list tab |
| `src/components/settings/McpServerModal.svelte` | New: add/edit modal |
| `src/components/settings/SettingsPanel.svelte` | Register MCP Servers tab |
| `src/styles/settings.css` | Styles for server rows, badges, modal |
