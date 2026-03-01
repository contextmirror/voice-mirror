# Problems Panel — Design Document

> VS Code-style unified error/warning list for the Lens workspace bottom panel.

**Date:** 2026-02-28

---

## Goal

Add a **Problems panel** as a 4th bottom panel tab (alongside Voice Agent, Output, Terminal) that displays all LSP diagnostics grouped by file in a collapsible tree view. Clicking the status bar error/warning counts opens this panel. Ctrl+Shift+M toggles it.

## Architecture

The panel reads from the existing `lsp-diagnostics.svelte.js` store — specifically the `rawDiagnostics` Map which already holds `Array<{range, severity, message, source, code}>` per file. No new store is needed. The panel is a new Svelte component wired into `TerminalTabs.svelte` as a 4th tab, with a status bar click handler connecting the two.

## Components

### ProblemsPanel.svelte (new)

**Location:** `src/components/lens/ProblemsPanel.svelte`

**Layout:** Collapsible tree view grouped by file.

```
▼ src/lib/api.js — 3 errors, 1 warning
    ⊗ Line 42:5   Property 'foo' does not exist on type 'Window'   ts(2339)
    ⊗ Line 87:12  Cannot find name 'bar'                           ts(2304)
    ⊗ Line 103:3  Type 'string' not assignable to type 'number'    ts(2322)
    ⚠ Line 55:7   'x' is declared but never used                   ts(6133)
▼ src/components/lens/FileTree.svelte — 1 error
    ⊗ Line 12:8   Missing required prop 'items'                    svelte
```

**File header row:** Chevron (▼/▶) + file icon + relative path + summary counts (N errors, M warnings).

**Diagnostic row:** Severity icon (⊗ error / ⚠ warning / ℹ info) + line:col + message + source/code (right-aligned, dimmed).

**Click behavior:**
- Click file header → collapse/expand that group
- Click diagnostic row → open file in editor, set cursor to line:col

**Empty state:** "No problems have been detected in the workspace." centered message when no diagnostics exist.

**Sort order:**
- Files: files with errors first, then warnings-only, alphabetical within same severity tier
- Diagnostics within file: errors first, then warnings, then info; within same severity, by line number

### TerminalTabs.svelte (modified)

**New tab:** "Problems" added as 4th tab after Terminal.

**Tab badge:** Shows total error + warning count when > 0 (e.g., "Problems 4"). Badge uses `--danger` color for errors, `--warn` if warnings only.

**Toolbar (when Problems tab active):**
- 3 severity toggle buttons with counts: `⊗ 3` `⚠ 1` `ℹ 0` — click toggles visibility
- Text filter input — filters diagnostics by message text (same pattern as Output panel filter)

**Content routing:** `{#if bottomPanelMode === 'problems'}` renders `<ProblemsPanel />`.

**Event listener:** Listens for `status-bar-show-problems` window event, sets `bottomPanelMode = 'problems'`.

**Keyboard shortcut:** Ctrl+Shift+M toggles Problems panel (sets mode to 'problems' or returns to previous mode).

**Panel order for Ctrl+Tab cycling:** ai → output → terminal → problems → ai.

### StatusBar.svelte (modified)

**Line 98 diagnostics button:** Add `onclick` handler that dispatches `window.dispatchEvent(new CustomEvent('status-bar-show-problems'))`.

### lsp-diagnostics.svelte.js (modified)

**New method `getTotals()`:** Returns `{ errors: number, warnings: number, infos: number }` aggregated across all files. Used by TerminalTabs for badge and toolbar toggle counts.

## Data Flow

```
LSP server → lsp-diagnostics Tauri event → lsp-diagnostics.svelte.js store
    ├── rawDiagnostics Map → ProblemsPanel tree view
    ├── diagnostics Map → FileTree badges (existing)
    ├── getTotals() → TerminalTabs badge + severity toggles
    └── updateDiagnostics() → StatusBar counts (existing)

Status bar click → CustomEvent('status-bar-show-problems') → TerminalTabs sets mode
Ctrl+Shift+M → TerminalTabs toggles mode
Diagnostic row click → tabs store openFile() + cursor position
```

## Scope

**In scope:**
- Tree view grouped by file with collapse/expand
- Severity filter toggles (error/warning/info)
- Text filter input
- Click-to-navigate (file + line:col)
- Status bar click opens Problems panel
- Ctrl+Shift+M keyboard shortcut
- Tab badge with aggregate counts
- Empty state message
- Sorted output (severity, then line number)

**Out of scope (YAGNI):**
- Source filters (`@source:` syntax)
- Glob/file exclude patterns
- Related information child nodes
- Active-file-only mode
- Workspace-wide diagnostic requests (geterr/geterrForProject)
- Debouncing diagnostic updates

## Files

| File | Change |
|------|--------|
| `src/components/lens/ProblemsPanel.svelte` | **New** — tree view component |
| `src/components/terminal/TerminalTabs.svelte` | 4th tab, toolbar, event listener, Ctrl+Shift+M |
| `src/components/shared/StatusBar.svelte` | onclick for diagnostics button |
| `src/lib/stores/lsp-diagnostics.svelte.js` | Add `getTotals()` method |
| `test/components/problems-panel.test.cjs` | **New** — source-inspection tests |
| `test/stores/lsp-diagnostics.test.cjs` | Test for `getTotals()` |

## References

- Research: `docs/implementation/LSP-CONFIG-GAPS.md` §2
- UX Audit: `docs/source-of-truth/UX-AUDIT.md` item #18
- VS Code: `src/vs/workbench/contrib/markers/browser/markersView.ts`
- Existing store: `src/lib/stores/lsp-diagnostics.svelte.js`
- Bottom panel: `src/components/terminal/TerminalTabs.svelte`
- Status bar: `src/components/shared/StatusBar.svelte`
