# Inline Gutter Change Indicators — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show colored bars in the editor gutter for lines added/modified/deleted since the last git commit, with click-to-peek inline diff and "Revert Change" button — matching VS Code's dirty diff feature.

**Architecture:** A self-contained CodeMirror 6 extension (`editor-git-gutter.js`) using `StateField<RangeSet<GutterMarker>>` + `gutter()` + `ViewPlugin`. The plugin fetches the HEAD version via the existing `getFileGitContent` API, computes a Myers line diff on document changes (200ms debounce), and renders colored gutter markers. A click handler opens an inline peek widget (block `Decoration.widget`) with hunk context and a revert button. No new Rust commands or npm packages.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), existing `getFileGitContent` Tauri API, custom Myers line diff, CSS variables for theming.

---

## Context for the Implementer

**Key files to understand before starting:**

| File | What it does | Why it matters |
|------|-------------|----------------|
| `src/lib/editor-extensions.js` | Builds the CM6 extensions array | You'll add the git gutter extension here |
| `src/lib/editor-theme.js` | CM6 theme using CSS variables | You'll add gutter bar styles here |
| `src/components/lens/FileEditor.svelte` | Mounts CodeMirror, handles save/load | You'll pass the `getOriginalContent` callback from here |
| `src/lib/api.js` → `getFileGitContent()` | Fetches `git show HEAD:<path>` | Already exists — returns `{ content, isNew }` |
| `test/components/file-editor.test.cjs` | Source-inspection test pattern | Follow this pattern for your tests |

**CodeMirror extension architecture (must understand):**
- `StateField` holds persistent state across transactions
- `StateEffect` is how you push updates into a `StateField`
- `GutterMarker` subclass renders a DOM element per gutter marker
- `gutter()` creates a gutter column that reads markers from a `StateField`
- `ViewPlugin` runs side effects (async fetches, debounced computation)
- `Decoration.widget({ widget, block: true })` injects a DOM widget below a line

**The `cmCache` pattern:** FileEditor lazily imports CM modules into a `cmCache` object, then passes it to `buildEditorExtensions(cm, lsp, options)`. The git gutter extension does NOT use `cmCache` — it imports directly from `@codemirror/view` and `@codemirror/state` since it's a standalone `.js` module (not a `.svelte` file, no runes).

---

### Task 1: Create test file with initial structure tests

**Files:**
- Create: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the test file**

```javascript
/**
 * editor-git-gutter.test.cjs -- Source-inspection tests for the git gutter CM6 extension.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/editor-git-gutter.js');

describe('editor-git-gutter.js -- file exists', () => {
  it('source file exists', () => {
    assert.ok(fs.existsSync(SRC_PATH), 'editor-git-gutter.js should exist');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "editor-git-gutter"`
Expected: FAIL — file does not exist

**Step 3: Create the empty module**

Create `src/lib/editor-git-gutter.js`:

```javascript
/**
 * editor-git-gutter.js -- CodeMirror 6 extension for inline git change indicators.
 *
 * Shows colored bars in the editor gutter for lines added (green), modified (blue),
 * or deleted (red triangle) since the last git commit. Clicking a bar opens an
 * inline peek widget with the original content and a "Revert Change" button.
 *
 * Usage: import { createGitGutter } from './editor-git-gutter.js'
 * then spread createGitGutter(getOriginalContent) into the extensions array.
 */
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "editor-git-gutter"`
Expected: PASS

**Step 5: Commit**

```bash
git add test/components/editor-git-gutter.test.cjs src/lib/editor-git-gutter.js
git commit -m "test: scaffold editor-git-gutter module and test file"
```

---

### Task 2: Implement Myers line diff utility

**Files:**
- Modify: `src/lib/editor-git-gutter.js`
- Modify: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the failing tests**

Add to `test/components/editor-git-gutter.test.cjs`:

```javascript
let src;
describe('editor-git-gutter.js -- module structure', () => {
  src = fs.readFileSync(SRC_PATH, 'utf-8');

  it('exports computeLineChanges function', () => {
    assert.ok(src.includes('export function computeLineChanges('), 'Should export computeLineChanges');
  });

  it('computeLineChanges returns array of change objects', () => {
    assert.ok(src.includes("type: 'added'") || src.includes("type: 'modified'") || src.includes("type: 'deleted'"),
      'Should produce change objects with type field');
  });

  it('handles added lines', () => {
    assert.ok(src.includes("'added'"), 'Should handle added line type');
  });

  it('handles modified lines', () => {
    assert.ok(src.includes("'modified'"), 'Should handle modified line type');
  });

  it('handles deleted lines', () => {
    assert.ok(src.includes("'deleted'"), 'Should handle deleted line type');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "module structure"`
Expected: FAIL — no exports yet

**Step 3: Implement the diff utility**

Add to `src/lib/editor-git-gutter.js`:

```javascript
/**
 * Compute line-level changes between original and modified text.
 * Returns an array of { type: 'added'|'modified'|'deleted', from: number, to: number }
 * where from/to are 1-based line numbers in the modified text.
 * For deleted changes, from === to === the line after which content was removed.
 *
 * Uses a simplified Myers diff (O(ND) — fast for typical source edits).
 */
export function computeLineChanges(originalText, modifiedText) {
  const oldLines = originalText.split('\n');
  const newLines = modifiedText.split('\n');
  const ops = myersDiff(oldLines, newLines);
  return opsToChanges(ops, newLines.length);
}

/**
 * Myers diff — returns a sequence of { type: 'equal'|'delete'|'insert', oldIdx, newIdx, count }.
 */
function myersDiff(oldArr, newArr) {
  const N = oldArr.length;
  const M = newArr.length;
  const MAX = N + M;
  const vSize = 2 * MAX + 1;
  const v = new Int32Array(vSize);
  v.fill(-1);
  const offset = MAX;
  v[offset + 1] = 0;
  const trace = [];

  for (let d = 0; d <= MAX; d++) {
    const vSnap = v.slice();
    trace.push(vSnap);
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && oldArr[x] === newArr[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        return backtrack(trace, offset, N, M, oldArr, newArr);
      }
    }
  }
  return [];
}

function backtrack(trace, offset, N, M) {
  const ops = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d - 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    // Diagonal (equal)
    while (x > prevX + (prevK < k ? 1 : 0) && y > prevY + (prevK < k ? 0 : 1)) {
      x--;
      y--;
      ops.unshift({ type: 'equal', oldIdx: x, newIdx: y });
    }
    if (d > 0) {
      if (prevK < k) {
        // Move right = delete from old
        ops.unshift({ type: 'delete', oldIdx: prevX });
        x = prevX + 1;
        y = prevY;
      } else {
        // Move down = insert into new
        ops.unshift({ type: 'insert', newIdx: prevY });
        x = prevX;
        y = prevY + 1;
      }
    }
  }
  // Remaining diagonal at d=0
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.unshift({ type: 'equal', oldIdx: x, newIdx: y });
  }
  return ops;
}

/**
 * Convert raw diff ops into collapsed change ranges.
 */
function opsToChanges(ops, totalNewLines) {
  const changes = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'equal') {
      i++;
      continue;
    }
    // Collect consecutive inserts and deletes into a hunk
    let inserts = 0;
    let deletes = 0;
    const startNewIdx = op.type === 'insert' ? op.newIdx : (i + 1 < ops.length && ops[i + 1]?.type === 'insert' ? ops[i + 1].newIdx : -1);
    let firstNewLine = -1;
    const hunkStart = i;
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'insert') {
        if (firstNewLine === -1) firstNewLine = ops[i].newIdx;
        inserts++;
      } else {
        deletes++;
      }
      i++;
    }
    if (inserts > 0 && deletes > 0) {
      // Modified: lines changed in place
      changes.push({ type: 'modified', from: firstNewLine + 1, to: firstNewLine + inserts });
    } else if (inserts > 0) {
      // Added: new lines inserted
      changes.push({ type: 'added', from: firstNewLine + 1, to: firstNewLine + inserts });
    } else if (deletes > 0) {
      // Deleted: lines removed — marker goes on the line after the deletion point
      // Use the newIdx of the next equal op, or totalNewLines if at end
      let afterLine;
      if (i < ops.length && ops[i].type === 'equal') {
        afterLine = ops[i].newIdx + 1; // 1-based
      } else {
        afterLine = totalNewLines; // deletion at end of file
      }
      changes.push({ type: 'deleted', from: afterLine, to: afterLine });
    }
  }
  return changes;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "module structure"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/editor-git-gutter.js test/components/editor-git-gutter.test.cjs
git commit -m "feat: implement Myers line diff for git gutter changes"
```

---

### Task 3: Implement GutterMarker subclasses and gutter extension

**Files:**
- Modify: `src/lib/editor-git-gutter.js`
- Modify: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the failing tests**

Add to `test/components/editor-git-gutter.test.cjs`:

```javascript
describe('editor-git-gutter.js -- CM6 gutter extension', () => {
  it('imports gutter and GutterMarker from @codemirror/view', () => {
    assert.ok(src.includes("from '@codemirror/view'"), 'Should import from @codemirror/view');
    assert.ok(src.includes('GutterMarker'), 'Should use GutterMarker');
    assert.ok(src.includes('gutter'), 'Should use gutter()');
  });

  it('imports StateField and StateEffect from @codemirror/state', () => {
    assert.ok(src.includes("from '@codemirror/state'"), 'Should import from @codemirror/state');
    assert.ok(src.includes('StateField'), 'Should use StateField');
    assert.ok(src.includes('StateEffect'), 'Should use StateEffect');
  });

  it('defines AddedMarker class extending GutterMarker', () => {
    assert.ok(src.includes('class AddedMarker extends GutterMarker'), 'Should define AddedMarker');
  });

  it('defines ModifiedMarker class extending GutterMarker', () => {
    assert.ok(src.includes('class ModifiedMarker extends GutterMarker'), 'Should define ModifiedMarker');
  });

  it('defines DeletedMarker class extending GutterMarker', () => {
    assert.ok(src.includes('class DeletedMarker extends GutterMarker'), 'Should define DeletedMarker');
  });

  it('creates a gutter with class cm-git-change-gutter', () => {
    assert.ok(src.includes('cm-git-change-gutter'), 'Should create git change gutter column');
  });

  it('defines setGitChanges StateEffect', () => {
    assert.ok(src.includes('setGitChanges'), 'Should define setGitChanges effect');
  });

  it('defines gitChangeField StateField', () => {
    assert.ok(src.includes('gitChangeField'), 'Should define gitChangeField');
  });

  it('exports createGitGutter factory function', () => {
    assert.ok(src.includes('export function createGitGutter('), 'Should export createGitGutter');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "CM6 gutter extension"`
Expected: FAIL

**Step 3: Implement the CM6 gutter infrastructure**

Add to the top of `src/lib/editor-git-gutter.js` (before `computeLineChanges`):

```javascript
import { gutter, GutterMarker, ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';

// ── Gutter marker classes ──

class AddedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-git-added';
    return el;
  }
}

class ModifiedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-git-modified';
    return el;
  }
}

class DeletedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-git-deleted';
    return el;
  }
}

const addedMarker = new AddedMarker();
const modifiedMarker = new ModifiedMarker();
const deletedMarker = new DeletedMarker();

// ── State management ──

const setGitChanges = StateEffect.define();

const gitChangeField = StateField.define({
  create() { return { markers: RangeSet.empty, changes: [] }; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitChanges)) {
        return e.value;
      }
    }
    // Map markers through document changes so positions stay valid
    if (tr.docChanged && value.markers !== RangeSet.empty) {
      return { markers: value.markers.map(tr.changes), changes: value.changes };
    }
    return value;
  },
});

// ── Gutter column ──

const gitChangeGutter = gutter({
  class: 'cm-git-change-gutter',
  markers: (view) => view.state.field(gitChangeField).markers,
  domEventHandlers: {
    mousedown(view, line) {
      // Click handler — will be wired to peek widget in Task 5
      const pos = line.from;
      const changes = view.state.field(gitChangeField).changes;
      const lineNo = view.state.doc.lineAt(pos).number;
      const change = changes.find(c => lineNo >= c.from && lineNo <= c.to);
      if (change) {
        showPeekWidget(view, change);
        return true;
      }
      return false;
    },
  },
});
```

Then add the `createGitGutter` factory at the bottom (after `opsToChanges`):

```javascript
// ── Gutter file-size gate ──

const MAX_LINES_FOR_GIT_GUTTER = 10000;

/**
 * Create the git gutter extension array.
 *
 * @param {function} getOriginalContent - async function(filePath) → string|null
 *   Returns the HEAD version of the file, or null if new/untracked.
 * @returns {Array} CM6 extension array to spread into the editor extensions
 */
export function createGitGutter(getOriginalContent) {
  const plugin = ViewPlugin.define((view) => {
    let originalContent = null;
    let debounceTimer = null;
    let currentPath = null;

    function computeAndDispatch() {
      if (originalContent === null) return;
      if (view.state.doc.lines > MAX_LINES_FOR_GIT_GUTTER) return;

      const currentText = view.state.doc.toString();
      const changes = computeLineChanges(originalContent, currentText);

      // Build RangeSet of gutter markers
      const builder = new RangeSet().constructor.empty;
      const markers = [];
      for (const change of changes) {
        const markerObj = change.type === 'added' ? addedMarker
          : change.type === 'modified' ? modifiedMarker
          : deletedMarker;

        if (change.type === 'deleted') {
          // Place deleted marker on the line where content was removed
          const lineNum = Math.min(change.from, view.state.doc.lines);
          const pos = view.state.doc.line(lineNum).from;
          markers.push({ from: pos, to: pos, marker: markerObj });
        } else {
          // Add/modified: mark each line in the range
          for (let line = change.from; line <= change.to; line++) {
            if (line > view.state.doc.lines) break;
            const pos = view.state.doc.line(line).from;
            markers.push({ from: pos, to: pos, marker: markerObj });
          }
        }
      }

      // RangeSet requires sorted, non-overlapping ranges
      markers.sort((a, b) => a.from - b.from);
      const rangeBuilder = RangeSet.of(markers.map(m => m.marker.range(m.from)));

      view.dispatch({
        effects: setGitChanges.of({ markers: rangeBuilder, changes }),
      });
    }

    return {
      async setPath(filePath) {
        currentPath = filePath;
        if (!filePath) {
          originalContent = null;
          return;
        }
        try {
          const result = await getOriginalContent(filePath);
          if (result && !result.isNew && result.content != null) {
            originalContent = result.content;
          } else {
            originalContent = null; // New file, no original
          }
        } catch {
          originalContent = null;
        }
        computeAndDispatch();
      },

      async refreshOriginal() {
        if (currentPath) {
          await this.setPath(currentPath);
        }
      },

      update(update) {
        if (update.docChanged && originalContent !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => computeAndDispatch(), 200);
        }
      },

      destroy() {
        clearTimeout(debounceTimer);
      },
    };
  });

  return [gitChangeField, gitChangeGutter, plugin];
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "CM6 gutter extension"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/editor-git-gutter.js test/components/editor-git-gutter.test.cjs
git commit -m "feat: implement CM6 gutter markers and StateField for git changes"
```

---

### Task 4: Add gutter styles to editor theme

**Files:**
- Modify: `src/lib/editor-theme.js:19-112` (add styles to `editorTheme`)
- Modify: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the failing test**

Add to `test/components/editor-git-gutter.test.cjs`:

```javascript
describe('editor-theme.js -- git gutter styles', () => {
  const themeSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

  it('styles .cm-git-added with green bar', () => {
    assert.ok(themeSrc.includes('.cm-git-added'), 'Should style .cm-git-added');
    assert.ok(themeSrc.includes('--ok'), 'Added should use --ok (green) color');
  });

  it('styles .cm-git-modified with accent bar', () => {
    assert.ok(themeSrc.includes('.cm-git-modified'), 'Should style .cm-git-modified');
    assert.ok(themeSrc.includes('--accent'), 'Modified should use --accent (blue) color');
  });

  it('styles .cm-git-deleted with danger triangle', () => {
    assert.ok(themeSrc.includes('.cm-git-deleted'), 'Should style .cm-git-deleted');
    assert.ok(themeSrc.includes('--danger'), 'Deleted should use --danger (red) color');
  });

  it('sets gutter column width', () => {
    assert.ok(themeSrc.includes('cm-git-change-gutter'), 'Should style the gutter column');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "git gutter styles"`
Expected: FAIL

**Step 3: Add styles to editor-theme.js**

In `src/lib/editor-theme.js`, add to the `editorTheme` object (inside `EditorView.theme({...})`) before the closing `}, { dark: true });`:

```javascript
  // ── Git change gutter ──
  '.cm-git-change-gutter': {
    width: '3px',
    minWidth: '3px',
    marginRight: '2px',
  },
  '.cm-git-change-gutter .cm-gutterElement': {
    padding: '0',
    minWidth: '3px',
    cursor: 'pointer',
  },
  '.cm-git-added': {
    width: '3px',
    height: '100%',
    backgroundColor: 'var(--cm-git-added, var(--ok))',
    borderRadius: '1px',
  },
  '.cm-git-modified': {
    width: '3px',
    height: '100%',
    backgroundColor: 'var(--cm-git-modified, var(--accent))',
    borderRadius: '1px',
  },
  '.cm-git-deleted': {
    position: 'relative',
    width: '3px',
    height: '0',
  },
  '.cm-git-deleted::after': {
    content: '""',
    position: 'absolute',
    left: '-1px',
    top: '-4px',
    width: '0',
    height: '0',
    borderTop: '4px solid transparent',
    borderBottom: '4px solid transparent',
    borderLeft: '5px solid var(--cm-git-deleted, var(--danger))',
    pointerEvents: 'none',
  },
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "git gutter styles"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/editor-theme.js test/components/editor-git-gutter.test.cjs
git commit -m "feat: add git gutter CSS styles to editor theme"
```

---

### Task 5: Implement inline peek widget with revert

**Files:**
- Modify: `src/lib/editor-git-gutter.js`
- Modify: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the failing tests**

Add to `test/components/editor-git-gutter.test.cjs`:

```javascript
describe('editor-git-gutter.js -- peek widget', () => {
  it('defines a PeekWidget class extending WidgetType', () => {
    assert.ok(src.includes('class PeekWidget extends WidgetType'), 'Should define PeekWidget');
  });

  it('peek widget has revert functionality', () => {
    assert.ok(src.includes('Revert'), 'Should have Revert button text');
  });

  it('peek widget shows original content', () => {
    assert.ok(src.includes('peek-original') || src.includes('peek-deleted'),
      'Should show original/deleted content in peek');
  });

  it('peek widget has navigation (prev/next)', () => {
    assert.ok(src.includes('peek-prev') || src.includes('prev-change'),
      'Should have prev change navigation');
    assert.ok(src.includes('peek-next') || src.includes('next-change'),
      'Should have next change navigation');
  });

  it('peek widget has close button', () => {
    assert.ok(src.includes('peek-close'), 'Should have close button');
  });

  it('defines showPeekWidget function', () => {
    assert.ok(src.includes('function showPeekWidget'), 'Should define showPeekWidget');
  });

  it('uses Decoration.widget for block placement', () => {
    assert.ok(src.includes('Decoration.widget'), 'Should use Decoration.widget');
    assert.ok(src.includes('block: true') || src.includes('block:true'), 'Should use block decoration');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "peek widget"`
Expected: FAIL

**Step 3: Implement the peek widget**

Add to `src/lib/editor-git-gutter.js` (after the gutter column definition, before `computeLineChanges`):

```javascript
// ── Peek widget state ──

const setPeekWidget = StateEffect.define();

const peekWidgetField = StateField.define({
  create() { return Decoration.none; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setPeekWidget)) return e.value;
    }
    if (tr.docChanged) return Decoration.none; // Close on edit
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Peek widget class ──

class PeekWidget extends WidgetType {
  constructor(change, originalLines, view) {
    super();
    this.change = change;
    this.originalLines = originalLines;
    this.view = view;
  }

  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-git-peek';

    // Header
    const header = document.createElement('div');
    header.className = 'cm-git-peek-header';

    const allChanges = this.view.state.field(gitChangeField).changes;
    const idx = allChanges.indexOf(this.change);
    const label = document.createElement('span');
    label.className = 'cm-git-peek-label';
    label.textContent = `Change ${idx + 1} of ${allChanges.length}`;

    const nav = document.createElement('span');
    nav.className = 'cm-git-peek-nav';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'cm-git-peek-btn prev-change';
    prevBtn.textContent = '↑';
    prevBtn.title = 'Previous change';
    prevBtn.disabled = idx <= 0;
    prevBtn.onclick = () => {
      if (idx > 0) showPeekWidget(this.view, allChanges[idx - 1]);
    };

    const nextBtn = document.createElement('button');
    nextBtn.className = 'cm-git-peek-btn next-change';
    nextBtn.textContent = '↓';
    nextBtn.title = 'Next change';
    nextBtn.disabled = idx >= allChanges.length - 1;
    nextBtn.onclick = () => {
      if (idx < allChanges.length - 1) showPeekWidget(this.view, allChanges[idx + 1]);
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cm-git-peek-btn peek-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (Escape)';
    closeBtn.onclick = () => closePeekWidget(this.view);

    nav.append(prevBtn, nextBtn, closeBtn);
    header.append(label, nav);

    // Body — show the hunk
    const body = document.createElement('div');
    body.className = 'cm-git-peek-body';

    if (this.change.type === 'deleted' || this.change.type === 'modified') {
      const oldBlock = document.createElement('div');
      oldBlock.className = 'cm-git-peek-deleted';
      // Get original lines for this hunk
      const origLines = this.originalLines;
      for (const line of origLines) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-git-peek-line removed';
        lineEl.textContent = '- ' + line;
        oldBlock.appendChild(lineEl);
      }
      body.appendChild(oldBlock);
    }

    if (this.change.type === 'added' || this.change.type === 'modified') {
      const newBlock = document.createElement('div');
      newBlock.className = 'cm-git-peek-added';
      const doc = this.view.state.doc;
      for (let lineNo = this.change.from; lineNo <= this.change.to && lineNo <= doc.lines; lineNo++) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-git-peek-line added';
        lineEl.textContent = '+ ' + doc.line(lineNo).text;
        newBlock.appendChild(lineEl);
      }
      body.appendChild(newBlock);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'cm-git-peek-actions';

    const revertBtn = document.createElement('button');
    revertBtn.className = 'cm-git-peek-btn cm-git-peek-revert';
    revertBtn.textContent = 'Revert Change';
    revertBtn.onclick = () => {
      revertChange(this.view, this.change, this.originalLines);
      closePeekWidget(this.view);
    };
    actions.appendChild(revertBtn);

    wrapper.append(header, body, actions);
    return wrapper;
  }

  ignoreEvent() { return false; }
}

// ── Peek widget helpers ──

function showPeekWidget(view, change) {
  const state = view.state.field(gitChangeField);
  const originalContent = view.state.field(originalContentField);
  if (!originalContent) return;

  const originalLines = originalContent.split('\n');

  // Determine which original lines correspond to this change.
  // Re-run the diff to get the old-line mapping.
  const currentText = view.state.doc.toString();
  const oldLines = originalContent.split('\n');
  const newLines = currentText.split('\n');
  const ops = myersDiff(oldLines, newLines);

  // Map change back to original line range
  let hunkOriginalLines = [];
  if (change.type === 'deleted' || change.type === 'modified') {
    // Find the ops that correspond to this change's line range
    let deletes = [];
    for (const op of ops) {
      if (op.type === 'delete') {
        deletes.push(oldLines[op.oldIdx]);
      } else if (op.type === 'insert' || op.type === 'equal') {
        const newLineNo = (op.newIdx ?? -1) + 1;
        if (newLineNo >= change.from && newLineNo <= change.to && deletes.length > 0) {
          hunkOriginalLines.push(...deletes);
          deletes = [];
        } else if (deletes.length > 0 && change.type === 'deleted' && newLineNo >= change.from) {
          hunkOriginalLines.push(...deletes);
          deletes = [];
        } else {
          deletes = [];
        }
      }
    }
    // Catch trailing deletes
    if (deletes.length > 0 && change.type === 'deleted') {
      hunkOriginalLines.push(...deletes);
    }
  }

  // Place widget below the last line of the change
  const lineNo = Math.min(change.to, view.state.doc.lines);
  const pos = view.state.doc.line(lineNo).to;

  const widget = Decoration.widget({
    widget: new PeekWidget(change, hunkOriginalLines, view),
    block: true,
    side: 1,
  });

  view.dispatch({
    effects: setPeekWidget.of(Decoration.set([widget.range(pos)])),
  });
}

function closePeekWidget(view) {
  view.dispatch({
    effects: setPeekWidget.of(Decoration.none),
  });
}

function revertChange(view, change, originalLines) {
  const doc = view.state.doc;
  if (change.type === 'deleted') {
    // Re-insert deleted lines at the deletion point
    const insertPos = change.from <= doc.lines
      ? doc.line(change.from).from
      : doc.length;
    const insertText = originalLines.join('\n') + '\n';
    view.dispatch({ changes: { from: insertPos, to: insertPos, insert: insertText } });
  } else if (change.type === 'added') {
    // Remove added lines
    const from = doc.line(change.from).from;
    const to = change.to < doc.lines
      ? doc.line(change.to + 1).from
      : doc.line(change.to).to;
    view.dispatch({ changes: { from, to, insert: '' } });
  } else if (change.type === 'modified') {
    // Replace modified lines with original
    const from = doc.line(change.from).from;
    const to = doc.line(change.to).to;
    const replacement = originalLines.join('\n');
    view.dispatch({ changes: { from, to, insert: replacement } });
  }
}
```

Also add a `StateField` to store the original content so the peek widget can access it:

```javascript
// Add near the other StateField definitions:
const setOriginalContent = StateEffect.define();

const originalContentField = StateField.define({
  create() { return null; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setOriginalContent)) return e.value;
    }
    return value;
  },
});
```

Update `createGitGutter` to:
1. Include `peekWidgetField` and `originalContentField` in the returned extensions array
2. Dispatch `setOriginalContent` when original content is fetched
3. Add an Escape key handler to close the peek widget

In the `createGitGutter` return statement, change:
```javascript
return [gitChangeField, gitChangeGutter, plugin];
```
to:
```javascript
return [
  gitChangeField,
  originalContentField,
  peekWidgetField,
  gitChangeGutter,
  plugin,
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key === 'Escape' && view.state.field(peekWidgetField) !== Decoration.none) {
        closePeekWidget(view);
        return true;
      }
      return false;
    },
  }),
];
```

In the `setPath` method of the ViewPlugin, after `originalContent = result.content;`, add:
```javascript
view.dispatch({ effects: setOriginalContent.of(originalContent) });
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "peek widget"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/editor-git-gutter.js test/components/editor-git-gutter.test.cjs
git commit -m "feat: implement inline peek widget with revert for git gutter"
```

---

### Task 6: Add peek widget styles to editor theme

**Files:**
- Modify: `src/lib/editor-theme.js`
- Modify: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the failing test**

```javascript
describe('editor-theme.js -- peek widget styles', () => {
  const themeSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

  it('styles the peek widget container', () => {
    assert.ok(themeSrc.includes('.cm-git-peek'), 'Should style .cm-git-peek');
  });

  it('styles peek header', () => {
    assert.ok(themeSrc.includes('cm-git-peek-header'), 'Should style peek header');
  });

  it('styles peek revert button', () => {
    assert.ok(themeSrc.includes('cm-git-peek-revert'), 'Should style revert button');
  });

  it('styles removed and added lines', () => {
    assert.ok(themeSrc.includes('cm-git-peek-line'), 'Should style peek diff lines');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "peek widget styles"`
Expected: FAIL

**Step 3: Add peek widget styles to editor-theme.js**

Add to the `editorTheme` object in `EditorView.theme({...})`:

```javascript
  // ── Git peek widget ──
  '.cm-git-peek': {
    backgroundColor: 'var(--cm-panel-bg, var(--bg-elevated))',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    margin: '4px 0 4px 24px',
    overflow: 'hidden',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-git-peek-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
    borderBottom: '1px solid var(--border)',
    fontSize: '11px',
    color: 'var(--cm-foreground)',
  },
  '.cm-git-peek-label': {
    fontWeight: '600',
  },
  '.cm-git-peek-nav': {
    display: 'flex',
    gap: '2px',
  },
  '.cm-git-peek-btn': {
    background: 'transparent',
    border: 'none',
    color: 'var(--cm-foreground)',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '12px',
    lineHeight: '1',
  },
  '.cm-git-peek-btn:hover': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  },
  '.cm-git-peek-btn:disabled': {
    opacity: '0.3',
    cursor: 'default',
  },
  '.cm-git-peek-body': {
    padding: '4px 0',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  '.cm-git-peek-line': {
    padding: '0 8px',
    lineHeight: '1.6',
    whiteSpace: 'pre',
  },
  '.cm-git-peek-line.removed': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)',
    color: 'var(--danger)',
  },
  '.cm-git-peek-line.added': {
    backgroundColor: 'color-mix(in srgb, var(--ok) 12%, transparent)',
    color: 'var(--ok)',
  },
  '.cm-git-peek-actions': {
    padding: '4px 8px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  '.cm-git-peek-revert': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 15%, transparent)',
    color: 'var(--danger)',
    border: '1px solid var(--danger)',
    padding: '3px 10px',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '600',
  },
  '.cm-git-peek-revert:hover': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 25%, transparent)',
  },
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "peek widget styles"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/editor-theme.js test/components/editor-git-gutter.test.cjs
git commit -m "feat: add peek widget styles to editor theme"
```

---

### Task 7: Wire git gutter into FileEditor

**Files:**
- Modify: `src/lib/editor-extensions.js:28-137` (add git gutter to extensions)
- Modify: `src/components/lens/FileEditor.svelte` (pass callback, trigger on load/save)
- Modify: `test/components/editor-git-gutter.test.cjs`

**Step 1: Write the failing tests**

Add to `test/components/editor-git-gutter.test.cjs`:

```javascript
describe('editor-extensions.js -- git gutter integration', () => {
  const extSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');

  it('imports createGitGutter', () => {
    assert.ok(extSrc.includes('createGitGutter'), 'Should import createGitGutter');
  });

  it('accepts onGetOriginalContent option', () => {
    assert.ok(extSrc.includes('onGetOriginalContent') || extSrc.includes('getOriginalContent'),
      'Should accept original content callback in options');
  });

  it('spreads git gutter extensions into the array', () => {
    assert.ok(extSrc.includes('createGitGutter'), 'Should call createGitGutter');
  });
});

describe('FileEditor.svelte -- git gutter integration', () => {
  const editorSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/FileEditor.svelte'), 'utf-8');

  it('imports getFileGitContent from api', () => {
    assert.ok(editorSrc.includes('getFileGitContent'), 'Should import getFileGitContent');
  });

  it('passes getOriginalContent to buildEditorExtensions', () => {
    assert.ok(editorSrc.includes('getOriginalContent') || editorSrc.includes('onGetOriginalContent'),
      'Should pass original content callback');
  });

  it('refreshes git gutter after save', () => {
    assert.ok(editorSrc.includes('refreshOriginal') || editorSrc.includes('refreshGitGutter'),
      'Should refresh git gutter after saving');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "git gutter integration"`
Expected: FAIL

**Step 3: Wire it up**

**`src/lib/editor-extensions.js`** — Add the import and option:

At the top of the file, add:
```javascript
import { createGitGutter } from './editor-git-gutter.js';
```

Add `getOriginalContent` to the destructured options:
```javascript
const {
  isReadOnly,
  filePath,
  voiceMirrorEditorTheme,
  onDocChanged,
  onDismissMenu,
  onSave,
  onFormat,
  onSignatureHelp,
  onContextMenu,
  onClick,
  getOriginalContent,  // async (path) => { content, isNew } | null
} = options;
```

After the minimap push and before the LSP section, add:
```javascript
  // Git change gutter — skip for read-only / external files
  if (getOriginalContent && !isReadOnly) {
    extensions.push(...createGitGutter(getOriginalContent));
  }
```

**`src/components/lens/FileEditor.svelte`** — Add the callback and refresh:

Add `getFileGitContent` to the existing api.js import (it already imports `readFile`, `writeFile`, etc.):
```javascript
import { readFile, readExternalFile, writeFile, getFileGitContent, revealInExplorer } from '../../lib/api.js';
```

In the `buildEditorExtensions` call, add the `getOriginalContent` option:
```javascript
const extensions = buildEditorExtensions(cm, lsp, {
  isReadOnly,
  filePath,
  voiceMirrorEditorTheme,
  // ... existing options ...
  getOriginalContent: isExternal ? null : async (path) => {
    const root = projectStore.activeProject?.path || null;
    try {
      const result = await getFileGitContent(path, root);
      return result?.data || result;
    } catch { return null; }
  },
});
```

After the `loadFile` function creates the editor, access the git gutter plugin to set the initial path. After `view = new cm.EditorView(...)`:
```javascript
// Initialize git gutter with the file path
const gitPlugin = view.plugin(/* ViewPlugin reference */);
```

Actually, the cleaner approach is to have the `ViewPlugin.create()` in `createGitGutter` accept the file path through the options callback. The callback already receives the path. We need to trigger `setPath` after the editor is created.

Add after the EditorView creation:
```javascript
// Trigger git gutter initial load
if (!isExternal && !isReadOnly) {
  setTimeout(() => {
    const gitPlugin = view?.plugin?.(gitGutterPlugin);
    if (gitPlugin) gitPlugin.setPath(filePath);
  }, 0);
}
```

Wait — this requires exporting the plugin reference. Simpler approach: have the `ViewPlugin.create()` automatically call `setPath` on init. Update `createGitGutter` to accept the initial path:

Change `createGitGutter` signature to:
```javascript
export function createGitGutter(getOriginalContent) {
```

And in the `ViewPlugin.define` callback, add an init call:
```javascript
const plugin = ViewPlugin.define((view) => {
  // ... existing code ...
  const instance = {
    // ... existing methods ...
  };
  // Auto-init is handled by FileEditor calling setPath after creation
  return instance;
});
```

Actually, the simplest pattern: export the ViewPlugin reference so FileEditor can access it:

In `editor-git-gutter.js`, change the plugin creation to use a module-level reference:

```javascript
let _gitGutterPlugin = null;

export function createGitGutter(getOriginalContent) {
  const plugin = ViewPlugin.define((view) => {
    // ... same as before ...
  });
  _gitGutterPlugin = plugin;
  return [gitChangeField, originalContentField, peekWidgetField, gitChangeGutter, plugin, /* escape handler */];
}

export { _gitGutterPlugin as gitGutterPlugin };
```

Then in FileEditor, after creating the EditorView:
```javascript
import { gitGutterPlugin } from '../../lib/editor-git-gutter.js';

// After view = new cm.EditorView(...)
if (!isExternal && !isReadOnly && !isUntitled) {
  const gp = view.plugin(gitGutterPlugin);
  if (gp) gp.setPath(filePath);
}
```

And in the `save()` function, after `tabsStore.setDirty(tab.id, false);`:
```javascript
// Refresh git gutter (file on disk changed)
const gp = view?.plugin?.(gitGutterPlugin);
if (gp) gp.refreshOriginal();
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "git gutter integration"`
Expected: PASS

**Step 5: Run the full test suite**

Run: `npm test`
Expected: All 3400+ tests pass

**Step 6: Commit**

```bash
git add src/lib/editor-extensions.js src/lib/editor-git-gutter.js src/components/lens/FileEditor.svelte test/components/editor-git-gutter.test.cjs
git commit -m "feat: wire git gutter into FileEditor with save refresh"
```

---

### Task 8: Run full test suite and verify

**Step 1: Run npm tests**

Run: `npm test`
Expected: All tests pass (3400+)

**Step 2: Verify no import/syntax errors**

Run: `npm run check` (Svelte type checking)
Expected: Clean

**Step 3: Manual verification**

1. Open Voice Mirror in dev mode: `npm run dev`
2. Open any file that has git changes
3. Verify green bars appear next to added lines
4. Verify blue bars appear next to modified lines
5. Verify red triangle appears where lines were deleted
6. Click a gutter bar — peek widget should appear
7. Verify "Revert Change" reverts the hunk
8. Press Escape — peek widget closes
9. Edit the file — gutter updates after 200ms
10. Save the file (Ctrl+S) — gutter refreshes from disk

**Step 4: Update IDE-GAPS.md**

Move "Inline gutter change indicators" from Open Gaps to Completed:

In the Completed table, add:
```markdown
| Inline gutter change indicators | Editor + Git | Green/blue/red bars + peek widget + revert |
```

In the Open Gaps table, remove rank #1 (inline gutter change indicators) and renumber remaining gaps.

In §11 (Source Control), change:
```markdown
| **Inline change indicators (editor gutter)** | ✅ ... | ✅ Same | ❌ | **High** |
```
to:
```markdown
| **Inline change indicators (editor gutter)** | ✅ ... | ✅ Same | ✅ Added/modified/deleted + peek + revert | Done |
```

In §15 (Editor), make the same change.

**Step 5: Commit**

```bash
git add docs/implementation/IDE-GAPS.md
git commit -m "docs: mark inline gutter change indicators as complete in IDE-GAPS"
```

---

## Summary of Files

| File | Type | Lines (est.) |
|------|------|-------------|
| `src/lib/editor-git-gutter.js` | New | ~350 |
| `src/lib/editor-extensions.js` | Modify | +10 |
| `src/lib/editor-theme.js` | Modify | +80 |
| `src/components/lens/FileEditor.svelte` | Modify | +15 |
| `test/components/editor-git-gutter.test.cjs` | New | ~120 |
| `docs/implementation/IDE-GAPS.md` | Modify | ~5 |

**No new Rust commands.** No new npm packages. No new stores.
