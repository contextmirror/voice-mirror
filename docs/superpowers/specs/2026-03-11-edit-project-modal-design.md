# Edit Project Modal — Design Spec

## Goal

Add an "Edit Project" modal to the sidebar's ProjectStrip, letting users customize project name, icon (custom image or letter fallback), and badge color.

## Trigger

Right-click a project icon in ProjectStrip → context menu → "Edit" (above existing "Remove").

## Modal Layout

1. **Name** — text input, pre-filled with current name. Empty names rejected on save.
2. **Icon** — clickable area showing current icon (custom image or colored letter badge).
   - Click opens Tauri file dialog filtered to PNG, JPG, JPEG, WebP, SVG.
   - Drag-drop also accepted.
   - Warn (not reject) if source file exceeds 1MB.
   - "Remove icon" button appears when a custom icon is set, reverting to letter fallback.
3. **Color** — row of 8 swatches, each showing the project letter/icon on the color. Click to select. Selected swatch gets a highlight ring. Existing 8-color palette: `#ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899`.
4. **Cancel / Save** buttons.

## Data Model

### ProjectEntry (schema.rs)

Add one new field to the existing `ProjectEntry` struct:

```rust
#[serde(default)]
pub icon: Option<String>,  // filename in project-icons/ dir, e.g. "a1b2c3.png"
```

The existing `color` field becomes user-overridable (currently hash-assigned, never changed).

### Icon Storage

Icons stored at `%APPDATA%/voice-mirror/project-icons/` as 128x128 PNG files. Filenames are hashed from the source path for uniqueness. Each file is ~5-30KB.

Icons are never auto-deleted. Only removed when the user explicitly clicks "Remove icon" in the edit modal. This preserves icons across project remove/re-add cycles.

## Backend (Rust)

### New Tauri Commands

**`save_project_icon(file_path: String) -> IpcResponse`**
- Read the image file from `file_path`
- Resize to 128x128 using the `image` crate (already a dependency)
- Save as PNG to `%APPDATA%/voice-mirror/project-icons/{hash}.png`
- Create the `project-icons/` directory if it doesn't exist
- Return `{ filename: "hash.png" }` on success

**`remove_project_icon(filename: String) -> IpcResponse`**
- Validate filename (no path traversal — alphanumeric + `.png` only)
- Delete the file from `project-icons/`
- Return success (ignore if file doesn't exist)

## Frontend (Svelte)

### New Component: `EditProjectModal.svelte`

- Located at `src/components/sidebar/EditProjectModal.svelte`
- Props: `projectIndex`, `onClose`
- Local state for name, color, icon (only persisted on Save)
- On Save: call `projectStore.updateProjectField()` for each changed field, then close
- On Cancel: discard local state, close

### Modified: `ProjectStrip.svelte`

- Add "Edit" option to context menu (above "Remove")
- On "Edit" click: open `EditProjectModal` with the project's index
- Pass icon data to project avatar rendering (custom image or letter fallback)

### Modified: `project.svelte.js`

- No structural changes needed — `updateProjectField()` already supports arbitrary fields
- Avatar rendering logic updated: if `entry.icon` exists, load from asset protocol; otherwise show colored letter

### Modified: `api.js`

- Add `saveProjectIcon(filePath)` wrapper
- Add `removeProjectIcon(filename)` wrapper

## Data Flow

```
Open Modal
  → populate from projectStore.entries[index]

Pick Image (file dialog or drag-drop)
  → call save_project_icon(filePath)
  → backend resizes to 128x128 PNG, saves to project-icons/
  → returns filename
  → modal shows preview via asset protocol URL

Remove Icon
  → call remove_project_icon(filename)
  → modal reverts to letter fallback preview

Save
  → projectStore.updateProjectField(index, 'name', value)
  → projectStore.updateProjectField(index, 'color', value)
  → projectStore.updateProjectField(index, 'icon', filename | null)
  → _persist() → config.json

Cancel
  → discard local changes
  → if an icon was uploaded during this session but not saved, delete it
```

## Files Touched

| Action | File |
|--------|------|
| Create | `src/components/sidebar/EditProjectModal.svelte` |
| Modify | `src/components/sidebar/ProjectStrip.svelte` — context menu + modal + icon rendering |
| Modify | `src/lib/stores/project.svelte.js` — icon-aware avatar logic |
| Modify | `src/lib/api.js` — new command wrappers |
| Modify | `src-tauri/src/config/schema.rs` — add `icon` field to `ProjectEntry` |
| Create | `src-tauri/src/commands/project.rs` — new commands module |
| Modify | `src-tauri/src/lib.rs` — register new commands |

## Validation

- **Name**: reject empty (trim whitespace). No other restrictions.
- **Image file type**: PNG, JPG, JPEG, WebP, SVG only (filter in file dialog + backend validation).
- **Image size**: warn if over 1MB, but still process it. Resize handles any dimension.
- **Icon filename**: alphanumeric + `.png` only (path traversal defense on remove).
- **Color**: must be one of the 8 preset hex values.

## Testing

- Source-inspection tests for EditProjectModal (exports, props, event handlers)
- Rust unit tests for icon save/remove commands (temp dir, resize verification, path validation)
- Frontend store tests for icon field persistence
