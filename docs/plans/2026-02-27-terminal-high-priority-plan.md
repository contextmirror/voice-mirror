# Terminal High-Priority Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 5 high-priority terminal features: tab close button, grid splits, terminal persistence, find-in-terminal, and clickable links.

**Architecture:** Pure-JS modules for testable logic (`split-tree.js`, `terminal-search.js`, `terminal-links.js`), thin Svelte component wrappers, config persistence via existing Rust backend. All logic modules are plain `.js` (not `.svelte.js`) so they can be directly imported in `node:test`.

**Tech Stack:** Svelte 5, ghostty-web (WASM terminal), node:test, Tauri IPC, Rust serde config

**Testing:** Every feature is TDD — write tests first, then implement. Test files use `node:test` + `node:assert/strict`. Pure-JS modules use direct-import `.mjs` tests. Svelte components use source-inspection `.cjs` tests.

**Important:** Another Claude may be working on unrelated files. Ignore uncommitted changes not related to this plan.

---

## Task 1: Tab Close Button

**Files:**
- Modify: `src/components/terminal/TerminalTabStrip.svelte`
- Modify: `src/lib/stores/terminal-tabs.svelte.js` (add `killGroup` method)
- Create: `test/components/terminal-tab-strip.cjs`

### Step 1: Write source-inspection tests for TerminalTabStrip

Create `test/components/terminal-tab-strip.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalTabStrip.svelte'),
  'utf-8'
);

describe('TerminalTabStrip', () => {
  it('has a close button element', () => {
    assert.ok(src.includes('close-btn') || src.includes('tab-close'), 'should have a close button class');
  });

  it('close button calls killGroup or killInstance on click', () => {
    assert.ok(
      src.includes('handleClose') || src.includes('killGroup') || src.includes('killInstance'),
      'should have close handler'
    );
  });

  it('close button has stop propagation to prevent tab switching', () => {
    assert.ok(src.includes('stopPropagation'), 'close click should not bubble to tab click');
  });

  it('supports middle-click to close', () => {
    assert.ok(
      src.includes('onauxclick') || src.includes('onmousedown') || src.includes('onmouseup'),
      'should handle middle-click'
    );
  });

  it('close button has aria-label for accessibility', () => {
    assert.ok(src.includes('aria-label'), 'close button should be accessible');
  });

  it('close button has hover-only visibility class', () => {
    assert.ok(
      src.includes('opacity') || src.includes(':hover'),
      'close button should appear on hover'
    );
  });
});
```

### Step 2: Run tests to verify they fail

Run: `node --test test/components/terminal-tab-strip.cjs`
Expected: All 6 tests FAIL (TerminalTabStrip has no close button yet).

### Step 3: Write source-inspection tests for terminal-tabs store killGroup

Add to `test/components/terminal-tab-strip.cjs` (below the existing tests):

```js
const storeSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js'),
  'utf-8'
);

describe('terminal-tabs store - killGroup', () => {
  it('exports a killGroup method', () => {
    assert.ok(storeSrc.includes('killGroup'), 'store should have killGroup method');
  });

  it('killGroup kills all instances in the group', () => {
    assert.ok(
      storeSrc.includes('killInstance') || storeSrc.includes('terminalKill'),
      'killGroup should kill instances'
    );
  });

  it('auto-creates new group when last group is killed', () => {
    assert.ok(
      storeSrc.includes('groups.length === 0') || storeSrc.includes('addGroup'),
      'should handle empty state after last group killed'
    );
  });
});
```

### Step 4: Run tests to verify they fail

Run: `node --test test/components/terminal-tab-strip.cjs`
Expected: killGroup tests FAIL.

### Step 5: Add killGroup to terminal-tabs store

In `src/lib/stores/terminal-tabs.svelte.js`, add after the `unsplitGroup` method (~line 328):

```js
    /**
     * Kill an entire group and all its instances.
     * If this is the last group, auto-creates a fresh terminal.
     * @param {string} groupId
     */
    async killGroup(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;

      // Kill all instances in the group
      for (const instId of [...group.instanceIds]) {
        const inst = instances[instId];
        if (inst?.shellId && inst.running) {
          try {
            await terminalKill(inst.shellId);
          } catch (err) {
            console.warn('[terminal-tabs] Failed to kill instance:', err);
          }
        }
        const { [instId]: _, ...rest } = instances;
        instances = rest;
      }

      // Remove the group
      const groupIdx = groups.findIndex(g => g.id === groupId);
      groups = groups.filter(g => g.id !== groupId);

      // Focus previous group
      if (activeGroupId === groupId) {
        if (groups.length > 0) {
          const prevIdx = Math.min(groupIdx, groups.length - 1);
          const prevGroup = groups[prevIdx > 0 ? prevIdx - 1 : 0] || groups[0];
          activeGroupId = prevGroup.id;
          activeInstanceId = prevGroup.instanceIds[0] || null;
        } else {
          activeGroupId = null;
          activeInstanceId = null;
        }
      }

      syncLegacyTabs();

      // Auto-create fresh terminal if no groups left
      if (groups.length === 0) {
        await this.addGroup();
      }
    },
```

### Step 6: Implement close button in TerminalTabStrip

Replace the full content of `src/components/terminal/TerminalTabStrip.svelte` with the updated version that adds:
- Close button (X SVG) per tab, visible on hover, `opacity: 0` → `opacity: 1` on `.group-tab:hover`
- `onclick` with `stopPropagation()` that calls `terminalTabsStore.killGroup(group.id)`
- Dev-server confirmation via `devServerManager.isDevServerShell()` + `toastStore.addToast()`
- `onauxclick` handler for middle-click close (button === 1)
- `aria-label="Close terminal group"` on close button

Key changes to the template:

```svelte
<script>
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  let { oncontextmenu } = $props();

  function handleClose(e, group) {
    e.stopPropagation();
    const firstInst = terminalTabsStore.getInstance(group.instanceIds[0]);
    if (firstInst?.type === 'dev-server' && devServerManager.isDevServerShell(firstInst.id)) {
      toastStore.addToast({
        message: `Stop ${firstInst.title || 'Dev server'}?`,
        severity: 'warning',
        duration: 8000,
        actions: [
          { label: 'Stop', callback: () => terminalTabsStore.killGroup(group.id) },
          { label: 'Cancel', callback: () => {} },
        ],
      });
    } else {
      terminalTabsStore.killGroup(group.id);
    }
  }

  function handleAuxClick(e, group) {
    if (e.button === 1) {
      e.preventDefault();
      handleClose(e, group);
    }
  }
</script>
```

In the template, add the close button inside the `.group-tab` div and the `onauxclick` on the tab:

```svelte
<div class="group-tab" ... onauxclick={(e) => handleAuxClick(e, group)}>
  {firstInstance?.title || 'Terminal'}
  {#if group.instanceIds.length > 1}
    <span class="split-badge">{group.instanceIds.length}</span>
  {/if}
  <button
    class="tab-close"
    onclick={(e) => handleClose(e, group)}
    aria-label="Close terminal group"
    tabindex="-1"
  >
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/>
      <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  </button>
</div>
```

CSS additions:

```css
.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  border-radius: 3px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
}

.group-tab:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: rgba(255,255,255,0.1);
  color: var(--text);
}
```

### Step 7: Run tests to verify they pass

Run: `node --test test/components/terminal-tab-strip.cjs`
Expected: All 9 tests PASS.

### Step 8: Run full test suite

Run: `npm test`
Expected: All 4487+ tests pass (no regressions).

### Step 9: Commit

```bash
git add src/components/terminal/TerminalTabStrip.svelte src/lib/stores/terminal-tabs.svelte.js test/components/terminal-tab-strip.cjs
git commit -m "feat(terminal): add tab close button with middle-click and last-group safety"
```

---

## Task 2: Split Tree Module

**Files:**
- Create: `src/lib/split-tree.js`
- Create: `test/unit/split-tree.mjs`

### Step 1: Write failing tests for split-tree.js

Create `test/unit/split-tree.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLeaf,
  splitLeaf,
  removeLeaf,
  findLeaf,
  getAllInstanceIds,
  getDepth,
  serialize,
  deserialize,
  MAX_DEPTH,
} from '../../src/lib/split-tree.js';

describe('split-tree', () => {
  describe('createLeaf', () => {
    it('creates a leaf node', () => {
      const leaf = createLeaf('inst-1');
      assert.deepStrictEqual(leaf, { type: 'leaf', instanceId: 'inst-1' });
    });
  });

  describe('splitLeaf', () => {
    it('splits a single leaf horizontally', () => {
      const tree = createLeaf('a');
      const result = splitLeaf(tree, 'a', 'b', 'horizontal');
      assert.equal(result.type, 'split');
      assert.equal(result.direction, 'horizontal');
      assert.equal(result.ratio, 0.5);
      assert.deepStrictEqual(result.children[0], { type: 'leaf', instanceId: 'a' });
      assert.deepStrictEqual(result.children[1], { type: 'leaf', instanceId: 'b' });
    });

    it('splits a single leaf vertically', () => {
      const tree = createLeaf('a');
      const result = splitLeaf(tree, 'a', 'b', 'vertical');
      assert.equal(result.direction, 'vertical');
    });

    it('splits a nested leaf', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      // b should now be split into b and c
      assert.equal(tree.children[1].type, 'split');
      assert.equal(tree.children[1].direction, 'vertical');
      assert.deepStrictEqual(tree.children[1].children[0], { type: 'leaf', instanceId: 'b' });
      assert.deepStrictEqual(tree.children[1].children[1], { type: 'leaf', instanceId: 'c' });
    });

    it('returns null if target leaf not found', () => {
      const tree = createLeaf('a');
      const result = splitLeaf(tree, 'nonexistent', 'b', 'horizontal');
      assert.equal(result, null);
    });

    it('rejects split beyond MAX_DEPTH', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');  // depth 1
      tree = splitLeaf(tree, 'b', 'c', 'vertical');     // depth 2
      tree = splitLeaf(tree, 'c', 'd', 'horizontal');   // depth 3 = MAX_DEPTH
      const result = splitLeaf(tree, 'd', 'e', 'vertical'); // depth 4 = rejected
      assert.equal(result, null);
    });
  });

  describe('removeLeaf', () => {
    it('returns null when removing the only leaf', () => {
      const tree = createLeaf('a');
      const result = removeLeaf(tree, 'a');
      assert.equal(result, null);
    });

    it('promotes sibling when removing from 2-node split', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      const result = removeLeaf(tree, 'b');
      assert.deepStrictEqual(result, { type: 'leaf', instanceId: 'a' });
    });

    it('promotes the other sibling when removing first child', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      const result = removeLeaf(tree, 'a');
      assert.deepStrictEqual(result, { type: 'leaf', instanceId: 'b' });
    });

    it('removes from nested tree correctly', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      // Tree: split(a, split(b, c))
      const result = removeLeaf(tree, 'c');
      // Should collapse inner split: split(a, b)
      assert.equal(result.type, 'split');
      assert.deepStrictEqual(result.children[0], { type: 'leaf', instanceId: 'a' });
      assert.deepStrictEqual(result.children[1], { type: 'leaf', instanceId: 'b' });
    });

    it('returns null if target not found', () => {
      const tree = createLeaf('a');
      const result = removeLeaf(tree, 'nonexistent');
      // Should return original tree unchanged
      assert.deepStrictEqual(result, tree);
    });
  });

  describe('findLeaf', () => {
    it('finds a leaf in a single-node tree', () => {
      const tree = createLeaf('a');
      assert.deepStrictEqual(findLeaf(tree, 'a'), tree);
    });

    it('finds a leaf in a nested tree', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      const found = findLeaf(tree, 'c');
      assert.deepStrictEqual(found, { type: 'leaf', instanceId: 'c' });
    });

    it('returns null when not found', () => {
      const tree = createLeaf('a');
      assert.equal(findLeaf(tree, 'z'), null);
    });
  });

  describe('getAllInstanceIds', () => {
    it('returns single ID for leaf', () => {
      assert.deepStrictEqual(getAllInstanceIds(createLeaf('a')), ['a']);
    });

    it('returns all IDs in tree order (left-to-right, depth-first)', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      assert.deepStrictEqual(getAllInstanceIds(tree), ['a', 'b', 'c']);
    });
  });

  describe('getDepth', () => {
    it('returns 0 for a leaf', () => {
      assert.equal(getDepth(createLeaf('a')), 0);
    });

    it('returns 1 for a single split', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      assert.equal(getDepth(tree), 1);
    });

    it('returns correct depth for nested splits', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      tree = splitLeaf(tree, 'c', 'd', 'horizontal');
      assert.equal(getDepth(tree), 3);
    });
  });

  describe('MAX_DEPTH', () => {
    it('is 3', () => {
      assert.equal(MAX_DEPTH, 3);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips a leaf', () => {
      const tree = createLeaf('a');
      const json = serialize(tree);
      const restored = deserialize(json);
      assert.deepStrictEqual(restored, tree);
    });

    it('round-trips a complex tree', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      const json = serialize(tree);
      const parsed = JSON.parse(JSON.stringify(json)); // simulate storage round-trip
      const restored = deserialize(parsed);
      assert.deepStrictEqual(getAllInstanceIds(restored), ['a', 'b', 'c']);
      assert.equal(restored.direction, 'horizontal');
      assert.equal(restored.children[1].direction, 'vertical');
    });

    it('deserialize returns null for invalid data', () => {
      assert.equal(deserialize(null), null);
      assert.equal(deserialize(undefined), null);
      assert.equal(deserialize({}), null);
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `node --test test/unit/split-tree.mjs`
Expected: FAIL — module not found.

### Step 3: Implement split-tree.js

Create `src/lib/split-tree.js`:

```js
/**
 * split-tree.js -- Pure-JS recursive split tree for terminal pane layout.
 *
 * Data model:
 *   SplitNode = { type: 'leaf', instanceId: string }
 *             | { type: 'split', direction: 'horizontal'|'vertical', ratio: number, children: [SplitNode, SplitNode] }
 *
 * All functions are pure (no mutations). Trees are rebuilt on change.
 */

/** Maximum nesting depth for splits. Depth 3 allows up to ~8 panes. */
export const MAX_DEPTH = 3;

/**
 * Create a leaf node.
 * @param {string} instanceId
 * @returns {{ type: 'leaf', instanceId: string }}
 */
export function createLeaf(instanceId) {
  return { type: 'leaf', instanceId };
}

/**
 * Get the depth of a tree (0 for leaf, 1+ for splits).
 * @param {object} node
 * @returns {number}
 */
export function getDepth(node) {
  if (node.type === 'leaf') return 0;
  return 1 + Math.max(getDepth(node.children[0]), getDepth(node.children[1]));
}

/**
 * Find a leaf node by instanceId.
 * @param {object} node
 * @param {string} instanceId
 * @returns {object|null}
 */
export function findLeaf(node, instanceId) {
  if (node.type === 'leaf') {
    return node.instanceId === instanceId ? node : null;
  }
  return findLeaf(node.children[0], instanceId) || findLeaf(node.children[1], instanceId);
}

/**
 * Get all instance IDs in tree order (left-to-right, depth-first).
 * @param {object} node
 * @returns {string[]}
 */
export function getAllInstanceIds(node) {
  if (node.type === 'leaf') return [node.instanceId];
  return [...getAllInstanceIds(node.children[0]), ...getAllInstanceIds(node.children[1])];
}

/**
 * Split a leaf into two panes. Returns a new tree, or null if the target
 * was not found or max depth would be exceeded.
 * @param {object} tree - The root node
 * @param {string} targetInstanceId - The leaf to split
 * @param {string} newInstanceId - The new instance to add
 * @param {'horizontal'|'vertical'} direction
 * @returns {object|null}
 */
export function splitLeaf(tree, targetInstanceId, newInstanceId, direction) {
  function walk(node, depth) {
    if (node.type === 'leaf') {
      if (node.instanceId === targetInstanceId) {
        if (depth >= MAX_DEPTH) return null; // would exceed max depth
        return {
          type: 'split',
          direction,
          ratio: 0.5,
          children: [
            { type: 'leaf', instanceId: targetInstanceId },
            { type: 'leaf', instanceId: newInstanceId },
          ],
        };
      }
      return undefined; // not found at this leaf
    }

    // Recurse into split children
    const leftResult = walk(node.children[0], depth + 1);
    if (leftResult === null) return null; // max depth exceeded
    if (leftResult !== undefined) {
      return { ...node, children: [leftResult, node.children[1]] };
    }

    const rightResult = walk(node.children[1], depth + 1);
    if (rightResult === null) return null;
    if (rightResult !== undefined) {
      return { ...node, children: [node.children[0], rightResult] };
    }

    return undefined; // not found in either subtree
  }

  const result = walk(tree, 0);
  return result === undefined ? null : result;
}

/**
 * Remove a leaf from the tree. Returns the new tree, or null if removing
 * the last leaf. If removing from a 2-node split, promotes the sibling.
 * If the target is not found, returns the tree unchanged.
 * @param {object} tree
 * @param {string} instanceId
 * @returns {object|null}
 */
export function removeLeaf(tree, instanceId) {
  if (tree.type === 'leaf') {
    return tree.instanceId === instanceId ? null : tree;
  }

  // Check if one of the direct children is the target leaf
  if (tree.children[0].type === 'leaf' && tree.children[0].instanceId === instanceId) {
    return tree.children[1]; // promote sibling
  }
  if (tree.children[1].type === 'leaf' && tree.children[1].instanceId === instanceId) {
    return tree.children[0]; // promote sibling
  }

  // Recurse into children
  const leftResult = removeLeaf(tree.children[0], instanceId);
  if (leftResult !== tree.children[0]) {
    if (leftResult === null) return tree.children[1]; // left subtree emptied
    return { ...tree, children: [leftResult, tree.children[1]] };
  }

  const rightResult = removeLeaf(tree.children[1], instanceId);
  if (rightResult !== tree.children[1]) {
    if (rightResult === null) return tree.children[0]; // right subtree emptied
    return { ...tree, children: [tree.children[0], rightResult] };
  }

  return tree; // not found
}

/**
 * Serialize a tree to a JSON-safe object (identity for our structure).
 * @param {object} tree
 * @returns {object}
 */
export function serialize(tree) {
  return JSON.parse(JSON.stringify(tree));
}

/**
 * Deserialize a tree from stored JSON. Returns null if invalid.
 * @param {*} data
 * @returns {object|null}
 */
export function deserialize(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'leaf' && typeof data.instanceId === 'string') {
    return { type: 'leaf', instanceId: data.instanceId };
  }
  if (data.type === 'split' && Array.isArray(data.children) && data.children.length === 2) {
    const left = deserialize(data.children[0]);
    const right = deserialize(data.children[1]);
    if (!left || !right) return null;
    return {
      type: 'split',
      direction: data.direction || 'horizontal',
      ratio: typeof data.ratio === 'number' ? data.ratio : 0.5,
      children: [left, right],
    };
  }
  return null;
}
```

### Step 4: Run tests to verify they pass

Run: `node --test test/unit/split-tree.mjs`
Expected: All 25 tests PASS.

### Step 5: Run full test suite

Run: `npm test`
Expected: All tests pass.

### Step 6: Commit

```bash
git add src/lib/split-tree.js test/unit/split-tree.mjs
git commit -m "feat(terminal): add pure-JS split tree module with full test coverage"
```

---

## Task 3: Integrate Split Tree into Store and UI

**Files:**
- Modify: `src/lib/stores/terminal-tabs.svelte.js` — replace `instanceIds[]` with `splitTree`
- Modify: `src/components/terminal/TerminalPanel.svelte` — recursive split rendering
- Modify: `src/components/terminal/TerminalSidebar.svelte` — derive instance list from tree
- Modify: `src/components/terminal/TerminalContextMenu.svelte` — split direction options
- Modify: `src/components/terminal/TerminalActionBar.svelte` — split direction dropdown
- Create: `test/stores/terminal-tabs-split.cjs` — source-inspection tests

### Step 1: Write source-inspection tests

Create `test/stores/terminal-tabs-split.cjs`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storeSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js'),
  'utf-8'
);

describe('terminal-tabs store - split tree integration', () => {
  it('imports split-tree module', () => {
    assert.ok(storeSrc.includes("from '../split-tree.js'") || storeSrc.includes("from '../split-tree'"),
      'should import split-tree');
  });

  it('groups have splitTree property', () => {
    assert.ok(storeSrc.includes('splitTree'), 'groups should use splitTree');
  });

  it('addGroup creates initial leaf splitTree', () => {
    assert.ok(storeSrc.includes('createLeaf'), 'addGroup should create a leaf');
  });

  it('splitInstance uses splitLeaf with direction parameter', () => {
    assert.ok(storeSrc.includes('splitLeaf'), 'splitInstance should use splitLeaf');
  });

  it('supports split direction parameter', () => {
    assert.ok(
      storeSrc.includes("direction") && (storeSrc.includes("'horizontal'") || storeSrc.includes("'vertical'")),
      'should support direction parameter'
    );
  });

  it('killInstance uses removeLeaf', () => {
    assert.ok(storeSrc.includes('removeLeaf'), 'killInstance should use removeLeaf');
  });

  it('maintains backward-compat instanceIds getter from splitTree', () => {
    assert.ok(storeSrc.includes('getAllInstanceIds'), 'should derive instanceIds from splitTree');
  });
});

const panelSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalPanel.svelte'),
  'utf-8'
);

describe('TerminalPanel - recursive split rendering', () => {
  it('imports SplitPanel', () => {
    assert.ok(panelSrc.includes('SplitPanel'), 'should import SplitPanel');
  });

  it('handles both leaf and split node types', () => {
    assert.ok(panelSrc.includes("type === 'leaf'") || panelSrc.includes('.type'),
      'should check node type for rendering');
  });

  it('renders Terminal for leaf nodes', () => {
    assert.ok(panelSrc.includes('Terminal') && panelSrc.includes('shellId'),
      'should render Terminal component for leaves');
  });

  it('handles both horizontal and vertical splits', () => {
    assert.ok(panelSrc.includes('direction'), 'should pass direction to SplitPanel');
  });
});

const ctxSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalContextMenu.svelte'),
  'utf-8'
);

describe('TerminalContextMenu - split direction', () => {
  it('offers Split Right option', () => {
    assert.ok(ctxSrc.includes('Split Right') || ctxSrc.includes('split-right'),
      'should have Split Right option');
  });

  it('offers Split Down option', () => {
    assert.ok(ctxSrc.includes('Split Down') || ctxSrc.includes('split-down'),
      'should have Split Down option');
  });
});
```

### Step 2: Run tests to verify they fail

Run: `node --test test/stores/terminal-tabs-split.cjs`
Expected: Most tests FAIL.

### Step 3: Modify terminal-tabs.svelte.js

This is the biggest change. Key modifications:

1. Add import: `import { createLeaf, splitLeaf, removeLeaf, getAllInstanceIds, findLeaf } from '../split-tree.js';`

2. Change group shape from `{ id, instanceIds }` to `{ id, splitTree, get instanceIds() { return getAllInstanceIds(this.splitTree); } }`. Use a getter so existing code that reads `group.instanceIds` still works.

3. In `addGroup`: create group with `splitTree: createLeaf(shellId)` and add computed `instanceIds` getter.

4. In `splitInstance`: accept optional `direction` param (default `'vertical'`), use `splitLeaf(group.splitTree, activeInstanceId, shellId, direction)`.

5. In `killInstance`: use `removeLeaf(group.splitTree, instanceId)` to get new tree. If null, remove group.

6. In `unsplitGroup`: rebuild tree as single leaf with the kept instance.

7. Add helper to create group objects with the instanceIds getter:
```js
function createGroup(id, splitTree) {
  return {
    id,
    splitTree,
    get instanceIds() { return getAllInstanceIds(this.splitTree); },
  };
}
```

### Step 4: Modify TerminalPanel.svelte for recursive rendering

Replace the hardcoded 2-pane SplitPanel with a recursive rendering approach. Create a helper function or use `{#if}` / `{#each}` logic:

```svelte
{#each terminalTabsStore.groups as group (group.id)}
  {@const isActive = group.id === activeGroupId}
  <div class="group-container" class:active={isActive}>
    {#if group.splitTree.type === 'leaf'}
      {@const inst = terminalTabsStore.getInstance(group.splitTree.instanceId)}
      {#if inst}
        <Terminal shellId={inst.shellId} visible={isActive} />
      {/if}
    {:else}
      <!-- Recursive split rendering via a Svelte snippet or nested component -->
      {@render splitNode(group.splitTree, isActive)}
    {/if}
  </div>
{/each}
```

Use a Svelte 5 `{#snippet}` for recursive rendering:

```svelte
{#snippet splitNode(node, visible)}
  {#if node.type === 'leaf'}
    {@const inst = terminalTabsStore.getInstance(node.instanceId)}
    {#if inst}
      <Terminal shellId={inst.shellId} {visible} />
    {/if}
  {:else}
    <SplitPanel direction={node.direction} ratio={node.ratio} minA={80} minB={80}>
      {#snippet panelA()}
        {@render splitNode(node.children[0], visible)}
      {/snippet}
      {#snippet panelB()}
        {@render splitNode(node.children[1], visible)}
      {/snippet}
    </SplitPanel>
  {/if}
{/snippet}
```

Note: SplitPanel's `ratio` is bindable. For recursive trees, store ratios in the tree nodes themselves (the `ratio` field in split nodes). Wire up `bind:ratio` to update the tree node's ratio.

### Step 5: Update TerminalContextMenu with split direction options

Replace the single "Split Terminal" button with two:
- "Split Right" (vertical split) — Ctrl+Shift+5
- "Split Down" (horizontal split) — Ctrl+Shift+-

Update handlers to pass direction:
```js
function handleSplitRight() {
  terminalTabsStore.splitInstance({ direction: 'vertical' });
  onClose();
}
function handleSplitDown() {
  terminalTabsStore.splitInstance({ direction: 'horizontal' });
  onClose();
}
```

### Step 6: Update TerminalActionBar split button

Change split button to have a dropdown with "Split Right" and "Split Down" options in the "+" dropdown menu.

### Step 7: Update TerminalSidebar

The sidebar reads `group.instanceIds` which is now a getter derived from `splitTree`. This should work without changes. Verify by reading the code.

### Step 8: Run tests

Run: `node --test test/stores/terminal-tabs-split.cjs`
Expected: All tests PASS.

Run: `npm test`
Expected: All tests pass.

### Step 9: Commit

```bash
git add src/lib/stores/terminal-tabs.svelte.js src/components/terminal/TerminalPanel.svelte src/components/terminal/TerminalContextMenu.svelte src/components/terminal/TerminalActionBar.svelte test/stores/terminal-tabs-split.cjs
git commit -m "feat(terminal): integrate split tree for H+V grid splits (replaces 2-pane hardcode)"
```

---

## Task 4: Terminal Persistence

**Files:**
- Modify: `src/lib/stores/terminal-tabs.svelte.js` — save/restore layout
- Modify: `src-tauri/src/config/schema.rs` — add `terminal_layout` field
- Create: `test/unit/terminal-persistence.mjs`

### Step 1: Write failing tests

Create `test/unit/terminal-persistence.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the serialization/deserialization functions we'll add
// These will be exported from a new persistence helper or from split-tree.js

import { createLeaf, splitLeaf, serialize, deserialize } from '../../src/lib/split-tree.js';

describe('terminal persistence - layout serialization', () => {
  it('serializes a layout with one group, one instance', () => {
    const layout = {
      groups: [
        {
          id: 'g1',
          splitTree: serialize(createLeaf('i1')),
          instances: {
            'i1': { title: 'Terminal 1', color: null, icon: null, profileId: 'default' },
          },
        },
      ],
      activeGroupId: 'g1',
    };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    assert.equal(restored.groups.length, 1);
    assert.equal(restored.groups[0].id, 'g1');
    assert.equal(restored.activeGroupId, 'g1');
  });

  it('serializes a layout with splits', () => {
    let tree = createLeaf('i1');
    tree = splitLeaf(tree, 'i1', 'i2', 'vertical');
    const layout = {
      groups: [
        {
          id: 'g1',
          splitTree: serialize(tree),
          instances: {
            'i1': { title: 'Terminal 1', color: null, icon: null, profileId: 'default' },
            'i2': { title: 'Terminal 2', color: 'red', icon: 'server', profileId: 'git-bash' },
          },
        },
      ],
      activeGroupId: 'g1',
    };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    const restoredTree = deserialize(restored.groups[0].splitTree);
    assert.equal(restoredTree.type, 'split');
    assert.equal(restoredTree.direction, 'vertical');
  });

  it('serializes multiple groups', () => {
    const layout = {
      groups: [
        { id: 'g1', splitTree: serialize(createLeaf('i1')), instances: { 'i1': { title: 'T1', color: null, icon: null, profileId: 'default' } } },
        { id: 'g2', splitTree: serialize(createLeaf('i2')), instances: { 'i2': { title: 'T2', color: 'blue', icon: 'node', profileId: 'powershell' } } },
      ],
      activeGroupId: 'g2',
    };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    assert.equal(restored.groups.length, 2);
    assert.equal(restored.activeGroupId, 'g2');
  });

  it('handles empty layout gracefully', () => {
    const layout = { groups: [], activeGroupId: null };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    assert.equal(restored.groups.length, 0);
    assert.equal(restored.activeGroupId, null);
  });

  it('preserves instance customizations', () => {
    const layout = {
      groups: [{
        id: 'g1',
        splitTree: serialize(createLeaf('i1')),
        instances: {
          'i1': { title: 'My Server', color: 'green', icon: 'server', profileId: 'git-bash' },
        },
      }],
      activeGroupId: 'g1',
    };
    const restored = JSON.parse(JSON.stringify(layout));
    const inst = restored.groups[0].instances['i1'];
    assert.equal(inst.title, 'My Server');
    assert.equal(inst.color, 'green');
    assert.equal(inst.icon, 'server');
    assert.equal(inst.profileId, 'git-bash');
  });
});
```

### Step 2: Run tests

Run: `node --test test/unit/terminal-persistence.mjs`
Expected: All PASS (these test pure serialization, not the store integration yet).

### Step 3: Add terminal_layout to Rust config schema

In `src-tauri/src/config/schema.rs`, add to `AppConfig`:

```rust
    #[serde(default)]
    pub terminal_layout: Option<serde_json::Value>,
```

This is an opaque JSON value — the frontend owns the shape.

### Step 4: Add save/restore methods to terminal-tabs store

In `terminal-tabs.svelte.js`, add:

1. Import `setConfig` and `getConfig` from api.js (or use the config store)
2. Add `saveLayout()` method that serializes current groups/instances to the `terminalLayout` config key
3. Add `restoreLayout(layoutData)` method that recreates groups/instances from saved data
4. Call `saveLayout()` (debounced 500ms) after any structural change
5. In `TerminalPanel.svelte` `onMount`, check for saved layout and restore

### Step 5: Add source-inspection tests for save/restore

Add to `test/stores/terminal-tabs-split.cjs`:

```js
describe('terminal-tabs store - persistence', () => {
  it('has saveLayout method', () => {
    assert.ok(storeSrc.includes('saveLayout'), 'should have saveLayout');
  });

  it('has restoreLayout method', () => {
    assert.ok(storeSrc.includes('restoreLayout'), 'should have restoreLayout');
  });

  it('debounces save calls', () => {
    assert.ok(
      storeSrc.includes('setTimeout') || storeSrc.includes('debounce'),
      'should debounce saves'
    );
  });
});
```

### Step 6: Run full test suite, verify, commit

Run: `npm test` and `cargo check --tests`
Expected: All pass.

```bash
git add src/lib/stores/terminal-tabs.svelte.js src-tauri/src/config/schema.rs test/unit/terminal-persistence.mjs test/stores/terminal-tabs-split.cjs
git commit -m "feat(terminal): persist terminal layout (groups, splits, names, colors, icons) across restarts"
```

---

## Task 5: Terminal Search (Find in Terminal)

**Files:**
- Create: `src/lib/terminal-search.js`
- Create: `src/components/terminal/TerminalSearch.svelte`
- Modify: `src/components/terminal/Terminal.svelte` — mount search overlay
- Create: `test/unit/terminal-search.mjs`

### Step 1: Write failing tests for search logic

Create `test/unit/terminal-search.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchBuffer,
  nextMatch,
  prevMatch,
  getMatchIndex,
} from '../../src/lib/terminal-search.js';

// Helper: create a mock getLine function from an array of strings
function mockBuffer(lines) {
  return {
    getLine: (y) => lines[y] || null,
    lineCount: lines.length,
  };
}

describe('terminal-search', () => {
  describe('searchBuffer', () => {
    it('finds a single match', () => {
      const { getLine, lineCount } = mockBuffer(['hello world', 'foo bar']);
      const result = searchBuffer(getLine, lineCount, 'world', {});
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].row, 0);
      assert.equal(result.matches[0].startCol, 6);
      assert.equal(result.matches[0].endCol, 11);
    });

    it('finds multiple matches on same line', () => {
      const { getLine, lineCount } = mockBuffer(['abcabc']);
      const result = searchBuffer(getLine, lineCount, 'abc', {});
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].startCol, 0);
      assert.equal(result.matches[1].startCol, 3);
    });

    it('finds matches across multiple lines', () => {
      const { getLine, lineCount } = mockBuffer(['error here', 'no match', 'error there']);
      const result = searchBuffer(getLine, lineCount, 'error', {});
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].row, 0);
      assert.equal(result.matches[1].row, 2);
    });

    it('returns empty for no matches', () => {
      const { getLine, lineCount } = mockBuffer(['hello world']);
      const result = searchBuffer(getLine, lineCount, 'xyz', {});
      assert.equal(result.matches.length, 0);
      assert.equal(result.total, 0);
    });

    it('returns empty for empty query', () => {
      const { getLine, lineCount } = mockBuffer(['hello world']);
      const result = searchBuffer(getLine, lineCount, '', {});
      assert.equal(result.matches.length, 0);
    });

    it('case-insensitive by default', () => {
      const { getLine, lineCount } = mockBuffer(['Hello WORLD']);
      const result = searchBuffer(getLine, lineCount, 'hello', {});
      assert.equal(result.matches.length, 1);
    });

    it('respects caseSensitive option', () => {
      const { getLine, lineCount } = mockBuffer(['Hello WORLD']);
      const result = searchBuffer(getLine, lineCount, 'hello', { caseSensitive: true });
      assert.equal(result.matches.length, 0);
    });

    it('supports regex search', () => {
      const { getLine, lineCount } = mockBuffer(['error: line 42', 'warning: line 7']);
      const result = searchBuffer(getLine, lineCount, 'line \\d+', { regex: true });
      assert.equal(result.matches.length, 2);
    });

    it('handles invalid regex gracefully', () => {
      const { getLine, lineCount } = mockBuffer(['hello']);
      const result = searchBuffer(getLine, lineCount, '[invalid', { regex: true });
      assert.equal(result.matches.length, 0);
    });

    it('handles null lines', () => {
      const getLine = (y) => (y === 0 ? 'hello' : null);
      const result = searchBuffer(getLine, 3, 'hello', {});
      assert.equal(result.matches.length, 1);
    });

    it('handles unicode/emoji in text', () => {
      const { getLine, lineCount } = mockBuffer(['hello 🌍 world']);
      const result = searchBuffer(getLine, lineCount, 'hello', {});
      assert.equal(result.matches.length, 1);
    });
  });

  describe('nextMatch / prevMatch', () => {
    it('wraps to start from end', () => {
      assert.equal(nextMatch(5, 4), 0);
    });

    it('increments normally', () => {
      assert.equal(nextMatch(5, 2), 3);
    });

    it('wraps to end from start', () => {
      assert.equal(prevMatch(5, 0), 4);
    });

    it('decrements normally', () => {
      assert.equal(prevMatch(5, 3), 2);
    });

    it('returns 0 for single match', () => {
      assert.equal(nextMatch(1, 0), 0);
      assert.equal(prevMatch(1, 0), 0);
    });
  });

  describe('getMatchIndex', () => {
    it('returns nearest match at or after cursor position', () => {
      const matches = [
        { row: 0, startCol: 5 },
        { row: 2, startCol: 10 },
        { row: 5, startCol: 0 },
      ];
      assert.equal(getMatchIndex(matches, 0, 0), 0);
      assert.equal(getMatchIndex(matches, 2, 10), 1);
      assert.equal(getMatchIndex(matches, 3, 0), 2);
    });

    it('returns 0 for empty matches', () => {
      assert.equal(getMatchIndex([], 0, 0), 0);
    });

    it('wraps to first match if cursor is past all matches', () => {
      const matches = [{ row: 0, startCol: 0 }, { row: 1, startCol: 0 }];
      assert.equal(getMatchIndex(matches, 100, 0), 0);
    });
  });
});
```

### Step 2: Run to verify fail

Run: `node --test test/unit/terminal-search.mjs`
Expected: FAIL — module not found.

### Step 3: Implement terminal-search.js

Create `src/lib/terminal-search.js`:

```js
/**
 * terminal-search.js -- Pure-JS terminal buffer search logic.
 *
 * Searches through terminal text lines using string or regex matching.
 * Returns match positions (row, startCol, endCol) for highlighting.
 */

/**
 * Search through a terminal buffer.
 * @param {(y: number) => string|null} getLine - Returns text for line y
 * @param {number} lineCount - Total number of lines
 * @param {string} query - Search string or regex pattern
 * @param {{ caseSensitive?: boolean, regex?: boolean }} options
 * @returns {{ matches: Array<{row: number, startCol: number, endCol: number}>, total: number }}
 */
export function searchBuffer(getLine, lineCount, query, options = {}) {
  if (!query) return { matches: [], total: 0 };

  const { caseSensitive = false, regex = false } = options;
  const matches = [];

  let pattern;
  if (regex) {
    try {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch {
      return { matches: [], total: 0 };
    }
  }

  for (let y = 0; y < lineCount; y++) {
    const line = getLine(y);
    if (line == null) continue;

    if (regex) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        matches.push({ row: y, startCol: m.index, endCol: m.index + m[0].length });
        if (m[0].length === 0) pattern.lastIndex++; // prevent infinite loop on zero-width match
      }
    } else {
      const haystack = caseSensitive ? line : line.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      let idx = 0;
      while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        matches.push({ row: y, startCol: idx, endCol: idx + needle.length });
        idx += needle.length || 1;
      }
    }
  }

  return { matches, total: matches.length };
}

/**
 * Get the next match index (wraps around).
 * @param {number} total - Total number of matches
 * @param {number} current - Current match index
 * @returns {number}
 */
export function nextMatch(total, current) {
  if (total === 0) return 0;
  return (current + 1) % total;
}

/**
 * Get the previous match index (wraps around).
 * @param {number} total
 * @param {number} current
 * @returns {number}
 */
export function prevMatch(total, current) {
  if (total === 0) return 0;
  return (current - 1 + total) % total;
}

/**
 * Find the match index nearest to (or at/after) the cursor position.
 * @param {Array<{row: number, startCol: number}>} matches
 * @param {number} cursorRow
 * @param {number} cursorCol
 * @returns {number}
 */
export function getMatchIndex(matches, cursorRow, cursorCol) {
  if (matches.length === 0) return 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.row > cursorRow || (m.row === cursorRow && m.startCol >= cursorCol)) {
      return i;
    }
  }
  return 0; // wrap to first
}
```

### Step 4: Run tests

Run: `node --test test/unit/terminal-search.mjs`
Expected: All 18 tests PASS.

### Step 5: Create TerminalSearch.svelte component

Create `src/components/terminal/TerminalSearch.svelte` — a floating search bar overlay. Position at top-right of terminal container. Contains:
- Text input (auto-focus on mount)
- Match count "X of Y"
- Up/down navigation buttons
- Case sensitivity toggle (Aa)
- Regex toggle (.*)
- Close button (X)
- Keyboard: Escape closes, Enter next, Shift+Enter prev

Props: `{ visible, onClose, onSearch, onNext, onPrev, matchCount, currentMatch, caseSensitive, regex, onToggleCase, onToggleRegex }`

### Step 6: Integrate into Terminal.svelte

Add search state and overlay to `Terminal.svelte`:
- Ctrl+F toggles search visibility
- On query change: call `searchBuffer()` with ghostty-web's `buffer.active.getLine(y).translateToString()`
- Draw highlight rectangles on a canvas overlay positioned over the terminal
- Navigation scrolls viewport to match row

### Step 7: Run full test suite, commit

Run: `npm test`

```bash
git add src/lib/terminal-search.js src/components/terminal/TerminalSearch.svelte src/components/terminal/Terminal.svelte test/unit/terminal-search.mjs
git commit -m "feat(terminal): add find-in-terminal with Ctrl+F search overlay"
```

---

## Task 6: Clickable Links (URLs and File Paths)

**Files:**
- Create: `src/lib/terminal-links.js`
- Modify: `src/components/terminal/Terminal.svelte` — register link providers
- Create: `test/unit/terminal-links.mjs`

### Step 1: Write failing tests

Create `test/unit/terminal-links.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectURLs, detectFilePaths } from '../../src/lib/terminal-links.js';

describe('terminal-links', () => {
  describe('detectURLs', () => {
    it('detects https URL', () => {
      const matches = detectURLs('visit https://example.com for info');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('detects http URL', () => {
      const matches = detectURLs('http://localhost:3000/api');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].url, 'http://localhost:3000/api');
    });

    it('detects URL with query string', () => {
      const matches = detectURLs('https://example.com/path?q=search&page=2');
      assert.equal(matches.length, 1);
      assert.ok(matches[0].url.includes('?q=search'));
    });

    it('detects URL with fragment', () => {
      const matches = detectURLs('https://example.com/docs#section');
      assert.equal(matches.length, 1);
      assert.ok(matches[0].url.includes('#section'));
    });

    it('strips trailing period', () => {
      const matches = detectURLs('See https://example.com.');
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('strips trailing comma', () => {
      const matches = detectURLs('https://example.com, more text');
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('strips trailing parenthesis if unmatched', () => {
      const matches = detectURLs('(see https://example.com)');
      assert.equal(matches[0].url, 'https://example.com');
    });

    it('keeps matched parentheses in URL', () => {
      const matches = detectURLs('https://en.wikipedia.org/wiki/Foo_(bar)');
      assert.ok(matches[0].url.includes('(bar)'));
    });

    it('detects multiple URLs on one line', () => {
      const matches = detectURLs('https://a.com and https://b.com');
      assert.equal(matches.length, 2);
    });

    it('returns start and end positions', () => {
      const matches = detectURLs('xx https://example.com yy');
      assert.equal(matches[0].start, 3);
      assert.equal(matches[0].end, 3 + 'https://example.com'.length);
    });

    it('returns empty for no URLs', () => {
      assert.equal(detectURLs('no urls here').length, 0);
    });

    it('detects URL with port', () => {
      const matches = detectURLs('http://127.0.0.1:8080/path');
      assert.equal(matches.length, 1);
    });
  });

  describe('detectFilePaths', () => {
    it('detects relative Unix path with line number', () => {
      const matches = detectFilePaths('  src/App.svelte:42:5', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].path, '/project/src/App.svelte');
      assert.equal(matches[0].line, 42);
      assert.equal(matches[0].col, 5);
    });

    it('detects ./relative path', () => {
      const matches = detectFilePaths('./src/main.js:10', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 10);
    });

    it('detects path with line only', () => {
      const matches = detectFilePaths('src/foo.ts:7', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 7);
      assert.equal(matches[0].col, undefined);
    });

    it('detects Windows absolute path', () => {
      const matches = detectFilePaths('E:\\Projects\\Voice Mirror\\src\\main.js:5', '');
      assert.equal(matches.length, 1);
      assert.ok(matches[0].path.includes('main.js'));
      assert.equal(matches[0].line, 5);
    });

    it('detects parenthesized line:col format', () => {
      const matches = detectFilePaths('src/foo.rs(42,5): error', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 42);
      assert.equal(matches[0].col, 5);
    });

    it('returns start and end positions', () => {
      const matches = detectFilePaths('error in src/foo.js:5', '/project');
      assert.ok(matches[0].start >= 0);
      assert.ok(matches[0].end > matches[0].start);
    });

    it('does not match plain words without extensions', () => {
      const matches = detectFilePaths('hello world', '/project');
      assert.equal(matches.length, 0);
    });

    it('returns empty array for no matches', () => {
      assert.equal(detectFilePaths('no files here', '/project').length, 0);
    });

    it('matches common extensions', () => {
      for (const ext of ['.js', '.ts', '.rs', '.py', '.css', '.html', '.svelte', '.json', '.md', '.toml']) {
        const matches = detectFilePaths(`file${ext}:1`, '/p');
        assert.ok(matches.length >= 1, `should match ${ext}`);
      }
    });

    it('detects paths in TypeScript compiler output', () => {
      const matches = detectFilePaths('src/components/App.tsx(15,3): error TS2304:', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 15);
      assert.equal(matches[0].col, 3);
    });

    it('detects paths in Rust compiler output', () => {
      const matches = detectFilePaths('  --> src/main.rs:42:10', '/project');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 42);
      assert.equal(matches[0].col, 10);
    });
  });
});
```

### Step 2: Run to verify fail

Run: `node --test test/unit/terminal-links.mjs`
Expected: FAIL — module not found.

### Step 3: Implement terminal-links.js

Create `src/lib/terminal-links.js`:

```js
/**
 * terminal-links.js -- Pure-JS terminal link detection.
 *
 * Detects URLs and file paths with line:col in terminal output text.
 */

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

/**
 * Detect URLs in a line of terminal text.
 * @param {string} text
 * @returns {Array<{start: number, end: number, url: string}>}
 */
export function detectURLs(text) {
  const matches = [];
  URL_REGEX.lastIndex = 0;
  let m;
  while ((m = URL_REGEX.exec(text)) !== null) {
    let url = m[0];
    let end = m.index + url.length;

    // Balance parentheses — keep matched pairs
    const openCount = (url.match(/\(/g) || []).length;
    const closeCount = (url.match(/\)/g) || []).length;
    if (closeCount > openCount && url.endsWith(')')) {
      url = url.slice(0, -1);
      end--;
    }

    // Strip trailing punctuation
    const trailingMatch = url.match(TRAILING_PUNCT);
    if (trailingMatch) {
      url = url.slice(0, -trailingMatch[0].length);
      end -= trailingMatch[0].length;
    }

    matches.push({ start: m.index, end, url });
  }
  return matches;
}

// File extensions we recognize
const EXTENSIONS = '(?:js|ts|jsx|tsx|mjs|cjs|rs|py|css|html|svelte|json|md|toml|yaml|yml|go|java|c|cpp|h|hpp|rb|sh|bash|zsh|ps1|vue|astro|txt|log|xml|sql|graphql|prisma|env|lock|conf|cfg|ini|Cargo|Makefile)';

// Pattern: optional prefix (-->) + path with known extension + optional :line:col or (line,col)
const FILE_PATH_REGEX = new RegExp(
  '(?:-->\\s*)?' +                            // optional Rust --> prefix
  '(' +
    '(?:[A-Za-z]:\\\\[^\\s:()]+)' +           // Windows absolute: C:\path\file
    '|' +
    '(?:\\.{0,2}/[^\\s:()]+)' +               // Unix relative/absolute: ./path, ../path, /path
    '|' +
    '(?:[a-zA-Z_][a-zA-Z0-9_./\\\\-]*\\.' + EXTENSIONS + ')' +  // bare path: src/file.ext
  ')' +
  '(?:' +
    ':(\\d+)(?::(\\d+))?' +                   // :line or :line:col
    '|' +
    '\\((\\d+)(?:,(\\d+))?\\)' +              // (line) or (line,col)
  ')?',
  'g'
);

/**
 * Detect file paths (with optional line:col) in terminal text.
 * @param {string} text
 * @param {string} cwd - Working directory for resolving relative paths
 * @returns {Array<{start: number, end: number, path: string, line?: number, col?: number}>}
 */
export function detectFilePaths(text, cwd) {
  const matches = [];
  FILE_PATH_REGEX.lastIndex = 0;
  let m;
  while ((m = FILE_PATH_REGEX.exec(text)) !== null) {
    let filePath = m[1];
    const line = parseInt(m[2] || m[4], 10) || undefined;
    const col = parseInt(m[3] || m[5], 10) || undefined;

    // Skip if it looks like a URL (already handled by detectURLs)
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) continue;

    // Resolve relative paths
    if (!filePath.match(/^[A-Za-z]:\\/) && !filePath.startsWith('/')) {
      filePath = (cwd ? cwd + '/' : '') + filePath.replace(/^\.\//, '');
    } else if (filePath.startsWith('./') || filePath.startsWith('../')) {
      filePath = (cwd ? cwd + '/' : '') + filePath.replace(/^\.\//, '');
    }

    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      path: filePath,
      line,
      col,
    });
  }
  return matches;
}
```

### Step 4: Run tests

Run: `node --test test/unit/terminal-links.mjs`
Expected: All ~28 tests PASS. Iterate on the regex patterns if any fail.

### Step 5: Integrate link providers into Terminal.svelte

In `Terminal.svelte`, after terminal initialization:
1. Import `detectURLs` and `detectFilePaths` from `terminal-links.js`
2. Register two `ILinkProvider` instances on the terminal
3. URL links: `window.__TAURI__.shell.open(url)` on Ctrl+Click
4. File links: emit event / call store to open file in Lens editor

### Step 6: Run full test suite, commit

Run: `npm test`

```bash
git add src/lib/terminal-links.js src/components/terminal/Terminal.svelte test/unit/terminal-links.mjs
git commit -m "feat(terminal): add clickable URLs and file paths with link detection"
```

---

## Task 7: Final Integration Testing

### Step 1: Run full test suite

Run: `npm test`
Expected: All 4487+ (plus ~98 new) tests pass.

### Step 2: Rust compilation check

Run: `cd src-tauri && cargo check --tests`
Expected: Clean.

### Step 3: Verify no regressions with existing store tests

Run: `node --test test/stores/`
Run: `node --test test/components/`

### Step 4: Final commit if any fixups needed

```bash
git add -A
git commit -m "test(terminal): integration fixes for terminal high-priority features"
```

---

## Summary

| Task | Files | Tests | Feature |
|------|-------|-------|---------|
| 1 | 3 | ~9 | Tab close button |
| 2 | 2 | ~25 | Split tree module |
| 3 | 6 | ~14 | Split tree UI integration |
| 4 | 3 | ~8 | Terminal persistence |
| 5 | 3 | ~18 | Find in terminal |
| 6 | 3 | ~28 | Clickable links |
| 7 | 0 | 0 | Integration verification |
| **Total** | **~17** | **~102** | **5 features** |
