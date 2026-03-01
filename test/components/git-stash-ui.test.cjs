/**
 * git-stash-ui.test.cjs -- Source-inspection tests for git stash UI in GitCommitPanel.svelte
 *
 * Validates stash button, dropdown, imports, state, and stash operations in the UI.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COMPONENT_PATH = path.join(__dirname, '../../src/components/lens/GitCommitPanel.svelte');
const src = fs.readFileSync(COMPONENT_PATH, 'utf-8');

// ============ Imports ============

describe('GitCommitPanel.svelte -- stash imports', () => {
  it('imports gitStashSave from api.js', () => {
    assert.ok(src.includes('gitStashSave'), 'Should import gitStashSave');
  });

  it('imports gitStashList from api.js', () => {
    assert.ok(src.includes('gitStashList'), 'Should import gitStashList');
  });

  it('imports gitStashPop from api.js', () => {
    assert.ok(src.includes('gitStashPop'), 'Should import gitStashPop');
  });

  it('imports gitStashApply from api.js', () => {
    assert.ok(src.includes('gitStashApply'), 'Should import gitStashApply');
  });

  it('imports gitStashDrop from api.js', () => {
    assert.ok(src.includes('gitStashDrop'), 'Should import gitStashDrop');
  });
});

// ============ State ============

describe('GitCommitPanel.svelte -- stash state', () => {
  it('has stashDropdown state', () => {
    assert.ok(
      src.includes('stashDropdown') && src.includes('$state'),
      'Should have stashDropdown state'
    );
  });

  it('has stashOp state for operation tracking', () => {
    assert.ok(
      src.includes('stashOp') && src.includes('$state'),
      'Should have stashOp state'
    );
  });

  it('has stashes state array', () => {
    assert.ok(
      src.includes('stashes') && src.includes('$state'),
      'Should have stashes state array'
    );
  });

  it('has stashMessage state', () => {
    assert.ok(
      src.includes('stashMessage') && src.includes('$state'),
      'Should have stashMessage state'
    );
  });
});

// ============ UI Elements ============

describe('GitCommitPanel.svelte -- stash UI elements', () => {
  it('has a stash button', () => {
    assert.ok(
      src.includes('stash-btn'),
      'Should have a stash button with stash-btn class'
    );
  });

  it('has a stash dropdown', () => {
    assert.ok(
      src.includes('stash-dropdown'),
      'Should have a stash dropdown element'
    );
  });

  it('has stash message input', () => {
    assert.ok(
      src.includes('stash-message-input'),
      'Should have a stash message input'
    );
  });

  it('has stash save button', () => {
    assert.ok(
      src.includes('stash-save-btn'),
      'Should have a stash save button'
    );
  });

  it('has Pop Latest Stash option', () => {
    assert.ok(
      src.includes('Pop Latest Stash'),
      'Should have Pop Latest Stash menu item'
    );
  });

  it('has Apply Latest Stash option', () => {
    assert.ok(
      src.includes('Apply Latest Stash'),
      'Should have Apply Latest Stash menu item'
    );
  });

  it('has stash list section', () => {
    assert.ok(
      src.includes('stash-list'),
      'Should have a stash list element'
    );
  });

  it('shows stash item info (index and message)', () => {
    assert.ok(
      src.includes('stash-item-index') && src.includes('stash-item-message'),
      'Should show stash index and message'
    );
  });

  it('has per-stash action buttons (pop, apply, drop)', () => {
    assert.ok(
      src.includes('stash-action-btn'),
      'Should have stash action buttons'
    );
  });
});

// ============ Functions ============

describe('GitCommitPanel.svelte -- stash functions', () => {
  it('has handleStashSave function', () => {
    assert.ok(
      src.includes('handleStashSave'),
      'Should have handleStashSave function'
    );
  });

  it('has handleStashPop function', () => {
    assert.ok(
      src.includes('handleStashPop'),
      'Should have handleStashPop function'
    );
  });

  it('has handleStashApply function', () => {
    assert.ok(
      src.includes('handleStashApply'),
      'Should have handleStashApply function'
    );
  });

  it('has handleStashDrop function', () => {
    assert.ok(
      src.includes('handleStashDrop'),
      'Should have handleStashDrop function'
    );
  });

  it('has toggleStashDropdown function', () => {
    assert.ok(
      src.includes('toggleStashDropdown'),
      'Should have toggleStashDropdown function'
    );
  });

  it('has closeStashDropdown function', () => {
    assert.ok(
      src.includes('closeStashDropdown'),
      'Should have closeStashDropdown function'
    );
  });

  it('has refreshStashList function', () => {
    assert.ok(
      src.includes('refreshStashList'),
      'Should have refreshStashList function'
    );
  });
});

// ============ Behavior ============

describe('GitCommitPanel.svelte -- stash behavior', () => {
  it('calls onCommit after stash save to refresh git status', () => {
    // handleStashSave should call onCommit to trigger a status refresh
    assert.ok(
      src.includes('handleStashSave') && src.includes('onCommit'),
      'Should call onCommit after stash save'
    );
  });

  it('calls onCommit after stash pop to refresh git status', () => {
    assert.ok(
      src.includes('handleStashPop') && src.includes('onCommit'),
      'Should call onCommit after stash pop'
    );
  });

  it('confirms before dropping a stash', () => {
    assert.ok(
      src.includes('handleStashDrop') && src.includes('confirm'),
      'Should confirm before dropping a stash'
    );
  });

  it('disables stash actions when stashOp is active', () => {
    assert.ok(
      src.includes('stashOp') && src.includes('disabled'),
      'Should disable actions when stashOp is in progress'
    );
  });

  it('uses -webkit-app-region: no-drag on stash elements', () => {
    assert.ok(
      src.includes('stash') && src.includes('-webkit-app-region: no-drag'),
      'Stash elements should have -webkit-app-region: no-drag'
    );
  });

  it('uses CSS variables for theming', () => {
    assert.ok(
      src.includes('stash') && src.includes('var(--'),
      'Stash elements should use CSS variables'
    );
  });
});
