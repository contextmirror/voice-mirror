# UX Completeness Audit — Voice Mirror Lens vs VS Code / Zed

> Internal doc. Comprehensive audit of interactive surfaces, context menus, keyboard shortcuts, status indicators, tab behaviors, editor micro-interactions, and drag-and-drop. Compared against VS Code and Zed.
>
> Last updated: 2026-02-28

---

## Executive Summary

Voice Mirror's Lens workspace has solid functionality with remaining UX gaps in **interactive polish**. Waves 1 and 2 (16 items total) have been completed. Remaining gaps:

- **Multiple medium-priority gaps** across context menus, tabs, editor, drag-and-drop

### Wave 1 — COMPLETED

All 10 items from the initial wave are done:

| # | Fix | Status |
|---|-----|--------|
| 1 | Terminal body context menu (Copy/Paste/SelectAll/Clear) | ✅ Done |
| 2 | Wire Ctrl+W to close active tab | ✅ Done |
| 3 | Save prompt on dirty tab close | ✅ Done |
| 4 | Wire Ctrl+B (toggle sidebar) + Ctrl+J (toggle panel) | ✅ Done |
| 5 | Fix Ctrl+Shift+M conflict (mute→Ctrl+Shift+U, stats→Ctrl+Shift+D) | ✅ Done |
| 6 | Fix Ctrl+Shift+O conflict (overlay→Ctrl+Shift+Y) | ✅ Done |
| 7 | Tab/Shift+Tab for indent in editor | ✅ Done (already had `indentWithTab`) |
| 8 | F12 for Go to Definition | ✅ Done (already wired in editor-extensions.js) |
| 9 | Editor font zoom (Ctrl+=/Ctrl+-/Ctrl+0) | ✅ Done (already wired with config persistence) |
| 10 | Middle-click to close editor tabs | ✅ Done |

### Wave 2 — COMPLETED

All 6 items from the second wave are done:

| # | Fix | Status |
|---|-----|--------|
| 1 | Closed tab history + Ctrl+Shift+T (max 20, context menu item) | ✅ Done |
| 2 | Mouse wheel scroll on tab bar (deltaY → scrollLeft) | ✅ Done |
| 3 | Back/forward navigation (Alt+Left/Right, navigation-history store) | ✅ Done |
| 4 | Ctrl+hover definition underline (ViewPlugin, Decoration.mark, cm-definition-hint CSS) | ✅ Done |
| 5 | Ctrl+PageUp/PageDown tab cycling (prev/next with wrap-around) | ✅ Done |
| 6 | Tab drag → split zones (custom MIME, DropZoneOverlay, 5-zone split) | ✅ Done |

### Next Priorities

| # | Fix | Category | Effort |
|---|-----|----------|--------|
| ~~1~~ | ~~**Quick fix lightbulb in gutter**~~ (💡 GutterMarker + debounced LSP probe) | Editor | ✅ Done |
| ~~2~~ | ~~**Ctrl+Tab MRU tab cycling**~~ | ~~Tabs~~ | Removed (acceptable as-is) |
| ~~3~~ | ~~**Unsplit terminal preserves terminals**~~ (was killing them) | Terminal | ✅ Done |
| ~~4~~ | ~~**Text drag in editor**~~ | ~~Drag~~ | Removed (acceptable as-is) |

---

## 1. Context Menus (Right-Click)

### 1.1 Editor Body Context Menu

**File:** `src/components/lens/EditorContextMenu.svelte`

#### What We Have
- **Diagnostic section** (conditional): Fix This Error (AI)
- **AI section** (conditional, when text selected): Explain This, Refactor This, Add Tests
- **LSP section** (conditional): Go to Definition, Find References, Rename Symbol, Quick Fix
- **Edit section**: Cut, Copy, Paste, Select All
- **Folding section**: Fold/Unfold at Cursor, Fold/Unfold All
- **File section**: Copy Path, Copy Relative Path, Copy as Markdown, Reveal in File Explorer

#### Missing vs VS Code (should add)

| Item | Priority |
|------|----------|
| **Toggle Line Comment (Ctrl+/)** | High |
| **Format Document (Shift+Alt+F)** | High |
| **Toggle Block Comment** | Medium |
| **Command Palette... (Ctrl+Shift+P)** | Medium |
| **Change All Occurrences** | Medium |
| Go to Type Definition | Medium |
| Peek Definition (Alt+F12) | Low |
| Refactor... submenu | Low |

---

### 1.2 Editor Tab Context Menu

**File:** `src/components/lens/TabContextMenu.svelte`

#### What We Have
Close, Close Others, Close to the Right, Close All, Rename (F2), Split Right, Split Down, Open to the Side, Copy Path, Copy Relative Path, Reveal in File Explorer

#### Missing vs VS Code

| Item | Priority |
|------|----------|
| **Close Saved** | High |
| **Pin / Unpin Tab** (discoverability — double-click-to-pin exists but no menu) | High |
| ~~Reopen Closed Editor (Ctrl+Shift+T)~~ | ~~Medium~~ ✅ Done (Wave 2) |
| Close to the Left | Medium |
| Split Up, Split Left | Low |

---

### 1.3 Editor Gutter Context Menu

#### What We Have
Same as editor body (the fallback handler catches gutter clicks). Diagnostic items correctly appear when right-clicking diagnostic markers.

#### Missing vs VS Code

| Item | Priority |
|------|----------|
| Go to Line... (Ctrl+G) | Medium |
| Toggle Comment (prominent positioning) | Medium |
| Breakpoint actions | Low (requires DAP) |

---

### 1.4 File Tree Context Menu

**File:** `src/components/lens/FileContextMenu.svelte`

Four modes: **empty space**, **file**, **folder**, **git change**.

#### What We Have
- **Empty:** New File, New Folder
- **File:** Open, Open Diff (if git), New File, New Folder, Rename (F2), Delete, Copy Path, Copy Relative Path, Reveal
- **Folder:** New File, New Folder, Rename (F2), Delete, Copy Path, Copy Relative Path, Reveal
- **Changes:** Open Diff, Copy Path, Copy Relative Path, Reveal

#### Missing vs VS Code

| Item | Priority |
|------|----------|
| **Open to the Side** (split editor) | High |
| **Open in Terminal** | High |
| **Stage / Unstage / Discard** on git changes | Medium |
| Find in Folder... | Medium |
| Duplicate file | Medium |
| Cut / Copy / Paste (file move/duplicate operations) | Medium |
| Select for Compare / Compare with Selected | Low |
| Collapse Folder Recursively | Low |

---

### 1.5 Terminal Body Context Menu — CRITICAL GAP

**File:** `src/components/terminal/Terminal.svelte`

#### What We Have
**Nothing.** Right-clicking in the terminal canvas produces no menu. The global context menu blocker in `main.js` suppresses the native browser menu, and no custom menu replaces it.

#### What VS Code Has
Copy, Paste, Select All, Clear Terminal, Split Terminal, Find (Ctrl+F), Change Terminal Profile

#### Recommendation
**CRITICAL** — Add a terminal body context menu. Users universally expect right-click Copy/Paste in a terminal. Minimum items: Copy, Paste, Select All, Clear, separator, Split Right, Split Down, separator, Find (Ctrl+F).

---

### 1.6 Terminal Instance Context Menu (Sidebar/Tab Right-Click)

**File:** `src/components/terminal/TerminalContextMenu.svelte`

#### What We Have
Split Right, Split Down, Change Color, Change Icon, Rename (F2), Kill Terminal, Unsplit Terminal

#### Missing vs VS Code

| Item | Priority |
|------|----------|
| **Copy** | High |
| **Paste** | High |
| **Clear Terminal** | High |
| Select All | Medium |
| Toggle Find (Ctrl+F) | Medium |

---

### 1.7 Terminal Tab Strip Context Menu

**File:** `src/components/terminal/TerminalTabStrip.svelte`

#### What We Have
**Not wired.** The component accepts an `oncontextmenu` prop but `TerminalPanel.svelte` doesn't connect it.

#### Recommendation
**Medium** — Wire the existing prop to show `TerminalContextMenu`.

---

### 1.8 Diff Viewer Context Menu

**File:** `src/components/lens/DiffViewer.svelte`

#### What We Have
Copy, Select All, Open File, Copy Path, Copy Relative Path, Reveal in File Explorer

#### Missing vs VS Code

| Item | Priority |
|------|----------|
| **Revert Block/Hunk** | High |
| Go to Next/Previous Change (in menu, already has keyboard) | Medium |
| Stage This Hunk | Medium |

---

### 1.9 Browser Tab Context Menu

**File:** `src/components/lens/BrowserTabBar.svelte`

#### What We Have
Close Tab (single item)

#### Missing

| Item | Priority |
|------|----------|
| **Reload Tab** | High |
| **New Tab** | High |
| Close Other Tabs | Medium |
| Duplicate Tab | Medium |

---

### 1.10 Other Surfaces

| Surface | Current Menu | Gap |
|---------|-------------|-----|
| Voice Agent tab (outer strip) | Clear, Provider selection, Stop | Good — no gaps |
| Output tab (outer strip) | Clear Output, Copy All, Word Wrap, Scroll Lock | Good — no gaps |
| Terminal tab (outer strip) | None | Low — could add "New Terminal" |
| Chat/Session entries | Rename, Delete | Could add Duplicate, Export |
| Project strip avatars | Remove Project | **Edit Project dialog** (name, icon upload, color, startup script) + Open in Terminal, Copy Path — see §1.11 |
| Empty terminal sidebar | New Terminal | Could add "New with Profile..." |

---

### 1.11 Project Strip Context Menu + Edit Project Dialog

**File:** `src/components/sidebar/ProjectStrip.svelte`

**Reference:** OpenCode Desktop (`packages/app/src/components/dialog-edit-project.tsx`)

#### What We Have
Right-click on a project avatar shows a single "Remove Project" item. Project avatars display a colored letter derived from the folder name.

#### What OpenCode Desktop Has
Right-click context menu: **Edit**, Enable/Disable Workspaces, Clear Notifications, Close.

The **Edit** item opens a modal dialog with:
- **Project name** — text input (defaults to folder name)
- **Project icon** — click-to-upload image with drag-and-drop, stored as base64 data URL. When no custom image, falls back to colored avatar.
- **Color palette** — 6 color dots (pink, mint, orange, purple, cyan, lime) for avatar background. Uses CSS variables per theme. Hidden when custom image is uploaded.
- **Workspace startup script** — multiline monospace textarea for shell commands to run when opening the project (e.g. `npm run dev`, starting services)

#### Recommendation

| Item | Priority | Notes |
|------|----------|-------|
| **Edit Project dialog** (name, icon, color, startup script) | Medium | High-polish feature. Name + color are quick wins; icon upload + startup script are medium effort. |
| **Context menu expansion** (Edit, Clear Notifications, Close) | Medium | Currently only "Remove Project" — should match OpenCode's menu |
| **Startup script execution** | Medium-Large | Requires Tauri command to run shell commands on project open. Useful for auto-starting dev servers. |

---

## 2. Status Bar & Indicators

### 2.1 Bottom Status Bar — CRITICAL GAP

#### What We Have
**No bottom status bar exists.** The closest equivalent is `StatusDropdown.svelte` — a popover button in the FileTree header showing server/LSP status. It requires clicking to see anything.

`StatsBar.svelte` is a floating debug widget (CPU/MEM), not a status bar.

#### What VS Code Has (always visible at bottom)
Branch name, sync status, error/warning counts, line:column, spaces/tabs, encoding, EOL, language mode, Copilot status, notification bell

#### What Zed Has
Branch name, diagnostics count, cursor position, indentation, line endings, language server status

#### Gap Assessment

| Indicator | Priority | Notes |
|-----------|----------|-------|
| **Line:Column cursor position** | P0 | Used constantly by every developer |
| **Aggregate error/warning count** | P0 | Critical for project health awareness |
| **Language mode** | P1 | Expected in any code editor |
| **Git branch name** | P1 | Already computed in GitCommitPanel; needs persistent slot |
| **Indentation type/size** | P1 | Important for formatting |
| **Ahead/behind count** | P2 | Already computed; needs persistent display |
| **LSP status** | P2 | Currently 3 clicks deep in StatusDropdown |
| Encoding (UTF-8) | P3 | Rarely needed but expected |
| EOL type (LF/CRLF) | P3 | Rarely needed but expected |

**Recommendation:** The single most impactful change is implementing a persistent bottom status bar. Most of the data already exists in stores — it just needs to be surfaced.

---

### 2.2 File/Editor Breadcrumbs

#### What We Have
**Nothing.** The only file identification is the tab title.

#### What VS Code Has
`src > lib > stores > config.svelte.js > createConfigStore > loadConfig` — each segment clickable.

#### Recommendation
**Medium priority.** Tabs show only filenames — ambiguous with duplicates across directories.

---

### 2.3 Activity Bar / Sidebar Badges

#### What We Have
ProjectStrip shows colored avatars with active indicator pills. **No badge counts.**

#### What VS Code Has
Source Control icon badge (change count), error badge, search result count badge.

#### Recommendation
**Medium priority.** Git change count badge on sidebar would provide at-a-glance awareness.

---

### 2.4 Diagnostics Panel

#### What We Have
Diagnostics are inline squiggles in the editor and count badges in the file tree. **No unified diagnostics list panel.**

#### What VS Code Has
Problems panel (Ctrl+Shift+M) with filterable, sortable list of all errors/warnings across workspace.

#### Recommendation
**Medium priority.** Unified error browsing would be valuable.

---

## 3. Tab Behaviors

### 3.1 Editor Tabs (GroupTabBar.svelte)

#### What We Have
- Click to activate, close button (X), preview mode (single-click italic → double-click to pin)
- Dirty indicator (accent dot), read-only indicator (lock icon), diff stats badges
- Context menu (11 items), drag to reorder/move between groups
- Drop zone for file-tree drags, scroll overflow (horizontal scroll)
- Double-click empty space creates new untitled file
- Split editor button (left-click = split right, right-click = menu)
- More actions menu: Show Opened Editors, Close All, Close Saved, Enable Preview, Lock Group
- Inline tab rename (F2), file type icons

#### Missing — Critical

| Gap | Priority | Notes |
|-----|----------|-------|
| **Ctrl+W to close tab** | P0 | Context menu shows "Ctrl+W" hint but no handler exists — purely decorative |
| **Save prompt on dirty close** | P0 | Closing unsaved file silently loses changes — data loss risk |
| **Middle-click to close** | P1 | Works on terminal tabs but NOT on editor tabs — no `onauxclick` handler |

#### Missing — Important

| Gap | Priority | Notes |
|-----|----------|-------|
| ~~Closed tab history + Ctrl+Shift+T~~ | ~~P1~~ | ✅ Done (Wave 2) — closedTabs stack (max 20), reopenClosedTab, context menu item |
| ~~Mouse wheel scroll on tab bar~~ | ~~P1~~ | ✅ Done (Wave 2) — onwheel handler converts deltaY to scrollLeft |
| **Ctrl+Tab MRU cycling** | P2 | No tab activation history tracked |
| ~~Ctrl+PageUp/PageDown~~ | ~~P2~~ | ✅ Done (Wave 2) — prev/next editor tab with wrap-around |
| **Close to the Left** | P2 | Has "Close to the Right" but not Left |
| **Git/diagnostic tab decorations** | P2 | VS Code colors tab titles by git status |
| Tab overflow dropdown | P3 | No ">>" icon for hidden tabs |

---

### 3.2 Terminal Tabs (TerminalTabStrip.svelte)

#### What We Have
Click to activate, close button (hover), middle-click close, right-click context menu, split badge showing instance count, active tab highlight, scroll overflow

#### Missing

| Gap | Priority | Notes |
|-----|----------|-------|
| ~~Drag to reorder~~ | ~~P1~~ | Removed — acceptable as-is |
| ~~Inline rename (double-click)~~ | ~~P1~~ | Removed — prompt() dialog acceptable |
| Close Others / Close to Right | P2 | Not in context menu |
| Auto-detect terminal title | P3 | Static "Terminal N" unless manually renamed |

---

## 4. Editor Micro-Interactions

### 4.1 Selection — Working

| Behavior | Source |
|----------|--------|
| Select word (double-click) | CodeMirror default |
| Select all (Ctrl+A) | `defaultKeymap` |
| Expand selection (Mod+I → selectParentSyntax) | `defaultKeymap` (different key than VS Code's Shift+Alt+Right) |
| Column/box selection (Alt+drag) | `rectangularSelection()` in basicSetup |
| Multiple cursors (Ctrl+Alt+Up/Down) | Custom in `editor-extensions.js` |
| Select next occurrence (Ctrl+D) | `searchKeymap` |
| Select all occurrences (Ctrl+Shift+L) | `searchKeymap` |
| Highlight matching brackets | `bracketMatching()` in basicSetup |
| Highlight all occurrences of selected text | `highlightSelectionMatches()` in basicSetup |

### 4.1 Selection — Missing

| Behavior | Priority | Notes |
|----------|----------|-------|
| **Ctrl+L for select line (Windows)** | Medium | CodeMirror uses Alt+L, VS Code uses Ctrl+L |
| Expand/Shrink selection (Shift+Alt+Right/Left) | Low | `selectParentSyntax` covers main use case |

---

### 4.2 Line Operations — Working

| Behavior | Source |
|----------|--------|
| Move line up/down (Alt+Up/Down) | `defaultKeymap` |
| Copy line up/down (Shift+Alt+Up/Down) | `defaultKeymap` |
| Delete line (Ctrl+Shift+K) | `defaultKeymap` |
| Toggle line comment (Ctrl+/) | `defaultKeymap` |
| Toggle block comment (Alt+A) | `defaultKeymap` |
| Indent/outdent (Mod+]/[) | `defaultKeymap` |

### 4.2 Line Operations — Missing

| Behavior | Priority | Notes |
|----------|----------|-------|
| **Tab/Shift+Tab for indent** | HIGH | `indentWithTab` NOT included in extensions. Users expect Tab to indent selected blocks |
| Insert line above (Ctrl+Shift+Enter) | Medium | Not bound |
| Insert line below (Ctrl+Enter) | Medium | Not bound |
| Join lines | Low | No command exists |
| Sort lines | Very Low | No command exists |

---

### 4.3 Navigation — Working

| Behavior | Source |
|----------|--------|
| Go to matching bracket (Shift+Ctrl+\\) | `defaultKeymap` |
| Go to beginning/end of file (Ctrl+Home/End) | `defaultKeymap` |
| Go to beginning/end of line (Home/End) | `defaultKeymap` |
| Go word by word (Ctrl+Left/Right) | `defaultKeymap` |
| Page up/down | `defaultKeymap` |
| Go to line (Ctrl+G) | Command palette |
| Go to definition (Ctrl+Click) | Custom in FileEditor.svelte |

### 4.3 Navigation — Missing

| Behavior | Priority | Notes |
|----------|----------|-------|
| **F12 for Go to Definition** | HIGH | Only Ctrl+Click works. F12 in commands.svelte.js is display-only metadata |
| ~~Back/forward after navigation (Alt+Left/Right)~~ | ~~HIGH~~ | ✅ Done (Wave 2) — navigation-history store, Alt+Left/Right keybindings, push before Ctrl+Click |
| Peek definition (Alt+F12) | Medium | Inline definition preview widget |
| Scroll without cursor (Ctrl+Up/Down) | Medium | No viewport-only scrolling |

---

### 4.4 Editing Helpers — Working

| Behavior | Source |
|----------|--------|
| Auto-close brackets/quotes | `closeBrackets()` in basicSetup |
| Auto-surround selection | `closeBrackets()` |
| Undo/redo (Ctrl+Z / Ctrl+Shift+Z) | `history()` in basicSetup |
| Code folding (Ctrl+Shift+[/]) | `foldKeymap` in basicSetup |
| Format document (Shift+Alt+F) | Custom keybinding → LSP |
| Format on save | Config option, implemented in FileEditor |

### 4.4 Editing Helpers — Missing

| Behavior | Priority | Notes |
|----------|----------|-------|
| **Auto-indent on paste** | Medium | Pasted code is not reindented to match context |
| Transform to uppercase/lowercase | Low | No command palette entries |

---

### 4.5 Code Intelligence — Working

| Behavior | Source |
|----------|--------|
| Hover tooltip (300ms delay) | `editor-lsp.svelte.js` |
| Go-to-definition (Ctrl+Click) | FileEditor.svelte |
| Code actions (Ctrl+.) | `editor-extensions.js` → CodeActionsMenu |
| Rename symbol (F2) | `editor-extensions.js` → RenameInput |
| Find references (Shift+F12) | `editor-extensions.js` → ReferencesPanel |
| Signature help (auto on `(` `,`) | `editor-lsp.svelte.js` → SignatureHelp |
| Diagnostics (squiggles + lint gutter) | `lintGutter()` + `setDiagnostics()` |
| Autocomplete (LSP + activateOnTyping) | `editor-extensions.js` |

### 4.5 Code Intelligence — Missing

| Behavior | Priority | Notes |
|----------|----------|-------|
| ~~Ctrl+hover underline (definition hint)~~ | ~~Medium~~ | ✅ Done (Wave 2) — ViewPlugin with Ctrl key tracking, word detection, Decoration.mark, cm-definition-hint CSS |
| ~~Quick fix lightbulb in gutter~~ | ~~Medium~~ | ✅ Done — 💡 GutterMarker with debounced LSP probe, click to open CodeActionsMenu |
| Peek definition (Alt+F12) | Medium | Inline preview widget |
| Inlay hints (LSP) | Medium | Type annotations displayed inline |
| Diagnostic peek cycling (F8) | Low | No next-error navigation |

---

### 4.6 Font / Display — Working

| Behavior | Source |
|----------|--------|
| Font: Cascadia Code / Fira Code (with ligatures) | `tokens.css` |
| Active line highlight | `highlightActiveLine()` in basicSetup |
| Minimap | `@replit/codemirror-minimap` in `editor-extensions.js` |
| Git gutter (add/modify/delete markers + peek + revert) | `editor-git-gutter.js` |
| Custom theme synced with app theme | `editor-theme.js` |

### 4.6 Font / Display — Missing

| Behavior | Priority | Notes |
|----------|----------|-------|
| **Font zoom (Ctrl+= / Ctrl+-)** | HIGH | No way to adjust editor font size |
| **Word wrap toggle** | Medium | No way to toggle word wrap (exists in DiffViewer, not file editor) |
| **Tab size configuration** | Medium | No user-facing setting |
| Minimap toggle (show/hide) | Low | Always visible |
| Cursor blink/animation style | Low | Not configurable |
| Render whitespace | Low | Not available |
| Bracket pair colorization | Low | Not available |

---

## 5. Keyboard Shortcut Coverage

### 5.1 Critical Issues — Shortcuts That Don't Work

| Shortcut | Issue | Severity |
|----------|-------|----------|
| **Ctrl+W** | Shown as "Close" hint in TabContextMenu but **no handler exists** | CRITICAL |
| **Ctrl+Shift+M** | **Conflicts**: bound to both `toggle-mute` AND `stats-dashboard` globally — one silently fails | HIGH |
| **Ctrl+Shift+O** | **Conflicts**: in-app `go-to-symbol` overrides global `toggle-overlay` when app is focused | HIGH |
| **Ctrl+K W / Ctrl+K U** | Shown in GroupTabBar More menu but **chord handler doesn't recognize non-Ctrl second keys** | MEDIUM |
| **Delete** | Listed as `kill-terminal` in shortcuts but **no handler registered** | MEDIUM |
| **F12** | Listed in commands.svelte.js metadata for Go to Definition but **not wired to editor keymap** | HIGH |

### 5.2 Missing Global Shortcuts

| Shortcut | VS Code Action | Priority |
|----------|---------------|----------|
| **Ctrl+B** | Toggle sidebar | HIGH |
| **Ctrl+J** | Toggle bottom panel | HIGH |
| **Ctrl+W** | Close active tab | HIGH |
| **Ctrl+O** | Open file (menu shows hint but not wired) | HIGH |
| ~~Ctrl+Shift+T~~ | ~~Reopen closed tab~~ | ~~MEDIUM~~ ✅ Done (Wave 2) |
| ~~Ctrl+PageUp/Down~~ | ~~Previous/next editor tab~~ | ~~MEDIUM~~ ✅ Done (Wave 2) |
| **Ctrl+Shift+E** | Focus file tree | MEDIUM |
| Ctrl+Shift+S | Save As | LOW |
| F11 | Toggle fullscreen | LOW |

### 5.3 Missing Editor Shortcuts

| Shortcut | VS Code Action | Priority |
|----------|---------------|----------|
| **Tab / Shift+Tab** | Indent/outdent block (`indentWithTab` not included) | HIGH |
| **F12** | Go to Definition (only Ctrl+Click works) | HIGH |
| Ctrl+L | Select line (Windows — CM uses Alt+L) | MEDIUM |
| Ctrl+Shift+Enter | Insert line above | MEDIUM |
| Ctrl+Enter | Insert line below | MEDIUM |

### 5.4 Defined Shortcuts — Working Correctly

<details>
<summary>Full list of 50+ working shortcuts (click to expand)</summary>

**Global:**
Ctrl+, (settings), Ctrl+N (new chat), Ctrl+P (quick open), Ctrl+Shift+P/F1 (command palette), Ctrl+G (go to line), Ctrl+Shift+O (go to symbol), Ctrl+Shift+F (search in files), Ctrl+` (toggle terminal), Ctrl+\\ (split editor), Ctrl+1/2 (focus group), Ctrl+T (terminal tab), Escape (close panel), Ctrl+Tab/Shift+Tab (cycle bottom panels)

**Global (Tauri):**
Ctrl+Shift+; (voice), Ctrl+Shift+H (show/hide window)

**Editor (via CodeMirror):**
Ctrl+S (save), Shift+Alt+F (format), Ctrl+Alt+Up/Down (add cursor), F2 (rename), Shift+F12 (references), Ctrl+. (code actions), Ctrl+Shift+Space (signature help), Ctrl+Click (go to def), Ctrl+F (find), Ctrl+H (replace), Ctrl+/ (line comment), Ctrl+D (select next), Alt+Up/Down (move line), Shift+Alt+Up/Down (copy line), Ctrl+Shift+K (delete line), Ctrl+]/[ (indent/outdent), Ctrl+Shift+\\ (bracket match), Ctrl+Z/Shift+Z (undo/redo), Ctrl+Shift+[/] (fold/unfold)

**Chords:**
Ctrl+K → Ctrl+Left/Right/Up/Down (focus direction), Ctrl+K → Ctrl+= (even sizes), Ctrl+K → Ctrl+M (maximize)

**Terminal:**
Ctrl+Shift+' (new terminal), Ctrl+Shift+5 (split), Ctrl+F (find), Ctrl+C (copy/interrupt), Ctrl+V (paste), Alt+Left/Right (focus prev/next pane)

**Terminal Search:**
Escape (close), Enter (next), Shift+Enter (prev), Alt+C (toggle case), Alt+R (toggle regex)

**Diff Viewer:**
Alt+Down/Up (next/prev chunk)
</details>

---

## 6. Drag Interactions

### 6.1 What Works

| Surface | Drag Source | Drop Targets | Visual Feedback |
|---------|-----------|-------------|-----------------|
| **Editor tabs** (GroupTabBar) | Tab with `draggable` | Same/other tab bar (reorder/move) + file-tree drop support | Thin accent vertical line |
| **File tree** (FileTreeNode) | Files only (not folders) | EditorPane (5-zone overlay), GroupTabBar, LensWorkspace seams | Custom drag ghost, dashed zone overlay |
| **Terminal sidebar** (TerminalSidebar) | Instance rows | Same/other instance rows (reorder, cross-group move) | Top/bottom accent line, opacity fade |
| **Panel resize** (SplitPanel) | Handle divider | Continuous resize via pointer events | col-resize / row-resize cursor |
| **Window resize** (ResizeEdges) | Edge/corner strips | Native Tauri resize | Resize cursors |

### 6.2 ~~Missing~~ Done — High Priority

| Gap | Description | Status |
|-----|-------------|--------|
| ~~Tab drag → split zones~~ | ~~Dragging editor tabs does NOT activate DropZoneOverlay.~~ Custom MIME type, DropZoneOverlay detects tab drags, 5-zone split on drop. | ✅ Done (Wave 2) |

### 6.3 Missing — Medium Priority

| Gap | Description | Effort |
|-----|-------------|--------|
| ~~Text drag in editor~~ | ~~Global `dragstart` handler blocks CodeMirror text drag.~~ | Removed (acceptable as-is) |
| **External file drop from OS** | `dragDropEnabled: false` in tauri.conf.json. Enabling + adding handler would allow opening files dragged from Windows Explorer. | Medium |
| **File drag to terminal** | Cannot drop a file onto the terminal to insert its path. VS Code supports this. | Medium |

### 6.4 Missing — Low Priority

| Gap | Description |
|-----|-------------|
| File tree drag-to-move (between folders) | Complex (file system ops, undo, conflict detection) |
| Terminal tab strip drag reorder | Sidebar handles this; tab strip doesn't |
| Browser tab drag reorder | BrowserTabBar has no drag support |
| Custom tab drag ghost | No `setDragImage()` for editor tabs |

---

## Priority Summary — Remaining Items

### P0 — Critical

All P0 items completed (status bar done in prior work).

### P1 — High Priority

| # | Item | Category | Effort |
|---|------|----------|--------|
| ~~4~~ | ~~Closed tab history + Ctrl+Shift+T~~ | ~~Tabs~~ | ✅ Done (Wave 2) |
| ~~5~~ | ~~Mouse wheel scroll on tab bar~~ | ~~Tabs~~ | ✅ Done (Wave 2) |
| 6 | File tree: Open to the Side, Open in Terminal | Context Menus | Small |
| 7 | Browser tab: Reload, New Tab | Context Menus | Small |
| ~~8~~ | ~~Tab drag → split zones (extend DropZoneOverlay)~~ | ~~Drag~~ | ✅ Done (Wave 2) |

### P2 — Medium Priority

| # | Item | Category | Effort |
|---|------|----------|--------|
| ~~9~~ | ~~Back/forward navigation (Alt+Left/Right)~~ | ~~Editor~~ | ✅ Done (Wave 2) |
| ~~10~~ | ~~Ctrl+hover underline (definition hint)~~ | ~~Editor~~ | ✅ Done (Wave 2) |
| ~~11~~ | ~~Quick fix lightbulb in gutter~~ | ~~Editor~~ | ✅ Done |
| ~~12~~ | ~~Ctrl+Tab MRU tab cycling~~ | ~~Tabs~~ | Removed (acceptable as-is) |
| ~~13~~ | ~~Ctrl+PageUp/PageDown (prev/next tab)~~ | ~~Keyboards~~ | ✅ Done (Wave 2) |
| ~~14~~ | ~~Terminal inline rename~~ | ~~Tabs~~ | Removed (acceptable as-is) |
| ~~15~~ | ~~Terminal tab strip drag reorder~~ | ~~Drag~~ | Removed (acceptable as-is) |
| 16 | File path breadcrumbs | Status Bar | Medium |
| 17 | Sidebar badge counts (git changes, errors) | Status Bar | Medium |
| 18 | Diagnostics panel (unified error list) | Status Bar | Medium-Large | See `docs/implementation/LSP-CONFIG-GAPS.md` |
| 19 | Editor context menu: Toggle Comment, Format | Context Menus | Small |
| 20 | Diff context menu: Revert Hunk | Context Menus | Medium |
| 21 | File tree: Stage/Unstage/Discard on changes | Context Menus | Small |
| 22 | Word wrap toggle in editor | Editor | Small |
| 23 | Tab size configuration | Editor | Small |
| 24 | Auto-indent on paste | Editor | Medium |
| ~~25~~ | ~~Text drag in editor (unblock in main.js)~~ | ~~Drag~~ | Removed (acceptable as-is) |
| 26 | External file drop from OS | Drag | Medium |
| 27 | Ctrl+O (open file) wired to handler | Keyboards | Small |
| 28 | Ctrl+Shift+E (focus file tree) | Keyboards | Small |
| 29 | Wire Ctrl+K W / Ctrl+K U chords | Keyboards | Small |
| 30 | Edit Project dialog (name, icon, color, startup script) | Project | Medium |
| 31 | Project strip context menu (Edit, Clear Notifications, Close) | Context Menus | Small |

### P3 — Low Priority / Nice-to-Have

| # | Item | Category | Effort |
|---|------|----------|--------|
| 32 | Inlay hints (LSP) | Editor | Medium |
| 33 | Peek definition (Alt+F12) | Editor | Large |
| 34 | Tab overflow dropdown | Tabs | Medium |
| 35 | Git/diagnostic tab decorations | Tabs | Medium |
| 36 | Close to the Left (tab context menu) | Context Menus | Small |
| 37 | Notification center/history | Status Bar | Medium |
| 38 | File drag to terminal (insert path) | Drag | Medium |
| 39 | Cursor blink/animation config | Editor | Low |
| 40 | Render whitespace | Editor | Low |
| 41 | Bracket pair colorization | Editor | Low |
| 42 | Minimap show/hide toggle | Editor | Small |
| 43 | Browser tab: Duplicate, Close Others | Context Menus | Small |

---

## Notes

- **VS Code reference repo:** `E:\Projects\references\VSCode\`
- **Zed reference repo:** Not cloned locally; comparisons based on published documentation and known features.
- **Wave 2 closed 6 items** covering tab management (closed tab history, wheel scroll, tab cycling), editor navigation (back/forward, Ctrl+hover underline), and drag-and-drop (tab drag to split zones).
- **Context menu gaps are mostly small scope.** Adding items to existing menus is straightforward once the pattern exists.
