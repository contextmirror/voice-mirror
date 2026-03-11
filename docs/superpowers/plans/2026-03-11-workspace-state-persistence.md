# Workspace State Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and restore per-project editor session state (open tabs, pinned tabs, cursor positions, editor splits, panel layout) so users pick up exactly where they left off.

**Architecture:** Each project gets a JSON state file at `%APPDATA%/voice-mirror/workspace-state/{hash}.json`. The frontend orchestrator store collects state from tabs, editor-groups, and layout stores, writes via thin Rust commands. State is saved on project switch, app close, and a 60s debounce timer.

**Tech Stack:** Tauri 2 (Rust backend), Svelte 5 ($state/$derived), CodeMirror 6 (cursor/scroll), FNV-1a hashing

**Spec:** `docs/superpowers/specs/2026-03-11-workspace-state-persistence-design.md`

---

## Chunk 1: Backend + API Layer

### Task 1: Rust commands for workspace state persistence

**Files:**
- Modify: `src-tauri/src/commands/project.rs` — extract `hash_filename()` to `mod.rs`
- Modify: `src-tauri/src/commands/mod.rs` — add shared `hash_filename()` + `pub mod workspace_state`
- Create: `src-tauri/src/commands/workspace_state.rs` — two new commands
- Modify: `src-tauri/src/lib.rs` — register commands

**Context:**
- The `hash_filename()` FNV-1a function currently lives in `src-tauri/src/commands/project.rs:18-27`. It needs to be shared with the new workspace_state module.
- `IpcResponse` is in `src-tauri/src/commands/mod.rs:23-55` with `ok()`, `ok_empty()`, `err()`.
- Commands are registered in `src-tauri/src/lib.rs` at `generate_handler![]` (line 277).
- Existing pattern: `use commands::project as project_cmds;` (lib.rs:27), registered as `project_cmds::save_project_icon` (lib.rs:497).

- [ ] **Step 1: Move `hash_filename()` to `commands/mod.rs`**

In `src-tauri/src/commands/mod.rs`, add the shared function after the `IpcResponse` impl block (after line 55):

```rust
/// Stable FNV-1a hash of a string to a hex filename.
/// Deterministic across Rust versions and platforms.
pub fn hash_filename(source: &str) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in source.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{:x}", hash)
}
```

In `src-tauri/src/commands/project.rs`, remove the local `hash_filename()` function (lines 15-27) and replace the call site at line 67 with `super::hash_filename(&params.file_path)`.

- [ ] **Step 2: Create `workspace_state.rs`**

Create `src-tauri/src/commands/workspace_state.rs`:

```rust
//! Workspace state persistence — save/load per-project editor state.

use super::{hash_filename, IpcResponse};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

/// Get the workspace-state directory under %APPDATA%/voice-mirror/.
fn state_dir() -> Result<PathBuf, String> {
    let app_data = dirs::config_dir()
        .ok_or("Cannot determine config directory")?;
    Ok(app_data.join("voice-mirror").join("workspace-state"))
}

// ── save_workspace_state ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStateParams {
    pub project_path: String,
    pub state: Value,
}

#[tauri::command]
pub fn save_workspace_state(params: SaveStateParams) -> IpcResponse {
    let dir = match state_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return IpcResponse::err(format!("Failed to create state directory: {e}"));
    }

    let hash = hash_filename(&params.project_path);
    let filename = format!("{hash}.json");
    let dest = dir.join(&filename);
    let tmp = dir.join(format!("{hash}.json.tmp"));

    // Serialize JSON
    let json = match serde_json::to_string_pretty(&params.state) {
        Ok(j) => j,
        Err(e) => return IpcResponse::err(format!("Failed to serialize state: {e}")),
    };

    // Atomic write: write to .tmp, then rename
    if let Err(e) = std::fs::write(&tmp, &json) {
        return IpcResponse::err(format!("Failed to write state file: {e}"));
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        // Fallback: try direct write if rename fails (cross-device)
        let _ = std::fs::remove_file(&tmp);
        if let Err(e2) = std::fs::write(&dest, &json) {
            return IpcResponse::err(format!("Failed to save state: {e}, {e2}"));
        }
    }

    IpcResponse::ok_empty()
}

// ── load_workspace_state ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadStateParams {
    pub project_path: String,
}

#[tauri::command]
pub fn load_workspace_state(params: LoadStateParams) -> IpcResponse {
    let dir = match state_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };

    let hash = hash_filename(&params.project_path);
    let path = dir.join(format!("{hash}.json"));

    if !path.exists() {
        return IpcResponse::ok(Value::Null);
    }

    match std::fs::read_to_string(&path) {
        Ok(contents) => {
            match serde_json::from_str::<Value>(&contents) {
                Ok(state) => IpcResponse::ok(state),
                Err(e) => {
                    tracing::warn!("Corrupt workspace state file {}: {e}", path.display());
                    IpcResponse::ok(Value::Null)
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to read workspace state {}: {e}", path.display());
            IpcResponse::ok(Value::Null)
        }
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_and_load_workspace_state() {
        let tmp = std::env::temp_dir().join("vm-ws-state-test");
        let _ = std::fs::remove_dir_all(&tmp);

        // Use a fake project path
        let project_path = "E:\\Projects\\test-project".to_string();

        let state = serde_json::json!({
            "version": 1,
            "tabs": [{ "path": "src/main.rs", "pinned": false }],
            "activeTabPath": "src/main.rs"
        });

        let result = save_workspace_state(SaveStateParams {
            project_path: project_path.clone(),
            state: state.clone(),
        });
        assert!(result.success, "save should succeed");

        let result = load_workspace_state(LoadStateParams {
            project_path: project_path.clone(),
        });
        assert!(result.success, "load should succeed");
        let loaded = result.data.unwrap();
        assert_eq!(loaded["version"], 1);
        assert_eq!(loaded["activeTabPath"], "src/main.rs");

        // Cleanup
        let hash = hash_filename(&project_path);
        let path = state_dir().unwrap().join(format!("{hash}.json"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_load_missing_state_returns_null() {
        let result = load_workspace_state(LoadStateParams {
            project_path: "E:\\Projects\\nonexistent-project-xyz".to_string(),
        });
        assert!(result.success);
        assert_eq!(result.data.unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn test_load_corrupt_state_returns_null() {
        let dir = state_dir().unwrap();
        let _ = std::fs::create_dir_all(&dir);
        let hash = hash_filename("E:\\corrupt-test");
        let path = dir.join(format!("{hash}.json"));
        std::fs::write(&path, b"not valid json {{{").unwrap();

        let result = load_workspace_state(LoadStateParams {
            project_path: "E:\\corrupt-test".to_string(),
        });
        assert!(result.success, "should not error on corrupt file");
        assert_eq!(result.data.unwrap(), serde_json::Value::Null);

        let _ = std::fs::remove_file(&path);
    }
}
```

- [ ] **Step 3: Register the module and commands**

In `src-tauri/src/commands/mod.rs`, add after `pub mod project;`:

```rust
pub mod workspace_state;
```

In `src-tauri/src/lib.rs`, add the alias after `use commands::project as project_cmds;` (line 27):

```rust
use commands::workspace_state as ws_state_cmds;
```

In the `generate_handler![]` macro (before the closing `]` at line 500), add:

```rust
            // Workspace State
            ws_state_cmds::save_workspace_state,
            ws_state_cmds::load_workspace_state,
```

- [ ] **Step 4: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles clean with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/commands/workspace_state.rs src-tauri/src/commands/project.rs src-tauri/src/lib.rs
git commit -m "feat(workspace): add save/load workspace state Rust commands"
```

### Task 2: API wrappers and test updates

**Files:**
- Modify: `src/lib/api.js` — add 2 wrapper functions
- Modify: `test/api/api-signatures.test.cjs` — add new commands and exports

**Context:**
- API wrappers follow the `params` pattern: `invoke('command_name', { params: { ... } })` (see `saveProjectIcon` at api.js:1013).
- The api-signatures test has three sections: `criticalCommands` (invoke names), `expectedExports` (function names), and a count check.
- Current export count: check the `expectedExports.length` value in the test (it must match the actual count).

- [ ] **Step 1: Add API wrappers**

At the bottom of `src/lib/api.js`, before the closing comment or after the `loadProjectIcons` function, add a new section:

```javascript
// ============ Workspace State ============

/** Save workspace state for a project.
 * @param {string} projectPath - Absolute project path.
 * @param {Object} state - The serialized workspace state JSON.
 * @returns {Promise<Object>}
 */
export async function saveWorkspaceState(projectPath, state) {
  return invoke('save_workspace_state', { params: { projectPath, state } });
}

/** Load workspace state for a project.
 * @param {string} projectPath - Absolute project path.
 * @returns {Promise<Object>} { success, data: state|null }
 */
export async function loadWorkspaceState(projectPath) {
  return invoke('load_workspace_state', { params: { projectPath } });
}
```

- [ ] **Step 2: Update api-signatures test**

In `test/api/api-signatures.test.cjs`:

Add to the `criticalCommands` array (after the `'load_project_icons'` entry or in a new "Workspace State" section):

```javascript
    // Workspace State
    'save_workspace_state',
    'load_workspace_state',
```

Add to the `expectedExports` array (after `'loadProjectIcons'`):

```javascript
    // Workspace State
    'saveWorkspaceState',
    'loadWorkspaceState',
```

Add `'Workspace State'` to the `sections` array in the "section organization" test.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (the export count test auto-checks the total).

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.js test/api/api-signatures.test.cjs
git commit -m "feat(workspace): add workspace state API wrappers and tests"
```

---

## Chunk 2: Store Serialization

### Task 3: Editor groups serialize/restore

**Files:**
- Modify: `src/lib/stores/editor-groups.svelte.js` — add `serialize()` and `restore()`
- Modify: `test/stores/editor-groups.test.cjs` (or create if it doesn't exist)

**Context:**
- The store is at `src/lib/stores/editor-groups.svelte.js`. Key internal state (lines 164-169):
  - `gridRoot` — binary tree (`{ type: 'leaf', groupId }` or `{ type: 'branch', direction, ratio, children }`)
  - `groups` — `SvelteMap<number, { activeTabId, locked }>`
  - `focusedGroupId`, `nextGroupId`, `maximizedGroupId`
- The `reset()` method (line 340-346) shows how to set all values back to defaults.
- The tree is plain JS objects (no classes), so it serializes to JSON naturally.

- [ ] **Step 1: Add `serialize()` to the store**

In `src/lib/stores/editor-groups.svelte.js`, add inside the return object (after `get maximizedGroupId()` at line 419, before `toggleGroupLock`):

```javascript
    /**
     * Serialize the editor group layout for persistence.
     * @returns {Object} Serializable state
     */
    serialize() {
      // Deep clone the tree to avoid serializing reactive proxies
      const root = JSON.parse(JSON.stringify(gridRoot));
      const groupMeta = {};
      for (const [id, meta] of groups) {
        groupMeta[id] = { activeTabId: meta.activeTabId, locked: meta.locked };
      }
      return {
        root,
        groupMeta,
        focusedGroupId,
        maximizedGroupId,
        nextGroupId,
      };
    },

    /**
     * Restore editor group layout from persisted state.
     * @param {Object} data - Previously serialized state
     */
    restore(data) {
      if (!data || !data.root) return;
      gridRoot = data.root;
      groups = new SvelteMap();
      if (data.groupMeta) {
        for (const [id, meta] of Object.entries(data.groupMeta)) {
          groups.set(Number(id), { activeTabId: meta.activeTabId || null, locked: meta.locked || false });
        }
      }
      // Ensure at least group 1 exists
      if (groups.size === 0) {
        groups.set(1, { activeTabId: null, locked: false });
      }
      focusedGroupId = data.focusedGroupId ?? 1;
      maximizedGroupId = data.maximizedGroupId ?? null;
      nextGroupId = data.nextGroupId ?? 2;
    },
```

- [ ] **Step 2: Write source-inspection tests**

Check if `test/stores/editor-groups.test.cjs` exists. If not, create it. Add tests:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/editor-groups.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('editor-groups.svelte.js — workspace state persistence', () => {
  it('exports editorGroupsStore', () => {
    assert.ok(src.includes('export const editorGroupsStore'), 'Should export editorGroupsStore');
  });

  it('has serialize() method', () => {
    assert.ok(src.includes('serialize()'), 'Should have serialize method');
  });

  it('has restore() method', () => {
    assert.ok(src.includes('restore(data)'), 'Should have restore method');
  });

  it('serialize returns root, groupMeta, focusedGroupId, maximizedGroupId, nextGroupId', () => {
    assert.ok(src.includes('root,'), 'serialize should return root');
    assert.ok(src.includes('groupMeta,'), 'serialize should return groupMeta');
    assert.ok(src.includes('focusedGroupId,'), 'serialize should return focusedGroupId');
    assert.ok(src.includes('maximizedGroupId,'), 'serialize should return maximizedGroupId');
    assert.ok(src.includes('nextGroupId,'), 'serialize should return nextGroupId');
  });

  it('restore handles missing data gracefully', () => {
    assert.ok(src.includes('if (!data || !data.root) return'), 'Should guard against missing data');
  });

  it('restore ensures at least group 1 exists', () => {
    assert.ok(src.includes('groups.size === 0'), 'Should check for empty groups');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/editor-groups.svelte.js test/stores/editor-groups.test.cjs
git commit -m "feat(workspace): add serialize/restore to editor-groups store"
```

### Task 4: Tabs store serialize/restore + updateTabMeta

**Files:**
- Modify: `src/lib/stores/tabs.svelte.js` — add `serialize()`, `restore()`, `updateTabMeta()`
- Modify: `test/stores/tabs.test.cjs` (or create if it doesn't exist)

**Context:**
- Tabs store is at `src/lib/stores/tabs.svelte.js`. Each tab object: `{ id, type, title, path, groupId, preview, dirty, readOnly?, external? }`.
- Tab IDs: `path` for group 1, `${path}:g${groupId}` for other groups (line 133).
- Only persist `type === 'file'` tabs (skip `diff` and `untitled:`).
- `editorGroupsStore` must be restored BEFORE tabs (groups need to exist).
- `openFile()` (line 117) is the existing way to add tabs — but for restore we want direct insertion (skip preview logic, skip audit).

- [ ] **Step 1: Add `serialize()`, `restore()`, and `updateTabMeta()` to the store**

In `src/lib/stores/tabs.svelte.js`, add inside the return object (after `reopenClosedTab` at line 578, before the closing `};`):

```javascript
    /**
     * Update metadata on a tab (cursor, scroll) — used by FileEditor for state capture.
     * @param {string} tabId
     * @param {{ cursor?: { line: number, col: number }, scroll?: { top: number } }} meta
     */
    updateTabMeta(tabId, meta) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        if (meta.cursor) tab.cursor = meta.cursor;
        if (meta.scroll) tab.scroll = meta.scroll;
      }
    },

    /**
     * Serialize open tabs for workspace state persistence.
     * Only file tabs are persisted (excludes diff and untitled tabs).
     * @returns {Array<Object>}
     */
    serialize() {
      return tabs
        .filter(t => t.type === 'file' && !t.path.startsWith('untitled:'))
        .map(t => ({
          type: t.type,
          path: t.path,
          groupId: t.groupId,
          pinned: !t.preview,
          preview: t.preview || false,
          cursor: t.cursor || null,
          scroll: t.scroll || null,
        }));
    },

    /**
     * Restore tabs from persisted workspace state.
     * Must be called AFTER editorGroupsStore.restore() so groups exist.
     * @param {Array<Object>} tabsData - Serialized tab array
     */
    restore(tabsData) {
      if (!Array.isArray(tabsData) || tabsData.length === 0) {
        tabs.length = 0;
        activeTabId = null;
        return;
      }

      tabs.length = 0;
      activeTabId = null;

      for (const t of tabsData) {
        if (!t.path || t.path.startsWith('untitled:')) continue;
        const groupId = t.groupId || 1;
        const tabId = groupId === 1 ? t.path : `${t.path}:g${groupId}`;
        tabs.push({
          id: tabId,
          type: 'file',
          title: basename(t.path),
          path: t.path,
          groupId,
          preview: t.preview || false,
          dirty: false,
          readOnly: false,
          external: false,
          cursor: t.cursor || null,
          scroll: t.scroll || null,
        });
      }
    },

    /**
     * Set the active tab by ID without audit logging (for restore).
     * @param {string} id
     */
    setActiveQuiet(id) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        activeTabId = id;
        editorGroupsStore.setActiveTabForGroup(tab.groupId, id);
        editorGroupsStore.setFocusedGroup(tab.groupId);
      }
    },
```

- [ ] **Step 2: Write source-inspection tests**

Check if `test/stores/tabs.test.cjs` exists. Add or append tests:

```javascript
describe('tabs.svelte.js — workspace state persistence', () => {
  it('has serialize() method', () => {
    assert.ok(src.includes('serialize()'), 'Should have serialize method');
  });

  it('has restore() method', () => {
    assert.ok(src.includes('restore(tabsData)'), 'Should have restore method');
  });

  it('has updateTabMeta() method', () => {
    assert.ok(src.includes('updateTabMeta(tabId, meta)'), 'Should have updateTabMeta method');
  });

  it('has setActiveQuiet() method', () => {
    assert.ok(src.includes('setActiveQuiet(id)'), 'Should have setActiveQuiet method');
  });

  it('serialize filters out diff and untitled tabs', () => {
    assert.ok(src.includes("t.type === 'file'"), 'Should filter to file type');
    assert.ok(src.includes("!t.path.startsWith('untitled:')"), 'Should exclude untitled');
  });

  it('serialize captures cursor and scroll', () => {
    assert.ok(src.includes('cursor: t.cursor'), 'Should capture cursor');
    assert.ok(src.includes('scroll: t.scroll'), 'Should capture scroll');
  });

  it('restore reconstructs tab IDs with group convention', () => {
    assert.ok(
      src.includes("`${t.path}:g${groupId}`"),
      'Should use group-namespaced IDs'
    );
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/tabs.svelte.js test/stores/tabs.test.cjs
git commit -m "feat(workspace): add serialize/restore/updateTabMeta to tabs store"
```

### Task 5: Layout store serialize/restore

**Files:**
- Modify: `src/lib/stores/layout.svelte.js` — add `serialize()`, `restore()`, setters
- Modify: `test/stores/layout.test.cjs` (or the existing test file for layout)

**Context:**
- Layout store at `src/lib/stores/layout.svelte.js` is very small (25 lines). Has `showChat`, `showTerminal`, `showFileTree` with getters and toggles.
- Split ratios (`chatRatio`, `centerRatio`, `previewRatio`, `devicePreviewRatio`) currently live as local `$state` in `LensWorkspace.svelte` (lines 43-47). We'll move them into the layout store so they're accessible for serialization.

- [ ] **Step 1: Expand the layout store**

Replace the contents of `src/lib/stores/layout.svelte.js`:

```javascript
/**
 * layout.svelte.js -- Panel visibility and split ratio state for Lens workspace.
 *
 * Shared between TitleBar (toggle buttons), LensWorkspace (conditional rendering
 * and split sizes), and workspace-state (persistence).
 */

function createLayoutStore() {
  let showChat = $state(true);
  let showTerminal = $state(true);
  let showFileTree = $state(true);

  // Split ratios (previously local to LensWorkspace.svelte)
  let chatRatio = $state(0.18);
  let centerRatio = $state(0.75);
  let previewRatio = $state(0.78);
  let devicePreviewRatio = $state(0.5);

  return {
    get showChat() { return showChat; },
    get showTerminal() { return showTerminal; },
    get showFileTree() { return showFileTree; },
    get chatRatio() { return chatRatio; },
    get centerRatio() { return centerRatio; },
    get previewRatio() { return previewRatio; },
    get devicePreviewRatio() { return devicePreviewRatio; },

    setShowChat(v) { showChat = v; },
    setShowTerminal(v) { showTerminal = v; },
    setShowFileTree(v) { showFileTree = v; },
    setChatRatio(v) { chatRatio = v; },
    setCenterRatio(v) { centerRatio = v; },
    setPreviewRatio(v) { previewRatio = v; },
    setDevicePreviewRatio(v) { devicePreviewRatio = v; },

    toggleChat() { showChat = !showChat; },
    toggleTerminal() { showTerminal = !showTerminal; },
    toggleFileTree() { showFileTree = !showFileTree; },

    /**
     * Serialize layout state for persistence.
     * @returns {Object}
     */
    serialize() {
      return {
        showChat,
        showTerminal,
        showFileTree,
        chatRatio,
        centerRatio,
        previewRatio,
        devicePreviewRatio,
      };
    },

    /**
     * Restore layout state from persisted data.
     * @param {Object} data
     */
    restore(data) {
      if (!data) return;
      if (typeof data.showChat === 'boolean') showChat = data.showChat;
      if (typeof data.showTerminal === 'boolean') showTerminal = data.showTerminal;
      if (typeof data.showFileTree === 'boolean') showFileTree = data.showFileTree;
      if (typeof data.chatRatio === 'number') chatRatio = data.chatRatio;
      if (typeof data.centerRatio === 'number') centerRatio = data.centerRatio;
      if (typeof data.previewRatio === 'number') previewRatio = data.previewRatio;
      if (typeof data.devicePreviewRatio === 'number') devicePreviewRatio = data.devicePreviewRatio;
    },
  };
}

export const layoutStore = createLayoutStore();
```

- [ ] **Step 2: Update LensWorkspace.svelte to sync ratios with layout store**

In `src/components/lens/LensWorkspace.svelte`, keep the local `$state` ratio variables (they're needed for `bind:ratio` on SplitPanel which requires writable state). Add bidirectional sync with the layout store:

Add the import:

```javascript
  import { layoutStore } from '../../lib/stores/layout.svelte.js';
```

After the local ratio `$state` declarations (lines 43-47), add sync effects:

```javascript
  // Sync local ratios → layout store (for workspace state persistence)
  $effect(() => { layoutStore.setChatRatio(chatRatio); });
  $effect(() => { layoutStore.setCenterRatio(centerRatio); });
  $effect(() => { layoutStore.setPreviewRatio(previewRatio); });
  $effect(() => { layoutStore.setDevicePreviewRatio(devicePreviewRatio); });
```

The local `$state` variables remain as-is for `bind:ratio`. The `$effect` hooks push changes to the store for serialization. On restore, `layoutStore.restore()` sets the store values, and LensWorkspace reads them on mount.

Add an initialization effect to read from the store when LensWorkspace mounts (to handle workspace restore):

```javascript
  // Initialize ratios from layout store (restored workspace state)
  $effect(() => {
    // Only run once on mount — read from store if values differ from defaults
    if (layoutStore.chatRatio !== 0.18) chatRatio = layoutStore.chatRatio;
    if (layoutStore.centerRatio !== 0.75) centerRatio = layoutStore.centerRatio;
    if (layoutStore.previewRatio !== 0.78) previewRatio = layoutStore.previewRatio;
    if (layoutStore.devicePreviewRatio !== 0.5) devicePreviewRatio = layoutStore.devicePreviewRatio;
  });
```

**Note:** The local variables keep working with `bind:ratio`. The store is the persistence layer. This avoids the Svelte 5 limitation where `bind:` targets must be writable `$state` variables.

- [ ] **Step 3: Write source-inspection tests**

Add tests (in existing layout test file or create `test/stores/layout.test.cjs`):

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/layout.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('layout.svelte.js — workspace state persistence', () => {
  it('has serialize() method', () => {
    assert.ok(src.includes('serialize()'), 'Should have serialize method');
  });

  it('has restore() method', () => {
    assert.ok(src.includes('restore(data)'), 'Should have restore method');
  });

  it('serialize includes panel visibility and ratios', () => {
    assert.ok(src.includes('showChat,'), 'Should include showChat');
    assert.ok(src.includes('chatRatio,'), 'Should include chatRatio');
    assert.ok(src.includes('centerRatio,'), 'Should include centerRatio');
    assert.ok(src.includes('previewRatio,'), 'Should include previewRatio');
    assert.ok(src.includes('devicePreviewRatio,'), 'Should include devicePreviewRatio');
  });

  it('restore validates types before setting', () => {
    assert.ok(src.includes("typeof data.showChat === 'boolean'"), 'Should validate boolean');
    assert.ok(src.includes("typeof data.chatRatio === 'number'"), 'Should validate number');
  });

  it('exports ratio getters', () => {
    assert.ok(src.includes('get chatRatio()'), 'Should export chatRatio getter');
    assert.ok(src.includes('get centerRatio()'), 'Should export centerRatio getter');
    assert.ok(src.includes('get previewRatio()'), 'Should export previewRatio getter');
    assert.ok(src.includes('get devicePreviewRatio()'), 'Should export devicePreviewRatio getter');
  });

  it('exports ratio setters', () => {
    assert.ok(src.includes('setChatRatio('), 'Should export setChatRatio');
    assert.ok(src.includes('setCenterRatio('), 'Should export setCenterRatio');
    assert.ok(src.includes('setPreviewRatio('), 'Should export setPreviewRatio');
    assert.ok(src.includes('setDevicePreviewRatio('), 'Should export setDevicePreviewRatio');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/layout.svelte.js src/components/lens/LensWorkspace.svelte test/stores/layout.test.cjs
git commit -m "feat(workspace): add serialize/restore to layout store, move ratios from LensWorkspace"
```

---

## Chunk 3: Orchestrator Store + Cursor Capture

### Task 6: Workspace state orchestrator store

**Files:**
- Create: `src/lib/stores/workspace-state.svelte.js`
- Create: `test/stores/workspace-state.test.cjs`

**Context:**
- This store orchestrates save/restore across tabs, editor-groups, and layout stores.
- On save: emit DOM event for cursor capture → serialize all stores → call Rust save command.
- On restore: call Rust load command → restore groups first (so group IDs exist) → restore tabs → restore layout → set active tab.
- 60s debounce timer for auto-save.

- [ ] **Step 1: Create the orchestrator store**

Create `src/lib/stores/workspace-state.svelte.js`:

```javascript
/**
 * workspace-state.svelte.js -- Orchestrator for per-project workspace persistence.
 *
 * Collects state from tabs, editor-groups, and layout stores.
 * Saves on project switch, app close, and 60s debounce timer.
 * Restores on app startup and project switch.
 */

import { tabsStore } from './tabs.svelte.js';
import { editorGroupsStore } from './editor-groups.svelte.js';
import { layoutStore } from './layout.svelte.js';
import { saveWorkspaceState, loadWorkspaceState } from '../api.js';
import { unwrapResult } from '../utils.js';

const STATE_VERSION = 1;
const AUTO_SAVE_DELAY = 60_000; // 60 seconds

let autoSaveTimer = null;
let currentProjectPath = null;

/**
 * Emit a DOM event to tell all mounted FileEditors to write their
 * cursor/scroll state onto their tab objects via tabsStore.updateTabMeta().
 */
function captureEditorState() {
  window.dispatchEvent(new CustomEvent('workspace-state:capture'));
}

/**
 * Collect the full workspace state from all stores.
 * @returns {Object} Serializable state JSON
 */
function collectState() {
  return {
    version: STATE_VERSION,
    tabs: tabsStore.serialize(),
    activeTabId: tabsStore.activeTabId || null,
    groups: editorGroupsStore.serialize(),
    layout: layoutStore.serialize(),
  };
}

/**
 * Save the current workspace state for a project.
 * @param {string} projectPath - Absolute project path
 */
export async function saveCurrentState(projectPath) {
  if (!projectPath) return;
  try {
    captureEditorState();
    // Small delay to let FileEditors respond to the capture event
    await new Promise(r => setTimeout(r, 10));
    const state = collectState();
    await saveWorkspaceState(projectPath, state);
  } catch (err) {
    console.warn('[workspace-state] Failed to save:', err);
  }
}

/**
 * Restore workspace state for a project.
 * @param {string} projectPath - Absolute project path
 */
export async function restoreState(projectPath) {
  if (!projectPath) return;
  try {
    const result = await loadWorkspaceState(projectPath);
    const data = unwrapResult(result);
    if (!data || data.version == null) {
      // No saved state — start fresh (close any leftover tabs)
      tabsStore.closeAll();
      return;
    }

    // Restore order matters: groups first (creates group IDs),
    // then tabs (assigns to groups), then layout
    editorGroupsStore.restore(data.groups);
    tabsStore.restore(data.tabs);
    layoutStore.restore(data.layout);

    // Restore active tab (uses tab ID for multi-group correctness)
    if (data.activeTabId) {
      tabsStore.setActiveQuiet(data.activeTabId);
    } else if (data.activeTabPath) {
      // Backwards compat with older state files that used path
      const activeTab = tabsStore.tabs.find(t => t.path === data.activeTabPath);
      if (activeTab) {
        tabsStore.setActiveQuiet(activeTab.id);
      }
    }
  } catch (err) {
    console.warn('[workspace-state] Failed to restore:', err);
  }
}

/**
 * Start listening for auto-save. Call notifyChange() whenever
 * tab/split/layout state changes to trigger a debounced save.
 * @param {string} projectPath
 */
export function startAutoSave(projectPath) {
  stopAutoSave();
  currentProjectPath = projectPath;
}

/**
 * Stop the auto-save timer and clear the project path.
 */
export function stopAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  currentProjectPath = null;
}

/**
 * Notify that workspace state has changed. Debounces saves —
 * resets the 60s timer on each call, fires after 60s of no changes.
 */
export function notifyChange() {
  if (!currentProjectPath) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (currentProjectPath) {
      saveCurrentState(currentProjectPath);
    }
  }, AUTO_SAVE_DELAY);
}
```

- [ ] **Step 2: Write source-inspection tests**

Create `test/stores/workspace-state.test.cjs`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/workspace-state.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('workspace-state.svelte.js — exports', () => {
  it('exports saveCurrentState', () => {
    assert.ok(src.includes('export async function saveCurrentState('), 'Should export saveCurrentState');
  });

  it('exports restoreState', () => {
    assert.ok(src.includes('export async function restoreState('), 'Should export restoreState');
  });

  it('exports startAutoSave', () => {
    assert.ok(src.includes('export function startAutoSave('), 'Should export startAutoSave');
  });

  it('exports stopAutoSave', () => {
    assert.ok(src.includes('export function stopAutoSave('), 'Should export stopAutoSave');
  });

  it('exports notifyChange', () => {
    assert.ok(src.includes('export function notifyChange('), 'Should export notifyChange');
  });
});

describe('workspace-state.svelte.js — imports', () => {
  it('imports tabsStore', () => {
    assert.ok(src.includes("from './tabs.svelte.js'"), 'Should import from tabs store');
  });

  it('imports editorGroupsStore', () => {
    assert.ok(src.includes("from './editor-groups.svelte.js'"), 'Should import from editor-groups store');
  });

  it('imports layoutStore', () => {
    assert.ok(src.includes("from './layout.svelte.js'"), 'Should import from layout store');
  });

  it('imports saveWorkspaceState and loadWorkspaceState from api', () => {
    assert.ok(src.includes('saveWorkspaceState'), 'Should import saveWorkspaceState');
    assert.ok(src.includes('loadWorkspaceState'), 'Should import loadWorkspaceState');
  });
});

describe('workspace-state.svelte.js — behavior', () => {
  it('defines STATE_VERSION', () => {
    assert.ok(src.includes('STATE_VERSION = 1'), 'Should define version 1');
  });

  it('defines AUTO_SAVE_DELAY of 60 seconds', () => {
    assert.ok(src.includes('60_000') || src.includes('60000'), 'Should use 60s delay');
  });

  it('notifyChange uses debounce pattern (clearTimeout + setTimeout)', () => {
    assert.ok(src.includes('clearTimeout(autoSaveTimer)'), 'Should clear previous timer');
    assert.ok(src.includes('setTimeout('), 'Should set new timer');
  });

  it('emits workspace-state:capture event before saving', () => {
    assert.ok(src.includes("'workspace-state:capture'"), 'Should emit capture event');
  });

  it('collectState includes version, tabs, activeTabPath, groups, layout', () => {
    assert.ok(src.includes('version: STATE_VERSION'), 'Should include version');
    assert.ok(src.includes('tabs: tabsStore.serialize()'), 'Should serialize tabs');
    assert.ok(src.includes('activeTabId: tabsStore.activeTabId'), 'Should store activeTabId');
    assert.ok(src.includes('groups: editorGroupsStore.serialize()'), 'Should serialize groups');
    assert.ok(src.includes('layout: layoutStore.serialize()'), 'Should serialize layout');
  });

  it('restores groups before tabs (order matters)', () => {
    const groupsIdx = src.indexOf('editorGroupsStore.restore(');
    const tabsIdx = src.indexOf('tabsStore.restore(');
    assert.ok(groupsIdx < tabsIdx, 'Should restore groups before tabs');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/workspace-state.svelte.js test/stores/workspace-state.test.cjs
git commit -m "feat(workspace): add workspace-state orchestrator store"
```

### Task 7: FileEditor cursor/scroll capture

**Files:**
- Modify: `src/components/lens/FileEditor.svelte` — listen for capture event, write cursor/scroll to tab

**Context:**
- FileEditor has `let view;` (line 30) which is the CodeMirror `EditorView` instance.
- `let { tab, groupId = 1 } = $props();` (line 27).
- CodeMirror cursor: `view.state.selection.main.head` gives offset, convert via `view.state.doc.lineAt(offset)` to get `{ number, from }`.
- CodeMirror scroll: `view.scrollDOM.scrollTop`.
- Tab ID: `tab.id`.
- On restore, tab objects will have `cursor` and `scroll` properties. FileEditor should apply these when mounting.
- The existing `pendingCursorPosition` mechanism (tabsStore lines 45-89) already handles cursor-on-open for navigation. For workspace restore, we set cursor/scroll directly on the tab object and FileEditor reads it during init.

- [ ] **Step 1: Add capture listener and restore logic to FileEditor**

In `src/components/lens/FileEditor.svelte`, add the import for tabsStore if not already present, then add an `$effect` for the capture event listener. Add this after the existing `$effect` blocks (search for a good insertion point, like after the diagnostic effect or the pending cursor effect):

```javascript
  // Workspace state capture — write cursor/scroll to tab on demand
  $effect(() => {
    const handleCapture = () => {
      if (!view || !tab) return;
      const offset = view.state.selection.main.head;
      const line = view.state.doc.lineAt(offset);
      tabsStore.updateTabMeta(tab.id, {
        cursor: { line: line.number, col: offset - line.from },
        scroll: { top: view.scrollDOM.scrollTop },
      });
    };
    window.addEventListener('workspace-state:capture', handleCapture);
    return () => window.removeEventListener('workspace-state:capture', handleCapture);
  });
```

Also add import for `tabsStore` at the top if not already imported:

```javascript
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
```

For restoring cursor/scroll on mount — in the existing editor initialization code (where the EditorView is created and content is loaded), add after the view is created and content is set:

```javascript
    // Restore cursor/scroll from workspace state if available
    if (tab.cursor && view) {
      try {
        const line = view.state.doc.line(tab.cursor.line);
        const pos = line.from + (tab.cursor.col || 0);
        view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
      } catch { /* line may not exist */ }
    }
    if (tab.scroll && view) {
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = tab.scroll.top;
      });
    }
```

Place this after the view initialization completes (after content is loaded and the EditorView is fully set up). Look for the block where `loading = false` is set — add it just before that.

- [ ] **Step 2: Write source-inspection tests**

In the existing `test/components/file-editor.test.cjs` (or create if needed), add:

```javascript
describe('FileEditor — workspace state capture', () => {
  it('listens for workspace-state:capture event', () => {
    assert.ok(src.includes("'workspace-state:capture'"), 'Should listen for capture event');
  });

  it('calls tabsStore.updateTabMeta on capture', () => {
    assert.ok(src.includes('tabsStore.updateTabMeta('), 'Should call updateTabMeta');
  });

  it('restores cursor from tab.cursor on mount', () => {
    assert.ok(src.includes('tab.cursor'), 'Should read tab.cursor');
  });

  it('restores scroll from tab.scroll on mount', () => {
    assert.ok(src.includes('tab.scroll'), 'Should read tab.scroll');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/lens/FileEditor.svelte test/components/file-editor.test.cjs
git commit -m "feat(workspace): add cursor/scroll capture and restore in FileEditor"
```

---

## Chunk 4: Wiring — Project Switch, Startup, Close

### Task 8: Wire save/restore into project switch and app lifecycle

**Files:**
- Modify: `src/lib/stores/project.svelte.js` — save/restore on project switch
- Modify: `src/App.svelte` — restore on startup, save on close
- Modify: tests for project store and App if they exist

**Context:**
- `projectStore.setActive(index)` (project.svelte.js:120-125) is called on project switch. Currently just sets index, persists, and loads chat sessions.
- `App.svelte` has a `$effect` that runs when `configStore.loaded` becomes true (lines 48-78), where `projectStore.init(projects)` is called.
- The `beforeunload` handler (App.svelte:285-289) is synchronous. For async save-on-close, use `getCurrentWindow().onCloseRequested()` from `@tauri-apps/api/window` which supports async callbacks.

- [ ] **Step 1: Wire project switch**

In `src/lib/stores/project.svelte.js`, add the import at the top:

```javascript
import { saveCurrentState, restoreState, startAutoSave, stopAutoSave } from './workspace-state.svelte.js';
```

Modify `setActive(index)` (currently lines 120-125) to save/restore:

```javascript
    async setActive(index) {
      if (index < 0 || index >= entries.length) return;
      // Save current project's state before switching
      const oldProject = entries[activeIndex];
      if (oldProject) {
        stopAutoSave();
        await saveCurrentState(oldProject.path);
      }
      activeIndex = index;
      this._persist();
      this.loadSessions();
      // Restore new project's state
      const newProject = entries[activeIndex];
      if (newProject) {
        await restoreState(newProject.path);
        startAutoSave(newProject.path);
      }
    },
```

**IMPORTANT:** Since `setActive` is now async, update `ProjectStrip.svelte`'s `handleSelect`:

In `src/components/sidebar/ProjectStrip.svelte`, change line 17-19:

```javascript
  async function handleSelect(i) {
    await projectStore.setActive(i);
  }
```

Also check for any other callers of `setActive` in the codebase and ensure they handle the async return (or at minimum don't depend on synchronous completion).
```

- [ ] **Step 2: Wire startup restore in App.svelte**

In `src/App.svelte`, add imports:

```javascript
  import { restoreState, startAutoSave, saveCurrentState, stopAutoSave } from './lib/stores/workspace-state.svelte.js';
  import { getCurrentWindow } from '@tauri-apps/api/window';
```

In the `$effect` block that runs when `configStore.loaded` (around line 48-78), after `projectStore.init(projects)` (line 60), add workspace restore:

```javascript
        // Restore workspace state for the active project
        const activeProject = projectStore.activeProject;
        if (activeProject) {
          restoreState(activeProject.path).then(() => {
            startAutoSave(activeProject.path);
          });
        }
```

- [ ] **Step 3: Wire save-on-close in App.svelte**

Add a new `$effect` block (after the existing `beforeunload` effect, around line 290):

```javascript
  // Save workspace state before window closes (async-capable via Tauri API)
  $effect(() => {
    let unlisten;
    getCurrentWindow().onCloseRequested(async (event) => {
      const activeProject = projectStore.activeProject;
      if (activeProject) {
        stopAutoSave();
        await saveCurrentState(activeProject.path);
      }
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  });
```

**Note:** The `onCloseRequested` callback runs before the window closes. It can be async. After the save completes, the window closes naturally (no need to call `event.preventDefault()` since we want it to close).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/project.svelte.js src/App.svelte
git commit -m "feat(workspace): wire save/restore into project switch and app lifecycle"
```

### Task 9: Validate file existence on restore

**Files:**
- Modify: `src/lib/stores/workspace-state.svelte.js` — add file existence check

**Context:**
- On restore, tabs referencing deleted files should be silently skipped.
- We have `readFile` in api.js, but a lighter check is better. We can use the `list_directory` command on the parent, or simply try opening the file and catch errors.
- Simplest approach: the tabs store's `restore()` creates tab objects. After restore, FileEditor will attempt to load the file. If it fails, it shows an error state (already handled). But the tab stays open showing an error — not ideal.
- Better: filter tabs against disk before creating them. Use a batch check via the existing `search_files` command, or just attempt `readFile` for each path and filter.
- Simplest YAGNI approach: use the Tauri `invoke('read_file', ...)` to check existence, but that loads entire file content. Instead, add a lightweight existence-check approach.
- Actually, the simplest approach: just try to open each file. If FileEditor can't load it, the tab shows an error. Users can close it. This is what VS Code does. No extra validation needed.

Decision: **Skip pre-validation.** FileEditor already handles missing files gracefully (shows error state). Users can close stale tabs. This is the VS Code behavior and avoids N async calls on restore.

No code changes needed for this task. This is a design decision documentation.

- [ ] **Step 1: Commit (no-op documentation)**

No changes — this task documents the decision to skip pre-validation. FileEditor already handles missing files.

---

That completes the implementation plan. 4 chunks, 9 tasks.
