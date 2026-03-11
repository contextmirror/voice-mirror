# Browser Menu & Downloads Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hamburger menu to the browser panel with working Downloads, History, Zoom, and Find on Page features.

**Architecture:** WebView2 COM APIs for downloads (`ICoreWebView2_4::add_DownloadStarting`) and zoom (`ICoreWebView2Controller::SetZoomFactor`). Find uses `window.find()` via existing `ExecuteScript` pattern. History persists to JSON. All features accessible via a dropdown menu in `BrowserTabBar`. Keyboard shortcuts forwarded from child WebView2 via existing `lens-shortcut` URI scheme.

**Tech Stack:** Rust/Tauri (COM, WebView2), Svelte 5 ($state stores), webview2-com 0.38, CodeMirror-style overlay panels.

---

## Errata (from plan review — read BEFORE implementing)

### API Corrections (apply everywhere in this plan)
1. **`IpcResponse` methods**: `IpcResponse::error(...)` → `IpcResponse::err(...)`. `IpcResponse::ok_data(...)` → `IpcResponse::ok(...)`. `IpcResponse::ok()` (no args) → `IpcResponse::ok_empty()`.
2. **Platform import**: `use crate::platform` → `use crate::services::platform`
3. **No `chrono`**: Not a dependency. Use `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()` for timestamps (epoch millis, consistent with codebase).
4. **Add `opener` crate**: Must add `opener = "0.7"` to `[dependencies]` in `Cargo.toml`, OR use `tauri_plugin_shell`'s open functionality.

### COM Pattern Corrections (Chunk 5 — Download Manager)
5. **Out-pointer pattern**: webview2-com-sys 0.38 uses Win32-style out-pointers, NOT Rust return values. Example: `args.Uri()?.to_string()` is WRONG → use `let mut uri = PWSTR::null(); download_op.Uri(&mut uri)?; uri.to_string()`. Same for `ResultFilePath`, `TotalBytesToReceive`, `BytesReceived`, `State`.
6. **`add_DownloadStarting` token**: Use `let mut token: i64 = 0;` and `wv4.add_DownloadStarting(&handler, &mut token)` — not `EventRegistrationToken`.
7. **`add_StateChanged` token**: Same pattern — needs `&mut token` parameter.
8. **`SetHandled` semantics**: `SetHandled(true)` = host handled it (suppress default dialog, use `ResultFilePath`). `SetHandled(false)` = use default behavior (show built-in dialog). For auto-save: `SetHandled(true)` + set path. For "ask location": `SetHandled(false)`.

### Architectural Corrections
9. **FindBar z-index**: Native WebView2 renders on top of DOM. FindBar inside `LensPreview` will be invisible. Mount FindBar in `LensWorkspace.svelte` between toolbar and preview, and shrink WebView2 bounds by FindBar height when visible (`lensResizeWebview`).
10. **BrowserTabBar is in LensWorkspace**: Zoom/Find/History/Downloads state and handlers must live in or be accessible from `LensWorkspace.svelte`, not `LensPreview.svelte`. Wire via props or use stores.
11. **BrowserTab creation sites**: When adding `zoom_factor: 1.0` to `BrowserTab`, update both creation sites in `lens.rs` (approx lines 390 and 622).
12. **LensState init in lib.rs**: The `.manage(LensState { ... })` call must include `downloads: std::sync::Mutex::new(Vec::new())`.
13. **Zoom SetZoomFactor is synchronous**: No channel/callback needed. Just call `controller.SetZoomFactor(factor)` directly and return.
14. **Config typed access**: `get_config_snapshot()` returns `AppConfig` (typed struct), not `Value`. Add `BrowserConfig` struct to `schema.rs` with `download_ask_location: bool` and `download_path: Option<String>`. Access as `config.browser.download_ask_location`.
15. **Download persistence**: The spec says persist to `downloads.json` but the plan only uses in-memory state. Add disk persistence (same pattern as history) or explicitly descope.
16. **`confirm()` in Tauri**: `window.confirm()` may not work. Use the app's toast/modal pattern or `tauri-plugin-dialog`.
17. **Final commit**: Use explicit `git add` for specific files, not `git add -A`.
18. **Zoom per-tab read-back**: On tab switch, read actual zoom from `lens_get_zoom(tabId)` instead of assuming 100%.
19. **`handleAction` identity comparison**: In `BrowserMenu.svelte`, use a `keepOpen` param or separate handler for zoom buttons instead of comparing function references.
20. **Menu placement CORRECTION**: Menu button goes in `LensToolbar.svelte` (after URL bar), NOT in `BrowserTabBar.svelte`. Update Task 2 accordingly — import BrowserMenu in LensToolbar, add after `</form>`. Use `nav-btn` class (28x28) for the trigger button to match existing toolbar buttons.

---

## Chunk 1: Menu Shell + Shortcut Infrastructure

### Task 1: Extend Keyboard Shortcut Script

**Files:**
- Modify: `src-tauri/src/commands/lens.rs:73-105` (build_shortcut_script)
- Modify: `src/App.svelte:237-250` (lens-shortcut listener)

- [ ] **Step 1: Extend `build_shortcut_script()` to intercept Ctrl+F, Ctrl++, Ctrl+-, Ctrl+0**

In `src-tauri/src/commands/lens.rs`, replace the `build_shortcut_script()` function (lines 73-105) with:

```rust
fn build_shortcut_script() -> String {
    let shortcut_base = if cfg!(target_os = "windows") {
        "https://lens-shortcut.localhost/"
    } else {
        "lens-shortcut://localhost/"
    };
    format!(
        r#"document.addEventListener('keydown', function(e) {{
            var key = e.key;
            var lower = key.toLowerCase();
            if (key === 'F1') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'F1' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && lower === 'r') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'hard-refresh' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && lower === 'f') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'find' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && (key === '+' || key === '=')) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-in' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && key === '-') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-out' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && key === '0') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-reset' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && ['n','t',','].includes(lower)) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + lower + '?t=' + Date.now();
                }} catch(err) {{}}
            }}
        }}, true);"#,
        shortcut_base, shortcut_base, shortcut_base,
        shortcut_base, shortcut_base, shortcut_base, shortcut_base
    )
}
```

- [ ] **Step 2: Extend App.svelte lens-shortcut listener**

In `src/App.svelte` (lines 237-250), extend the listener to emit custom events for the new shortcuts:

```javascript
$effect(() => {
  let unlistenFn;
  listen('lens-shortcut', (event) => {
    const key = event.payload?.key;
    if (key === 'F1') {
      commandPaletteMode = 'commands';
      commandPaletteVisible = true;
    }
    else if (key === ',') {
      navigationStore.setView('settings');
    }
    else if (key === 'find') {
      window.dispatchEvent(new CustomEvent('lens-find-toggle'));
    }
    else if (key === 'zoom-in') {
      window.dispatchEvent(new CustomEvent('lens-zoom', { detail: 'in' }));
    }
    else if (key === 'zoom-out') {
      window.dispatchEvent(new CustomEvent('lens-zoom', { detail: 'out' }));
    }
    else if (key === 'zoom-reset') {
      window.dispatchEvent(new CustomEvent('lens-zoom', { detail: 'reset' }));
    }
  }).then(fn => { unlistenFn = fn; });
  return () => { unlistenFn?.(); };
});
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/lens.rs src/App.svelte
git commit -m "feat(lens): extend shortcut script for find, zoom keys"
```

---

### Task 2: Hamburger Menu Component

**Files:**
- Create: `src/components/lens/BrowserMenu.svelte`
- Modify: `src/components/lens/BrowserTabBar.svelte`

- [ ] **Step 1: Create BrowserMenu.svelte**

```svelte
<script>
  /** @type {{ zoomLevel: number, onZoomIn: () => void, onZoomOut: () => void, onZoomReset: () => void, onFind: () => void, onDownloads: () => void, onHistory: () => void, onDownloadSettings: () => void }} */
  let {
    zoomLevel = 100,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onFind,
    onDownloads,
    onHistory,
    onDownloadSettings,
  } = $props();

  let open = $state(false);
  let menuRef = $state(null);

  function toggle() {
    open = !open;
  }

  function handleAction(fn) {
    return () => {
      fn?.();
      // Don't close for zoom actions
      if (fn !== onZoomIn && fn !== onZoomOut && fn !== onZoomReset) {
        open = false;
      }
    };
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      open = false;
    }
  }

  function handleClickOutside(e) {
    if (menuRef && !menuRef.contains(e.target)) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', handleClickOutside, true);
      document.addEventListener('keydown', handleKeydown);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div class="browser-menu" bind:this={menuRef}>
  <button class="menu-trigger" onclick={toggle} title="Menu">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3" r="1.5"/>
      <circle cx="8" cy="8" r="1.5"/>
      <circle cx="8" cy="13" r="1.5"/>
    </svg>
  </button>

  {#if open}
    <div class="menu-dropdown" role="menu">
      <div class="menu-item zoom-row" role="menuitem">
        <span class="menu-label">Zoom</span>
        <button class="zoom-btn" onclick={handleAction(onZoomOut)} title="Zoom out">−</button>
        <span class="zoom-level">{zoomLevel}%</span>
        <button class="zoom-btn" onclick={handleAction(onZoomIn)} title="Zoom in">+</button>
        {#if zoomLevel !== 100}
          <button class="zoom-btn reset" onclick={handleAction(onZoomReset)} title="Reset zoom">↺</button>
        {/if}
      </div>

      <div class="menu-separator"></div>

      <button class="menu-item" role="menuitem" onclick={handleAction(onFind)}>
        <span class="menu-label">Find on page</span>
        <span class="menu-shortcut">Ctrl+F</span>
      </button>

      <div class="menu-separator"></div>

      <button class="menu-item" role="menuitem" onclick={handleAction(onDownloads)}>
        <span class="menu-label">Downloads</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={handleAction(onHistory)}>
        <span class="menu-label">History</span>
      </button>

      <div class="menu-separator"></div>

      <button class="menu-item" role="menuitem" onclick={handleAction(onDownloadSettings)}>
        <span class="menu-label">Download settings</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .browser-menu {
    position: relative;
    display: flex;
    align-items: center;
  }

  .menu-trigger {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }
  .menu-trigger:hover {
    background: var(--bg-hover, rgba(255,255,255,0.08));
    color: var(--text-primary, #ccc);
  }

  .menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 1000;
    min-width: 220px;
    background: var(--bg-surface, #1e1e2e);
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }

  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    gap: 8px;
  }
  .menu-item:hover {
    background: var(--bg-hover, rgba(255,255,255,0.08));
  }

  .menu-label {
    flex: 1;
  }

  .menu-shortcut {
    color: var(--text-secondary, #666);
    font-size: 12px;
  }

  .menu-separator {
    height: 1px;
    background: var(--border-color, #333);
    margin: 4px 0;
  }

  .zoom-row {
    cursor: default;
    gap: 4px;
  }
  .zoom-row:hover {
    background: none;
  }

  .zoom-btn {
    background: var(--bg-hover, rgba(255,255,255,0.08));
    border: 1px solid var(--border-color, #333);
    color: var(--text-primary, #ccc);
    cursor: pointer;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .zoom-btn:hover {
    background: var(--bg-active, rgba(255,255,255,0.12));
  }
  .zoom-btn.reset {
    font-size: 12px;
  }

  .zoom-level {
    min-width: 40px;
    text-align: center;
    font-size: 12px;
    color: var(--text-secondary, #999);
  }
</style>
```

- [ ] **Step 2: Add menu button to BrowserTabBar.svelte**

In `src/components/lens/BrowserTabBar.svelte`, import and mount BrowserMenu after the "+" button (after line 95):

Add to the script section:
```javascript
import BrowserMenu from './BrowserMenu.svelte';
```

Add props to the component:
```javascript
let {
  // ...existing props
  zoomLevel = 100,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFind,
  onDownloads,
  onHistory,
  onDownloadSettings,
} = $props();
```

Add after the "+" button (after line ~95, before the context menu):
```svelte
<BrowserMenu
  {zoomLevel}
  {onZoomIn}
  {onZoomOut}
  {onZoomReset}
  {onFind}
  {onDownloads}
  {onHistory}
  {onDownloadSettings}
/>
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (new component has no tests yet, existing tests unaffected)

- [ ] **Step 4: Commit**

```bash
git add src/components/lens/BrowserMenu.svelte src/components/lens/BrowserTabBar.svelte
git commit -m "feat(lens): add browser hamburger menu shell"
```

---

## Chunk 2: Zoom

### Task 3: Zoom — Rust Backend

**Files:**
- Modify: `src-tauri/src/commands/lens.rs` (add command + BrowserTab zoom field)
- Modify: `src-tauri/src/lib.rs:349-369` (register command)

- [ ] **Step 1: Add zoom_factor to BrowserTab struct**

In `src-tauri/src/commands/lens.rs` (lines 14-17), add zoom tracking:

```rust
pub struct BrowserTab {
    pub webview_label: String,
    pub zoom_factor: f64,
}
```

Update all places that create `BrowserTab` to include `zoom_factor: 1.0`.

- [ ] **Step 2: Add lens_set_zoom and lens_get_zoom commands**

Add after the existing lens commands (around line 870):

```rust
#[tauri::command]
pub fn lens_set_zoom(
    app: AppHandle,
    tab_id: String,
    factor: f64,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::error("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        let factor_clamped = factor.clamp(0.25, 2.0);
        let (tx, rx) = std::sync::mpsc::channel();

        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            unsafe {
                let controller = platform_webview.controller();
                let _ = controller.SetZoomFactor(factor_clamped);
                let _ = tx.send(factor_clamped);
            }
            #[cfg(not(windows))]
            {
                let _ = tx.send(factor_clamped);
            }
        });

        if let Ok(applied) = rx.recv_timeout(std::time::Duration::from_secs(2)) {
            let mut tabs = state.tabs.lock().unwrap();
            if let Some(tab) = tabs.get_mut(&tab_id) {
                tab.zoom_factor = applied;
            }
            IpcResponse::ok_data(serde_json::json!({ "zoomFactor": applied }))
        } else {
            IpcResponse::error("Zoom timed out")
        }
    } else {
        IpcResponse::error("Webview not found")
    }
}

#[tauri::command]
pub fn lens_get_zoom(
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    match tabs.get(&tab_id) {
        Some(tab) => IpcResponse::ok_data(serde_json::json!({ "zoomFactor": tab.zoom_factor })),
        None => IpcResponse::error("Tab not found"),
    }
}
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the lens section of `generate_handler![]` (around line 363):

```rust
lens_cmds::lens_set_zoom,
lens_cmds::lens_get_zoom,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/lens.rs src-tauri/src/lib.rs
git commit -m "feat(lens): add zoom Tauri commands via SetZoomFactor COM API"
```

---

### Task 4: Zoom — Frontend

**Files:**
- Modify: `src/lib/api.js` (add wrappers)
- Modify: `src/components/lens/LensPreview.svelte` (zoom state + keyboard handler)
- Modify: `src/components/lens/BrowserTabBar.svelte` (wire zoom props)

- [ ] **Step 1: Add API wrappers**

In `src/lib/api.js`, add after the existing lens functions (around line 401):

```javascript
export async function lensSetZoom(tabId, factor) {
  return invoke('lens_set_zoom', { tabId, factor });
}
export async function lensGetZoom(tabId) {
  return invoke('lens_get_zoom', { tabId });
}
```

- [ ] **Step 2: Add zoom state and handlers to LensPreview.svelte**

Add zoom level constants and state:
```javascript
const ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

let zoomLevel = $state(100);

function getNextZoom(direction) {
  const current = zoomLevel;
  if (direction === 'in') {
    return ZOOM_LEVELS.find(z => z > current) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  } else {
    return [...ZOOM_LEVELS].reverse().find(z => z < current) ?? ZOOM_LEVELS[0];
  }
}

async function setZoom(factor) {
  const tabId = browserTabsStore.activeTabId;
  if (!tabId) return;
  const resp = await lensSetZoom(tabId, factor / 100);
  if (resp?.data?.zoomFactor) {
    zoomLevel = Math.round(resp.data.zoomFactor * 100);
  }
}

function handleZoomIn() { setZoom(getNextZoom('in')); }
function handleZoomOut() { setZoom(getNextZoom('out')); }
function handleZoomReset() { setZoom(100); }
```

Add keyboard listener in the `$effect` block:
```javascript
function onLensZoom(e) {
  const dir = e.detail;
  if (dir === 'in') handleZoomIn();
  else if (dir === 'out') handleZoomOut();
  else if (dir === 'reset') handleZoomReset();
}
window.addEventListener('lens-zoom', onLensZoom);
// cleanup: window.removeEventListener('lens-zoom', onLensZoom);
```

Reset zoom to 100 when switching tabs:
```javascript
// In the tab switch handler, after switching:
zoomLevel = 100;
// (Or read it back with lensGetZoom)
```

- [ ] **Step 3: Wire zoom props through BrowserTabBar**

In the parent that renders `<BrowserTabBar>`, pass the zoom props:
```svelte
<BrowserTabBar
  {zoomLevel}
  onZoomIn={handleZoomIn}
  onZoomOut={handleZoomOut}
  onZoomReset={handleZoomReset}
  ...other props
/>
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Manual test**

1. Start app with `npm run dev`
2. Open browser panel, navigate to any page
3. Click menu → use +/- zoom buttons → verify page zooms
4. Press Ctrl++ / Ctrl+- / Ctrl+0 → verify shortcuts work
5. Switch tabs → verify zoom resets

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.js src/components/lens/LensPreview.svelte src/components/lens/BrowserTabBar.svelte
git commit -m "feat(lens): wire zoom UI with keyboard shortcuts"
```

---

## Chunk 3: Find on Page

### Task 5: Find on Page — Rust Backend

**Files:**
- Modify: `src-tauri/src/commands/lens.rs` (add find commands)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Add find commands**

Add to `src-tauri/src/commands/lens.rs`:

```rust
#[tauri::command]
pub fn lens_find_on_page(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::error("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        let js = format!(
            "window.find({}, false, false, true, false, true, false)",
            serde_json::to_string(&query).unwrap_or_default()
        );
        let (tx, rx) = std::sync::mpsc::channel();

        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;
                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(e) => { let _ = tx.send(Err(format!("{:?}", e))); return; }
                    };
                    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, result| {
                        if hr.is_ok() {
                            let _ = tx.send(Ok(result));
                        } else {
                            let _ = tx.send(Err(format!("HRESULT {:?}", hr)));
                        }
                        Ok(())
                    }));
                    let _ = core_webview.ExecuteScript(&HSTRING::from(js.as_str()), &handler);
                }
            }
        });

        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(result)) => IpcResponse::ok_data(serde_json::json!({ "found": result == "true" })),
            Ok(Err(e)) => IpcResponse::error(&e),
            Err(_) => IpcResponse::error("Find timed out"),
        }
    } else {
        IpcResponse::error("Webview not found")
    }
}

#[tauri::command]
pub fn lens_find_next(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    // Same as find_on_page — window.find() with forward direction
    lens_find_on_page(app, tab_id, query, state)
}

#[tauri::command]
pub fn lens_find_previous(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::error("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        // backwards = true (3rd param)
        let js = format!(
            "window.find({}, false, true, true, false, true, false)",
            serde_json::to_string(&query).unwrap_or_default()
        );
        let (tx, rx) = std::sync::mpsc::channel();

        let _ = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;
                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(e) => { let _ = tx.send(Err(format!("{:?}", e))); return; }
                    };
                    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, result| {
                        if hr.is_ok() { let _ = tx.send(Ok(result)); }
                        else { let _ = tx.send(Err(format!("{:?}", hr))); }
                        Ok(())
                    }));
                    let _ = core_webview.ExecuteScript(&HSTRING::from(js.as_str()), &handler);
                }
            }
        });

        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(result)) => IpcResponse::ok_data(serde_json::json!({ "found": result == "true" })),
            _ => IpcResponse::error("Find previous failed"),
        }
    } else {
        IpcResponse::error("Webview not found")
    }
}

#[tauri::command]
pub fn lens_close_find(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = state.tabs.lock().unwrap();
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::error("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.eval("window.getSelection().removeAllRanges()");
        IpcResponse::ok()
    } else {
        IpcResponse::error("Webview not found")
    }
}
```

- [ ] **Step 2: Register commands in lib.rs**

Add to `generate_handler![]` in the lens section:
```rust
lens_cmds::lens_find_on_page,
lens_cmds::lens_find_next,
lens_cmds::lens_find_previous,
lens_cmds::lens_close_find,
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/lens.rs src-tauri/src/lib.rs
git commit -m "feat(lens): add find-on-page Tauri commands via window.find()"
```

---

### Task 6: Find on Page — Frontend

**Files:**
- Create: `src/components/lens/FindBar.svelte`
- Modify: `src/lib/api.js` (add wrappers)
- Modify: `src/components/lens/LensPreview.svelte` (mount FindBar, handle toggle)

- [ ] **Step 1: Add API wrappers**

In `src/lib/api.js`:
```javascript
export async function lensFindOnPage(tabId, query) {
  return invoke('lens_find_on_page', { tabId, query });
}
export async function lensFindNext(tabId, query) {
  return invoke('lens_find_next', { tabId, query });
}
export async function lensFindPrevious(tabId, query) {
  return invoke('lens_find_previous', { tabId, query });
}
export async function lensCloseFind(tabId) {
  return invoke('lens_close_find', { tabId });
}
```

- [ ] **Step 2: Create FindBar.svelte**

```svelte
<script>
  import { lensFindOnPage, lensFindNext, lensFindPrevious, lensCloseFind } from '$lib/api.js';
  import browserTabsStore from '$lib/stores/browser-tabs.svelte.js';

  let { visible = false, onClose } = $props();
  let query = $state('');
  let inputRef = $state(null);

  $effect(() => {
    if (visible && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  async function doFind() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId || !query.trim()) return;
    await lensFindOnPage(tabId, query);
  }

  async function findNext() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId || !query.trim()) return;
    await lensFindNext(tabId, query);
  }

  async function findPrevious() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId || !query.trim()) return;
    await lensFindPrevious(tabId, query);
  }

  async function close() {
    const tabId = browserTabsStore.activeTabId;
    if (tabId) await lensCloseFind(tabId);
    query = '';
    onClose?.();
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      findPrevious();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      findNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  // Live search as user types (debounced)
  let debounceTimer;
  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doFind, 200);
  }
</script>

{#if visible}
  <div class="find-bar">
    <input
      bind:this={inputRef}
      bind:value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      placeholder="Find on page..."
      spellcheck="false"
    />
    <button onclick={findPrevious} title="Previous (Shift+Enter)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 4l-5 5h10z"/>
      </svg>
    </button>
    <button onclick={findNext} title="Next (Enter)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 12l5-5H3z"/>
      </svg>
    </button>
    <button onclick={close} title="Close (Escape)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.5 3.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
  </div>
{/if}

<style>
  .find-bar {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    background: var(--bg-surface, #1e1e2e);
    border: 1px solid var(--border-color, #333);
    border-radius: 0 0 0 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  input {
    width: 200px;
    padding: 4px 8px;
    background: var(--bg-input, #2a2a3a);
    border: 1px solid var(--border-color, #444);
    border-radius: 4px;
    color: var(--text-primary, #ccc);
    font-size: 13px;
    outline: none;
  }
  input:focus {
    border-color: var(--accent, #7aa2f7);
  }

  button {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }
  button:hover {
    background: var(--bg-hover, rgba(255,255,255,0.08));
    color: var(--text-primary, #ccc);
  }
</style>
```

- [ ] **Step 3: Mount FindBar in LensPreview.svelte**

Import and add state:
```javascript
import FindBar from './FindBar.svelte';
let findBarVisible = $state(false);

function toggleFind() {
  findBarVisible = !findBarVisible;
}

// Listen for Ctrl+F shortcut
function onLensFindToggle() {
  toggleFind();
}
window.addEventListener('lens-find-toggle', onLensFindToggle);
// cleanup: window.removeEventListener('lens-find-toggle', onLensFindToggle);
```

Add in the template, inside the browser container (positioned relative):
```svelte
<FindBar visible={findBarVisible} onClose={() => findBarVisible = false} />
```

Wire the `onFind` prop through BrowserTabBar to the menu.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/lens/FindBar.svelte src/lib/api.js src/components/lens/LensPreview.svelte
git commit -m "feat(lens): add find-on-page bar with live search"
```

---

## Chunk 4: History

### Task 7: History — Rust Backend

**Files:**
- Modify: `src-tauri/src/commands/lens.rs` (add history commands + emit from on_page_load)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Add history file helpers and commands**

Add to `src-tauri/src/commands/lens.rs`:

```rust
use crate::platform;

const MAX_HISTORY_ENTRIES: usize = 200;

fn history_path() -> std::path::PathBuf {
    platform::get_data_dir().join("browser-history.json")
}

fn read_history() -> Vec<serde_json::Value> {
    let path = history_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn write_history(entries: &[serde_json::Value]) {
    let path = history_path();
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(path, json);
    }
}

#[tauri::command]
pub fn lens_add_history_entry(url: String, title: String) -> IpcResponse {
    // Skip empty/blank URLs
    if url.is_empty() || url == "about:blank" {
        return IpcResponse::ok();
    }

    let mut entries = read_history();

    // Skip duplicate consecutive visits
    if let Some(last) = entries.first() {
        if last.get("url").and_then(|v| v.as_str()) == Some(&url) {
            return IpcResponse::ok();
        }
    }

    let entry = serde_json::json!({
        "url": url,
        "title": title,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    // Prepend (newest first)
    entries.insert(0, entry);

    // Prune to max
    entries.truncate(MAX_HISTORY_ENTRIES);

    write_history(&entries);
    IpcResponse::ok()
}

#[tauri::command]
pub fn lens_get_history() -> IpcResponse {
    let entries = read_history();
    IpcResponse::ok_data(serde_json::json!({ "entries": entries }))
}

#[tauri::command]
pub fn lens_clear_history() -> IpcResponse {
    write_history(&[]);
    IpcResponse::ok()
}

#[tauri::command]
pub fn lens_delete_history_entry(timestamp: String) -> IpcResponse {
    let mut entries = read_history();
    entries.retain(|e| e.get("timestamp").and_then(|t| t.as_str()) != Some(&timestamp));
    write_history(&entries);
    IpcResponse::ok()
}
```

- [ ] **Step 2: Emit history event from on_page_load**

In the `on_page_load` closure (lines 305-316), add a `lens-history-entry` event emission after the URL change event:

```rust
.on_page_load(move |webview, payload| {
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
        let url_str = payload.url().to_string();
        info!("[lens] Page load finished (tab {}): {}", tab_id_for_handler, url_str);
        let _ = app_for_handler.emit(
            "lens-url-changed",
            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
        );
        // Emit for history tracking (frontend will persist)
        let _ = app_for_handler.emit(
            "lens-history-entry",
            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
        );
        report_page_title(&app_for_handler, &webview, tab_id_for_handler.clone());
    }
})
```

- [ ] **Step 3: Register commands in lib.rs**

Add to `generate_handler![]`:
```rust
lens_cmds::lens_add_history_entry,
lens_cmds::lens_get_history,
lens_cmds::lens_clear_history,
lens_cmds::lens_delete_history_entry,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles (may need `chrono` — check if already a dependency, otherwise use `std::time::SystemTime`)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/lens.rs src-tauri/src/lib.rs
git commit -m "feat(lens): add browser history Tauri commands with JSON persistence"
```

---

### Task 8: History — Frontend Store

**Files:**
- Create: `src/lib/stores/browser-history.svelte.js`
- Modify: `src/lib/api.js` (add wrappers)

- [ ] **Step 1: Add API wrappers**

In `src/lib/api.js`:
```javascript
export async function lensAddHistoryEntry(url, title) {
  return invoke('lens_add_history_entry', { url, title });
}
export async function lensGetHistory() {
  return invoke('lens_get_history', {});
}
export async function lensClearHistory() {
  return invoke('lens_clear_history', {});
}
export async function lensDeleteHistoryEntry(timestamp) {
  return invoke('lens_delete_history_entry', { timestamp });
}
```

- [ ] **Step 2: Create browser-history.svelte.js store**

```javascript
import { lensGetHistory, lensClearHistory, lensDeleteHistoryEntry, lensAddHistoryEntry } from '$lib/api.js';
import { listen } from '@tauri-apps/api/event';

function createBrowserHistoryStore() {
  let entries = $state([]);
  let loaded = $state(false);
  let unlistenHistory = null;

  async function load() {
    try {
      const resp = await lensGetHistory();
      if (resp?.data?.entries) {
        entries = resp.data.entries;
      }
      loaded = true;
    } catch (e) {
      console.warn('[history] Failed to load:', e);
    }
  }

  async function init() {
    await load();

    // Listen for page loads and persist history
    unlistenHistory = await listen('lens-history-entry', async (event) => {
      const { url } = event.payload;
      if (!url || url === 'about:blank') return;

      // Wait briefly for title to be available
      setTimeout(async () => {
        // Get title from browser-tabs store (already updated by lens-title-changed)
        const { default: browserTabsStore } = await import('./browser-tabs.svelte.js');
        const tab = browserTabsStore.activeTab;
        const title = tab?.title || url;
        await lensAddHistoryEntry(url, title);
        await load(); // Refresh local state
      }, 500);
    });
  }

  async function clearAll() {
    await lensClearHistory();
    entries = [];
  }

  async function deleteEntry(timestamp) {
    await lensDeleteHistoryEntry(timestamp);
    entries = entries.filter(e => e.timestamp !== timestamp);
  }

  function getGrouped() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);

    const groups = { today: [], yesterday: [], older: [] };

    for (const entry of entries) {
      const date = new Date(entry.timestamp);
      if (date >= today) groups.today.push(entry);
      else if (date >= yesterday) groups.yesterday.push(entry);
      else groups.older.push(entry);
    }

    return groups;
  }

  function filter(query) {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(e =>
      (e.url?.toLowerCase().includes(q)) ||
      (e.title?.toLowerCase().includes(q))
    );
  }

  function destroy() {
    unlistenHistory?.();
  }

  return {
    get entries() { return entries; },
    get loaded() { return loaded; },
    init,
    load,
    clearAll,
    deleteEntry,
    getGrouped,
    filter,
    destroy,
  };
}

const browserHistoryStore = createBrowserHistoryStore();
export default browserHistoryStore;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/browser-history.svelte.js src/lib/api.js
git commit -m "feat(lens): add browser history store with event-driven persistence"
```

---

### Task 9: History — Panel UI

**Files:**
- Create: `src/components/lens/HistoryPanel.svelte`
- Modify: `src/components/lens/LensPreview.svelte` (mount panel, wire menu)

- [ ] **Step 1: Create HistoryPanel.svelte**

```svelte
<script>
  import browserHistoryStore from '$lib/stores/browser-history.svelte.js';
  import lensStore from '$lib/stores/lens.svelte.js';

  let { onClose } = $props();
  let searchQuery = $state('');

  const filtered = $derived(
    searchQuery.trim()
      ? browserHistoryStore.filter(searchQuery)
      : browserHistoryStore.entries
  );

  const grouped = $derived.by(() => {
    if (searchQuery.trim()) return { results: filtered };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);

    const groups = [];
    let todayItems = [];
    let yesterdayItems = [];
    let olderItems = [];

    for (const entry of browserHistoryStore.entries) {
      const date = new Date(entry.timestamp);
      if (date >= today) todayItems.push(entry);
      else if (date >= yesterday) yesterdayItems.push(entry);
      else olderItems.push(entry);
    }

    if (todayItems.length) groups.push({ label: 'Today', items: todayItems });
    if (yesterdayItems.length) groups.push({ label: 'Yesterday', items: yesterdayItems });
    if (olderItems.length) groups.push({ label: 'Older', items: olderItems });

    return groups;
  });

  function navigate(url) {
    lensStore.navigate(url);
    onClose?.();
  }

  async function deleteEntry(timestamp) {
    await browserHistoryStore.deleteEntry(timestamp);
  }

  async function clearAll() {
    if (confirm('Clear all browsing history?')) {
      await browserHistoryStore.clearAll();
    }
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function truncateUrl(url, max = 60) {
    return url.length > max ? url.slice(0, max) + '...' : url;
  }
</script>

<div class="history-panel">
  <div class="panel-header">
    <button class="back-btn" onclick={onClose} title="Back">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
    <h3>History</h3>
    <button class="clear-btn" onclick={clearAll}>Clear all</button>
  </div>

  <div class="search-bar">
    <input
      bind:value={searchQuery}
      placeholder="Search history..."
      spellcheck="false"
    />
  </div>

  <div class="history-list">
    {#if searchQuery.trim()}
      {#each filtered as entry}
        <div class="history-entry">
          <button class="entry-link" onclick={() => navigate(entry.url)}>
            <span class="entry-title">{entry.title || entry.url}</span>
            <span class="entry-url">{truncateUrl(entry.url)}</span>
          </button>
          <button class="delete-btn" onclick={() => deleteEntry(entry.timestamp)} title="Remove">×</button>
        </div>
      {:else}
        <div class="empty">No matches found</div>
      {/each}
    {:else}
      {#each grouped as group}
        <div class="group-label">{group.label}</div>
        {#each group.items as entry}
          <div class="history-entry">
            <span class="entry-time">{formatTime(entry.timestamp)}</span>
            <button class="entry-link" onclick={() => navigate(entry.url)}>
              <span class="entry-title">{entry.title || entry.url}</span>
              <span class="entry-url">{truncateUrl(entry.url)}</span>
            </button>
            <button class="delete-btn" onclick={() => deleteEntry(entry.timestamp)} title="Remove">×</button>
          </div>
        {:else}
          <div class="empty">No browsing history</div>
        {/each}
      {:else}
        <div class="empty">No browsing history</div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .history-panel {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: var(--bg-primary, #1a1a2e);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .panel-header h3 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .back-btn, .clear-btn, .delete-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }
  .back-btn:hover, .clear-btn:hover, .delete-btn:hover {
    color: var(--text-primary, #ccc);
    background: var(--bg-hover, rgba(255,255,255,0.08));
  }

  .clear-btn {
    font-size: 12px;
    padding: 4px 8px;
    color: var(--error, #f38ba8);
  }

  .search-bar {
    padding: 8px 12px;
  }
  .search-bar input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-input, #2a2a3a);
    border: 1px solid var(--border-color, #444);
    border-radius: 4px;
    color: var(--text-primary, #ccc);
    font-size: 13px;
    outline: none;
  }
  .search-bar input:focus {
    border-color: var(--accent, #7aa2f7);
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .group-label {
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary, #666);
    letter-spacing: 0.5px;
  }

  .history-entry {
    display: flex;
    align-items: center;
    padding: 4px 12px;
    gap: 8px;
  }
  .history-entry:hover {
    background: var(--bg-hover, rgba(255,255,255,0.04));
  }

  .entry-time {
    font-size: 11px;
    color: var(--text-secondary, #666);
    min-width: 48px;
  }

  .entry-link {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    cursor: pointer;
    text-align: left;
    padding: 4px 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }
  .entry-link:hover .entry-title {
    color: var(--accent, #7aa2f7);
  }

  .entry-title {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .entry-url {
    font-size: 11px;
    color: var(--text-secondary, #666);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delete-btn {
    font-size: 16px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .history-entry:hover .delete-btn {
    opacity: 1;
  }

  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary, #666);
    font-size: 13px;
  }
</style>
```

- [ ] **Step 2: Mount HistoryPanel in LensPreview.svelte**

Add state and imports:
```javascript
import HistoryPanel from './HistoryPanel.svelte';
import browserHistoryStore from '$lib/stores/browser-history.svelte.js';

let showHistory = $state(false);

// Initialize history store on mount
$effect(() => {
  browserHistoryStore.init();
  return () => browserHistoryStore.destroy();
});
```

Add panel to template (inside the browser container):
```svelte
{#if showHistory}
  <HistoryPanel onClose={() => showHistory = false} />
{/if}
```

Wire `onHistory` through BrowserTabBar menu:
```javascript
function handleHistory() { showHistory = true; }
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/components/lens/HistoryPanel.svelte src/components/lens/LensPreview.svelte
git commit -m "feat(lens): add history panel with search, grouping, and delete"
```

---

## Chunk 5: Download Manager

### Task 10: Download Manager — Rust Backend (COM Event Hook)

**Files:**
- Modify: `src-tauri/src/commands/lens.rs` (download hook + download state)
- Modify: `src-tauri/src/lib.rs` (register commands)

**Note:** This is the most complex task. The `ICoreWebView2_4::add_DownloadStarting` event must be registered after WebView2 creation via `with_webview()`. The download operation provides progress events.

- [ ] **Step 1: Add download state to LensState**

Add a download tracking structure:

```rust
use std::sync::atomic::{AtomicU64, Ordering};

static DOWNLOAD_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadEntry {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub total_bytes: i64,
    pub received_bytes: i64,
    pub state: String, // "downloading", "completed", "cancelled", "failed"
    pub path: String,
    pub timestamp: String,
}
```

Add to `LensState`:
```rust
pub struct LensState {
    pub tabs: Mutex<HashMap<String, BrowserTab>>,
    pub active_tab_id: Mutex<Option<String>>,
    pub bounds: Mutex<Option<(f64, f64, f64, f64)>>,
    pub device_webviews: Mutex<Vec<DeviceWebview>>,
    pub downloads: Mutex<Vec<DownloadEntry>>,
}
```

- [ ] **Step 2: Create download event hook function**

Add a function that registers the download handler on a webview. This follows the same `with_webview()` pattern as `report_page_title()`:

```rust
fn register_download_handler(app: &AppHandle, webview: &tauri::Webview, state_arc: Arc<Mutex<Vec<DownloadEntry>>>) {
    let app_handle = app.clone();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::DownloadStartingEventHandler;
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_4;
            use windows_core::Interface;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        tracing::error!("[lens] Failed to get CoreWebView2 for download handler: {:?}", e);
                        return;
                    }
                };

                // QI to ICoreWebView2_4 for download support
                let wv4: ICoreWebView2_4 = match core_webview.cast() {
                    Ok(wv) => wv,
                    Err(e) => {
                        tracing::error!("[lens] ICoreWebView2_4 not available: {:?}", e);
                        return;
                    }
                };

                let app_clone = app_handle.clone();
                let downloads = state_arc.clone();

                let handler = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
                    if let Some(args) = args {
                        let download_op = args.DownloadOperation()?;
                        let uri = args.Uri()?.to_string();

                        // Get default download path from user's Downloads folder
                        let result_path = args.ResultFilePath()?.to_string();
                        let filename = std::path::Path::new(&result_path)
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "download".to_string());

                        let download_id = format!("dl-{}", DOWNLOAD_COUNTER.fetch_add(1, Ordering::Relaxed));

                        let entry = DownloadEntry {
                            id: download_id.clone(),
                            filename: filename.clone(),
                            url: uri.clone(),
                            total_bytes: download_op.TotalBytesToReceive()?,
                            received_bytes: 0,
                            state: "downloading".to_string(),
                            path: result_path,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                        };

                        // Track it
                        if let Ok(mut dl) = downloads.lock() {
                            dl.push(entry.clone());
                        }

                        // Notify frontend
                        let _ = app_clone.emit("lens-download-started", &entry);

                        // Allow the download to proceed
                        args.SetHandled(false)?;

                        // Monitor progress via state change events
                        let app_for_progress = app_clone.clone();
                        let dl_id = download_id.clone();
                        let downloads_for_progress = downloads.clone();

                        let state_handler = webview2_com::StateChangedEventHandler::create(
                            Box::new(move |op, _args| {
                                if let Some(op) = op {
                                    let received = op.BytesReceived().unwrap_or(0);
                                    let total = op.TotalBytesToReceive().unwrap_or(-1);
                                    let state = match op.State() {
                                        Ok(s) => match s.0 {
                                            0 => "downloading",
                                            1 => "interrupted",
                                            2 => "completed",
                                            _ => "unknown",
                                        },
                                        Err(_) => "unknown",
                                    };

                                    // Update tracking
                                    if let Ok(mut dl) = downloads_for_progress.lock() {
                                        if let Some(entry) = dl.iter_mut().find(|e| e.id == dl_id) {
                                            entry.received_bytes = received;
                                            if total > 0 { entry.total_bytes = total; }
                                            entry.state = state.to_string();
                                        }
                                    }

                                    // Notify frontend
                                    let _ = app_for_progress.emit("lens-download-progress", serde_json::json!({
                                        "id": dl_id,
                                        "received": received,
                                        "total": total,
                                        "state": state,
                                    }));
                                }
                                Ok(())
                            })
                        );

                        let _ = download_op.add_StateChanged(&state_handler);
                    }
                    Ok(())
                }));

                let mut token = webview2_com::Microsoft::Web::WebView2::Win32::EventRegistrationToken::default();
                if let Err(e) = wv4.add_DownloadStarting(&handler, &mut token) {
                    tracing::error!("[lens] Failed to register download handler: {:?}", e);
                }

                tracing::info!("[lens] Download handler registered");
            }
        }
    });
}
```

- [ ] **Step 3: Call register_download_handler after webview creation**

In `create_tab_webview()`, in the `Ok(_webview)` match arm (line ~325), capture the webview and register:

```rust
Ok(webview_ref) => {
    info!("[lens] Webview created successfully: {} (tab {})", label_clone, tab_id_clone);

    // Register download handler
    let downloads_arc = Arc::new(/* get from LensState */);
    register_download_handler(&app_for_create, &webview_ref, downloads_arc);

    Ok(label_clone)
}
```

**Note:** The `LensState` isn't directly available inside `create_tab_webview()` (it's called from the async command). You'll need to pass the `Arc<Mutex<Vec<DownloadEntry>>>` from LensState into this function, or restructure so the download state is accessible. The simplest approach: make `LensState.downloads` an `Arc<Mutex<Vec<DownloadEntry>>>` and clone the Arc when passing to `create_tab_webview()`.

- [ ] **Step 4: Add download Tauri commands**

```rust
#[tauri::command]
pub fn lens_get_downloads(
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let downloads = state.downloads.lock().unwrap();
    IpcResponse::ok_data(serde_json::json!({ "downloads": downloads.clone() }))
}

#[tauri::command]
pub fn lens_clear_downloads(
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let mut downloads = state.downloads.lock().unwrap();
    downloads.retain(|d| d.state == "downloading"); // Keep active ones
    IpcResponse::ok()
}

#[tauri::command]
pub fn lens_open_download(path: String) -> IpcResponse {
    if let Err(e) = opener::open(&path) {
        return IpcResponse::error(&format!("Failed to open: {}", e));
    }
    IpcResponse::ok()
}

#[tauri::command]
pub fn lens_open_download_folder(path: String) -> IpcResponse {
    let parent = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if let Err(e) = opener::open(&parent) {
        return IpcResponse::error(&format!("Failed to open folder: {}", e));
    }
    IpcResponse::ok()
}
```

- [ ] **Step 5: Register commands in lib.rs**

Add to `generate_handler![]`:
```rust
lens_cmds::lens_get_downloads,
lens_cmds::lens_clear_downloads,
lens_cmds::lens_open_download,
lens_cmds::lens_open_download_folder,
```

- [ ] **Step 6: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles. If `DownloadStartingEventHandler` or `ICoreWebView2_4` aren't in webview2-com 0.38, check what's available and adapt. May need `windows_core::Interface` for `.cast()`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/lens.rs src-tauri/src/lib.rs
git commit -m "feat(lens): hook WebView2 DownloadStarting event with progress tracking"
```

---

### Task 11: Download Manager — Frontend Store + Panel

**Files:**
- Create: `src/lib/stores/downloads.svelte.js`
- Create: `src/components/lens/DownloadsPanel.svelte`
- Modify: `src/lib/api.js` (add wrappers)
- Modify: `src/components/lens/LensPreview.svelte` (mount panel, toast on complete)

- [ ] **Step 1: Add API wrappers**

In `src/lib/api.js`:
```javascript
export async function lensGetDownloads() {
  return invoke('lens_get_downloads', {});
}
export async function lensClearDownloads() {
  return invoke('lens_clear_downloads', {});
}
export async function lensOpenDownload(path) {
  return invoke('lens_open_download', { path });
}
export async function lensOpenDownloadFolder(path) {
  return invoke('lens_open_download_folder', { path });
}
```

- [ ] **Step 2: Create downloads.svelte.js store**

```javascript
import { lensGetDownloads, lensClearDownloads, lensOpenDownload, lensOpenDownloadFolder } from '$lib/api.js';
import { listen } from '@tauri-apps/api/event';
import toastStore from '$lib/stores/toast.svelte.js';

function createDownloadsStore() {
  let downloads = $state([]);
  let unlistenStarted = null;
  let unlistenProgress = null;

  async function init() {
    // Load existing downloads
    const resp = await lensGetDownloads();
    if (resp?.data?.downloads) {
      downloads = resp.data.downloads;
    }

    // Listen for new downloads
    unlistenStarted = await listen('lens-download-started', (event) => {
      const entry = event.payload;
      downloads = [entry, ...downloads];
    });

    // Listen for progress updates
    unlistenProgress = await listen('lens-download-progress', (event) => {
      const { id, received, total, state } = event.payload;
      downloads = downloads.map(d => {
        if (d.id !== id) return d;
        const updated = { ...d, received_bytes: received, state };
        if (total > 0) updated.total_bytes = total;
        return updated;
      });

      // Toast on completion
      if (state === 'completed') {
        const entry = downloads.find(d => d.id === id);
        if (entry) {
          toastStore.addToast({
            message: `Downloaded ${entry.filename}`,
            severity: 'success',
            duration: 5000,
            action: {
              label: 'Open',
              callback: () => lensOpenDownload(entry.path),
            },
          });
        }
      }
    });
  }

  async function clearCompleted() {
    await lensClearDownloads();
    downloads = downloads.filter(d => d.state === 'downloading');
  }

  async function openFile(path) {
    await lensOpenDownload(path);
  }

  async function openFolder(path) {
    await lensOpenDownloadFolder(path);
  }

  function destroy() {
    unlistenStarted?.();
    unlistenProgress?.();
  }

  return {
    get downloads() { return downloads; },
    get activeCount() { return downloads.filter(d => d.state === 'downloading').length; },
    init,
    clearCompleted,
    openFile,
    openFolder,
    destroy,
  };
}

const downloadsStore = createDownloadsStore();
export default downloadsStore;
```

- [ ] **Step 3: Create DownloadsPanel.svelte**

```svelte
<script>
  import downloadsStore from '$lib/stores/downloads.svelte.js';

  let { onClose } = $props();

  function formatBytes(bytes) {
    if (bytes < 0) return 'Unknown';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function progressPercent(entry) {
    if (entry.total_bytes <= 0) return -1; // indeterminate
    return Math.round((entry.received_bytes / entry.total_bytes) * 100);
  }
</script>

<div class="downloads-panel">
  <div class="panel-header">
    <button class="back-btn" onclick={onClose} title="Back">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
    <h3>Downloads</h3>
    <button class="clear-btn" onclick={() => downloadsStore.clearCompleted()}>Clear completed</button>
  </div>

  <div class="downloads-list">
    {#each downloadsStore.downloads as entry (entry.id)}
      <div class="download-entry" class:completed={entry.state === 'completed'} class:failed={entry.state === 'failed'}>
        <div class="entry-info">
          <span class="filename">{entry.filename}</span>
          <span class="meta">
            {#if entry.state === 'downloading'}
              {formatBytes(entry.received_bytes)} / {formatBytes(entry.total_bytes)}
            {:else if entry.state === 'completed'}
              {formatBytes(entry.total_bytes)}
            {:else}
              {entry.state}
            {/if}
          </span>
          {#if entry.state === 'downloading'}
            {@const pct = progressPercent(entry)}
            <div class="progress-bar">
              {#if pct >= 0}
                <div class="progress-fill" style="width: {pct}%"></div>
              {:else}
                <div class="progress-fill indeterminate"></div>
              {/if}
            </div>
          {/if}
        </div>
        <div class="entry-actions">
          {#if entry.state === 'completed'}
            <button onclick={() => downloadsStore.openFile(entry.path)} title="Open file">Open</button>
            <button onclick={() => downloadsStore.openFolder(entry.path)} title="Show in folder">Folder</button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty">No downloads</div>
    {/each}
  </div>
</div>

<style>
  .downloads-panel {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: var(--bg-primary, #1a1a2e);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .panel-header h3 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .back-btn, .clear-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }
  .back-btn:hover, .clear-btn:hover {
    color: var(--text-primary, #ccc);
    background: var(--bg-hover, rgba(255,255,255,0.08));
  }
  .clear-btn {
    font-size: 12px;
    padding: 4px 8px;
  }

  .downloads-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .download-entry {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 8px;
  }
  .download-entry:hover {
    background: var(--bg-hover, rgba(255,255,255,0.04));
  }

  .entry-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .filename {
    font-size: 13px;
    color: var(--text-primary, #ccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-size: 11px;
    color: var(--text-secondary, #666);
  }

  .progress-bar {
    height: 3px;
    background: var(--bg-hover, rgba(255,255,255,0.08));
    border-radius: 2px;
    overflow: hidden;
    margin-top: 2px;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent, #7aa2f7);
    border-radius: 2px;
    transition: width 0.2s;
  }
  .progress-fill.indeterminate {
    width: 30%;
    animation: indeterminate 1.5s infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .entry-actions {
    display: flex;
    gap: 4px;
  }
  .entry-actions button {
    background: none;
    border: 1px solid var(--border-color, #333);
    color: var(--text-secondary, #888);
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
  }
  .entry-actions button:hover {
    color: var(--text-primary, #ccc);
    background: var(--bg-hover, rgba(255,255,255,0.08));
  }

  .completed .filename { color: var(--text-secondary, #888); }
  .failed .filename { color: var(--error, #f38ba8); }
  .failed .meta { color: var(--error, #f38ba8); }

  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary, #666);
    font-size: 13px;
  }
</style>
```

- [ ] **Step 4: Mount DownloadsPanel in LensPreview.svelte**

```javascript
import DownloadsPanel from './DownloadsPanel.svelte';
import downloadsStore from '$lib/stores/downloads.svelte.js';

let showDownloads = $state(false);

// Initialize downloads store
$effect(() => {
  downloadsStore.init();
  return () => downloadsStore.destroy();
});

function handleDownloads() { showDownloads = true; }
```

Template:
```svelte
{#if showDownloads}
  <DownloadsPanel onClose={() => showDownloads = false} />
{/if}
```

Wire `onDownloads` through BrowserTabBar menu.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Manual test**

1. Start app, open browser panel
2. Navigate to a page with a downloadable file
3. Click download link → verify download starts (was previously silent)
4. Verify toast appears on completion
5. Open Downloads from menu → verify list shows entry
6. Click "Open" → file opens
7. Click "Folder" → explorer opens to download location

- [ ] **Step 7: Commit**

```bash
git add src/lib/stores/downloads.svelte.js src/components/lens/DownloadsPanel.svelte src/lib/api.js src/components/lens/LensPreview.svelte
git commit -m "feat(lens): add downloads panel with progress tracking and toast notifications"
```

---

## Chunk 6: Download Settings + Final Wiring

### Task 12: Download Settings

**Files:**
- Modify: `src/lib/stores/config.svelte.js` (add download config)
- Modify: `src-tauri/src/commands/lens.rs` (read config in download handler)

- [ ] **Step 1: Add download settings to DEFAULT_CONFIG**

In `src/lib/stores/config.svelte.js`, add to `DEFAULT_CONFIG`:

```javascript
browser: {
  downloadAskLocation: false,  // true = always show Save As dialog
  downloadPath: '',            // empty = system Downloads folder
},
```

- [ ] **Step 2: Use config in download handler**

In the `DownloadStartingEventHandler` callback in `lens.rs`, read the config to decide whether to show Save As or auto-download:

```rust
// Inside the download handler callback:
let config = crate::commands::config::get_config_snapshot();
let ask_location = config.get("browser")
    .and_then(|b| b.get("downloadAskLocation"))
    .and_then(|v| v.as_bool())
    .unwrap_or(false);

if ask_location {
    // Let WebView2 show its native save dialog
    args.SetHandled(false)?;
} else {
    // Auto-save to configured path (or default Downloads)
    let download_path = config.get("browser")
        .and_then(|b| b.get("downloadPath"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if !download_path.is_empty() {
        let dest = std::path::Path::new(download_path).join(&filename);
        args.SetResultFilePath(&HSTRING::from(dest.to_string_lossy().as_ref()))?;
    }
    args.SetHandled(true)?;
}
```

- [ ] **Step 3: Wire "Download settings" menu item**

The `onDownloadSettings` prop in BrowserMenu should navigate to Settings:
```javascript
function handleDownloadSettings() {
  navigationStore.setView('settings');
  // Optionally: scroll to browser section
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/config.svelte.js src-tauri/src/commands/lens.rs src/components/lens/LensPreview.svelte
git commit -m "feat(lens): add download settings (ask location, custom path)"
```

---

### Task 13: Final Wiring & Cleanup

**Files:**
- Modify: `src/components/lens/LensPreview.svelte` (wire all menu actions)
- Modify: `src/components/lens/BrowserTabBar.svelte` (pass all props)
- Modify: `docs/source-of-truth/BROWSER-CONTROL.md` (update known gaps)

- [ ] **Step 1: Wire all menu callbacks through BrowserTabBar to LensPreview**

Ensure all these props flow correctly:
- `zoomLevel`, `onZoomIn`, `onZoomOut`, `onZoomReset` → zoom handlers
- `onFind` → `toggleFind()`
- `onDownloads` → `() => showDownloads = true`
- `onHistory` → `() => showHistory = true`
- `onDownloadSettings` → `() => navigationStore.setView('settings')`

- [ ] **Step 2: Update BROWSER-CONTROL.md**

Mark the Download Manager gap as resolved. Add documentation about the new menu and features.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(lens): complete browser menu with downloads, history, zoom, find"
```
