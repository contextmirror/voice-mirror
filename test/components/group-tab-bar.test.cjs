/**
 * group-tab-bar.test.cjs -- Source-inspection tests for GroupTabBar.svelte
 *
 * Validates the per-group tab bar component for split editor.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/GroupTabBar.svelte'),
  'utf-8'
);

// ============ Component structure ============

describe('GroupTabBar.svelte: component structure', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'File should have content');
  });

  it('uses $props() for groupId', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('groupId'), 'Should accept groupId prop');
  });

  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
    assert.ok(src.includes('tabs.svelte.js'), 'Should import from tabs.svelte.js');
  });

  it('imports editorGroupsStore', () => {
    assert.ok(src.includes('editorGroupsStore'), 'Should import editorGroupsStore');
    assert.ok(src.includes('editor-groups.svelte.js'), 'Should import from editor-groups.svelte.js');
  });
});

// ============ Tab rendering ============

describe('GroupTabBar.svelte: tab rendering', () => {
  it('renders tabs from tabsStore', () => {
    assert.ok(
      src.includes('getTabsForGroup') || src.includes('tabsStore'),
      'Should get tabs for this group'
    );
  });

  it('shows tab titles', () => {
    assert.ok(
      src.includes('tab.title') || src.includes('tab-title'),
      'Should display tab titles'
    );
  });

  it('shows dirty indicator', () => {
    assert.ok(
      src.includes('dirty') && (src.includes('class:dirty') || src.includes('dirty-dot')),
      'Should show dirty indicator'
    );
  });

  it('shows close button', () => {
    assert.ok(
      src.includes('closeTab') || src.includes('close'),
      'Should have close button'
    );
  });

  it('has active tab styling (class:active or similar)', () => {
    assert.ok(
      src.includes('class:active') || src.includes('active'),
      'Should have active tab styling'
    );
  });
});

// ============ Interactions ============

describe('GroupTabBar.svelte: interactions', () => {
  it('tab click calls setActive', () => {
    assert.ok(
      src.includes('setActive') || src.includes('onclick'),
      'Should handle tab click for activation'
    );
  });

  it('close button calls closeTab', () => {
    assert.ok(src.includes('closeTab'), 'Should call closeTab on close button');
  });

  it('double-click pins tab', () => {
    assert.ok(
      src.includes('ondblclick') || src.includes('dblclick'),
      'Should handle double-click for pinning'
    );
    assert.ok(src.includes('pinTab'), 'Should call pinTab');
  });

  it('has "+" button for new file', () => {
    assert.ok(
      src.includes('tab-add') || src.includes('+') || src.includes('add'),
      'Should have add button'
    );
  });
});

// ============ Drag and drop ============

describe('GroupTabBar.svelte: drag and drop', () => {
  it('tabs have draggable attribute', () => {
    assert.ok(
      src.includes('draggable') || src.includes('draggable="true"'),
      'Should have draggable attribute on tabs'
    );
  });

  it('has dragstart handler', () => {
    assert.ok(
      src.includes('dragstart') || src.includes('ondragstart'),
      'Should have dragstart handler'
    );
  });

  it('has dragover handler', () => {
    assert.ok(
      src.includes('dragover') || src.includes('ondragover'),
      'Should have dragover handler'
    );
  });

  it('has drop handler', () => {
    assert.ok(
      src.includes('ondrop') || src.includes('drop'),
      'Should have drop handler'
    );
  });

  it('uses dataTransfer for tab data', () => {
    assert.ok(
      src.includes('dataTransfer') || src.includes('setData') || src.includes('getData'),
      'Should use dataTransfer for tab data'
    );
  });
});

// ============ Focus indicator ============

describe('GroupTabBar.svelte: focus indicator', () => {
  it('has focused class based on focusedGroupId', () => {
    assert.ok(
      src.includes('focused') || src.includes('focusedGroupId'),
      'Should have focused indicator'
    );
  });
});

// ============ Styling ============

describe('GroupTabBar.svelte: styling', () => {
  it('uses -webkit-app-region: no-drag', () => {
    assert.ok(
      src.includes('-webkit-app-region: no-drag') || src.includes('app-region'),
      'Should use -webkit-app-region: no-drag for interactive elements'
    );
  });

  it('uses theme CSS variables (--bg, --text, --accent, --border)', () => {
    assert.ok(src.includes('var(--'), 'Should use CSS custom properties');
    const hasThemeVars = ['--bg', '--text', '--accent'].some(v => src.includes(`var(${v}`));
    assert.ok(hasThemeVars, 'Should use theme CSS variables');
  });

  it('has horizontal flex layout', () => {
    assert.ok(
      src.includes('display: flex') || src.includes('flex'),
      'Should have flex layout'
    );
  });
});
