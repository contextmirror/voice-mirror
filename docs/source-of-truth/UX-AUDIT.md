# UX Completeness Audit — Voice Mirror Lens vs VS Code / Zed

> Internal doc. Comprehensive audit of interactive surfaces, context menus, keyboard shortcuts, status indicators, tab behaviors, editor micro-interactions, and drag-and-drop. Compared against VS Code and Zed.
>
> Last updated: 2026-02-27

---

## Executive Summary

Voice Mirror's Lens workspace has solid functionality but significant UX gaps in **interactive polish** — the small behaviors that make an IDE feel professional. The audit found:

- **1 critical gap**: Terminal body has NO right-click context menu at all
- **1 critical infrastructure gap**: No persistent bottom status bar (line:col, language, errors, git branch)
- **6 high-priority shortcut issues**: Ctrl+W not wired, Ctrl+B/J missing, shortcut conflicts
- **Multiple medium-priority gaps** across all 6 audit areas

### Top 10 Most Impactful Fixes

| # | Fix | Category | Effort |
|---|-----|----------|--------|
| 1 | **Add terminal body context menu** (Copy/Paste/Clear) | Context Menus | Small |
| 2 | **Add persistent bottom status bar** (line:col, language, errors, git) | Status Bar | Medium |
| 3 | **Wire Ctrl+W** to close active tab | Keyboards | Small |
| 4 | **Add save prompt on dirty tab close** | Tab Behaviors | Medium |
| 5 | **Wire Ctrl+B** (toggle sidebar) + **Ctrl+J** (toggle panel) | Keyboards | Small |
| 6 | **Fix Ctrl+Shift+M conflict** (mute vs stats) | Keyboards | Small |
| 7 | **Add Tab/Shift+Tab for indent** in editor | Editor | Small |
| 8 | **Wire F12** for Go to Definition in editor | Editor | Small |
| 9 | **Add back/forward navigation** (Alt+Left/Right after jump) | Editor | Medium |
| 10 | **Add editor font zoom** (Ctrl+=/Ctrl+-) | Editor | Small |

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
| **Reopen Closed Editor (Ctrl+Shift+T)** | Medium |
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
| Project strip avatars | Remove Project | Could add Open in Terminal, Copy Path |
| Empty terminal sidebar | New Terminal | Could add "New with Profile..." |

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
| **Closed tab history + Ctrl+Shift+T** | P1 | No `closedTabs` stack in store, no reopen |
| **Mouse wheel scroll on tab bar** | P1 | No `onwheel` handler — can only scroll via tiny scrollbar |
| **Ctrl+Tab MRU cycling** | P2 | No tab activation history tracked |
| **Ctrl+PageUp/PageDown** | P2 | No prev/next editor tab navigation |
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
| **Drag to reorder** | P1 | Tab strip has no drag handlers (sidebar does) |
| **Inline rename (double-click)** | P1 | Uses `prompt()` dialog instead of inline input |
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
| **Back/forward after navigation (Alt+Left/Right)** | HIGH | No navigation history stack. Essential after Ctrl+Click jumps |
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
| **Ctrl+hover underline** (definition hint) | Medium | No visual feedback that Ctrl+Click will navigate |
| **Quick fix lightbulb in gutter** | Medium | Code actions exist but no visual indicator |
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
| **Ctrl+Shift+T** | Reopen closed tab | MEDIUM |
| **Ctrl+PageUp/Down** | Previous/next editor tab | MEDIUM |
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

### 6.2 Missing — High Priority

| Gap | Description | Effort |
|-----|-------------|--------|
| **Tab drag → split zones** | Dragging editor tabs does NOT activate DropZoneOverlay. Only file-tree drags show split zones. The overlay already exists — just needs to detect tab drag data too. | Small-Medium |

### 6.3 Missing — Medium Priority

| Gap | Description | Effort |
|-----|-------------|--------|
| **Text drag in editor** | Global `dragstart` handler in `main.js` blocks CodeMirror text drag. Need to allow drags originating from `.cm-editor`. | Small |
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

## Priority Summary — All Categories

### P0 — Critical / Fix Immediately

| # | Item | Category | Effort |
|---|------|----------|--------|
| 1 | Terminal body has NO context menu | Context Menus | Small |
| 2 | Ctrl+W not wired (shown as hint but broken) | Keyboards | Small |
| 3 | Save prompt on dirty tab close (data loss risk) | Tabs | Medium |
| 4 | Bottom status bar (container for all indicators) | Status Bar | Medium |
| 5 | Line:Column cursor position display | Status Bar | Small (needs #4) |
| 6 | Aggregate error/warning count display | Status Bar | Small (needs #4) |

### P1 — High Priority

| # | Item | Category | Effort |
|---|------|----------|--------|
| 7 | Ctrl+B (toggle sidebar) | Keyboards | Small |
| 8 | Ctrl+J (toggle bottom panel) | Keyboards | Small |
| 9 | Fix Ctrl+Shift+M conflict (mute vs stats) | Keyboards | Small |
| 10 | Fix Ctrl+Shift+O conflict (symbol vs overlay) | Keyboards | Small |
| 11 | Tab/Shift+Tab for indent in editor | Editor | Small |
| 12 | F12 for Go to Definition | Editor/Keyboards | Small |
| 13 | Middle-click to close editor tabs | Tabs | Small |
| 14 | Closed tab history + Ctrl+Shift+T | Tabs | Medium |
| 15 | Mouse wheel scroll on tab bar | Tabs | Small |
| 16 | Terminal context menu: Copy, Paste, Clear | Context Menus | Small |
| 17 | Font zoom (Ctrl+=/Ctrl+-) | Editor | Small |
| 18 | Language mode in status bar | Status Bar | Small (needs #4) |
| 19 | Git branch in status bar | Status Bar | Small (needs #4) |
| 20 | File tree: Open to the Side, Open in Terminal | Context Menus | Small |
| 21 | Browser tab: Reload, New Tab | Context Menus | Small |
| 22 | Tab drag → split zones (extend DropZoneOverlay) | Drag | Small-Medium |

### P2 — Medium Priority

| # | Item | Category | Effort |
|---|------|----------|--------|
| 23 | Back/forward navigation (Alt+Left/Right) | Editor | Medium |
| 24 | Ctrl+hover underline (definition hint) | Editor | Small |
| 25 | Quick fix lightbulb in gutter | Editor | Medium |
| 26 | Ctrl+Tab MRU tab cycling | Tabs | Medium |
| 27 | Ctrl+PageUp/PageDown (prev/next tab) | Keyboards | Small |
| 28 | Terminal inline rename (replace prompt() dialog) | Tabs | Small |
| 29 | Terminal tab strip drag reorder | Drag | Medium |
| 30 | Indentation type/size in status bar | Status Bar | Small (needs #4) |
| 31 | LSP status in persistent location | Status Bar | Small (needs #4) |
| 32 | File path breadcrumbs | Status Bar | Medium |
| 33 | Sidebar badge counts (git changes, errors) | Status Bar | Medium |
| 34 | Diagnostics panel (unified error list) | Status Bar | Medium-Large |
| 35 | Editor context menu: Toggle Comment, Format | Context Menus | Small |
| 36 | Diff context menu: Revert Hunk | Context Menus | Medium |
| 37 | File tree: Stage/Unstage/Discard on changes | Context Menus | Small |
| 38 | Word wrap toggle in editor | Editor | Small |
| 39 | Tab size configuration | Editor | Small |
| 40 | Auto-indent on paste | Editor | Medium |
| 41 | Text drag in editor (unblock in main.js) | Drag | Small |
| 42 | External file drop from OS | Drag | Medium |
| 43 | Ctrl+O (open file) wired to handler | Keyboards | Small |
| 44 | Ctrl+Shift+E (focus file tree) | Keyboards | Small |
| 45 | Wire Ctrl+K W / Ctrl+K U chords | Keyboards | Small |

### P3 — Low Priority / Nice-to-Have

| # | Item | Category | Effort |
|---|------|----------|--------|
| 46 | Inlay hints (LSP) | Editor | Medium |
| 47 | Peek definition (Alt+F12) | Editor | Large |
| 48 | Tab overflow dropdown | Tabs | Medium |
| 49 | Git/diagnostic tab decorations | Tabs | Medium |
| 50 | Close to the Left (tab context menu) | Context Menus | Small |
| 51 | Encoding/EOL in status bar | Status Bar | Small |
| 52 | Notification center/history | Status Bar | Medium |
| 53 | File drag to terminal (insert path) | Drag | Medium |
| 54 | Cursor blink/animation config | Editor | Low |
| 55 | Render whitespace | Editor | Low |
| 56 | Bracket pair colorization | Editor | Low |
| 57 | Minimap show/hide toggle | Editor | Small |
| 58 | Browser tab: Duplicate, Close Others | Context Menus | Small |

---

## Notes

- **VS Code reference repo:** `E:\Projects\references\VSCode\`
- **Zed reference repo:** Not cloned locally; comparisons based on published documentation and known features.
- **CodeMirror `basicSetup`** provides many defaults. Several "missing" items may only need a one-line extension add (e.g., `indentWithTab`, `selectLine` remap).
- **The status bar is the biggest infrastructure gap.** It's the container that ~8 individual indicators need. Building it first unblocks many small P1/P2 items.
- **Context menu gaps are mostly small scope.** Adding items to existing menus is straightforward once the pattern exists.
- **Keyboard conflicts should be fixed before adding new shortcuts.** The Ctrl+Shift+M and Ctrl+Shift+O conflicts mean existing features silently break.
