# Project-Aware MCP Server Configuration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users discover and toggle MCP servers per workspace, with the effective config written to `.mcp.json` on CLI provider start.

**Architecture:** Discovery reads `~/.claude/settings.json` (global) and `{workspace}/.mcp.json` (project-local), deduplicates by name (project wins), and merges with per-project enable/disable preferences stored in Voice Mirror's config. Two UI entry points: Edit Project modal and terminal context menu.

**Tech Stack:** Rust (Tauri commands, serde_json), Svelte 5 (reactive stores, context menu), existing IPC pattern (`IpcResponse`).

**Spec:** `docs/superpowers/specs/2026-03-17-project-aware-mcp-servers-design.md`

---

### Task 1: Extend Config Schema

**Files:**
- Modify: `src-tauri/src/config/schema.rs`

- [ ] **Step 1: Add `McpServerPref` struct and extend `ProjectEntry` and `ProjectsConfig`**

In `src-tauri/src/config/schema.rs`, add the new struct near the bottom of the file (after `ProjectEntry`):

```rust
/// Per-server enable/disable preference for a project workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerPref {
    pub enabled: bool,
}
```

Add to `ProjectEntry` (after the `icon` field):

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<HashMap<String, McpServerPref>>,
```

Add to `ProjectsConfig` (after `active_index`):

```rust
    /// MCP server preferences for the default workspace (Voice Mirror project root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_mcp_servers: Option<HashMap<String, McpServerPref>>,
```

Add `use std::collections::HashMap;` to the imports at the top of the file if not already present.

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors. serde will handle the new optional fields transparently — existing configs without `mcpServers` deserialize as `None`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/config/schema.rs
git commit -m "feat(config): add McpServerPref and mcp_servers fields to project schema"
```

---

### Task 2: Discovery Function in Rust

**Files:**
- Modify: `src-tauri/src/providers/cli/mcp_config.rs`

- [ ] **Step 1: Add `DiscoveredMcpServer` struct and `discover_mcp_servers_impl` function**

At the top of `mcp_config.rs`, add to existing imports:

```rust
use serde::Serialize;
use std::collections::HashMap;
use crate::config::schema::McpServerPref;
```

After the existing `write_mcp_config()` function (after line 205), add:

```rust
/// A discovered MCP server from global or project-local config.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredMcpServer {
    pub name: String,
    pub source: String,        // "global" | "project"
    pub is_own: bool,          // true for "voice-mirror"
    pub enabled: bool,         // from project preferences (default: true)
    pub config: serde_json::Value,
}

/// Discover MCP servers from global (~/.claude/settings.json) and
/// project-local ({workspace}/.mcp.json), deduplicate, and merge
/// with the project's enable/disable preferences.
///
/// Filters out `voice-mirror` from .mcp.json reads (we manage it ourselves).
/// Ignores the `disabled` field in source configs — enabled/disabled state
/// comes exclusively from Voice Mirror's preferences.
pub fn discover_mcp_servers_impl(
    workspace_path: &std::path::Path,
    preferences: &Option<HashMap<String, McpServerPref>>,
) -> Vec<DiscoveredMcpServer> {
    let mut servers: std::collections::BTreeMap<String, (String, serde_json::Value)> = std::collections::BTreeMap::new();

    // 1. Read global: ~/.claude/settings.json → mcpServers
    if let Some(home) = dirs::home_dir() {
        let settings_path = home.join(".claude").join("settings.json");
        if let Ok(raw) = std::fs::read_to_string(&settings_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(mcp) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
                    for (name, config) in mcp {
                        if name == "voice-mirror" {
                            continue; // Skip our own server
                        }
                        servers.insert(name.clone(), ("global".to_string(), config.clone()));
                    }
                }
            } else {
                warn!("Failed to parse ~/.claude/settings.json for MCP discovery");
            }
        }
    }

    // 2. Read project-local: {workspace}/.mcp.json → mcpServers
    let mcp_json_path = workspace_path.join(".mcp.json");
    if let Ok(raw) = std::fs::read_to_string(&mcp_json_path) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(mcp) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
                for (name, config) in mcp {
                    if name == "voice-mirror" {
                        continue; // Skip our own server (we wrote it)
                    }
                    // Project-local wins over global (overwrite if exists)
                    servers.insert(name.clone(), ("project".to_string(), config.clone()));
                }
            }
        } else {
            warn!("Failed to parse {} for MCP discovery", mcp_json_path.display());
        }
    }

    // 3. Build result with enable/disable preferences
    let prefs = preferences.as_ref();
    let mut result: Vec<DiscoveredMcpServer> = servers.into_iter().map(|(name, (source, config))| {
        let enabled = prefs
            .and_then(|p| p.get(&name))
            .map(|pref| pref.enabled)
            .unwrap_or(true); // Default: enabled
        DiscoveredMcpServer {
            name,
            source,
            is_own: false,
            enabled,
            config,
        }
    }).collect();

    // 4. Always include voice-mirror as first entry
    result.insert(0, DiscoveredMcpServer {
        name: "voice-mirror".to_string(),
        source: "project".to_string(),
        is_own: true,
        enabled: true, // Always enabled, cannot be disabled
        config: serde_json::json!({}), // Config managed separately
    });

    result
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/providers/cli/mcp_config.rs
git commit -m "feat(mcp): add discover_mcp_servers_impl for global + project-local discovery"
```

---

### Task 3: Tauri Command for Discovery

**Files:**
- Modify: `src-tauri/src/commands/project.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `discover_mcp_servers` command to `project.rs`**

At the top of `src-tauri/src/commands/project.rs`, add to imports:

```rust
use crate::providers::cli::mcp_config::{discover_mcp_servers_impl, DiscoveredMcpServer};
use crate::config::schema::McpServerPref;
use std::collections::HashMap;
```

At the bottom of the file (before `#[cfg(test)]`), add:

```rust
// ── discover_mcp_servers ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverMcpParams {
    pub workspace_path: String,
    /// MCP server preferences from the project config (passed from frontend
    /// to avoid needing AppState access to config).
    pub preferences: Option<HashMap<String, McpServerPref>>,
}

#[tauri::command]
pub fn discover_mcp_servers(params: DiscoverMcpParams) -> IpcResponse {
    let workspace = Path::new(&params.workspace_path);
    if !workspace.exists() {
        return IpcResponse::err(format!("Workspace path does not exist: {}", params.workspace_path));
    }

    let servers = discover_mcp_servers_impl(workspace, &params.preferences);

    match serde_json::to_value(&servers) {
        Ok(val) => IpcResponse::ok(val),
        Err(e) => IpcResponse::err(format!("Failed to serialize discovery result: {e}")),
    }
}
```

- [ ] **Step 2: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `project_cmds::load_project_icons,` line (~line 521) and add after it:

```rust
            project_cmds::discover_mcp_servers,
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/project.rs src-tauri/src/lib.rs
git commit -m "feat(mcp): add discover_mcp_servers Tauri command"
```

---

### Task 4: Extend `write_mcp_config` to Include Third-Party Servers

**Files:**
- Modify: `src-tauri/src/providers/cli/mcp_config.rs`

- [ ] **Step 1: Add `mcp_preferences` parameter to `write_mcp_config`**

Change the function signature at line 23 of `mcp_config.rs`:

```rust
pub fn write_mcp_config(
    project_root: &std::path::Path,
    enabled_groups: &str,
    cwd_override: Option<&PathBuf>,
    mcp_preferences: &Option<HashMap<String, McpServerPref>>,
) -> Result<(), String> {
```

- [ ] **Step 2: Replace the `.mcp.json` write sections to include discovered servers**

After building `voice_mirror_entry` (around line 48), and after the settings.json cleanup block (line 77), replace the project `.mcp.json` write block (lines 79-92) with:

```rust
    // --- 2. Discover third-party servers and build merged .mcp.json ---
    // For the CWD (or project root if no CWD override), discover all MCP servers
    // and merge with the user's per-project preferences.
    let effective_workspace = cwd_override.map(|p| p.as_path()).unwrap_or(project_root);
    let discovered = discover_mcp_servers_impl(effective_workspace, mcp_preferences);

    // Build merged mcpServers object
    let mut mcp_servers = serde_json::Map::new();
    mcp_servers.insert("voice-mirror".to_string(), voice_mirror_entry.clone());

    for server in &discovered {
        if server.is_own {
            continue; // Already added voice-mirror above
        }
        let mut config = server.config.clone();
        if !server.enabled {
            // Merge "disabled": true into the config
            if let Some(obj) = config.as_object_mut() {
                obj.insert("disabled".to_string(), serde_json::json!(true));
            }
        } else {
            // Remove disabled flag if present (server is enabled)
            if let Some(obj) = config.as_object_mut() {
                obj.remove("disabled");
            }
        }
        mcp_servers.insert(server.name.clone(), config);
    }

    let server_count = mcp_servers.len();
    let merged_mcp = serde_json::json!({ "mcpServers": mcp_servers });

    // Write to project root
    let project_mcp_path = project_root.join(".mcp.json");
    match serde_json::to_string_pretty(&merged_mcp) {
        Ok(s) => match std::fs::write(&project_mcp_path, &s) {
            Ok(()) => info!("Wrote project MCP config ({} servers) to {}", server_count, project_mcp_path.display()),
            Err(e) => warn!("Failed to write {}: {}", project_mcp_path.display(), e),
        },
        Err(e) => warn!("Failed to serialize .mcp.json: {}", e),
    }
```

- [ ] **Step 3: Update CWD override block to use merged config**

Replace the CWD `.mcp.json` write block (lines 99-121) — the `cwd_mcp` variable now uses `merged_mcp`:

```rust
    // --- 3. Write .mcp.json to CWD if it differs from project root ---
    if let Some(cwd) = cwd_override {
        if cwd.exists() {
            let cwd_mcp_path = cwd.join(".mcp.json");
            match serde_json::to_string_pretty(&merged_mcp) {
                Ok(s) => match std::fs::write(&cwd_mcp_path, &s) {
                    Ok(()) => info!("Wrote CWD MCP config ({} servers) to {}", server_count, cwd_mcp_path.display()),
                    Err(e) => warn!("Failed to write CWD .mcp.json {}: {}", cwd_mcp_path.display(), e),
                },
                Err(e) => warn!("Failed to serialize CWD .mcp.json: {}", e),
            }
            ensure_claude_mcp_trust(cwd);
        }
    }
```

- [ ] **Step 4: Update all call sites of `write_mcp_config`**

Search for all calls to `write_mcp_config(` in the codebase. Each call needs the new `mcp_preferences` parameter. For now, pass `&None` to maintain existing behavior — the frontend will pass real preferences once the UI is wired.

Likely call site: `src-tauri/src/providers/cli/mod.rs`. Find the call and add `&None` as the fourth argument.

Run: `rg "write_mcp_config\(" src-tauri/src/ --files-with-matches` to find all call sites.

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/cli/mcp_config.rs src-tauri/src/providers/cli/mod.rs
git commit -m "feat(mcp): write_mcp_config now includes discovered third-party servers"
```

---

### Task 5: Frontend — API Wrapper and Project Store Methods

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src/lib/stores/project.svelte.js`

- [ ] **Step 1: Add API wrapper in `api.js`**

Add to `src/lib/api.js` (in the appropriate section, e.g., after project icon functions):

```javascript
// ============ MCP Discovery ============

export async function discoverMcpServers(workspacePath, preferences) {
  return invoke('discover_mcp_servers', { params: { workspacePath, preferences: preferences || null } });
}
```

Note: Rust commands use `params` struct pattern — the wrapper must pass `{ params: { ... } }`.

- [ ] **Step 2: Add MCP methods to project store**

In `src/lib/stores/project.svelte.js`, add the `discoverMcpServers` import:

```javascript
import { setConfig, chatList, loadProjectIcons, discoverMcpServers } from '../api.js';
```

Add these methods inside the `createProjectStore()` return object (after `removeIconCache`):

```javascript
    /**
     * Set MCP server enabled/disabled for a project.
     * @param {string} projectPath - Project path (or '' for default workspace)
     * @param {string} serverName - MCP server name
     * @param {boolean} enabled
     */
    setMcpServer(projectPath, serverName, enabled) {
      if (!projectPath) {
        // Default workspace — store in a separate field we'll handle in _persist
        // For now, find by empty path convention or use activeProject
        return;
      }
      const idx = entries.findIndex(e => e.path === projectPath);
      if (idx === -1) return;
      if (!entries[idx].mcpServers) {
        entries[idx].mcpServers = {};
      }
      entries[idx].mcpServers[serverName] = { enabled };
      this._persist();
    },

    /**
     * Get MCP server preferences for a project.
     * @param {string} projectPath - Project path (or '' for default workspace)
     * @returns {Object} Map of server name → { enabled }
     */
    getMcpServers(projectPath) {
      if (!projectPath) return {};
      const entry = entries.find(e => e.path === projectPath);
      return entry?.mcpServers || {};
    },
```

- [ ] **Step 3: Verify frontend builds**

Run: `npm run check` or `npm run build` to verify no syntax/type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.js src/lib/stores/project.svelte.js
git commit -m "feat(mcp): add discoverMcpServers API wrapper and project store methods"
```

---

### Task 6: Edit Project Modal — MCP Section

**Files:**
- Modify: `src/components/sidebar/EditProjectModal.svelte`

- [ ] **Step 1: Add MCP discovery state and fetch on mount**

In the `<script>` section, add imports and state:

```javascript
import { discoverMcpServers } from '../../lib/api.js';
import { unwrapResult } from '../../lib/utils.js';
```

Add state variables (after `sizeWarning`):

```javascript
let mcpServers = $state([]);
let mcpLoading = $state(true);
let mcpToggles = $state({}); // { serverName: boolean }
```

**Replace** the existing `onMount` (line 12-15) with:

```javascript
onMount(() => {
  lensStore.freeze();
  // Fetch MCP servers for this project
  if (entry?.path) {
    discoverMcpServers(entry.path, entry.mcpServers || null)
      .then(result => {
        const servers = unwrapResult(result) || [];
        mcpServers = servers;
        // Initialize toggles from discovery result (backend already resolved enabled state)
        mcpToggles = {};
        for (const s of servers) {
          mcpToggles[s.name] = s.enabled;
        }
      })
      .catch(err => console.error('[edit-project] MCP discovery failed:', err))
      .finally(() => { mcpLoading = false; });
  } else {
    mcpLoading = false;
  }
  return () => lensStore.unfreeze();
});
```

- [ ] **Step 2: Save MCP preferences in `handleSave`**

In `handleSave()`, before `onClose()`, add:

```javascript
    // Save MCP server preferences
    if (mcpServers.length > 0) {
      const mcpPrefs = {};
      for (const s of mcpServers) {
        if (s.isOwn) continue; // Don't store prefs for voice-mirror
        mcpPrefs[s.name] = { enabled: mcpToggles[s.name] ?? true };
      }
      projectStore.updateProjectField(projectIndex, 'mcpServers', mcpPrefs);
    }
```

- [ ] **Step 3: Add MCP section template**

After the Color swatches `{/if}` block (around line 161), add:

```svelte
    <!-- MCP Servers -->
    {#if mcpLoading}
      <div class="field-label" style="margin-top: 16px;">MCP Servers</div>
      <div class="mcp-loading">Discovering servers...</div>
    {:else if mcpServers.length > 0}
      <div class="field-label" style="margin-top: 16px;">MCP Servers</div>
      <div class="mcp-list">
        {#each mcpServers as server}
          <label class="mcp-row">
            <input
              type="checkbox"
              checked={mcpToggles[server.name] ?? true}
              disabled={server.isOwn}
              onchange={(e) => { mcpToggles[server.name] = e.target.checked; mcpToggles = mcpToggles; }}
            />
            <span class="mcp-name">{server.name}</span>
            <span class="mcp-source">{server.source}</span>
          </label>
        {/each}
      </div>
    {/if}
```

- [ ] **Step 4: Add styles**

In the `<style>` block, add:

```css
  .mcp-loading {
    font-size: 12px;
    color: var(--muted);
    padding: 8px 0;
  }

  .mcp-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px;
  }

  .mcp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
  }

  .mcp-row:hover {
    background: var(--bg-hover);
  }

  .mcp-row input[type="checkbox"] {
    margin: 0;
    accent-color: var(--accent);
  }

  .mcp-name {
    flex: 1;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  .mcp-source {
    font-size: 11px;
    color: var(--muted);
    padding: 1px 5px;
    background: var(--bg);
    border-radius: 3px;
  }
```

- [ ] **Step 5: Verify frontend builds**

Run: `npm run check` or `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/EditProjectModal.svelte
git commit -m "feat(mcp): add MCP server toggles to Edit Project modal"
```

---

### Task 7: Terminal Context Menu — MCP Submenu

**Files:**
- Modify: `src/components/terminal/TerminalTabs.svelte`

- [ ] **Step 1: Add MCP state and imports**

In the `<script>` section, add imports:

```javascript
import { discoverMcpServers } from '../../lib/api.js';
import { unwrapResult } from '../../lib/utils.js';
```

Add state variables near the existing `contextMenu` state:

```javascript
let mcpMenuServers = $state([]);
let mcpMenuLoading = $state(false);
```

- [ ] **Step 2: Add handler functions**

Add these functions near the existing context menu handlers:

```javascript
async function openMcpMenu() {
  mcpMenuLoading = true;
  contextMenu = { ...contextMenu, step: 'mcp-servers' };
  try {
    const project = projectStore.activeProject;
    const path = project?.path || '';
    const prefs = project?.mcpServers || null;
    const result = await discoverMcpServers(path, prefs);
    const servers = unwrapResult(result) || [];
    mcpMenuServers = servers;
  } catch (err) {
    console.error('[terminal-tabs] MCP discovery failed:', err);
    mcpMenuServers = [];
  } finally {
    mcpMenuLoading = false;
  }
}

function toggleMcpServer(serverName, currentEnabled) {
  const newEnabled = !currentEnabled;
  // Update local state for immediate UI feedback
  mcpMenuServers = mcpMenuServers.map(s =>
    s.name === serverName ? { ...s, enabled: newEnabled } : s
  );
  // Persist to project store
  const project = projectStore.activeProject;
  if (project) {
    projectStore.setMcpServer(project.path, serverName, newEnabled);
  }
}

function refreshMcpMenu() {
  openMcpMenu(); // Re-run discovery
}
```

- [ ] **Step 3: Add "Configure MCP Servers..." menu item**

In the context menu template, inside the `{#if contextMenu.tabId === 'ai'}` block, after the provider groups `{/each}` (around line 790), and before the Stop Provider divider, add:

```svelte
          {#if projectStore.entries.length > 0 || projectStore.activeProject}
          <div class="context-menu-divider"></div>
          <button class="context-menu-item" onclick={openMcpMenu}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
            Configure MCP Servers...
            <svg class="ctx-submenu-arrow" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </button>
          {/if}
```

- [ ] **Step 4: Add the MCP servers submenu step**

In the context menu template, add a new `{:else if}` branch for the `mcp-servers` step. Place it after the workspaces step closing tag and before the `:else` (providers step). The structure follows the existing workspace picker pattern:

```svelte
      {:else if contextMenu.step === 'mcp-servers'}
        <!-- MCP server toggles -->
        <button class="context-menu-item" onclick={() => contextMenu = { ...contextMenu, step: 'providers' }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <div class="context-menu-divider"></div>
        <div class="context-menu-group-label">MCP Servers ({projectStore.activeProject?.name || 'default'})</div>
        {#if mcpMenuLoading}
          <div class="context-menu-item" style="opacity: 0.5; pointer-events: none;">Discovering...</div>
        {:else}
          {#each mcpMenuServers as server}
            <button
              class="context-menu-item"
              onclick={(e) => { e.stopPropagation(); if (!server.isOwn) toggleMcpServer(server.name, server.enabled); }}
            >
              {#if server.enabled}
                <svg class="ctx-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              {:else}
                <span style="width: 12px; display: inline-block;"></span>
              {/if}
              <span class="ctx-provider-label">{server.name}</span>
              <span class="mcp-source-badge">{server.source}</span>
            </button>
          {/each}
          <div class="context-menu-divider"></div>
          <button class="context-menu-item" onclick={refreshMcpMenu}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        {/if}
```

- [ ] **Step 5: Add badge style**

In the `<style>` block, add:

```css
  .mcp-source-badge {
    font-size: 10px;
    color: var(--muted);
    margin-left: auto;
    padding: 1px 4px;
    background: var(--bg);
    border-radius: 3px;
  }
```

- [ ] **Step 6: Verify frontend builds**

Run: `npm run check` or `npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/components/terminal/TerminalTabs.svelte
git commit -m "feat(mcp): add Configure MCP Servers submenu to terminal context menu"
```

---

### Task 8: Wire MCP Preferences into CLI Provider Start

The `set_provider` Tauri command uses flat parameters (not a params struct). MCP preferences need to flow through the full chain: frontend → `set_provider` command → `ProviderConfig` → `write_mcp_config`.

**Files:**
- Modify: `src-tauri/src/providers/mod.rs` (add field to `ProviderConfig`)
- Modify: `src-tauri/src/commands/ai.rs` (add param to `set_provider`, wire to `ProviderConfig`)
- Modify: `src-tauri/src/providers/cli/mod.rs` (pass preferences to `write_mcp_config`)
- Modify: `src/lib/api.js` (add `mcpPreferences` to `setProvider` invoke)
- Modify: `src/lib/stores/ai-status.svelte.js` (pass preferences from project store)

- [ ] **Step 1: Add `mcp_preferences` to `ProviderConfig`**

In `src-tauri/src/providers/mod.rs`, add import at the top:

```rust
use std::collections::HashMap;
use crate::config::schema::McpServerPref;
```

Add to `ProviderConfig` struct (after `cwd`):

```rust
    /// Per-project MCP server enable/disable preferences.
    pub mcp_preferences: Option<HashMap<String, McpServerPref>>,
```

Update the `Default` impl to include the new field:

```rust
    mcp_preferences: None,
```

- [ ] **Step 2: Add `mcp_preferences` parameter to `set_provider` command**

In `src-tauri/src/commands/ai.rs`, add to the `set_provider` function signature (after `rows`):

```rust
    mcp_preferences: Option<HashMap<String, crate::config::schema::McpServerPref>>,
```

Add `use std::collections::HashMap;` to imports if not present.

In the `ProviderConfig` construction block (around line 372), add the field:

```rust
    let config = ProviderConfig {
        model,
        base_url,
        api_key: resolved_key,
        context_length: context_length.unwrap_or(32768),
        system_prompt,
        cwd,
        mcp_preferences,
    };
```

- [ ] **Step 3: Pass preferences to `write_mcp_config` in CLI provider**

In `src-tauri/src/providers/cli/mod.rs`, find the `write_mcp_config` call (around line 267) and change from:

```rust
if let Err(e) = mcp_config::write_mcp_config(root, &enabled_groups, cwd_override, &None) {
```

to:

```rust
if let Err(e) = mcp_config::write_mcp_config(root, &enabled_groups, cwd_override, &self.config.mcp_preferences) {
```

(Note: `self.config` is the `ProviderConfig` stored on the `CliProvider`. Verify the field name by checking the struct — it may be accessed differently. Search for where `ProviderConfig` fields like `self.config.cwd` are used.)

- [ ] **Step 4: Add `mcpPreferences` to frontend API**

In `src/lib/api.js`, update the `setProvider` function to include the new param:

```javascript
export async function setProvider(providerId, options = {}) {
  return invoke('set_provider', {
    providerId,
    model: options.model,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    contextLength: options.contextLength,
    systemPrompt: options.systemPrompt,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    mcpPreferences: options.mcpPreferences || null,
  });
}
```

- [ ] **Step 5: Pass preferences from project store in `switchProvider`**

In `src/lib/stores/ai-status.svelte.js`, add import:

```javascript
import { projectStore } from './project.svelte.js';
```

In `switchProvider()`, where `apiSetProvider` is called (around line 161), add `mcpPreferences` to the options:

```javascript
    const result = await apiSetProvider(providerId, {
      model: opts.model || undefined,
      baseUrl: opts.baseUrl || undefined,
      apiKey: opts.apiKey || undefined,
      contextLength: opts.contextLength || undefined,
      systemPrompt,
      cwd: opts.cwd || undefined,
      cols: opts.cols,
      rows: opts.rows,
      mcpPreferences: projectStore.getMcpServers(projectStore.activeProject?.path || '') || undefined,
    });
```

- [ ] **Step 6: Verify compilation and frontend build**

Run: `cd src-tauri && cargo check` and `npm run check`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/providers/mod.rs src-tauri/src/commands/ai.rs src-tauri/src/providers/cli/mod.rs src/lib/api.js src/lib/stores/ai-status.svelte.js
git commit -m "feat(mcp): wire MCP preferences through full provider start chain"
```

---

### Task 9: Default Workspace MCP Preferences

**Files:**
- Modify: `src/lib/stores/project.svelte.js`
- Modify: `src/components/terminal/TerminalTabs.svelte`

- [ ] **Step 1: Handle default workspace in project store**

The `setMcpServer` and `getMcpServers` methods need to handle the case where `projectPath` is empty (default workspace). Update the methods in `project.svelte.js`:

For `setMcpServer`, handle the empty-path case by persisting to `projects.defaultMcpServers`:

```javascript
    setMcpServer(projectPath, serverName, enabled) {
      if (!projectPath) {
        // Default workspace — persist via setConfig directly
        // Read current default prefs, update, and save
        setConfig({
          projects: {
            defaultMcpServers: {
              ...this._defaultMcpServers,
              [serverName]: { enabled },
            },
          },
        }).catch(err => console.error('[project] Failed to persist default MCP prefs:', err));
        return;
      }
      const idx = entries.findIndex(e => e.path === projectPath);
      if (idx === -1) return;
      if (!entries[idx].mcpServers) {
        entries[idx].mcpServers = {};
      }
      entries[idx].mcpServers[serverName] = { enabled };
      this._persist();
    },
```

Add a `_defaultMcpServers` state and initialize it in `init()`:

```javascript
let defaultMcpServers = $state({});
```

In `init()`:
```javascript
defaultMcpServers = config.defaultMcpServers || {};
```

Add getter:
```javascript
get _defaultMcpServers() { return defaultMcpServers; },
```

Update `getMcpServers`:
```javascript
    getMcpServers(projectPath) {
      if (!projectPath) return defaultMcpServers;
      const entry = entries.find(e => e.path === projectPath);
      return entry?.mcpServers || {};
    },
```

- [ ] **Step 2: Verify frontend builds**

Run: `npm run check` or `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/project.svelte.js
git commit -m "feat(mcp): support default workspace MCP preferences"
```

---

### Task 10: Integration Test — Manual Verification

**Files:** None (manual testing)

- [ ] **Step 1: Build and run the app**

Run: `npm run dev`

- [ ] **Step 2: Test Edit Project modal**

1. Right-click a project in the sidebar → Edit
2. Verify the MCP Servers section appears below Color
3. Verify `voice-mirror` is shown as checked and disabled
4. Verify any global servers from `~/.claude/settings.json` appear with "global" badge
5. Toggle a server off, click Save
6. Re-open the modal — verify the toggle state persisted

- [ ] **Step 3: Test terminal context menu**

1. Right-click the Voice Agent tab
2. Verify "Configure MCP Servers..." appears after the provider list
3. Click it — verify the submenu shows discovered servers with checkmarks
4. Toggle a server — verify the checkmark updates without closing the menu
5. Click "Refresh" — verify the list re-fetches
6. Click "Back" — verify return to main menu

- [ ] **Step 4: Test effective .mcp.json**

1. Configure some servers as enabled/disabled via either UI
2. Start Claude Code in a workspace
3. Check the workspace's `.mcp.json` — verify it contains all enabled servers and disabled servers have `"disabled": true`

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(mcp): integration test fixes"
```
