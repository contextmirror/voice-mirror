# Status Bar Research — VS Code vs Zed vs Voice Mirror

> Research document for designing Voice Mirror's status bar.
> Date: 2026-02-28

---

## VS Code Status Bar

**Height:** 22px | **Font:** 12px | **Always visible** (all views)

### Left Side (left → right)

| Item | Click Action | Conditional |
|------|-------------|-------------|
| Remote indicator (SSH/WSL/Container) | Remote actions picker | Only when remote-capable |
| Git branch + sync status | Checkout branch / sync | When git repo open |
| Errors & warnings count `⊘ 0 ⚠ 2` | Toggle Problems panel | Always |
| Running tasks spinner | Show tasks | When tasks running |
| Debug configuration | Debug picker | When debug configured |

### Right Side (right → left, so rightmost listed first)

| Item | Click Action | Conditional |
|------|-------------|-------------|
| Notifications bell | Toggle notification center | Always |
| Copilot/AI status | Copilot settings | When extension active |
| Language mode (e.g. "JavaScript") | Language picker | When editor focused |
| EOL type (LF / CRLF) | EOL picker | When editor focused |
| Encoding (UTF-8) | Encoding picker | When editor focused |
| Indentation (Spaces: 2) | Indentation picker | When editor focused |
| Cursor position (Ln 42, Col 8) | Go to Line | When editor focused |

### Special Behaviors

- **Whole-bar color changes:** Blue (workspace), Purple (no folder), Orange (debugging)
- **Right-click context menu:** Toggle individual item visibility
- **Item kinds:** standard, warning (yellow bg), error (red bg), prominent (dark bg)
- **Compact grouping:** Related items can cluster with reduced spacing
- **Extensions can register items** with alignment + priority

---

## Zed Status Bar

**Height:** ~24px | **Minimal, icon-heavy** | **Always visible**

*Source: `E:\Projects\references\Zed\crates\workspace\src\status_bar.rs` + `crates\zed\src\zed.rs`*

### Left Side (left → right)

| # | Item | Icon/Display | Click Action |
|---|------|-------------|-------------|
| 1 | **Left dock panel buttons** | `FileTree`, `ListTree`, `GitBranch`, `UserGroup` icons | Toggle Project/Outline/Git/Collab panels |
| 2 | **Search button** | `MagnifyingGlass` icon | Open project search |
| 3 | **LSP button** | `BoltOutlined` + colored dot (health) | Popover: server list, PIDs, memory, restart/stop |
| 4 | **Diagnostic indicator** | `Check`(green) or `XCircle`(red) + `Warning`(yellow) + counts | Open diagnostics panel; inline message jumps to next error |
| 5 | **Activity indicator** | Rotating spinner + text | LSP progress, git ops, extension installs, formatting failures |

### Right Side (left → right)

| # | Item | Display | Click Action |
|---|------|---------|-------------|
| 6 | **Cursor position** | `Line:Col` (+ selection info) | Go to Line/Column modal |
| 7 | **Vim mode** | "NORMAL", "INSERT" etc. (colored) | Display only (hidden when vim off) |
| 8 | **Line endings** | "LF" / "CRLF" | Line ending selector (hidden by default) |
| 9 | **Toolchain** | e.g. "Python 3.11", "rustc 1.75" | Toolchain selector |
| 10 | **Language mode** | e.g. "Rust", "Plain Text" | Language selector |
| 11 | **Encoding** | "UTF-8" etc. | Encoding selector (hidden for UTF-8 by default) |
| 12 | **AI prediction** | Copilot/Supermaven/Zeta icon | AI settings popover |
| 13 | **Bottom dock buttons** | `Terminal`, `Debug` icons | Toggle terminal/debug panels |
| 14 | **Right dock buttons** | `Agent`, `Bell` icons | Toggle agent/notification panels |

### Settings

```json
{
  "status_bar": {
    "cursor_position_button": true,
    "active_language_button": true,
    "search_button": true,
    "line_endings_button": false,
    "active_encoding_button": "non_utf8"
  }
}
```

### Design Philosophy

- **Icon-heavy on the sides, text in the middle** — panel toggles as icon buttons, data as text
- **Panel buttons on both ends** — left dock panels on far left, right/bottom dock panels on far right
- **Conditional visibility** — items hide when not applicable (vim off, no image, no toolchain)
- **No whole-bar color changes** — stays consistent
- **Right-click dock buttons** → "Dock Left/Right/Bottom" context menu to reposition panels
- **Activity indicator** as a catch-all for background operations (LSP progress, git, formatting)
- Breadcrumbs are a **separate bar** above the editor

---

## Voice Mirror — Current State

**There is NO status bar.** Status indicators are scattered:

| Data | Where It Lives Now | Accessible? |
|------|--------------------|-------------|
| Git branch | `FileTree.svelte` local state, visible in Changes tab | 3 clicks deep |
| Error/warning counts | Per-file badges on `FileTreeNode` | No aggregate |
| LSP status | `StatusDropdown` popover → LSP tab | 3 clicks deep |
| AI provider status | TitleBar center | Always visible |
| Dev server status | `StatusDropdown` popover | 2 clicks deep |
| Cursor line:col | Not exposed (inside FileEditor only) | Not visible |
| Language mode | Not exposed (inferred from file extension) | Not visible |
| Encoding/EOL | Not tracked | Not available |
| Indentation | Not exposed | Not visible |

### Data Sources Available

| Data | Store / API | Status |
|------|-------------|--------|
| Active file path | `tabsStore.activeTab.path` | Ready |
| Dirty state | `tabsStore.activeTab.dirty` | Ready |
| Diagnostics | `lspDiagnosticsStore.diagnostics` (Map) | Ready (needs aggregate getter) |
| Git branch | `getGitChanges()` → `branch` field | API ready, needs store |
| Ahead/behind | `gitAheadBehind()` API | API ready, needs store |
| LSP servers | `lspGetStatus()` API | API ready |
| Cursor position | `view.state.selection.main.head` in CodeMirror | Needs event/store |
| Language name | File extension → language mapping | Needs utility |
| Project path | `projectStore.activeProject.path` | Ready |
| Panel visibility | `layoutStore.showTerminal`, etc. | Ready |

### Where It Goes

`App.svelte` — at the bottom of `.app-shell`, after `.app-body`. This makes it visible across all views, matching VS Code/Zed behavior. The `.app-shell` is `display: flex; flex-direction: column; height: 100vh`, so a fixed-height child at the end works naturally.

---

## Comparison Matrix

| Feature | VS Code | Zed | Both? |
|---------|---------|-----|-------|
| **Git branch** | ✅ Left | ✅ Left (panel button) | Both |
| **Error/warning count** | ✅ Left | ✅ Left | Both |
| **Cursor Ln:Col** | ✅ Right | ✅ Right | Both |
| **Language mode** | ✅ Right | ✅ Right | Both |
| **Indentation (Spaces/Tabs)** | ✅ Right | ❌ | VS Code only |
| **Encoding (UTF-8)** | ✅ Right | ✅ Right (non-UTF8 only) | Both |
| **EOL (LF/CRLF)** | ✅ Right | ✅ Right (off by default) | Both |
| **AI/Copilot status** | ✅ Right | ✅ Right | Both |
| **LSP status** | ❌ (extensions) | ✅ Left (bolt icon + popover) | Zed better |
| **Activity indicator** | ❌ | ✅ Left (spinner + text) | Zed only |
| **Panel toggle buttons** | ❌ | ✅ Both sides | Zed only |
| **Notifications bell** | ✅ Right | ✅ Right (dock button) | Both |
| **Remote indicator** | ✅ Left | ❌ | VS Code only |
| **Debug status** | ✅ Left | ✅ Right (dock button) | Both |
| **Running tasks** | ✅ Left | ❌ | VS Code only |
| **Toolchain version** | ❌ | ✅ Right | Zed only |
| **Vim mode** | ❌ (extension) | ✅ Right | Zed only |
| **Bar color changes** | ✅ (blue/purple/orange) | ❌ | VS Code only |
| **Right-click customize** | ✅ | ✅ (dock buttons) | Both |
| **Extension items** | ✅ | ❌ | VS Code only |

---

## Voice Mirror Status Bar — Confirmed Layout

> Items confirmed through discussion. This section is the design spec.

**Height:** 22px | **Font:** 12px | **Always visible** (bottom of app shell)

**Placement:** `App.svelte` — bottom of `.app-shell`, after `.app-body`. Spans full window width.

### Layout & Sidebar Awareness

- Status bar spans **full window width** edge-to-edge — it sits below the sidebar, not next to it
- It is a **sibling** of `.app-body` in the flex column, NOT a child of any panel
- When the sidebar collapses/expands, the content area above animates but the **status bar does not move or resize** — it stays pinned at the bottom, full width
- The status bar must **not interfere** with the sidebar collapse/expand CSS transition
- No left margin or padding shift needed — the bar is always the same width regardless of sidebar state
- This matches VS Code's behavior: their status bar is always full-width, unaffected by sidebar toggle

### Theme Awareness

- All colors use **CSS custom properties** from the theme system — no hardcoded colors
- Background: `--bg` or `--bg-elevated` (slightly distinct from editor background so the bar is visually separate)
- Text: `--text` for primary items, `--muted` for secondary/less important items
- Borders: `--border` for top edge separator
- Icons: `--muted` default, `--accent` for active/highlighted states
- Error count: `--danger` color, Warning count: `--warn` color
- Notification dot: `--accent` or `--danger`
- Must respond **instantly** to theme preset changes — no JS dispatch needed, CSS variables cascade automatically
- Works with all 8 built-in presets + custom themes (all presets provide the required color keys)

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LEFT                                                          RIGHT        │
│ ⎇ feature/lens  ⊘ 0 ⚠ 0  ▶ :5173  ⚡ LSP      Ln 1, Col 1  Spaces: 2  │
│                                                  UTF-8  LF  JavaScript  🔔 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Left Side (confirmed)

Left to right order:

| # | Item | Display | v1 Click | Future | Notes |
|---|------|---------|----------|--------|-------|
| L1 | **Git branch** | `⎇ feature/lens` (+ `*` if dirty) | Display only | Branch picker | Data from `getGitChanges()` → needs shared store. Visible even when sidebar collapsed. Always shown when project is open. |
| L2 | **Diagnostics count** | `⊘ 0 ⚠ 2` (error icon + count, warning icon + count) | Display only | Opens Problems panel | Powered by LSP diagnostics. Aggregate from `lspDiagnosticsStore.diagnostics` Map. Always shown (0/0 when no issues). |
| L3 | **Dev server status** | `▶ :5173` or `■ stopped` | Display only | Toggle dev server panel | From `devServerManager` store. Only shown when a project has a dev server detected/running. |
| L4 | **LSP status** | `⚡` icon (+ dot: green=healthy, yellow=starting, red=error) | Display only | Opens LSP popover (like Zed) | Aggregate health of running LSP servers. Data from `lspGetStatus()` API. Only shown when LSP servers are active. |

### Right Side (confirmed)

Left to right order:

| # | Item | Display | v1 Click | Future | Notes |
|---|------|---------|----------|--------|-------|
| R1 | **Cursor position** | `Ln 1, Col 1` | Go to Line dialog | — | Live updates on cursor move. Needs FileEditor → shared store. **Hidden when no editor focused.** |
| R2 | **Indentation** | `Spaces: 2` or `Tabs: 4` | Display only | Indentation picker | Read from CodeMirror config. **Hidden when no editor focused.** |
| R3 | **Encoding** | `UTF-8` | Display only | Encoding picker | Detect on file read. **Hidden when no editor focused.** |
| R4 | **EOL** | `LF` or `CRLF` | Display only | EOL picker | Detect on file read. **Hidden when no editor focused.** |
| R5 | **Language mode** | `JavaScript`, `Rust`, etc. | Display only | Language picker | Derived from file extension via `codemirror-languages.js`. **Hidden when no editor focused.** |
| R6 | **Notifications bell** | 🔔 icon + unread dot/count | Opens notification center | — | All toasts persist here. Updates, errors, LSP messages route through this. **Always shown.** |

### Conditional Visibility Rules

| Condition | Left side | Right side |
|-----------|-----------|------------|
| **Editor focused** | All items shown | All items shown |
| **Terminal focused** | L1-L4 shown | R1-R5 hidden, R6 (bell) shown |
| **Chat focused** | L1-L4 shown | R1-R5 hidden, R6 (bell) shown |
| **No project open** | L1-L4 hidden | R1-R5 hidden, R6 (bell) shown |

### Notification System (R6)

The notification bell replaces the current fire-and-forget toast system:

- **Toasts still appear** temporarily for immediate attention (auto-dismiss ~5s)
- **All notifications are persisted** in a notification center behind the bell
- **Bell shows unread indicator** (dot or count badge) when unseen notifications exist
- **Click opens notification center** — scrollable list with timestamps, dismiss buttons
- **Notification sources:** toast messages, app updates, LSP errors, dev server crashes, save errors, any system event worth reporting
- **App updates** surface here: "Voice Mirror v0.3.0 available — click to update"

### Not Included (v1)

| Item | Reason |
|------|--------|
| Copilot/AI prediction button | Not offered in our system |
| Remote indicator | Not applicable (desktop app) |
| Vim mode | Not supported |
| Toolchain version | Not applicable |
| Panel toggle buttons | Already have sidebar navigation |
| Bar color changes | Keep it simple for v1 |
| Extension contribution API | No extension system |
| AI provider status | Already in TitleBar — no need to duplicate |
| Voice pipeline status | Already in TitleBar — no need to duplicate |

### Future Work (unlocked by status bar)

| Feature | Description | Triggered by |
|---------|-------------|-------------|
| **Problems panel** | Dedicated bottom panel tab listing all LSP diagnostics across the project, like VS Code's Problems tab or Zed's Project Diagnostics multi-buffer. Every real IDE has this. | Click on L2 (diagnostics count) |
| **Indentation picker** | Dropdown to switch between Spaces/Tabs and set size (2/4/8) | Click on R2 |
| **Encoding picker** | Dropdown to reopen file with different encoding | Click on R3 |
| **EOL picker** | Dropdown to switch LF/CRLF | Click on R4 |
| **Language picker** | Searchable list of all supported languages, with Auto Detect | Click on R5 |
| **Branch picker** | Quick switch branches from status bar | Click on L1 |
| **LSP popover** | Zed-style popover showing server PIDs, memory, health, restart/stop | Click on L4 |
| **Notification center** | Full notification history with categories, filters, clear all | Expand from R6 |

---

## Sources

- [Zed Features](https://zed.dev/features)
- [Zed All Settings](https://zed.dev/docs/reference/all-settings)
- [Zed UI Discussion](https://github.com/zed-industries/zed/discussions/20086)
- [Understanding Zed Interface](https://zed.tips/tips/understanding-interface/)
- Zed reference repo: `E:\Projects\references\Zed\crates\workspace\src\status_bar.rs`
- VS Code reference repo: `E:\Projects\references\VSCode\src\vs\workbench\browser\parts\statusbar\`
