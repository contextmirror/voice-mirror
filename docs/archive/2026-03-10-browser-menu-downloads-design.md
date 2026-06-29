# Browser Menu & Downloads — Design Spec

**Date:** 2026-03-10
**Branch:** feature/lens
**Status:** Approved (revised after spec review)

## Problem

WebView2 suppresses downloads by default. Clicking download links does nothing. Additionally, the browser panel lacks standard browser controls (zoom, find, history) that users expect.

## Solution

Add a hamburger menu to the browser tab bar with four functional features: Downloads, History, Zoom, and Find on Page.

---

## 1. Download Manager

### COM Event Hook
- Hook `ICoreWebView2_4::add_DownloadStarting` **post-creation** via `with_webview()` + COM cast to `ICoreWebView2_4`
- Cannot be added in the `WebviewBuilder` chain — must be registered after `window.add_child()` returns
- On download start: check user preference — auto-save to Downloads folder, or show native Save As dialog via `ResultFilePath`
- Track active downloads via `ICoreWebView2DownloadOperation` events: `BytesReceived`, `TotalBytesToReceive`, `State`

### Download Settings
- **"Always ask where to save"** — bool, default: false
- **"Download location"** — path, default: system Downloads folder
- Stored in app settings (existing settings system via `config.svelte.js`)

### Downloads Panel
- Svelte component rendered as overlay inside browser area
- List entries: filename, size, status (downloading/complete/failed), progress bar, open file / open folder buttons
- State in `downloads.svelte.js` store, backed by JSON file for persistence
- Back arrow / close button returns to active web page

### Toast Notification
- Reuse existing `toastStore` (already has `progress` field) — no separate DownloadToast component
- "Downloaded filename.json" with "Open" action
- Auto-dismiss after 5 seconds

---

## 2. History

### Storage
- JSON file at `%APPDATA%/voice-mirror/browser-history.json`
- Array of `{ url, title, timestamp }` entries
- Capped at 200 entries, oldest pruned on insert
- Skip duplicate consecutive visits (same URL as last entry)
- `on_page_load` handler emits a history event → frontend `browser-history.svelte.js` store persists via Tauri command (keeps `on_page_load` lightweight, follows existing event pattern)

### History Panel
- Svelte component, same overlay pattern as Downloads
- Grouped by date: Today, Yesterday, Older
- Search/filter box at top — filters by URL and title
- Click to navigate, X to delete individual entries
- "Clear all history" at top

### Tauri Commands
- `lens_add_history_entry(url, title)` — append entry, prune if over 200
- `lens_get_history` — returns history array
- `lens_clear_history` — clears all entries

---

## 3. Zoom

### Implementation
- Native WebView2 COM: `ICoreWebView2Controller::SetZoomFactor(f64)` / `ZoomFactor(*mut f64)`
- Already available via existing `controller()` pattern in `browser_bridge.rs`
- No CDP needed — simpler and more reliable than DevTools Protocol
- Tauri command: `lens_set_zoom(tab_id, factor)`
- Levels: 25%, 33%, 50%, 67%, 75%, 80%, 90%, 100%, 110%, 125%, 150%, 175%, 200%
- Default: 100%. COM controller maintains state per-webview natively; `BrowserTab` struct stores it for UI display
- Reset button snaps back to 100%

### Menu UI
- Inline row: `[ - ] 100% [ + ]`
- Keyboard shortcuts: Ctrl+Plus, Ctrl+Minus, Ctrl+0 (reset) via `lens-shortcut` scheme

---

## 4. Find on Page

### Implementation
- `window.find(query, caseSensitive, backwards, wrapAround)` via existing `ExecuteScript` COM pattern
- **Limitation:** `window.find()` cannot provide match count or current index — only highlights current match
- Tauri commands: `lens_find_on_page(tab_id, query)`, `lens_find_next(tab_id)`, `lens_find_previous(tab_id)`, `lens_close_find(tab_id)`
- `window.getSelection().removeAllRanges()` via ExecuteScript to clear highlights on close

### UI
- Find bar slides in at top of browser panel
- Text input + up/down arrows + close (X) — no match count (API limitation)
- Triggered from menu or Ctrl+F via `lens-shortcut` scheme
- Escape closes the bar
- Find state is per-tab (switching tabs hides/shows the bar with its query)

---

## 5. Hamburger Menu

### Placement
- Right end of `LensToolbar.svelte` toolbar row, after the URL bar input
- Three-dot vertical icon, matching existing `nav-btn` style (28x28px)
- This is the natural Chrome/Brave menu position — next to the address bar

### Layout
```
┌───────────────────────────┐
│  Zoom   [ - ] 100% [ + ] │
│───────────────────────────│
│  Find on page     Ctrl+F  │
│───────────────────────────│
│  Downloads                │
│  History                  │
│───────────────────────────│
│  Download settings        │
└───────────────────────────┘
```

### Behavior
- Click outside or Escape dismisses
- Keyboard navigable (arrow keys + Enter)
- Zoom row is interactive inline (no sub-panel)
- Downloads/History open overlay panels in the browser area
- Download settings opens in Voice Mirror Settings panel

---

## Keyboard Shortcuts

Must extend `build_shortcut_script()` in `lens.rs` to intercept these keys (with `e.preventDefault()` to suppress WebView2's native zoom/find):
- `Ctrl+F` — open Find bar (suppresses Chromium's built-in find)
- `Ctrl+Plus` / `Ctrl+=` — zoom in
- `Ctrl+Minus` — zoom out
- `Ctrl+0` — reset zoom

Frontend `lens-shortcut` listener in `App.svelte` must also be extended to handle these new keys.

---

## File Inventory

### Rust (src-tauri/src/)
- `commands/lens.rs` — new commands (zoom, find, history), download event hook post-creation, extend `build_shortcut_script()`
- `services/browser_bridge.rs` — zoom via `SetZoomFactor` on controller
- `lib.rs` — register new commands in `generate_handler![]`

### Frontend (src/)
- `components/lens/BrowserMenu.svelte` — hamburger dropdown (new)
- `components/lens/DownloadsPanel.svelte` — downloads overlay (new)
- `components/lens/HistoryPanel.svelte` — history overlay (new)
- `components/lens/FindBar.svelte` — find-on-page bar (new)
- `lib/stores/downloads.svelte.js` — download state + persistence (new)
- `lib/stores/browser-history.svelte.js` — history state + persistence (new)
- `components/lens/LensToolbar.svelte` — add menu button after URL bar (modify)
- `components/lens/LensWorkspace.svelte` — mount FindBar, wire overlay panels (modify)
- `lib/api.js` — add wrapper functions for new Tauri commands (modify)
- `App.svelte` — extend `lens-shortcut` listener for new keys (modify)
- `lib/stores/config.svelte.js` — add download settings to `DEFAULT_CONFIG` (modify)

### Data Files
- `%APPDATA%/voice-mirror/browser-history.json` — history persistence
- `%APPDATA%/voice-mirror/downloads.json` — download records persistence
