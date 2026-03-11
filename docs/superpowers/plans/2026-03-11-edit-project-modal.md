# Edit Project Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Edit Project" modal to the sidebar's ProjectStrip, letting users customize project name, badge color, and custom icon image.

**Architecture:** New Rust commands handle icon file processing (resize to 128x128 PNG, store in `%APPDATA%/voice-mirror/project-icons/`). Frontend `EditProjectModal.svelte` provides the UI, integrated via ProjectStrip right-click context menu. Icons are served as base64 data URLs to avoid Tauri asset protocol/CSP configuration.

**Tech Stack:** Rust (`image` crate for resize, `base64` for data URLs, `dirs` for app data path), Svelte 5 (modal component with `$state`/`$derived`/`$props`), Tauri 2 (`@tauri-apps/plugin-dialog` for file picker)

**Spec:** `docs/superpowers/specs/2026-03-11-edit-project-modal-design.md`

**Deviations from spec:**
- Added `load_project_icons` batch command (needed for startup icon loading — spec didn't address this)
- Using base64 data URLs instead of asset protocol (simpler, no CSP changes, icons are tiny 5-30KB)
- Drag-drop deferred to follow-up (requires enabling Tauri's `dragDropEnabled` which was intentionally disabled to fix editor bugs)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/Cargo.toml:73` | Add `jpeg`, `webp` features to `image` crate |
| Modify | `src-tauri/src/config/schema.rs:494-501` | Add `icon` field to `ProjectEntry` |
| Create | `src-tauri/src/commands/project.rs` | Icon save/remove/load Tauri commands |
| Modify | `src-tauri/src/commands/mod.rs:1-15` | Register `project` module |
| Modify | `src-tauri/src/lib.rs:488-495` | Register 3 new commands in `generate_handler!` |
| Modify | `src/lib/api.js` | 3 API wrappers for icon commands |
| Modify | `src/lib/stores/project.svelte.js` | Icon cache (load, set, remove) |
| Create | `src/components/sidebar/EditProjectModal.svelte` | Modal component |
| Modify | `src/components/sidebar/ProjectStrip.svelte` | Context menu Edit item + icon rendering + modal |
| Create | `test/components/edit-project-modal.test.cjs` | Source-inspection tests for modal |
| Modify | `test/components/project-strip.test.cjs` | Tests for new Edit/icon features |

---

## Chunk 1: Backend

### Task 1: Schema + Image Features

**Files:**
- Modify: `src-tauri/src/config/schema.rs:494-501`
- Modify: `src-tauri/Cargo.toml:73`

- [ ] **Step 1: Add `icon` field to `ProjectEntry`**

In `src-tauri/src/config/schema.rs`, add the `icon` field to the `ProjectEntry` struct:

```rust
/// A single project entry (path + display name + color tag).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub path: String,
    pub name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}
```

- [ ] **Step 2: Add jpeg and webp features to image crate**

In `src-tauri/Cargo.toml`, change the image dependency from:
```toml
image = { version = "0.25", default-features = false, features = ["png"] }
```
to:
```toml
image = { version = "0.25", default-features = false, features = ["png", "jpeg", "webp"] }
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/config/schema.rs src-tauri/Cargo.toml
git commit -m "feat(project): add icon field to ProjectEntry schema + jpeg/webp support"
```

---

### Task 2: Project Icon Commands

**Files:**
- Create: `src-tauri/src/commands/project.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `commands/project.rs` with all three commands**

Create `src-tauri/src/commands/project.rs`:

```rust
//! Project icon management commands.

use super::IpcResponse;
use base64::Engine as _;
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Get the project-icons directory under %APPDATA%/voice-mirror/.
fn icons_dir() -> Result<PathBuf, String> {
    let app_data = dirs::config_dir()
        .ok_or("Cannot determine config directory")?;
    Ok(app_data.join("voice-mirror").join("project-icons"))
}

/// Hash a string to a hex filename for uniqueness.
fn hash_filename(source: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

// ── save_project_icon ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveIconParams {
    pub file_path: String,
}

#[tauri::command]
pub fn save_project_icon(params: SaveIconParams) -> IpcResponse {
    let source = Path::new(&params.file_path);

    // Validate extension
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let allowed = ["png", "jpg", "jpeg", "webp", "svg"];
    if !allowed.contains(&ext.as_str()) {
        return IpcResponse::err(format!("Unsupported image format: {ext}"));
    }

    // Ensure icons directory exists
    let dir = match icons_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return IpcResponse::err(format!("Failed to create icons directory: {e}"));
    }

    // Check file size for warning
    let size_warning = std::fs::metadata(source)
        .map(|m| m.len() > 1_048_576)
        .unwrap_or(false);

    let hash = hash_filename(&params.file_path);

    // SVG: copy as-is (vector format, no resize)
    if ext == "svg" {
        let filename = format!("{hash}.svg");
        let dest = dir.join(&filename);
        if let Err(e) = std::fs::copy(source, &dest) {
            return IpcResponse::err(format!("Failed to copy SVG: {e}"));
        }
        let svg_bytes = match std::fs::read(&dest) {
            Ok(b) => b,
            Err(e) => return IpcResponse::err(format!("Failed to read SVG: {e}")),
        };
        let data_url = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&svg_bytes)
        );
        return IpcResponse::ok(serde_json::json!({
            "filename": filename,
            "dataUrl": data_url,
            "sizeWarning": size_warning,
        }));
    }

    // Raster image: load, resize to 128x128, save as PNG
    let img = match image::open(source) {
        Ok(i) => i,
        Err(e) => return IpcResponse::err(format!("Failed to load image: {e}")),
    };

    let resized = img.resize_exact(128, 128, image::imageops::FilterType::Triangle);

    let mut png_buf = std::io::Cursor::new(Vec::new());
    if let Err(e) = resized.write_to(&mut png_buf, image::ImageFormat::Png) {
        return IpcResponse::err(format!("Failed to encode PNG: {e}"));
    }
    let png_bytes = png_buf.into_inner();

    let filename = format!("{hash}.png");
    let dest = dir.join(&filename);
    if let Err(e) = std::fs::write(&dest, &png_bytes) {
        return IpcResponse::err(format!("Failed to save icon: {e}"));
    }

    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    );

    IpcResponse::ok(serde_json::json!({
        "filename": filename,
        "dataUrl": data_url,
        "sizeWarning": size_warning,
    }))
}

// ── remove_project_icon ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveIconParams {
    pub filename: String,
}

#[tauri::command]
pub fn remove_project_icon(params: RemoveIconParams) -> IpcResponse {
    // Path traversal defense: only allow alphanumeric + dot + hyphen
    let valid = params.filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '-')
        && !params.filename.contains("..");
    if !valid {
        return IpcResponse::err("Invalid filename");
    }

    let dir = match icons_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };

    let path = dir.join(&params.filename);
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            return IpcResponse::err(format!("Failed to delete icon: {e}"));
        }
    }

    IpcResponse::ok_empty()
}

// ── load_project_icons ──

#[derive(Debug, Deserialize)]
pub struct LoadIconsParams {
    pub filenames: Vec<String>,
}

#[tauri::command]
pub fn load_project_icons(params: LoadIconsParams) -> IpcResponse {
    let dir = match icons_dir() {
        Ok(d) => d,
        Err(e) => return IpcResponse::err(e),
    };

    let mut icons = serde_json::Map::new();

    for filename in &params.filenames {
        let path = dir.join(filename);
        if let Ok(bytes) = std::fs::read(&path) {
            let mime = if filename.ends_with(".svg") {
                "image/svg+xml"
            } else {
                "image/png"
            };
            let data_url = format!(
                "data:{};base64,{}",
                mime,
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
            icons.insert(filename.clone(), serde_json::Value::String(data_url));
        }
    }

    IpcResponse::ok(serde_json::json!({ "icons": icons }))
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a minimal valid 2x2 red PNG for testing.
    fn create_test_png(path: &Path) {
        let img = image::ImageBuffer::from_fn(2, 2, |_, _| {
            image::Rgba([255u8, 0, 0, 255])
        });
        img.save(path).expect("Failed to save test PNG");
    }

    #[test]
    fn test_save_project_icon_creates_resized_png() {
        let tmp = std::env::temp_dir().join("vm-icon-test-save");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let source = tmp.join("test.png");
        create_test_png(&source);

        let result = save_project_icon(SaveIconParams {
            file_path: source.to_string_lossy().to_string(),
        });

        assert!(result.success, "save_project_icon should succeed");
        let data = result.data.unwrap();
        assert!(data["filename"].as_str().unwrap().ends_with(".png"));
        assert!(data["dataUrl"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(data["sizeWarning"].as_bool().unwrap(), false);

        // Verify the saved file is 128x128
        let saved_path = icons_dir().unwrap().join(data["filename"].as_str().unwrap());
        let saved_img = image::open(&saved_path).unwrap();
        assert_eq!(saved_img.width(), 128);
        assert_eq!(saved_img.height(), 128);

        // Cleanup
        let _ = fs::remove_file(&saved_path);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_remove_project_icon_deletes_file() {
        let dir = icons_dir().unwrap();
        fs::create_dir_all(&dir).unwrap();
        let test_file = dir.join("test-remove.png");
        fs::write(&test_file, b"fake png data").unwrap();

        let result = remove_project_icon(RemoveIconParams {
            filename: "test-remove.png".to_string(),
        });

        assert!(result.success);
        assert!(!test_file.exists(), "File should be deleted");
    }

    #[test]
    fn test_remove_project_icon_rejects_path_traversal() {
        let result = remove_project_icon(RemoveIconParams {
            filename: "../../../etc/passwd".to_string(),
        });
        assert!(!result.success, "Should reject path traversal");
    }

    #[test]
    fn test_load_project_icons_returns_data_urls() {
        let dir = icons_dir().unwrap();
        fs::create_dir_all(&dir).unwrap();
        let test_file = dir.join("test-load.png");
        fs::write(&test_file, b"fake png data").unwrap();

        let result = load_project_icons(LoadIconsParams {
            filenames: vec!["test-load.png".to_string(), "nonexistent.png".to_string()],
        });

        assert!(result.success);
        let data = result.data.unwrap();
        let icons = data["icons"].as_object().unwrap();
        assert!(icons.contains_key("test-load.png"), "Should include existing file");
        assert!(!icons.contains_key("nonexistent.png"), "Should skip missing files");
        assert!(icons["test-load.png"].as_str().unwrap().starts_with("data:image/png;base64,"));

        // Cleanup
        let _ = fs::remove_file(&test_file);
    }

    #[test]
    fn test_save_project_icon_rejects_unsupported_format() {
        let tmp = std::env::temp_dir().join("vm-icon-test-reject");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("test.bmp");
        fs::write(&source, b"fake bmp").unwrap();

        let result = save_project_icon(SaveIconParams {
            file_path: source.to_string_lossy().to_string(),
        });

        assert!(!result.success, "Should reject unsupported format");
        assert!(result.error.unwrap().contains("Unsupported"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
```

- [ ] **Step 2: Register module in `mod.rs`**

In `src-tauri/src/commands/mod.rs`, add after the last `pub mod` line:

```rust
pub mod project;
```

- [ ] **Step 3: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, follow the existing alias pattern. Add the import alias alongside the other command aliases (around line 227, where `use commands::X as X_cmds;` lines are):

```rust
use commands::project as project_cmds;
```

Then register the commands inside `generate_handler![]`, after the output commands section (~line 494):

```rust
            // Project icon management
            project_cmds::save_project_icon,
            project_cmds::remove_project_icon,
            project_cmds::load_project_icons,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 5: Run Rust tests**

Run: `cd src-tauri && cargo test --lib commands::project`
Expected: All 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/project.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(project): add save/remove/load icon Tauri commands"
```

---

## Chunk 2: Frontend

### Task 3: API Wrappers + Store Updates

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src/lib/stores/project.svelte.js`

- [ ] **Step 1: Add API wrappers to `api.js`**

Add these 3 functions near the bottom of `src/lib/api.js`, before the last closing brace or at the end of the exports:

```javascript
// ── Project icon management ──

export async function saveProjectIcon(filePath) {
  return invoke('save_project_icon', { params: { filePath } });
}

export async function removeProjectIcon(filename) {
  return invoke('remove_project_icon', { params: { filename } });
}

export async function loadProjectIcons(filenames) {
  return invoke('load_project_icons', { params: { filenames } });
}
```

- [ ] **Step 2: Add icon cache to project store**

In `src/lib/stores/project.svelte.js`:

First, add the import at the top (after the existing imports):

```javascript
import { loadProjectIcons } from '../api.js';
```

Then, inside `createProjectStore()`, add `iconCache` state:

```javascript
let iconCache = $state({});
```

Add these to the returned object (after `get sessions()`):

```javascript
    /** Map of icon filename → base64 data URL */
    get iconCache() { return iconCache; },
```

Add a `_loadIcons()` method (after `_persist()`):

```javascript
    /** Load icon data URLs for all entries that have icons. */
    async _loadIcons() {
      const filenames = [...new Set(entries
        .map(e => e.icon)
        .filter(Boolean))];
      if (filenames.length === 0) return;
      try {
        const result = await loadProjectIcons(filenames);
        const data = unwrapResult(result);
        if (data?.icons) {
          iconCache = { ...iconCache, ...data.icons };
        }
      } catch (err) {
        console.error('[project] Failed to load icons:', err);
      }
    },

    /** Cache an icon data URL by filename. */
    setIconCache(filename, dataUrl) {
      iconCache = { ...iconCache, [filename]: dataUrl };
    },

    /** Remove an icon from the cache. */
    removeIconCache(filename) {
      const next = { ...iconCache };
      delete next[filename];
      iconCache = next;
    },
```

Update `init()` to load icons after setting entries:

```javascript
    init(config) {
      entries = config.entries || [];
      activeIndex = config.activeIndex || 0;
      if (activeIndex >= entries.length) {
        activeIndex = 0;
      }
      if (entries.length > 0) {
        this.loadSessions();
        this._loadIcons();
      }
    },
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js src/lib/stores/project.svelte.js
git commit -m "feat(project): add icon API wrappers and store icon cache"
```

---

### Task 4: EditProjectModal Component

**Files:**
- Create: `test/components/edit-project-modal.test.cjs`
- Create: `src/components/sidebar/EditProjectModal.svelte`

- [ ] **Step 1: Write failing source-inspection tests**

Create `test/components/edit-project-modal.test.cjs`:

```javascript
/**
 * edit-project-modal.test.cjs -- Source-inspection tests for EditProjectModal.svelte
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(__dirname, '../../src/components/sidebar/EditProjectModal.svelte');
let src;
try {
  src = fs.readFileSync(filePath, 'utf-8');
} catch {
  src = '';
}

describe('EditProjectModal.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'EditProjectModal.svelte should exist and have content');
  });

  // ── Imports ──

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports open from @tauri-apps/plugin-dialog', () => {
    assert.ok(src.includes('@tauri-apps/plugin-dialog'), 'Should import plugin-dialog for file picker');
  });

  it('imports saveProjectIcon and removeProjectIcon from api', () => {
    assert.ok(src.includes('saveProjectIcon'), 'Should import saveProjectIcon');
    assert.ok(src.includes('removeProjectIcon'), 'Should import removeProjectIcon');
  });

  // ── Props ──

  it('accepts projectIndex prop', () => {
    assert.ok(src.includes('projectIndex'), 'Should have projectIndex prop');
  });

  it('accepts onClose prop', () => {
    assert.ok(src.includes('onClose'), 'Should have onClose prop');
  });

  // ── UI Structure ──

  it('has modal-overlay class', () => {
    assert.ok(src.includes('modal-overlay'), 'Should have modal-overlay backdrop');
  });

  it('has role="dialog" and aria-modal', () => {
    assert.ok(src.includes('role="dialog"'), 'Should have dialog role');
    assert.ok(src.includes('aria-modal'), 'Should have aria-modal');
  });

  it('has name input field', () => {
    assert.ok(src.includes('field-input'), 'Should have text input for name');
  });

  it('has color swatches', () => {
    assert.ok(src.includes('color-swatches'), 'Should have color swatch container');
    assert.ok(src.includes('swatch'), 'Should have swatch class for color buttons');
  });

  it('has all 8 color values', () => {
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
    for (const c of colors) {
      assert.ok(src.includes(c), `Should have color ${c}`);
    }
  });

  it('has icon preview area', () => {
    assert.ok(src.includes('icon-preview'), 'Should have icon preview button');
  });

  it('has remove icon button', () => {
    assert.ok(src.includes('remove-icon-btn'), 'Should have remove icon button');
  });

  // ── Actions ──

  it('has save and cancel buttons', () => {
    assert.ok(src.includes('btn-save'), 'Should have save button');
    assert.ok(src.includes('btn-cancel'), 'Should have cancel button');
  });

  it('has handleSave function', () => {
    assert.ok(src.includes('handleSave'), 'Should have handleSave handler');
  });

  it('has handleCancel function', () => {
    assert.ok(src.includes('handleCancel'), 'Should have handleCancel handler');
  });

  it('uses updateProjectField for saving', () => {
    assert.ok(src.includes('updateProjectField'), 'Should call updateProjectField on save');
  });

  it('handles Escape key to close', () => {
    assert.ok(src.includes('Escape'), 'Should handle Escape key');
  });

  // ── Styles ──

  it('has scoped style block', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped styles');
  });

  it('disables save when name is empty', () => {
    assert.ok(src.includes('disabled'), 'Should disable save button for empty names');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/components/edit-project-modal.test.cjs`
Expected: First test fails ("EditProjectModal.svelte should exist and have content").

- [ ] **Step 3: Create `EditProjectModal.svelte`**

Create `src/components/sidebar/EditProjectModal.svelte`:

```svelte
<script>
  import { open } from '@tauri-apps/plugin-dialog';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { saveProjectIcon, removeProjectIcon } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';

  let { projectIndex, onClose } = $props();

  const entry = $derived(projectStore.entries[projectIndex]);

  // Local editing state (only persisted on Save)
  let name = $state(entry?.name || '');
  let color = $state(entry?.color || '#3b82f6');
  let iconFilename = $state(entry?.icon || null);
  let iconPreview = $state(entry?.icon ? (projectStore.iconCache[entry.icon] || null) : null);
  let uploadedFilename = $state(null);
  let sizeWarning = $state(false);

  const originalIcon = entry?.icon || null;

  const COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  ];

  function handleKeydown(e) {
    if (e.key === 'Escape') handleCancel();
  }

  async function handlePickImage() {
    const selected = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    if (!selected) return;

    try {
      // Clean up previous upload if it wasn't the original icon
      if (uploadedFilename && uploadedFilename !== originalIcon) {
        try { await removeProjectIcon(uploadedFilename); } catch {}
      }

      const result = await saveProjectIcon(selected);
      const data = unwrapResult(result);
      if (data) {
        iconFilename = data.filename;
        iconPreview = data.dataUrl;
        uploadedFilename = data.filename;
        sizeWarning = data.sizeWarning || false;
      }
    } catch (err) {
      console.error('[edit-project] Failed to save icon:', err);
    }
  }

  function handleRemoveIcon() {
    iconFilename = null;
    iconPreview = null;
    sizeWarning = false;
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (trimmed !== entry.name) {
      projectStore.updateProjectField(projectIndex, 'name', trimmed);
    }
    if (color !== entry.color) {
      projectStore.updateProjectField(projectIndex, 'color', color);
    }

    if (iconFilename !== originalIcon) {
      projectStore.updateProjectField(projectIndex, 'icon', iconFilename || null);

      // Update icon cache
      if (iconFilename && iconPreview) {
        projectStore.setIconCache(iconFilename, iconPreview);
      }
      // Delete old icon file if it was removed or replaced
      if (originalIcon && originalIcon !== iconFilename) {
        try { await removeProjectIcon(originalIcon); } catch {}
        projectStore.removeIconCache(originalIcon);
      }
    }

    // Clean up uploaded file that got replaced before saving
    if (uploadedFilename && uploadedFilename !== iconFilename && uploadedFilename !== originalIcon) {
      try { await removeProjectIcon(uploadedFilename); } catch {}
    }

    onClose();
  }

  async function handleCancel() {
    // Clean up uploaded icon that wasn't saved
    if (uploadedFilename && uploadedFilename !== originalIcon) {
      try { await removeProjectIcon(uploadedFilename); } catch {}
    }
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={handleCancel} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit project">
    <h3 class="modal-title">Edit Project</h3>

    <!-- Name -->
    <label class="field-label">
      Name
      <input class="field-input" type="text" bind:value={name} />
    </label>

    <!-- Icon -->
    <div class="field-label">Icon</div>
    <div class="icon-area">
      <button class="icon-preview" onclick={handlePickImage} title="Click to change icon">
        {#if iconPreview}
          <img src={iconPreview} alt="Project icon" class="icon-img" />
        {:else}
          <span class="icon-letter" style="background: {color};">{(name.charAt(0) || '?').toUpperCase()}</span>
        {/if}
      </button>
      {#if iconFilename}
        <button class="remove-icon-btn" onclick={handleRemoveIcon}>Remove icon</button>
      {/if}
    </div>
    {#if sizeWarning}
      <div class="size-warning">Image was over 1 MB but has been resized.</div>
    {/if}

    <!-- Color -->
    <div class="field-label">Color</div>
    <div class="color-swatches">
      {#each COLORS as c}
        <button
          class="swatch"
          class:selected={color === c}
          style="background: {c};"
          onclick={() => { color = c; }}
          aria-label="Color {c}"
        >
          {#if iconPreview}
            <img src={iconPreview} alt="" class="swatch-icon" />
          {:else}
            {(name.charAt(0) || '?').toUpperCase()}
          {/if}
        </button>
      {/each}
    </div>

    <!-- Actions -->
    <div class="modal-actions">
      <button class="btn-cancel" onclick={handleCancel}>Cancel</button>
      <button class="btn-save" onclick={handleSave} disabled={!name.trim()}>Save</button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 340px;
    max-width: 90vw;
  }

  .modal-title {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    margin-top: 12px;
  }

  .field-input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    outline: none;
    box-sizing: border-box;
  }

  .field-input:focus {
    border-color: var(--accent);
  }

  .icon-area {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-preview {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    border: 2px dashed var(--border);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0;
  }

  .icon-preview:hover {
    border-color: var(--accent);
  }

  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }

  .icon-letter {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #fff;
    font-size: 18px;
    font-weight: 700;
  }

  .remove-icon-btn {
    background: none;
    border: none;
    color: var(--danger);
    font-size: 12px;
    cursor: pointer;
    padding: 4px 0;
    font-family: var(--font-family);
  }

  .remove-icon-btn:hover {
    text-decoration: underline;
  }

  .size-warning {
    font-size: 11px;
    color: var(--warning, #eab308);
    margin-top: 4px;
  }

  .color-swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .swatch {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    font-family: var(--font-family);
    padding: 0;
    transition: transform 0.1s;
  }

  .swatch:hover {
    transform: scale(1.1);
  }

  .swatch.selected {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--accent);
  }

  .swatch-icon {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .btn-cancel, .btn-save {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-cancel:hover {
    background: var(--bg-hover);
  }

  .btn-save {
    background: var(--accent);
    color: #fff;
  }

  .btn-save:hover {
    filter: brightness(1.1);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/components/edit-project-modal.test.cjs`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/EditProjectModal.svelte test/components/edit-project-modal.test.cjs
git commit -m "feat(project): add EditProjectModal component with tests"
```

---

### Task 5: ProjectStrip Integration

**Files:**
- Modify: `src/components/sidebar/ProjectStrip.svelte`
- Modify: `test/components/project-strip.test.cjs`

- [ ] **Step 1: Add failing tests to `project-strip.test.cjs`**

Insert these tests inside the existing `describe` block in `test/components/project-strip.test.cjs` (before the closing `});` at the end of the describe block):

```javascript
  // ── Edit Project Modal integration ──

  it('imports EditProjectModal', () => {
    assert.ok(src.includes('EditProjectModal'), 'Should import EditProjectModal');
  });

  it('has Edit option in context menu', () => {
    assert.ok(src.includes('handleEdit') || src.includes('Edit'), 'Should have Edit context menu action');
  });

  it('has avatar-icon class for custom project icons', () => {
    assert.ok(src.includes('avatar-icon'), 'Should have avatar-icon class for custom images');
  });

  it('checks iconCache for custom icons', () => {
    assert.ok(src.includes('iconCache'), 'Should reference iconCache from projectStore');
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/components/project-strip.test.cjs`
Expected: The 4 new tests fail, existing tests still pass.

- [ ] **Step 3: Update `ProjectStrip.svelte`**

Replace the full content of `src/components/sidebar/ProjectStrip.svelte` with:

```svelte
<script>
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { open } from '@tauri-apps/plugin-dialog';
  import EditProjectModal from './EditProjectModal.svelte';

  let entries = $derived(projectStore.entries);
  let activeIndex = $derived(projectStore.activeIndex);
  let iconCache = $derived(projectStore.iconCache);

  /** Context menu state */
  let contextMenu = $state({ visible: false, x: 0, y: 0, index: -1 });

  /** Edit modal state */
  let editingIndex = $state(-1);
  let showEditModal = $derived(editingIndex >= 0);

  function handleSelect(i) {
    projectStore.setActive(i);
  }

  async function handleAdd() {
    const selected = await open({ directory: true });
    if (selected) projectStore.addProject(selected);
  }

  function handleContextMenu(event, i) {
    event.preventDefault();
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, index: i };
  }

  function hideContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, index: -1 };
  }

  function handleEdit() {
    editingIndex = contextMenu.index;
    hideContextMenu();
  }

  function handleRemove() {
    const i = contextMenu.index;
    hideContextMenu();
    if (i >= 0) projectStore.removeProject(i);
  }

  function handleDocumentClick() {
    if (contextMenu.visible) hideContextMenu();
  }

  function handleDocumentKeydown(e) {
    if (e.key === 'Escape' && contextMenu.visible) hideContextMenu();
  }
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<div class="project-strip">
  {#each entries as entry, i}
    <button
      class="project-avatar"
      class:active={i === activeIndex}
      title="{entry.name} — {entry.path}"
      onclick={() => handleSelect(i)}
      oncontextmenu={(e) => handleContextMenu(e, i)}
      aria-label={entry.name}
      style="background: {entry.color};"
    >
      {#if entry.icon && iconCache[entry.icon]}
        <img src={iconCache[entry.icon]} alt={entry.name} class="avatar-icon" />
      {:else}
        {entry.name.charAt(0).toUpperCase()}
      {/if}
    </button>
  {/each}

  <button
    class="project-add"
    onclick={handleAdd}
    aria-label="Add project"
    data-tooltip="Add project"
  >+</button>
</div>

{#if contextMenu.visible}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    role="menu"
  >
    <button class="context-menu-item" onclick={handleEdit} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit
    </button>
    <button class="context-menu-item danger" onclick={handleRemove} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      Remove
    </button>
  </div>
{/if}

{#if showEditModal}
  <EditProjectModal
    projectIndex={editingIndex}
    onClose={() => { editingIndex = -1; }}
  />
{/if}

<style>
  @import '../../styles/context-menu.css';

  .project-strip {
    width: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .project-avatar {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: none;
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    font-family: var(--font-family);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
    position: relative;
    margin-left: 2px;
    padding: 0;
    overflow: hidden;
  }

  .avatar-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 10px;
  }

  /* Active indicator pill — left edge of the strip */
  .project-avatar::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 0;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
    transition: height var(--duration-fast) var(--ease-out);
  }

  .project-avatar:hover {
    opacity: 0.85;
    transform: scale(1.05);
  }

  .project-avatar:hover::before {
    height: 12px;
  }

  .project-avatar.active {
    border-radius: 10px;
  }

  .project-avatar.active::before {
    height: 22px;
  }

  .project-add {
    width: 36px;
    height: 36px;
    margin-left: 2px;
    border-radius: 10px;
    border: 1px dashed var(--muted);
    background: transparent;
    color: var(--muted);
    font-size: 18px;
    font-family: var(--font-family);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .project-add:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-hover);
  }

  /* Context Menu */

  .context-menu {
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .context-menu-item {
    gap: 8px;
    font-size: 13px;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .context-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .context-menu-item.danger:hover {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  .context-menu-item svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .project-avatar,
    .project-add,
    .context-menu-item {
      transition: none;
    }
    .project-avatar:hover {
      transform: none;
    }
  }
</style>
```

**Changes from original:**
1. Added `EditProjectModal` import
2. Added `iconCache` derived from store
3. Added `editingIndex` state and `showEditModal` derived
4. Added `handleEdit()` function
5. Added "Edit" button in context menu (above "Remove")
6. Added `{#if showEditModal}` block to render modal
7. Avatar now shows `<img>` with `avatar-icon` class when custom icon exists
8. Added `avatar-icon` CSS class + `overflow: hidden` and `padding: 0` on `.project-avatar`

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test test/components/project-strip.test.cjs`
Expected: All tests pass (original + 4 new).

- [ ] **Step 5: Run full frontend test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/ProjectStrip.svelte test/components/project-strip.test.cjs
git commit -m "feat(project): integrate Edit modal into ProjectStrip with icon rendering"
```
