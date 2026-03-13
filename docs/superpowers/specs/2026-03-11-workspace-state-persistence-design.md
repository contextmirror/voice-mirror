# Workspace State Persistence — Design Spec

## Goal

Persist and restore per-project editor session state (open tabs, pinned tabs, cursor positions, editor splits, panel layout) so users pick up exactly where they left off when reopening the app or switching projects.

## Data Model

Each project gets a JSON file at `%APPDATA%/voice-mirror/workspace-state/{project-hash}.json`. The hash uses FNV-1a (same stable hash as project icons, in Rust only).

```json
{
  "version": 1,
  "tabs": [
    {
      "type": "file",
      "path": "src/App.svelte",
      "groupId": 1,
      "pinned": false,
      "preview": false,
      "cursor": { "line": 42, "col": 8 },
      "scroll": { "top": 320 }
    },
    {
      "type": "file",
      "path": "src/lib/api.js",
      "groupId": 2,
      "pinned": true,
      "preview": false,
      "cursor": { "line": 1, "col": 0 },
      "scroll": { "top": 0 }
    }
  ],
  "activeTabPath": "src/App.svelte",
  "groups": {
    "root": {
      "type": "branch",
      "direction": "horizontal",
      "ratio": 0.5,
      "children": [
        { "type": "leaf", "groupId": 1 },
        { "type": "leaf", "groupId": 2 }
      ]
    },
    "groupMeta": {
      "1": { "activeTabId": "src/App.svelte", "locked": false },
      "2": { "activeTabId": "src/lib/api.js:g2", "locked": false }
    },
    "focusedGroupId": 1,
    "maximizedGroupId": null,
    "nextGroupId": 3
  },
  "layout": {
    "showChat": true,
    "showTerminal": true,
    "showFileTree": true,
    "chatRatio": 0.18,
    "centerRatio": 0.75,
    "previewRatio": 0.78,
    "devicePreviewRatio": 0.5
  }
}
```

Key decisions:

- **Relative paths** (to project root) — survives directory moves.
- **`version` field** — allows future migration without breaking existing state files.
- **Tab `type` field** — `"file"` for normal tabs. Diff tabs (`"diff"`) and untitled tabs are excluded from persistence (diff state is transient, untitled content is unsaved).
- **Tab `groupId`** — each tab records which editor group it belongs to. On restore, tab IDs are reconstructed using the existing convention: `path` for group 1, `${path}:g${groupId}` for other groups.
- **`groups.root`** — the full binary tree (branch nodes with `direction`, `ratio`, `children`; leaf nodes with `groupId`). Matches `editor-groups.svelte.js` grid structure exactly.
- **`groups.groupMeta`** — per-group metadata matching the store's `groups` SvelteMap: `{ activeTabId, locked }`. Uses actual tab IDs (not paths), so group 2's active tab is `"src/lib/api.js:g2"`.
- **`groups.nextGroupId`** — persisted to prevent ID collisions when creating new splits after restore.
- **`groups.maximizedGroupId`** — restores maximized split pane state.
- **`layout`** — panel visibility booleans (from `layout.svelte.js`) plus split ratios (from `LensWorkspace.svelte`): `chatRatio`, `centerRatio`, `previewRatio`, `devicePreviewRatio`. Uses actual variable names from the codebase.
- **Excluded from persistence**: untitled tabs (unsaved content), diff tabs (transient git state), `closedTabs` history (in-memory convenience, not critical state).

## Cursor/Scroll Capture

Each `FileEditor.svelte` instance owns a CodeMirror `EditorView`. The tabs store cannot directly access these component instances.

**Bridge mechanism:** The `workspace-state.svelte.js` orchestrator emits a `workspace-state:capture` custom DOM event before serializing. Each mounted `FileEditor` listens for this event and writes its current cursor position and scroll top onto its tab object (via `tabsStore.updateTabMeta(tabId, { cursor, scroll })`). The orchestrator then reads these values during `tabsStore.serialize()`.

On restore, cursor and scroll values are set via the existing `tabsStore.setPendingCursor()` mechanism for cursor, and a new `pendingScroll` field on the tab for scroll position, which `FileEditor` reads when mounting.

## Save & Restore Triggers

### Save Triggers

All write to the same per-project JSON file:

| Trigger | Behavior |
|---------|----------|
| **Project switch** | Save current project state, then load new project state |
| **App close** | Tauri `onCloseRequested()` (async-capable) saves current state before allowing window close |
| **Debounced auto-save** | 60s debounce timer resets on any tab/split change. Fires after 60s of no changes. |

### Restore Triggers

| Trigger | Behavior |
|---------|----------|
| **App startup** | Load state for the active project (already persisted as `activeIndex`) |
| **Project switch** | Load state for the newly selected project |

### Restore Behavior

- Validate each tab path exists on disk before opening (skip missing files silently).
- If state file doesn't exist (new project, first open), start with empty editor — same as today.
- If state file is corrupted/unparseable, log a warning and start fresh.

## Backend (Rust)

Two new Tauri commands in `src-tauri/src/commands/workspace_state.rs`:

### `save_workspace_state(projectPath, state)`

- Hash `projectPath` with FNV-1a to get filename (reuse `hash_filename()` from `project.rs`).
- Write JSON to `%APPDATA%/voice-mirror/workspace-state/{hash}.json`.
- Create directory if needed.
- Atomic write: write to `.tmp` file, then rename to prevent corruption on crash.

### `load_workspace_state(projectPath)`

- Read the JSON file if it exists.
- Return the parsed JSON or `null` if missing/corrupt.
- Log warning on parse failure, never error to frontend.

The backend is intentionally thin — the frontend owns the state shape. Rust is a dumb read/write layer. No schema validation in Rust; the `version` field lets the frontend handle migrations.

### Shared utility

Move `hash_filename()` from `project.rs` to a shared location (e.g. `commands/mod.rs` or a `util.rs`) so both `project.rs` and `workspace_state.rs` can use it.

## Frontend

### New: `src/lib/stores/workspace-state.svelte.js`

Orchestrator store — collects state from other stores, saves/restores.

Exports:
- `saveCurrentState(projectPath)` — emit capture event, collect from tabs + groups + layout, write via Rust
- `restoreState(projectPath)` — read via Rust, push into tabs + groups + layout
- `startAutoSave(projectPath)` — start 60s debounce timer
- `stopAutoSave()` — stop timer

On save: emits `workspace-state:capture`, then calls `tabsStore.serialize()`, `editorGroupsStore.serialize()`, reads layout state, combines into JSON, calls Rust command.

On restore: calls Rust command, pushes data into `editorGroupsStore.restore()` first (creates the group structure), then `tabsStore.restore()` (opens tabs into correct groups), then layout store.

### Modified: `src/lib/stores/tabs.svelte.js`

- `serialize()` → returns array of `{ type, path, groupId, pinned, preview, cursor, scroll }` for file tabs only (excludes untitled and diff tabs)
- `restore(tabsData, projectRoot)` → clears current tabs, opens each file tab into correct group, sets pinned/preview flags. Tab IDs reconstructed as `path` for group 1, `${path}:g${groupId}` for others.
- `updateTabMeta(tabId, meta)` → new method, lets FileEditor write cursor/scroll onto the tab object

### Modified: `src/lib/stores/editor-groups.svelte.js`

- `serialize()` → returns `{ root, groupMeta, focusedGroupId, maximizedGroupId, nextGroupId }`
- `restore(groupsData)` → sets `gridRoot`, rebuilds `groups` SvelteMap from `groupMeta`, restores `focusedGroupId`, `maximizedGroupId`, `nextGroupId`

### Modified: `src/lib/stores/layout.svelte.js`

- `serialize()` → returns `{ showChat, showTerminal, showFileTree }`
- `restore(layoutData)` → sets each value
- Add setters for the three booleans if not already present

### Modified: `src/components/lens/LensWorkspace.svelte`

- Expose `chatRatio`, `centerRatio`, `previewRatio`, `devicePreviewRatio` for serialization (via a `getLayoutRatios()` export or by moving ratios into the layout store)
- On restore, accept ratio values and set them

### Modified: `src/components/sidebar/ProjectStrip.svelte`

- On project switch in `handleSelect()`: `await saveCurrentState(oldPath)` then `await restoreState(newPath)`

### Modified: `src/App.svelte`

- On startup after project init: `await restoreState(activeProjectPath)`, then `startAutoSave(activeProjectPath)`
- Wire Tauri `getCurrentWindow().onCloseRequested()` to `await saveCurrentState(activeProjectPath)` before allowing close (this supports async, unlike `beforeunload`)

### Modified: `src/components/lens/FileEditor.svelte`

- Listen for `workspace-state:capture` event, write current cursor position and scroll top to tab via `tabsStore.updateTabMeta()`
- On mount, read `tab.pendingScroll` and apply scroll position after editor initializes

### Modified: `src/lib/api.js`

- `saveWorkspaceState(projectPath, state)` wrapper
- `loadWorkspaceState(projectPath)` wrapper

## Files Touched

| Action | File |
|--------|------|
| Create | `src-tauri/src/commands/workspace_state.rs` |
| Create | `src/lib/stores/workspace-state.svelte.js` |
| Modify | `src-tauri/src/commands/mod.rs` — add `pub mod workspace_state` |
| Modify | `src-tauri/src/commands/project.rs` — extract `hash_filename()` to shared location |
| Modify | `src-tauri/src/lib.rs` — register 2 new commands |
| Modify | `src/lib/api.js` — add 2 wrappers |
| Modify | `src/lib/stores/tabs.svelte.js` — add `serialize()`, `restore()`, `updateTabMeta()` |
| Modify | `src/lib/stores/editor-groups.svelte.js` — add `serialize()`, `restore()` |
| Modify | `src/lib/stores/layout.svelte.js` — add `serialize()`, `restore()`, setters |
| Modify | `src/components/lens/LensWorkspace.svelte` — expose/restore split ratios |
| Modify | `src/components/sidebar/ProjectStrip.svelte` — save/restore on switch |
| Modify | `src/App.svelte` — restore on startup, save on close via `onCloseRequested()` |
| Modify | `src/components/lens/FileEditor.svelte` — capture cursor/scroll, apply on mount |
| Create | `test/stores/workspace-state.test.cjs` — source-inspection tests |
| Modify | `test/api/api-signatures.test.cjs` — add new API functions |

## Validation

- **Missing files**: Tabs referencing deleted files are silently skipped on restore.
- **Corrupt state**: Unparseable JSON logs a warning, starts fresh.
- **Version mismatch**: Future versions can migrate or discard old state.
- **No schema validation in Rust**: Frontend owns the shape via the `version` field.
- **Atomic writes**: `.tmp` + rename prevents partial writes on crash.
- **Stale state files**: Not auto-cleaned. Orphaned files from removed projects are harmless (tiny JSON). Can add cleanup in a future pass if needed.

## Testing

- Source-inspection tests for `workspace-state.svelte.js` (exports, imports, function signatures)
- Source-inspection tests for `serialize()`/`restore()` on tabs and editor-groups stores
- Rust unit tests for save/load commands (temp dir, atomic write, missing file, corrupt JSON)
- API signature tests for new wrappers
