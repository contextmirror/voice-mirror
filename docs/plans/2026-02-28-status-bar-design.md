# Status Bar — Design Document

> Approved design for Voice Mirror's editor status bar.
> Date: 2026-02-28
> Research: `docs/plans/status-bar-research.md`

---

## Goal

Add a VS Code/Zed-style status bar at the bottom of the app shell, surfacing key workspace info (git branch, diagnostics, cursor position, language mode, etc.) that is currently buried 2-3 clicks deep or not exposed at all.

## Architecture

**Approach A — Monolithic component.** A single `StatusBar.svelte` component owns all rendering. A dedicated `status-bar.svelte.js` store aggregates data from existing stores and exposes a single reactive object the component reads. No slot system, no registry pattern — just a component and its store.

**Rationale:** Voice Mirror has a fixed set of status items (no extension API). A monolithic component is simpler, faster to build, and trivially testable. If the status bar grows significantly in the future, it can be decomposed then.

## Tech Stack

- Svelte 5 runes (`$state`, `$derived`, `$effect`)
- CSS custom properties (theme system)
- Existing stores: `projectStore`, `tabsStore`, `lspDiagnosticsStore`, `layoutStore`, `navigationStore`
- Existing APIs: `getGitChanges()`, `lspGetStatus()`
- New: `statusBarStore` (reactive aggregator), `StatusBar.svelte` (UI)

---

## New Files

| File | Purpose |
|------|---------|
| `src/components/shared/StatusBar.svelte` | Status bar UI component |
| `src/lib/stores/status-bar.svelte.js` | Reactive store aggregating data from existing stores/APIs |
| `test/components/status-bar.test.cjs` | Source-inspection tests for StatusBar.svelte |
| `test/stores/status-bar.test.cjs` | Source-inspection tests for status-bar.svelte.js |

## Modified Files

| File | Change |
|------|--------|
| `src/App.svelte` | Import + mount `<StatusBar />` after `.app-body` inside `.app-shell` |
| `src/components/lens/FileEditor.svelte` | Emit cursor position + indentation + EOL + encoding to `statusBarStore` |
| `src/styles/status-bar.css` | New CSS module (imported by StatusBar.svelte) |

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LEFT                                                          RIGHT        │
│ ⎇ feature/lens  ⊘ 0 ⚠ 0  ▶ :5173  ⚡ LSP      Ln 1, Col 1  Spaces: 2  │
│                                                  UTF-8  LF  JavaScript  🔔 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Height:** 22px | **Font:** 12px | **Always visible** (bottom of `.app-shell`)

### Left Side (L1–L4)

| # | Item | Display | v1 Click | Data Source |
|---|------|---------|----------|-------------|
| L1 | Git branch | `⎇ feature/lens` (+ `*` if dirty) | Display only | `getGitChanges()` → polled into store |
| L2 | Diagnostics | `⊘ 0 ⚠ 2` | Display only | `lspDiagnosticsStore.diagnostics` aggregate |
| L3 | Dev server | `▶ :5173` or `■ stopped` | Display only | `devServerManager` store |
| L4 | LSP status | `⚡` + health dot (green/yellow/red) | Display only | `lspGetStatus()` polled into store |

### Right Side (R1–R6)

| # | Item | Display | v1 Click | Data Source |
|---|------|---------|----------|-------------|
| R1 | Cursor position | `Ln 1, Col 1` | Go to Line dialog | FileEditor → `statusBarStore` |
| R2 | Indentation | `Spaces: 2` / `Tabs: 4` | Display only | FileEditor → `statusBarStore` |
| R3 | Encoding | `UTF-8` | Display only | FileEditor → `statusBarStore` |
| R4 | EOL | `LF` / `CRLF` | Display only | FileEditor → `statusBarStore` |
| R5 | Language mode | `JavaScript` | Display only | File extension → language map |
| R6 | Notification bell | 🔔 + unread dot | Opens notification center | Toast/notification system |

### Conditional Visibility

| Condition | Left side | Right side |
|-----------|-----------|------------|
| Editor focused | L1–L4 shown | R1–R6 shown |
| Terminal focused | L1–L4 shown | R1–R5 hidden, R6 shown |
| Chat focused | L1–L4 shown | R1–R5 hidden, R6 shown |
| No project open | L1–L4 hidden | R1–R5 hidden, R6 shown |

---

## Data Flow

```
┌──────────────────────────────────┐
│  FileEditor.svelte               │
│  (CodeMirror EditorView)         │
│  - cursor position               │
│  - indentation config            │
│  - detected EOL / encoding       │
│  - language from file extension  │
└──────────┬───────────────────────┘
           │ writes to
           ▼
┌──────────────────────────────────┐
│  statusBarStore                  │
│  (status-bar.svelte.js)          │
│  - cursor: { line, col }        │
│  - indent: { type, size }       │
│  - encoding: string             │
│  - eol: string                  │
│  - language: string             │
│  - editorFocused: boolean       │
│  - gitBranch: string            │
│  - gitDirty: boolean            │
│  - diagnostics: { err, warn }   │
│  - devServer: { status, port }  │
│  - lspHealth: string            │
│  - notifications: []            │
│  - unreadCount: number          │
└──────────┬───────────────────────┘
           │ $derived reads
           ▼
┌──────────────────────────────────┐
│  StatusBar.svelte                │
│  - Left: git, diag, dev, lsp    │
│  - Right: cursor, indent, enc,  │
│           eol, lang, bell       │
│  - Conditional visibility       │
└──────────────────────────────────┘
```

### Existing stores consumed by statusBarStore

| Store | Data used |
|-------|-----------|
| `projectStore` | `activeProject.path` — gate left-side visibility |
| `tabsStore` | `activeTab.path` — derive language, detect focus |
| `lspDiagnosticsStore` | `.diagnostics` Map — aggregate errors + warnings |
| `devServerManager` | `.status`, `.port` — dev server indicator |
| `navigationStore` | `.activeView` — determine if editor/terminal/chat focused |

### New data flows (FileEditor → store)

FileEditor already has access to cursor, indentation, etc. via CodeMirror's `EditorView`. On cursor move or config change, it will call setter methods on `statusBarStore`:

```js
// In FileEditor.svelte, on EditorView update:
statusBarStore.setCursor(line, col);
statusBarStore.setIndent(type, size);
statusBarStore.setEncoding(encoding);
statusBarStore.setEol(eol);
statusBarStore.setLanguage(languageName);
statusBarStore.setEditorFocused(true);
```

When no file is open or editor loses focus:
```js
statusBarStore.setEditorFocused(false);
```

### Git branch polling

`statusBarStore` polls `getGitChanges()` on a timer (every 5s when a project is open). The API is already available — it just needs a store-level polling loop.

### LSP health aggregation

`statusBarStore` polls `lspGetStatus()` on a timer (every 10s) and derives aggregate health:
- All healthy → green dot
- Any starting → yellow dot
- Any errored → red dot
- None running → hidden

---

## Mounting in App.svelte

```svelte
<div class="app-shell">
  <TitleBar>...</TitleBar>
  <div class="app-body">
    <Sidebar />
    <main class="main-content">...</main>
  </div>
  <StatusBar />        <!-- NEW: after .app-body, inside .app-shell -->
</div>
```

The status bar is a flex child of `.app-shell` (column direction). It has fixed height (22px) and `flex-shrink: 0`. The `.app-body` above it has `flex: 1` and `min-height: 0`, so the status bar naturally sits at the bottom without affecting the layout.

---

## Sidebar Awareness

- Status bar spans **full window width** edge-to-edge
- It is a **sibling** of `.app-body` — NOT a child of any panel
- Sidebar collapse/expand animates `.app-body` internals, but the status bar is outside that container — **no CSS transition interference**
- No left margin/padding shift needed — always full width regardless of sidebar state

---

## Theme Awareness

All colors use CSS custom properties from the theme system:

| Element | CSS Variable |
|---------|-------------|
| Background | `--bg-elevated` (slightly distinct from editor bg) |
| Text (primary) | `--text` |
| Text (secondary) | `--muted` |
| Top border | `--border` |
| Error count | `--danger` |
| Warning count | `--warn` |
| LSP healthy dot | `--ok` |
| LSP starting dot | `--warn` |
| LSP error dot | `--danger` |
| Active/hover | `--accent` |
| Notification dot | `--accent` |

Theme changes cascade instantly via CSS variables — no JS dispatch needed.

---

## Notification System (R6)

The bell replaces fire-and-forget toasts with a persistent notification center:

- **Toasts still appear** temporarily (auto-dismiss ~5s)
- **All notifications persist** in a notification center behind the bell
- **Bell shows unread indicator** (dot or count badge) when unseen notifications exist
- **Click opens notification center** — scrollable list with timestamps, dismiss buttons
- **Sources:** toast messages, app updates, LSP errors, dev server crashes, save errors
- **App updates** surface here: "Voice Mirror v0.3.0 available — click to update"

---

## Not Included (v1)

| Item | Reason |
|------|--------|
| Copilot/AI prediction | Not offered in our system |
| Remote indicator | Desktop app, not applicable |
| Vim mode | Not supported |
| Toolchain version | Not applicable |
| Panel toggle buttons | Already in TitleBar |
| Bar color changes | Keep it simple |
| Extension API | No extension system |
| AI provider status | Already in TitleBar |

---

## Implementation Waves

### Wave 1 — Infrastructure + Static Shell
- Create `status-bar.svelte.js` store with state shape + setters
- Create `StatusBar.svelte` with left/right container layout, 22px height
- Create `status-bar.css` with theme-aware styling
- Mount in `App.svelte` after `.app-body`
- Wire L2 diagnostics (aggregate from `lspDiagnosticsStore`)
- Write tests for store + component

### Wave 2 — Editor-Aware Right Side
- Wire FileEditor → `statusBarStore` (cursor, indent, encoding, EOL, language)
- Implement R1–R5 display items
- Implement conditional visibility (hide R1–R5 when no editor)
- R1 click → Go to Line dialog (command palette `goto-line` mode)
- Write tests for editor wiring

### Wave 3 — Left Side Remaining Items
- Wire L1 git branch (poll `getGitChanges()` every 5s)
- Wire L3 dev server (read from `devServerManager` store)
- Wire L4 LSP health (poll `lspGetStatus()` every 10s, derive aggregate health)
- Implement conditional visibility (hide L1–L4 when no project)
- Write tests for polling + aggregation

### Wave 4 — Notification Bell
- Add notification store (persist toasts, track read/unread)
- Wire R6 bell icon with unread badge
- Build notification center dropdown (click to open)
- Route existing toast notifications through the new system
- Write tests for notification persistence + unread tracking

---

## Future Work (unlocked by status bar)

| Feature | Trigger |
|---------|---------|
| Problems panel | Click L2 (diagnostics) |
| Indentation picker | Click R2 |
| Encoding picker | Click R3 |
| EOL picker | Click R4 |
| Language picker | Click R5 |
| Branch picker | Click L1 |
| LSP popover | Click L4 |
| Notification center expansion | Expand R6 |
