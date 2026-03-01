# Problems Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a VS Code-style Problems panel as a 4th bottom panel tab that displays all LSP diagnostics grouped by file, with severity filters, text search, click-to-navigate, status bar integration, and Ctrl+Shift+M keyboard shortcut.

**Architecture:** Reads from the existing `lsp-diagnostics.svelte.js` store's `rawDiagnostics` Map. New `ProblemsPanel.svelte` component wired into `TerminalTabs.svelte` as a 4th tab. Status bar's existing error/warning counts become clickable to open the panel. A `pendingCursorPosition` on the tabs store enables cross-file click-to-navigate.

**Tech Stack:** Svelte 5 (runes), existing `lsp-diagnostics.svelte.js` store, `tabs.svelte.js` store, CodeMirror 6 cursor dispatch, source-inspection tests (node:test + node:assert/strict).

**Design doc:** `docs/plans/2026-02-28-problems-panel-design.md`

---

### Task 1: Add `getTotals()` method to lsp-diagnostics store

**Files:**
- Modify: `src/lib/stores/lsp-diagnostics.svelte.js:57-105`
- Test: `test/stores/lsp-diagnostics.test.cjs`

**Step 1: Write the failing test**

Add to `test/stores/lsp-diagnostics.test.cjs`:

```javascript
describe('lsp-diagnostics.svelte.js: getTotals method', () => {
  it('has getTotals method', () => {
    assert.ok(src.includes('getTotals('), 'Should have getTotals method');
  });

  it('getTotals aggregates errors, warnings, and infos', () => {
    const getTotalsIdx = src.indexOf('getTotals()');
    const getTotalsBody = src.slice(getTotalsIdx, getTotalsIdx + 300);
    assert.ok(getTotalsBody.includes('errors'), 'Should count total errors');
    assert.ok(getTotalsBody.includes('warnings'), 'Should count total warnings');
    assert.ok(getTotalsBody.includes('infos'), 'Should count total infos');
  });

  it('getTotals iterates rawDiagnostics', () => {
    const getTotalsIdx = src.indexOf('getTotals()');
    const getTotalsBody = src.slice(getTotalsIdx, getTotalsIdx + 400);
    assert.ok(getTotalsBody.includes('rawDiagnostics'), 'Should iterate rawDiagnostics for accurate counts');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "getTotals"`
Expected: FAIL — `getTotals` not in source yet

**Step 3: Implement getTotals**

In `src/lib/stores/lsp-diagnostics.svelte.js`, add inside the return object (after `getRawForFile` method, before `clear()`):

```javascript
    /** Get aggregate counts across all files */
    getTotals() {
      let errors = 0;
      let warnings = 0;
      let infos = 0;
      for (const [, diags] of rawDiagnostics) {
        for (const d of diags) {
          const sev = d.severity;
          if (sev === 'error' || sev === 1) errors++;
          else if (sev === 'warning' || sev === 2) warnings++;
          else if (sev === 'information' || sev === 3) infos++;
        }
      }
      return { errors, warnings, infos };
    },
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "getTotals"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/stores/lsp-diagnostics.svelte.js test/stores/lsp-diagnostics.test.cjs
git commit -m "feat(lsp): add getTotals() method to diagnostics store"
```

---

### Task 2: Add `pendingCursorPosition` to tabs store

This enables cross-file click-to-navigate. When the Problems panel clicks a diagnostic, it sets a pending cursor position then opens the file. FileEditor reads and clears it.

**Files:**
- Modify: `src/lib/stores/tabs.svelte.js:66-134`
- Test: `test/stores/tabs.test.cjs`

**Step 1: Write the failing test**

Add to `test/stores/tabs.test.cjs`:

```javascript
describe('tabs.svelte.js: pendingCursorPosition', () => {
  it('has pendingCursorPosition getter', () => {
    assert.ok(src.includes('pendingCursorPosition'), 'Should have pendingCursorPosition');
  });

  it('has setPendingCursor method', () => {
    assert.ok(src.includes('setPendingCursor('), 'Should have setPendingCursor method');
  });

  it('has clearPendingCursor method', () => {
    assert.ok(src.includes('clearPendingCursor('), 'Should have clearPendingCursor method');
  });

  it('setPendingCursor accepts path, line, character', () => {
    const idx = src.indexOf('setPendingCursor(');
    const body = src.slice(idx, idx + 200);
    assert.ok(body.includes('path') && body.includes('line'), 'Should accept path and line');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "pendingCursorPosition"`
Expected: FAIL

**Step 3: Implement pendingCursorPosition**

In `src/lib/stores/tabs.svelte.js`, add a new `$state` variable near the top of `createTabsStore()`:

```javascript
  /** @type {{ path: string, line: number, character: number } | null} */
  let pendingCursorPosition = $state(null);
```

In the return object, add:

```javascript
    /** Pending cursor position for cross-file navigation */
    get pendingCursorPosition() { return pendingCursorPosition; },

    /** Set a cursor position to navigate to after a file opens */
    setPendingCursor(path, line, character) {
      pendingCursorPosition = { path, line, character };
    },

    /** Clear pending cursor (called by FileEditor after applying) */
    clearPendingCursor() {
      pendingCursorPosition = null;
    },
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "pendingCursorPosition"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/stores/tabs.svelte.js test/stores/tabs.test.cjs
git commit -m "feat(tabs): add pendingCursorPosition for cross-file navigation"
```

---

### Task 3: Wire FileEditor to consume pendingCursorPosition

When a file becomes active and there's a pending cursor position matching that file, FileEditor should move the cursor and clear the pending state.

**Files:**
- Modify: `src/components/lens/FileEditor.svelte`
- Test: `test/components/file-editor.test.cjs`

**Step 1: Write the failing test**

Add to `test/components/file-editor.test.cjs`:

```javascript
describe('FileEditor.svelte: pendingCursorPosition', () => {
  it('imports tabsStore for pending cursor', () => {
    assert.ok(
      editorSrc.includes('tabsStore') && editorSrc.includes('pendingCursorPosition'),
      'Should check tabsStore.pendingCursorPosition'
    );
  });

  it('dispatches cursor position from pending', () => {
    assert.ok(editorSrc.includes('clearPendingCursor'), 'Should clear pending cursor after applying');
  });

  it('uses scrollIntoView when applying pending cursor', () => {
    // The dispatch should scroll the line into view
    assert.ok(editorSrc.includes('scrollIntoView'), 'Should scroll to the cursor position');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "pendingCursorPosition"`
Expected: FAIL (at least the FileEditor tests)

**Step 3: Implement pending cursor consumption**

In `src/components/lens/FileEditor.svelte`, add an `$effect` that watches for pending cursor positions. Place it near the other effects that react to file changes:

```javascript
  // Apply pending cursor position (from Problems panel click-to-navigate)
  $effect(() => {
    const pending = tabsStore.pendingCursorPosition;
    if (!pending || !view || pending.path !== currentPath) return;
    // Defer to ensure editor content is loaded
    requestAnimationFrame(() => {
      try {
        const lineNum = Math.min(Math.max(pending.line + 1, 1), view.state.doc.lines);
        const line = view.state.doc.line(lineNum);
        const charOffset = Math.min(pending.character || 0, line.length);
        view.dispatch({ selection: { anchor: line.from + charOffset }, scrollIntoView: true });
        view.focus();
      } catch (e) {
        // Ignore if line is out of range
      }
      tabsStore.clearPendingCursor();
    });
  });
```

Make sure `tabsStore` is already imported (it should be — check the existing imports at the top of the file).

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "pendingCursorPosition"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All 5200+ tests pass

**Step 6: Commit**

```bash
git add src/components/lens/FileEditor.svelte test/components/file-editor.test.cjs
git commit -m "feat(editor): consume pendingCursorPosition for cross-file navigation"
```

---

### Task 4: Create ProblemsPanel.svelte

The main panel component: tree view grouped by file, severity icons, line:col, click-to-navigate.

**Files:**
- Create: `src/components/lens/ProblemsPanel.svelte`
- Create: `test/components/problems-panel.test.cjs`

**Step 1: Write the failing test**

Create `test/components/problems-panel.test.cjs`:

```javascript
/**
 * problems-panel.test.cjs -- Source-inspection tests for ProblemsPanel.svelte
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/ProblemsPanel.svelte'),
  'utf-8'
);

describe('ProblemsPanel.svelte: imports', () => {
  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should use diagnostics store');
  });

  it('imports tabsStore for navigation', () => {
    assert.ok(src.includes('tabsStore'), 'Should use tabs store for click-to-navigate');
  });
});

describe('ProblemsPanel.svelte: structure', () => {
  it('has file group headers with collapse toggle', () => {
    assert.ok(src.includes('file-group'), 'Should have file group containers');
    assert.ok(src.includes('collapsed') || src.includes('expanded'), 'Should support collapse/expand');
  });

  it('has diagnostic rows', () => {
    assert.ok(src.includes('diagnostic-row') || src.includes('diag-row'), 'Should have diagnostic rows');
  });

  it('shows severity icons', () => {
    assert.ok(src.includes('severity'), 'Should render severity indicators');
  });

  it('shows line and column', () => {
    assert.ok(src.includes('line') && src.includes('character'), 'Should show line:col');
  });

  it('shows diagnostic message', () => {
    assert.ok(src.includes('message'), 'Should show diagnostic message');
  });
});

describe('ProblemsPanel.svelte: click to navigate', () => {
  it('calls openFile on diagnostic click', () => {
    assert.ok(src.includes('openFile'), 'Should call openFile on click');
  });

  it('sets pending cursor position', () => {
    assert.ok(src.includes('setPendingCursor'), 'Should set cursor position for editor');
  });
});

describe('ProblemsPanel.svelte: empty state', () => {
  it('shows empty message when no problems', () => {
    assert.ok(
      src.includes('No problems') || src.includes('no problems'),
      'Should show empty state message'
    );
  });
});

describe('ProblemsPanel.svelte: filtering', () => {
  it('supports severity filtering', () => {
    assert.ok(src.includes('showErrors') || src.includes('filterErrors'), 'Should have error filter state');
    assert.ok(src.includes('showWarnings') || src.includes('filterWarnings'), 'Should have warning filter state');
  });

  it('supports text filtering', () => {
    assert.ok(src.includes('filterText') || src.includes('textFilter'), 'Should have text filter');
  });
});

describe('ProblemsPanel.svelte: sorting', () => {
  it('sorts diagnostics by severity then line', () => {
    assert.ok(src.includes('sort'), 'Should sort diagnostics');
  });
});

describe('ProblemsPanel.svelte: styling', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped styles');
  });

  it('uses theme variables for severity colors', () => {
    assert.ok(src.includes('--danger'), 'Should use --danger for errors');
    assert.ok(src.includes('--warn'), 'Should use --warn for warnings');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "ProblemsPanel"`
Expected: FAIL — file doesn't exist yet

**Step 3: Create ProblemsPanel.svelte**

Create `src/components/lens/ProblemsPanel.svelte`:

```svelte
<script>
  /**
   * ProblemsPanel.svelte -- VS Code-style unified Problems panel.
   *
   * Displays all LSP diagnostics grouped by file in a collapsible tree.
   * Supports severity filtering, text search, and click-to-navigate.
   */
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

  /** @type {{ showErrors: boolean, showWarnings: boolean, showInfos: boolean }} */
  let { showErrors = true, showWarnings = true, showInfos = true, filterText = '' } = $props();

  /** Track collapsed file groups */
  let collapsedFiles = $state(new Set());

  // -- Derived: grouped + filtered + sorted diagnostics --
  let fileGroups = $derived.by(() => {
    const raw = lspDiagnosticsStore.diagnostics;
    const rawDiags = /** @type {Map} */ (lspDiagnosticsStore.rawDiagnostics ?? new Map());
    if (!rawDiags.size) return [];

    const groups = [];
    const lowerFilter = filterText.toLowerCase();

    for (const [filePath, diags] of rawDiags) {
      // Filter by severity and text
      const filtered = diags.filter((d) => {
        const sev = d.severity;
        const isError = sev === 'error' || sev === 1;
        const isWarning = sev === 'warning' || sev === 2;
        const isInfo = sev === 'information' || sev === 3 || sev === 'hint' || sev === 4;

        if (isError && !showErrors) return false;
        if (isWarning && !showWarnings) return false;
        if (isInfo && !showInfos) return false;

        if (lowerFilter) {
          const msg = (d.message || '').toLowerCase();
          const src = (d.source || '').toLowerCase();
          const code = String(d.code || '').toLowerCase();
          if (!msg.includes(lowerFilter) && !src.includes(lowerFilter) && !code.includes(lowerFilter)) {
            return false;
          }
        }
        return true;
      });

      if (filtered.length === 0) continue;

      // Sort: errors first, then warnings, then info; within same severity by line
      const sorted = filtered.sort((a, b) => {
        const sevA = typeof a.severity === 'number' ? a.severity : (a.severity === 'error' ? 1 : a.severity === 'warning' ? 2 : 3);
        const sevB = typeof b.severity === 'number' ? b.severity : (b.severity === 'error' ? 1 : b.severity === 'warning' ? 2 : 3);
        if (sevA !== sevB) return sevA - sevB;
        const lineA = a.range?.start?.line ?? 0;
        const lineB = b.range?.start?.line ?? 0;
        return lineA - lineB;
      });

      const errors = sorted.filter(d => (d.severity === 'error' || d.severity === 1)).length;
      const warnings = sorted.filter(d => (d.severity === 'warning' || d.severity === 2)).length;

      groups.push({ filePath, diagnostics: sorted, errors, warnings });
    }

    // Sort file groups: files with errors first, then warnings-only, then alpha
    groups.sort((a, b) => {
      if (a.errors > 0 && b.errors === 0) return -1;
      if (a.errors === 0 && b.errors > 0) return 1;
      return a.filePath.localeCompare(b.filePath);
    });

    return groups;
  });

  let totalFiltered = $derived(fileGroups.reduce((sum, g) => sum + g.diagnostics.length, 0));

  function toggleCollapse(filePath) {
    const next = new Set(collapsedFiles);
    if (next.has(filePath)) {
      next.delete(filePath);
    } else {
      next.add(filePath);
    }
    collapsedFiles = next;
  }

  function navigateToDiagnostic(filePath, diag) {
    const line = diag.range?.start?.line ?? 0;
    const character = diag.range?.start?.character ?? 0;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    tabsStore.setPendingCursor(filePath, line, character);
    tabsStore.openFile({ name: fileName, path: filePath });
  }

  function severityIcon(sev) {
    if (sev === 'error' || sev === 1) return 'error';
    if (sev === 'warning' || sev === 2) return 'warning';
    return 'info';
  }

  function severityLabel(sev) {
    if (sev === 'error' || sev === 1) return 'Error';
    if (sev === 'warning' || sev === 2) return 'Warning';
    return 'Info';
  }

  function formatSource(diag) {
    let parts = [];
    if (diag.source) parts.push(diag.source);
    if (diag.code != null) parts.push(`(${diag.code})`);
    return parts.join(' ');
  }
</script>

<div class="problems-panel">
  {#if fileGroups.length === 0}
    <div class="problems-empty">
      No problems have been detected in the workspace.
    </div>
  {:else}
    <div class="problems-list">
      {#each fileGroups as group (group.filePath)}
        <!-- File group header -->
        <button
          class="file-group-header"
          onclick={() => toggleCollapse(group.filePath)}
          title={group.filePath}
        >
          <svg
            class="chevron"
            class:collapsed={collapsedFiles.has(group.filePath)}
            viewBox="0 0 16 16" width="12" height="12" fill="currentColor"
          >
            <path d="M5.7 13.7L5 13l4.6-4.6L5 3.8l.7-.7 5.3 5.3-5.3 5.3z"/>
          </svg>
          <span class="file-name">{group.filePath}</span>
          <span class="file-counts">
            {#if group.errors > 0}
              <span class="count-errors">{group.errors}</span>
            {/if}
            {#if group.warnings > 0}
              <span class="count-warnings">{group.warnings}</span>
            {/if}
          </span>
        </button>

        <!-- Diagnostics under this file -->
        {#if !collapsedFiles.has(group.filePath)}
          {#each group.diagnostics as diag, i (i)}
            <button
              class="diag-row"
              class:diag-error={severityIcon(diag.severity) === 'error'}
              class:diag-warning={severityIcon(diag.severity) === 'warning'}
              class:diag-info={severityIcon(diag.severity) === 'info'}
              onclick={() => navigateToDiagnostic(group.filePath, diag)}
              title="{severityLabel(diag.severity)}: {diag.message}"
            >
              <!-- Severity icon -->
              <span class="diag-severity severity-{severityIcon(diag.severity)}">
                {#if severityIcon(diag.severity) === 'error'}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="currentColor" stroke-width="1.5"/>
                  </svg>
                {:else if severityIcon(diag.severity) === 'warning'}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12zM8 5v4M8 11v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                {:else}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="8" cy="11.5" r="0.8" fill="currentColor"/>
                  </svg>
                {/if}
              </span>

              <!-- Message -->
              <span class="diag-message">{diag.message}</span>

              <!-- Source + code -->
              {#if formatSource(diag)}
                <span class="diag-source">{formatSource(diag)}</span>
              {/if}

              <!-- Line:col -->
              <span class="diag-location">[Ln {(diag.range?.start?.line ?? 0) + 1}, Col {(diag.range?.start?.character ?? 0) + 1}]</span>
            </button>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .problems-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--font-family);
    font-size: 12px;
    color: var(--text);
    background: var(--bg);
  }

  .problems-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    user-select: none;
  }

  .problems-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* -- File group header -- */
  .file-group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 8px;
    border: none;
    background: color-mix(in srgb, var(--text) 5%, transparent);
    color: var(--text-strong);
    font-size: 12px;
    font-family: var(--font-family);
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    user-select: none;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .file-group-header:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-counts {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .count-errors {
    color: var(--danger);
    font-weight: 600;
    font-size: 11px;
  }

  .count-warnings {
    color: var(--warn);
    font-weight: 600;
    font-size: 11px;
  }

  /* -- Diagnostic row -- */
  .diag-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    padding: 2px 8px 2px 24px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    line-height: 1.4;
  }

  .diag-row:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .diag-severity {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .severity-error { color: var(--danger); }
  .severity-warning { color: var(--warn); }
  .severity-info { color: var(--accent); }

  .diag-message {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .diag-source {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .diag-location {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "ProblemsPanel"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/lens/ProblemsPanel.svelte test/components/problems-panel.test.cjs
git commit -m "feat(lens): create ProblemsPanel component with tree view"
```

---

### Task 5: Add Problems tab to TerminalTabs

Wire ProblemsPanel as the 4th bottom panel tab with badge, toolbar, and event listener.

**Files:**
- Modify: `src/components/terminal/TerminalTabs.svelte`
- Test: `test/components/terminal-tabs.test.cjs`

**Step 1: Write the failing test**

Add to `test/components/terminal-tabs.test.cjs`:

```javascript
describe('TerminalTabs.svelte: Problems tab', () => {
  it('imports ProblemsPanel', () => {
    assert.ok(src.includes('ProblemsPanel'), 'Should import ProblemsPanel');
  });

  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should import diagnostics store for badge');
  });

  it('has problems mode in panel order', () => {
    assert.ok(src.includes("'problems'"), 'Should have problems mode');
  });

  it('includes problems in panelOrder array', () => {
    assert.ok(
      /panelOrder\s*=\s*\[.*'problems'.*\]/.test(src),
      'Should include problems in panelOrder for Ctrl+Tab cycling'
    );
  });

  it('has Problems tab in markup', () => {
    assert.ok(src.includes('Problems'), 'Should have Problems tab label');
  });

  it('renders ProblemsPanel when problems mode active', () => {
    assert.ok(src.includes('<ProblemsPanel'), 'Should render ProblemsPanel component');
  });

  it('listens for status-bar-show-problems event', () => {
    assert.ok(src.includes('status-bar-show-problems'), 'Should listen for status bar event');
  });

  it('has Ctrl+Shift+M keyboard shortcut', () => {
    assert.ok(
      src.includes('Shift') && src.includes("'M'") || src.includes('"M"') || src.includes("KeyM") || src.includes("'m'"),
      'Should handle Ctrl+Shift+M'
    );
  });

  it('has severity filter toggles in toolbar', () => {
    assert.ok(src.includes('showErrors') || src.includes('problemsShowErrors'), 'Should have error filter toggle');
    assert.ok(src.includes('showWarnings') || src.includes('problemsShowWarnings'), 'Should have warning filter toggle');
  });

  it('has text filter input for problems', () => {
    assert.ok(src.includes('problemsFilter') || src.includes('problems-filter'), 'Should have text filter for problems');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "Problems tab"`
Expected: FAIL

**Step 3: Implement Problems tab in TerminalTabs.svelte**

**3a. Add imports** (top of `<script>`, after existing imports ~line 26):

```javascript
  import ProblemsPanel from '../lens/ProblemsPanel.svelte';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
```

**3b. Add state** (after `bottomPanelMode` at line 29):

```javascript
  // ---- Problems panel filter state ----
  let problemsShowErrors = $state(true);
  let problemsShowWarnings = $state(true);
  let problemsShowInfos = $state(true);
  let problemsFilterText = $state('');

  // Derived totals for badge and toolbar
  let problemsTotals = $derived(lspDiagnosticsStore.getTotals());
  let problemsBadgeCount = $derived(problemsTotals.errors + problemsTotals.warnings);
```

**3c. Update panelOrder** (line 236):

Change:
```javascript
  const panelOrder = ['ai', 'output', 'terminal'];
```
To:
```javascript
  const panelOrder = ['ai', 'output', 'terminal', 'problems'];
```

**3d. Add Ctrl+Shift+M handler** inside the existing `onMount` keydown handler (after the Ctrl+Tab block, ~line 249):

```javascript
      // Ctrl+Shift+M → Toggle problems panel
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        bottomPanelMode = bottomPanelMode === 'problems' ? 'ai' : 'problems';
      }
```

**3e. Add status-bar-show-problems event listener** inside `onMount` (after the keydown handler registration):

```javascript
    function handleShowProblems() {
      bottomPanelMode = 'problems';
    }
    window.addEventListener('status-bar-show-problems', handleShowProblems);
```

And in the cleanup return:

```javascript
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      window.removeEventListener('status-bar-show-problems', handleShowProblems);
      setActionHandler('toggle-terminal', null);
    };
```

**3f. Add Problems tab markup** (after the Terminal tab div ending at line 320, before the spacer at line 322):

```svelte
    <!-- Problems tab (pinned) -->
    <div class="tab-divider"></div>
    <div
      class="terminal-tab"
      class:active={bottomPanelMode === 'problems'}
      role="tab"
      tabindex="0"
      aria-selected={bottomPanelMode === 'problems'}
      onclick={() => bottomPanelMode = 'problems'}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') bottomPanelMode = 'problems'; }}
      title="Problems (Ctrl+Shift+M)"
    >
      <svg class="tab-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12z"/>
        <line x1="8" y1="6" x2="8" y2="9"/><circle cx="8" cy="11" r="0.5" fill="currentColor"/>
      </svg>
      <span class="tab-label">Problems</span>
      {#if problemsBadgeCount > 0}
        <span class="problems-badge">{problemsBadgeCount}</span>
      {/if}
    </div>
```

**3g. Add Problems toolbar** (in the toolbar `{#if}` chain, after the `:else if bottomPanelMode === 'ai'` block ending at line 468):

```svelte
    {:else if bottomPanelMode === 'problems'}
      <div class="output-controls">
        <!-- Text filter -->
        <div class="output-filter-wrapper">
          <input
            class="output-filter-input problems-filter"
            type="text"
            placeholder="Filter (e.g. text, !exclude)"
            value={problemsFilterText}
            oninput={(e) => problemsFilterText = e.target.value}
          />
          <svg class="output-filter-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </div>
        <!-- Severity toggles -->
        <div class="toolbar-actions">
          <button
            class="toolbar-btn severity-toggle"
            class:toggled={problemsShowErrors}
            onclick={() => problemsShowErrors = !problemsShowErrors}
            title="Toggle errors"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="6"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>
            </svg>
            <span class="severity-count">{problemsTotals.errors}</span>
          </button>
          <button
            class="toolbar-btn severity-toggle"
            class:toggled={problemsShowWarnings}
            onclick={() => problemsShowWarnings = !problemsShowWarnings}
            title="Toggle warnings"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12zM8 5v4M8 11v1" stroke-linecap="round"/>
            </svg>
            <span class="severity-count">{problemsTotals.warnings}</span>
          </button>
          <button
            class="toolbar-btn severity-toggle"
            class:toggled={problemsShowInfos}
            onclick={() => problemsShowInfos = !problemsShowInfos}
            title="Toggle info"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="9" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/>
            </svg>
            <span class="severity-count">{problemsTotals.infos}</span>
          </button>
        </div>
      </div>
```

**3h. Add Problems content panel** (after the Terminal panel `{#if}` block ending at line 595):

```svelte
  <!-- Problems panel -->
  {#if bottomPanelMode === 'problems'}
    <div class="problems-panel-container">
      <ProblemsPanel
        showErrors={problemsShowErrors}
        showWarnings={problemsShowWarnings}
        showInfos={problemsShowInfos}
        filterText={problemsFilterText}
      />
    </div>
  {/if}
```

**3i. Add styles** (in `<style>`, after existing styles):

```css
  /* -- Problems badge -- */
  .problems-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    margin-left: 2px;
  }

  .severity-toggle {
    gap: 2px;
  }

  .severity-count {
    font-size: 11px;
  }

  .problems-panel-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "Problems tab"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All 5200+ tests pass

**Step 6: Commit**

```bash
git add src/components/terminal/TerminalTabs.svelte test/components/terminal-tabs.test.cjs
git commit -m "feat(lens): wire Problems panel as 4th bottom tab with filters and Ctrl+Shift+M"
```

---

### Task 6: Make status bar diagnostics clickable

**Files:**
- Modify: `src/components/shared/StatusBar.svelte:98`
- Test: `test/components/status-bar.test.cjs`

**Step 1: Write the failing test**

Add to `test/components/status-bar.test.cjs`:

```javascript
describe('StatusBar.svelte: problems panel link', () => {
  it('dispatches status-bar-show-problems event on diagnostics click', () => {
    assert.ok(
      src.includes('status-bar-show-problems'),
      'Should dispatch event to open problems panel'
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "problems panel link"`
Expected: FAIL

**Step 3: Add onclick handler**

In `src/components/shared/StatusBar.svelte`, change line 98 from:

```svelte
      <button class="sb-item" title="Errors and Warnings">
```

To:

```svelte
      <button class="sb-item" title="Errors and Warnings"
        onclick={() => window.dispatchEvent(new CustomEvent('status-bar-show-problems'))}>
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "problems panel link"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/shared/StatusBar.svelte test/components/status-bar.test.cjs
git commit -m "feat(statusbar): click error/warning counts to open Problems panel"
```

---

### Task 7: Run full test suite and verify

**Step 1: Run all tests**

Run: `npm test`
Expected: All 5200+ tests pass, no regressions

**Step 2: Update IDE-GAPS.md**

In `docs/implementation/IDE-GAPS.md`, update the diagnostics panel entry from ❌ to ✅ if it exists in the gap tracker.

**Step 3: Final commit**

```bash
git add docs/implementation/IDE-GAPS.md
git commit -m "docs: mark Problems panel as implemented in IDE gaps tracker"
```

---

## Verification

After implementation, verify end-to-end in the running app:

1. **Problems tab appears** — 4th tab in bottom panel with warning triangle icon
2. **Badge shows counts** — when there are LSP diagnostics, tab shows count badge
3. **Tree view groups by file** — collapsible file headers with diagnostics nested underneath
4. **Click navigates** — clicking a diagnostic opens the file and moves cursor to line:col
5. **Severity toggles work** — clicking error/warning/info buttons in toolbar filters the list
6. **Text filter works** — typing in filter input narrows diagnostics by message
7. **Empty state** — with no diagnostics: "No problems have been detected in the workspace."
8. **Status bar click** — clicking `⊗ 0 ⚠ 0` in status bar switches to Problems tab
9. **Ctrl+Shift+M** — toggles Problems panel
10. **Ctrl+Tab cycles** — includes Problems in the cycle: ai → output → terminal → problems → ai

## Summary of files modified

| File | Changes |
|------|---------|
| `src/lib/stores/lsp-diagnostics.svelte.js` | Add `getTotals()` method |
| `src/lib/stores/tabs.svelte.js` | Add `pendingCursorPosition`, `setPendingCursor()`, `clearPendingCursor()` |
| `src/components/lens/FileEditor.svelte` | Consume `pendingCursorPosition` with `$effect` |
| `src/components/lens/ProblemsPanel.svelte` | **New** — tree view component |
| `src/components/terminal/TerminalTabs.svelte` | 4th tab, badge, toolbar, severity filters, event listener, Ctrl+Shift+M |
| `src/components/shared/StatusBar.svelte` | Add onclick to diagnostics button |
| `test/stores/lsp-diagnostics.test.cjs` | Tests for `getTotals()` |
| `test/stores/tabs.test.cjs` | Tests for `pendingCursorPosition` |
| `test/components/file-editor.test.cjs` | Tests for pending cursor consumption |
| `test/components/problems-panel.test.cjs` | **New** — full source-inspection tests |
| `test/components/terminal-tabs.test.cjs` | Tests for Problems tab |
| `test/components/status-bar.test.cjs` | Tests for click-to-navigate |
