# Project-Aware MCP Server Configuration

**Date:** 2026-03-17
**Status:** Approved

## Problem

Voice Mirror currently manages only its own MCP server (`voice-mirror-mcp`). Users have other MCP servers configured globally (in `~/.claude/settings.json`) or per-project (in `.mcp.json`), but there's no way to control which servers are enabled for each workspace from within Voice Mirror. All third-party servers are invisible to the app.

## Solution

Discover MCP servers from both global and project-local config files, let users toggle them on/off per workspace, and write the effective config to `.mcp.json` when the CLI provider starts.

## Discovery

On demand (modal open, context menu open, or provider start), merge two sources:

1. **Global:** `~/.claude/settings.json` → `mcpServers` object
2. **Project-local:** `{workspace}/.mcp.json` → `mcpServers` object

**Deduplication:** By server name. Project-local wins over global (same precedence as Claude Code itself). Each discovered server carries a `source` label: `"global"` or `"project"`.

**Voice Mirror's own server** (`voice-mirror`) is always present and managed separately by the existing `write_mcp_config()` logic. It appears in the list but cannot be disabled.

### Avoiding circular reads

`write_mcp_config()` overwrites `{workspace}/.mcp.json` with the merged result (including `voice-mirror` and disabled entries). A subsequent discovery reading that file would see Voice Mirror's own output, not the user's original config.

**Solution:** During discovery of project-local `.mcp.json`, filter out:
- Any entry named `voice-mirror` (our own server — always managed separately)
- The `"disabled": true` field is **not** treated as a source-of-truth signal — discovery ignores it. The enabled/disabled state comes exclusively from Voice Mirror's config (`projectStore.entries[].mcpServers`). This means if a user manually adds `"disabled": true` to a server in `.mcp.json`, Voice Mirror will still show it as enabled (default) until the user explicitly disables it in the UI.

This keeps discovery idempotent: reading `.mcp.json` before or after Voice Mirror writes it yields the same server list (minus `voice-mirror`).

## Storage

### Source of truth: Voice Mirror config

Per-project MCP preferences stored in the project entry:

```json
{
  "projects": {
    "entries": [
      {
        "path": "E:\\Projects\\contextmirror.com",
        "name": "contextmirror.com",
        "color": "#3b82f6",
        "mcpServers": {
          "filesystem": { "enabled": true },
          "brave-search": { "enabled": false },
          "github": { "enabled": true }
        }
      }
    ]
  }
}
```

Servers not yet in the map default to **enabled** (matches Claude Code's default behavior — all servers active unless explicitly disabled).

### Effective config: `.mcp.json`

At CLI provider start, `write_mcp_config()` writes the effective `.mcp.json` to the workspace directory:

```json
{
  "mcpServers": {
    "voice-mirror": { "command": "...", "args": [...], "env": {...} },
    "filesystem": { "command": "...", "args": [...] },
    "github": { "command": "...", "args": [...] },
    "brave-search": { "command": "...", "args": [...], "disabled": true }
  }
}
```

- Enabled third-party servers: copied from their source config as-is
- Disabled third-party servers: copied with `"disabled": true` added
- `voice-mirror`: always included, managed by existing logic

## UI: Two Entry Points

Both entry points read/write the same data: `projectStore.entries[].mcpServers`.

### 1. Edit Project Modal (`EditProjectModal.svelte`)

New section below Color swatches:

```
MCP Servers
┌─────────────────────────────────────┐
│ [✓] voice-mirror          project   │
│ [✓] filesystem             global   │
│ [ ] brave-search           global   │
│ [✓] github                 global   │
└─────────────────────────────────────┘
```

- Checkbox rows: toggle + server name + source badge (muted text)
- `voice-mirror` row: always checked, checkbox disabled (cannot disable own server)
- Fetched on modal open via `discover_mcp_servers(project.path)` Tauri command
- Changes saved alongside name/color/icon on "Save"
- Loading state while discovery runs (brief spinner or skeleton)

### 2. Terminal Context Menu (`TerminalTabs.svelte`)

New menu item in the right-click menu:

```
Right-click Voice Agent tab:
├── Clear
├── ─────────────
├── CLI Agents
│   ├── Claude Code       → workspace picker
│   └── OpenCode          → workspace picker
├── Configure MCP Servers...  → submenu
├── ─────────────
├── Local LLM Servers
│   ...
```

Submenu contents:

```
┌───────────────────────────────┐
│ ✓ voice-mirror     (project)  │
│ ✓ filesystem        (global)  │
│   brave-search      (global)  │
│ ✓ github            (global)  │
│ ──────────────────────────────│
│ ↻ Refresh                     │
└───────────────────────────────┘
```

- Checkmarks toggle on click — custom HTML submenu (not native), stays open for multi-toggle
- `voice-mirror` shows checkmark but click is no-op
- "Refresh" re-runs discovery (re-reads both config files)
- Applies to the currently active workspace
- Only visible when a workspace is selected (active project exists)
- Changes persist immediately to Voice Mirror config (no separate save step)

## Backend Changes

### New Tauri command: `discover_mcp_servers`

```rust
#[tauri::command]
pub async fn discover_mcp_servers(
    workspace_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveredMcpServer>, String>
```

Returns:
```rust
pub struct DiscoveredMcpServer {
    pub name: String,
    pub source: String,        // "global" | "project"
    pub is_own: bool,          // true for "voice-mirror"
    pub enabled: bool,         // from project preferences (default: true)
    pub config: serde_json::Value,  // raw server config for write-through
}
```

The backend resolves `enabled` by looking up the project's `mcpServers` preferences. This avoids duplicating "default to enabled" logic in both Rust and JS — the frontend can use the `enabled` field directly for checkbox state.

Logic:
1. Read `~/.claude/settings.json` → extract `mcpServers` keys → tag as `"global"`
2. Read `{workspace_path}/.mcp.json` → extract `mcpServers` keys → tag as `"project"`
3. Merge: project-local wins on name collision
4. Tag `voice-mirror` as `is_own: true`
5. Return sorted by name

### Extend `write_mcp_config()`

Current signature adds Voice Mirror's own server to `.mcp.json`. Extended to also:

1. Call discovery to get all servers (global + project-local, filtering out `voice-mirror`)
2. Read project's `mcpServers` preferences from Voice Mirror config
3. For each discovered server:
   - If enabled (or not in preferences → default enabled): include config as-is
   - If disabled: include config with `"disabled": true`
4. Write merged result to `{workspace}/.mcp.json`

**CWD override:** When `cwd_override` differs from `project_root`, the CWD `.mcp.json` gets the same merged content. The project's MCP preferences (based on the active workspace) apply to both locations.

**OpenCode:** Out of scope for this feature. OpenCode's config (`~/.config/opencode/opencode.json`) continues to receive only the `voice-mirror` server entry. Third-party server management for OpenCode can be added later if needed.

**Claude MCP trust:** The existing `ensure_claude_mcp_trust()` writes `enableAllProjectMcpServers: true` to `settings.local.json`, which already covers all servers in `.mcp.json` — no additional trust entries needed for third-party servers.

### Extend config schema

In `src-tauri/src/config/schema.rs`, add `default_mcp_servers` to `ProjectsConfig` and `mcp_servers` to `ProjectEntry`:

```rust
// Note: ProjectEntry uses #[serde(rename_all = "camelCase")]
// so mcp_servers serializes as "mcpServers" in JSON
pub struct ProjectEntry {
    pub path: String,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub mcp_servers: Option<HashMap<String, McpServerPref>>,
    // ... existing fields
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpServerPref {
    pub enabled: bool,
}
```

## Frontend Changes

### `project.svelte.js`

New method:
```javascript
setMcpServer(projectPath, serverName, enabled) {
  // Update entries[].mcpServers map
  // Persist via updateConfig()
}

getMcpServers(projectPath) {
  // Return entries[].mcpServers || {}
}
```

### `EditProjectModal.svelte`

- Import `invoke` from Tauri
- On mount: call `discover_mcp_servers(entry.path)` → populate server list
- Render checkbox list below Color section
- On save: persist toggled servers via `projectStore.setMcpServer()`

### `TerminalTabs.svelte`

- New context menu step: `'mcp-servers'`
- "Configure MCP Servers..." item triggers discovery and shows submenu
- Toggle clicks call `projectStore.setMcpServer()` immediately

## Data Flow

```
User toggles server (either UI)
  → projectStore.setMcpServer(path, name, enabled)
  → updateConfig() persists to Voice Mirror config
  → takes effect on next CLI provider start (no live reload — user must restart provider)

CLI provider starts (Claude Code / OpenCode)
  → write_mcp_config() runs:
    1. Discover all servers (global + project-local)
    2. Read project's mcpServers preferences
    3. Merge: enabled servers included, disabled get "disabled": true
    4. Write effective .mcp.json to workspace
  → CLI spawns, reads .mcp.json, connects to enabled servers
```

## Default Workspace

"Voice Mirror (default)" is the app's project root, not a user-added project entry. It still needs MCP preferences. Store these under a dedicated key in Voice Mirror config:

```json
{
  "projects": {
    "defaultMcpServers": {
      "filesystem": { "enabled": true },
      "brave-search": { "enabled": false }
    },
    "entries": [...]
  }
}
```

The backend resolves preferences by: if workspace path matches project root → use `projects.defaultMcpServers`, otherwise → look up the matching `entries[].mcpServers`. The context menu and Edit Project modal both work the same way regardless of which workspace is active.

## Edge Cases

- **No workspace selected:** "Configure MCP Servers..." hidden in context menu; modal MCP section shows nothing
- **Config file missing:** Discovery returns empty list for that source (not an error)
- **Config file malformed:** Log warning, skip that source, return servers from the other
- **Server removed from global config:** Stale preference in Voice Mirror config is harmless — unknown servers in preferences are ignored during write
- **Race condition:** Discovery reads files at a point in time; "Refresh" re-reads. No file watching needed.

## Files to Create/Modify

| File | Change |
|------|--------|
| `src-tauri/src/config/schema.rs` | Add `mcp_servers` to `ProjectEntry`, add `McpServerPref` struct |
| `src-tauri/src/providers/cli/mcp_config.rs` | Add `discover_mcp_servers()`, extend `write_mcp_config()` |
| `src-tauri/src/commands/` | New command `discover_mcp_servers` (or add to existing commands file) |
| `src/lib/stores/project.svelte.js` | Add `setMcpServer()`, `getMcpServers()` |
| `src/components/sidebar/EditProjectModal.svelte` | MCP Servers section with checkboxes |
| `src/components/terminal/TerminalTabs.svelte` | "Configure MCP Servers..." menu item + submenu |
| `src/lib/api.js` | Add `discoverMcpServers(path)` wrapper |
