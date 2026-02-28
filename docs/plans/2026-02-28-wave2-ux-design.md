# Wave 2 UX Improvements — Design Document

> **Source:** `docs/source-of-truth/UX-AUDIT.md` priority items post-Wave 1 + status bar.

**Goal:** Close the 6 highest-impact remaining UX gaps to make Lens feel like a daily-driver editor.

**Scope:** Focused wave — 6 items, mix of quick wins and medium features.

---

## Items

### 1. Closed Tab History + Ctrl+Shift+T

**Problem:** Closing a tab permanently loses it. No way to undo a close.

**Design:**
- Add `closedTabs = $state([])` to `tabs.svelte.js` — stack of `{ path, type, groupId, title }`, max 20
- `closeTab()` pushes tab data onto stack before removing (skip untitled files)
- `reopenClosedTab()` pops from stack, calls `openFile()` with saved groupId (fallback to focused group if original group gone)
- Shortcut: `Ctrl+Shift+T` in `shortcuts.svelte.js`
- Context menu: "Reopen Closed Editor" added to `TabContextMenu.svelte`
- No cursor/scroll restoration — file reopens at position 0 (fresh from disk)

**Files:** `tabs.svelte.js`, `shortcuts.svelte.js`, `TabContextMenu.svelte`

---

### 2. Mouse Wheel Scroll on Tab Bar

**Problem:** Tab bar with many tabs requires clicking tiny scrollbar. Wheel scroll doesn't work.

**Design:**
- Add `onwheel` handler to `.tabs-scroll` container in `GroupTabBar.svelte`
- Convert vertical delta to horizontal: `container.scrollLeft += e.deltaY`
- `e.preventDefault()` to prevent page scroll

**Files:** `GroupTabBar.svelte`

---

### 3. Back/Forward Navigation (Alt+Left/Right)

**Problem:** After Ctrl+Click jump to definition, no way to go back. Breaks navigation flow.

**Design:**
- New store: `navigation-history.svelte.js`
  - `stack = []` of `{ path, line, character, groupId }`, max 50
  - `currentIndex` pointer
  - `pushLocation(loc)` — truncate forward history if not at top, then push
  - `goBack()` / `goForward()` — return location at decremented/incremented index
  - `canGoBack` / `canGoForward` derived getters
- Push current location before: Ctrl+Click definition, F12 definition, go-to-line, find-references click
- Alt+Left/Right keybindings in `editor-extensions.js` (CodeMirror scope, editor-focused only)
- Navigation action: open file if different path, move cursor to stored position

**Files:** `navigation-history.svelte.js` (new), `editor-extensions.js`, `FileEditor.svelte`, `editor-lsp.svelte.js`

---

### 4. Ctrl+Hover Underline (Definition Hint)

**Problem:** No visual feedback that Ctrl+Click will navigate to a definition.

**Design:**
- CodeMirror `ViewPlugin` in `editor-extensions.js`:
  - Track Ctrl key state via keydown/keyup on editor DOM
  - On mousemove while Ctrl held, get word under cursor via `view.posAtCoords()`
  - Apply `Decoration.mark` with `.cm-definition-hint` class
  - Remove on Ctrl release or mouse leave
- Optimistic underline (no LSP call) — same as VS Code. LSP check on actual click.
- CSS in `editor-theme.js`: `.cm-definition-hint` → `text-decoration: underline`, `color: var(--accent)`, `cursor: pointer`

**Files:** `editor-extensions.js`, `editor-theme.js`

---

### 5. Ctrl+PageUp/PageDown (Prev/Next Tab)

**Problem:** No keyboard shortcut to cycle through editor tabs.

**Design:**
- Add `'prev-editor-tab': { keys: 'Ctrl+PageUp' }` and `'next-editor-tab': { keys: 'Ctrl+PageDown' }` to `shortcuts.svelte.js`
- Handler: get focused group's tabs, find active index, cycle to prev/next, call `tabsStore.setActive()`

**Files:** `shortcuts.svelte.js`

---

### 6. Tab Drag → Split Zones

**Problem:** Dragging editor tabs doesn't show split zones. Only file-tree drags trigger `DropZoneOverlay`.

**Design:**
- Add custom MIME type `application/x-voice-mirror-tab` in GroupTabBar's `dragstart` (alongside existing `text/plain`)
- In editor pane area, check `e.dataTransfer.types` during `dragover` for either `application/x-voice-mirror-file` or `application/x-voice-mirror-tab`
- Show `DropZoneOverlay` for tab drags with same 5-zone layout (center, L, R, T, B)
- On drop: parse tab data, call `editorGroupsStore.splitGroup()` in target direction, then `tabsStore.moveTab()` to new group
- Center zone = move tab to existing group (no split)

**Files:** `GroupTabBar.svelte`, `EditorPane.svelte` (or equivalent drop target), `DropZoneOverlay.svelte`

---

## What's NOT in scope

- Cursor/scroll position restoration on tab reopen (YAGNI for now)
- Ctrl+Tab MRU cycling (different feature, tracked separately)
- Context menu additions (Toggle Comment, Format — shortcuts already work)
- File tree keyboard navigation (tracked separately in IDE-GAPS)
