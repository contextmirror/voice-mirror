# Quick Wins Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract 5 duplicated patterns into shared utilities, eliminating ~80 copy-pasted code blocks across the frontend.

**Architecture:** Pure mechanical extraction — create utility functions/actions, then find-and-replace each call site. No behavior changes, no UI changes. Each task is independent and can be committed separately.

**Tech Stack:** Svelte 5 (runes), ES modules, node:test

**Branch:** `refactor/code-audit` (from current `feature/lens` HEAD)

---

### Task 1: Extract `basename()` utility (18 sites)

**Files:**
- Modify: `src/lib/utils.js` — add export
- Modify: `test/unit/utils.test.mjs` — add tests
- Modify 14 files with 18 call sites (listed below)

**Step 1: Write the test**

Add to `test/unit/utils.test.mjs`:

```js
import { basename } from '../../src/lib/utils.js';

describe('basename', () => {
  it('extracts filename from forward-slash path', () => {
    assert.equal(basename('src/lib/utils.js'), 'utils.js');
  });

  it('extracts filename from backslash path', () => {
    assert.equal(basename('src\\lib\\utils.js'), 'utils.js');
  });

  it('extracts filename from mixed separators', () => {
    assert.equal(basename('src/lib\\utils.js'), 'utils.js');
  });

  it('returns the string itself if no separators', () => {
    assert.equal(basename('file.txt'), 'file.txt');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(basename(null), null);
    assert.equal(basename(undefined), undefined);
  });

  it('handles empty string', () => {
    assert.equal(basename(''), '');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep basename`
Expected: FAIL — `basename` is not exported

**Step 3: Write the implementation**

Add to `src/lib/utils.js`:

```js
/**
 * Extract the filename from a path string (handles both / and \ separators).
 */
export function basename(path) {
  return path?.split(/[/\\]/).pop() || path;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --grep basename`
Expected: PASS

**Step 5: Replace all 18 call sites**

In each file below, add `import { basename } from '$lib/utils.js';` (or adjust relative path) and replace `path.split(/[/\\]/).pop() || path` (and variants like `path.split(/[/\\]/).pop()`) with `basename(path)`.

Call sites:
1. `src/lib/editor-lsp.svelte.js:139`
2. `src/lib/stores/tabs.svelte.js:214`
3. `src/lib/stores/tabs.svelte.js:571`
4. `src/components/terminal/Terminal.svelte:447`
5. `src/components/lens/FileEditor.svelte:460`
6. `src/components/lens/FileEditor.svelte:471`
7. `src/components/lens/FileEditor.svelte:488`
8. `src/components/lens/FileEditor.svelte:983`
9. `src/components/lens/FileContextMenu.svelte:110`
10. `src/components/lens/DiffViewer.svelte:157`
11. `src/components/lens/ReferencesPanel.svelte:12`
12. `src/components/lens/CommandPalette.svelte:147`
13. `src/components/lens/ProblemsPanel.svelte:137`
14. `src/components/lens/FileTree.svelte:292`
15. `src/components/lens/FileTree.svelte:701`
16. `src/components/lens/FileTree.svelte:798`
17. `src/components/lens/TabBar.svelte:22`
18. `src/components/lens/SearchPanel.svelte:132`

**Important:** Some sites use slight variants — e.g. `.split('/').pop()` (forward-slash only) or no `|| path` fallback. Normalize all to `basename(path)`.

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/lib/utils.js test/unit/utils.test.mjs src/lib/editor-lsp.svelte.js src/lib/stores/tabs.svelte.js src/components/terminal/Terminal.svelte src/components/lens/FileEditor.svelte src/components/lens/FileContextMenu.svelte src/components/lens/DiffViewer.svelte src/components/lens/ReferencesPanel.svelte src/components/lens/CommandPalette.svelte src/components/lens/ProblemsPanel.svelte src/components/lens/FileTree.svelte src/components/lens/TabBar.svelte src/components/lens/SearchPanel.svelte
git commit -m "refactor: extract basename() utility, replace 18 inline copies"
```

---

### Task 2: Add `projectStore.root` getter (35+ sites)

**Files:**
- Modify: `src/lib/stores/project.svelte.js` — add getter
- Modify: `test/stores/project.test.cjs` — add test
- Modify: ~10 files with heaviest usage

**Step 1: Write the test**

Add to `test/stores/project.test.cjs` (source-inspection pattern):

```js
describe('project.svelte.js: root getter', () => {
  it('has a root getter that returns activeProject path or null', () => {
    const rootGetterIdx = src.indexOf('get root()');
    assert.ok(rootGetterIdx !== -1, 'Should have a root getter');
    const body = src.slice(rootGetterIdx, rootGetterIdx + 200);
    assert.ok(body.includes('activeProject'), 'root getter should reference activeProject');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep "root getter"`
Expected: FAIL

**Step 3: Write the implementation**

Add getter to the store object in `src/lib/stores/project.svelte.js`, alongside the existing `activeProject` getter:

```js
get root() {
  return this.activeProject?.path || null;
},
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --grep "root getter"`
Expected: PASS

**Step 5: Replace call sites**

Replace `projectStore.activeProject?.path || null` and `projectStore.activeProject?.path || ''` with `projectStore.root` across all files. The heaviest files:

- `src/components/lens/FileEditor.svelte` (~15 uses)
- `src/components/lens/FileTree.svelte`
- `src/components/lens/SearchPanel.svelte`
- `src/components/lens/CommandPalette.svelte`
- `src/components/lens/GitCommitPanel.svelte`
- `src/components/lens/StatusDropdown.svelte`
- `src/components/lens/LensPreview.svelte`
- `src/components/lens/TabBar.svelte`
- `src/components/lens/GroupTabBar.svelte`
- `src/lib/stores/tabs.svelte.js`

**Important:** Some sites use `|| ''` instead of `|| null`. The getter returns `null`. If a call site needs empty string, use `projectStore.root || ''` — but check if the downstream API accepts `null` first (most do).

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: add projectStore.root getter, replace 35+ inline expressions"
```

---

### Task 3: Extract `unwrapResult()` utility (20+ sites)

**Files:**
- Modify: `src/lib/utils.js` — add export
- Modify: `test/unit/utils.test.mjs` — add tests
- Modify: ~15 files with 20+ call sites

**Step 1: Write the test**

Add to `test/unit/utils.test.mjs`:

```js
import { unwrapResult } from '../../src/lib/utils.js';

describe('unwrapResult', () => {
  it('extracts .data from wrapped result', () => {
    assert.equal(unwrapResult({ data: 'hello' }), 'hello');
  });

  it('returns result directly if no .data property', () => {
    assert.equal(unwrapResult('hello'), 'hello');
  });

  it('returns result directly if .data is undefined', () => {
    assert.deepEqual(unwrapResult({ other: 1 }), { other: 1 });
  });

  it('returns fallback for null result', () => {
    assert.equal(unwrapResult(null, 'default'), 'default');
  });

  it('returns fallback for undefined result', () => {
    assert.equal(unwrapResult(undefined, 'default'), 'default');
  });

  it('returns null as default fallback', () => {
    assert.equal(unwrapResult(null), null);
  });

  it('preserves falsy .data values (0, empty string, false)', () => {
    assert.equal(unwrapResult({ data: 0 }), 0);
    assert.equal(unwrapResult({ data: '' }), '');
    assert.equal(unwrapResult({ data: false }), false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep unwrapResult`
Expected: FAIL

**Step 3: Write the implementation**

Add to `src/lib/utils.js`:

```js
/**
 * Unwrap a Tauri IPC result that may be { data } or the value directly.
 */
export function unwrapResult(result, fallback = null) {
  if (result == null) return fallback;
  return result.data !== undefined ? result.data : result;
}
```

Note: Using `result.data !== undefined` instead of `result?.data ?? result` to correctly handle falsy `.data` values like `0`, `""`, `false`.

**Step 4: Run test to verify it passes**

Run: `npm test -- --grep unwrapResult`
Expected: PASS

**Step 5: Replace all call sites**

In each file, add `import { unwrapResult } from '$lib/utils.js';` and replace patterns like:
- `result?.data || result` → `unwrapResult(result)`
- `const data = result?.data || result` → `const data = unwrapResult(result)`
- `(result?.data || result) || []` → `unwrapResult(result) || []`

Call sites (representative, search for `?.data || result` and `?.data ?? result` to find all):
- `src/lib/stores/ai-status.svelte.js`
- `src/components/settings/AISettings.svelte`
- `src/components/chat/ScreenshotPicker.svelte`
- `src/components/settings/DependencySettings.svelte`
- `src/components/settings/VoiceSettings.svelte`
- `src/components/lens/CommandPalette.svelte`
- `src/components/lens/FileEditor.svelte`
- `src/components/lens/LspTab.svelte`
- `src/components/lens/StatusDropdown.svelte`
- `src/components/lens/ServersTab.svelte`
- `src/lib/stores/project.svelte.js`
- `src/components/lens/LensPreview.svelte`
- `src/lib/stores/voice.svelte.js`
- `src/components/chat/ChatSessionDropdown.svelte`
- `src/components/sidebar/ChatList.svelte`

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract unwrapResult() utility, replace 20+ inline unwrap patterns"
```

---

### Task 4: Extract `clampToViewport()` utility (7 sites)

**Files:**
- Create: `src/lib/clamp-to-viewport.js`
- Create: `test/lib/clamp-to-viewport.test.cjs`
- Modify 7 component files

**Step 1: Write the test**

Create `test/lib/clamp-to-viewport.test.cjs` (source-inspection pattern):

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/clamp-to-viewport.js'),
  'utf-8'
);

describe('clamp-to-viewport.js', () => {
  it('exports a clampToViewport function', () => {
    assert.ok(src.includes('export function clampToViewport'),
      'Should export clampToViewport');
  });

  it('checks bottom overflow against window.innerHeight', () => {
    assert.ok(src.includes('innerHeight'),
      'Should reference window.innerHeight for bottom clamping');
  });

  it('checks right overflow against window.innerWidth', () => {
    assert.ok(src.includes('innerWidth'),
      'Should reference window.innerWidth for right clamping');
  });

  it('uses getBoundingClientRect for measurement', () => {
    assert.ok(src.includes('getBoundingClientRect'),
      'Should use getBoundingClientRect to measure element');
  });

  it('applies padding to prevent edge-touching', () => {
    assert.ok(src.includes('pad') || src.includes('padding'),
      'Should apply padding from viewport edges');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep clamp-to-viewport`
Expected: FAIL — file does not exist

**Step 3: Write the implementation**

Create `src/lib/clamp-to-viewport.js`:

```js
/**
 * Reposition an absolutely/fixed-positioned element if it overflows the viewport.
 * Call from an $effect after the element is mounted and positioned.
 *
 * @param {HTMLElement} el - The element to clamp
 * @param {number} [pad=4] - Padding from viewport edges in px
 */
export function clampToViewport(el, pad = 4) {
  const rect = el.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - pad) {
    el.style.top = `${Math.max(pad, window.innerHeight - rect.height - pad)}px`;
  }
  if (rect.right > window.innerWidth - pad) {
    el.style.left = `${Math.max(pad, window.innerWidth - rect.width - pad)}px`;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --grep clamp-to-viewport`
Expected: PASS

**Step 5: Replace all 7 call sites**

In each file, add `import { clampToViewport } from '$lib/clamp-to-viewport.js';` and replace the 10-line `$effect` block with:

```js
$effect(() => {
  if (visible && menuEl) clampToViewport(menuEl);
});
```

Files and approximate line ranges:
1. `src/components/lens/TabContextMenu.svelte:30-41`
2. `src/components/lens/FileContextMenu.svelte:30-41`
3. `src/components/lens/EditorContextMenu.svelte:31-42`
4. `src/components/lens/CodeActionsMenu.svelte:41-52`
5. `src/components/terminal/TerminalContextMenu.svelte:95-106`
6. `src/components/lens/ChatSessionDropdown.svelte:18-29` (guard is `contextMenu.visible && contextMenuEl`)
7. `src/components/lens/RenameInput.svelte:44-56` (guard is `visible && renameEl`)

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/lib/clamp-to-viewport.js test/lib/clamp-to-viewport.test.cjs src/components/lens/TabContextMenu.svelte src/components/lens/FileContextMenu.svelte src/components/lens/EditorContextMenu.svelte src/components/lens/CodeActionsMenu.svelte src/components/terminal/TerminalContextMenu.svelte src/components/lens/ChatSessionDropdown.svelte src/components/lens/RenameInput.svelte
git commit -m "refactor: extract clampToViewport() utility, replace 7 inline $effect blocks"
```

---

### Task 5: Extract click-outside helpers (Pattern B only — 4 sites)

**Files:**
- Create: `src/lib/popup-utils.js`
- Create: `test/lib/popup-utils.test.cjs`
- Modify 4 component files

**Scope note:** Only consolidating Pattern B (capture-phase mousedown + ESC keydown, used by context menus). Pattern A (deferred setTimeout click, used by pickers/dropdowns) has too much variance in guards and event types to unify cleanly — leave those as-is.

**Step 1: Write the test**

Create `test/lib/popup-utils.test.cjs` (source-inspection pattern):

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/popup-utils.js'),
  'utf-8'
);

describe('popup-utils.js', () => {
  it('exports a setupClickOutside function', () => {
    assert.ok(src.includes('export function setupClickOutside'),
      'Should export setupClickOutside');
  });

  it('uses capture phase for mousedown', () => {
    assert.ok(src.includes("'mousedown'") && src.includes('true'),
      'Should add mousedown listener in capture phase');
  });

  it('handles Escape key', () => {
    assert.ok(src.includes("'Escape'"),
      'Should close on Escape key');
  });

  it('checks element containment', () => {
    assert.ok(src.includes('.contains('),
      'Should check if click target is inside the menu');
  });

  it('returns a cleanup function', () => {
    assert.ok(src.includes('removeEventListener'),
      'Should return cleanup that removes listeners');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep popup-utils`
Expected: FAIL — file does not exist

**Step 3: Write the implementation**

Create `src/lib/popup-utils.js`:

```js
/**
 * Set up click-outside and Escape-key closing for a context menu.
 * Uses capture-phase mousedown to catch clicks before they propagate.
 *
 * @param {HTMLElement} el - The menu element
 * @param {() => void} onClose - Called when user clicks outside or presses Escape
 * @returns {() => void} Cleanup function to remove listeners
 */
export function setupClickOutside(el, onClose) {
  function handleMousedown(e) {
    if (!el.contains(e.target)) onClose();
  }
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
  document.addEventListener('mousedown', handleMousedown, true);
  document.addEventListener('keydown', handleKeydown, true);
  return () => {
    document.removeEventListener('mousedown', handleMousedown, true);
    document.removeEventListener('keydown', handleKeydown, true);
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --grep popup-utils`
Expected: PASS

**Step 5: Replace all 4 call sites**

In each file, add `import { setupClickOutside } from '$lib/popup-utils.js';` and replace the `handleClickOutside` function + `$effect` block with:

```js
$effect(() => {
  if (visible) return setupClickOutside(menuEl, close);
});
```

The `$effect` return value is the cleanup function, so Svelte automatically calls it when `visible` becomes false or the component unmounts.

Files:
1. `src/components/lens/TabContextMenu.svelte` — remove `handleClickOutside` fn + $effect (lines 57-74)
2. `src/components/lens/FileContextMenu.svelte` — remove `handleClickOutside` fn + $effect (lines 59-74)
3. `src/components/lens/EditorContextMenu.svelte` — remove `handleClickOutside` fn + $effect (lines 55-70)
4. `src/components/lens/CodeActionsMenu.svelte` — remove `handleClickOutside` fn + `handleKeydown` fn + $effect (lines 54-76)

**Note:** Each file also has a local `handleKeydown` for menu-specific keyboard nav (arrow keys, etc.). Only remove the Escape-handling `handleKeydown` that is part of the click-outside pattern. If the file has a separate `handleKeydown` for arrow nav, keep it.

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/lib/popup-utils.js test/lib/popup-utils.test.cjs src/components/lens/TabContextMenu.svelte src/components/lens/FileContextMenu.svelte src/components/lens/EditorContextMenu.svelte src/components/lens/CodeActionsMenu.svelte
git commit -m "refactor: extract setupClickOutside() utility, replace 4 inline patterns"
```

---

### Task 6: Final verification and branch cleanup

**Step 1: Run full test suite**

Run: `npm test`
Expected: All 5900+ tests pass

**Step 2: Verify no regressions with a quick manual smoke test**

- Open the app (`npm run dev`)
- Right-click in file tree → context menu appears, positions correctly, closes on outside click
- Right-click on a tab → same behavior
- Open a file → editor loads normally
- Check the Problems panel → severity counts display correctly

**Step 3: Update CODE-AUDIT.md**

Check off the completed items in `docs/CODE-AUDIT.md`.
