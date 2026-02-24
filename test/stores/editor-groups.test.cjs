/**
 * editor-groups.test.cjs -- Source-inspection tests for editor-groups.svelte.js
 *
 * Validates the grid tree model store for split editor groups.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/editor-groups.svelte.js'),
  'utf-8'
);

// ============ Module structure ============

describe('editor-groups.svelte.js: module structure', () => {
  it('exports editorGroupsStore', () => {
    assert.ok(src.includes('export const editorGroupsStore'), 'Should export editorGroupsStore');
  });

  it('uses $state for gridRoot', () => {
    assert.ok(src.includes('$state('), 'Should use $state rune');
    assert.ok(src.includes('gridRoot'), 'Should have gridRoot state');
  });

  it('uses $state for groups (Map)', () => {
    assert.ok(src.includes('groups'), 'Should have groups state');
    assert.ok(src.includes('new Map('), 'Should initialize groups as a Map');
  });

  it('uses $state for focusedGroupId', () => {
    assert.ok(src.includes('focusedGroupId'), 'Should have focusedGroupId state');
  });

  it('uses $state for nextGroupId', () => {
    assert.ok(src.includes('nextGroupId'), 'Should have nextGroupId state');
  });
});

// ============ Grid tree model ============

describe('editor-groups.svelte.js: grid tree model', () => {
  it('gridRoot defaults to leaf with groupId 1', () => {
    assert.ok(
      src.includes("type: 'leaf'") && src.includes('groupId: 1'),
      'Should default gridRoot to a leaf with groupId 1'
    );
  });

  it('initial groups Map has group 1', () => {
    assert.ok(
      src.includes('[1,') || src.includes('[1 ,') || src.includes('new Map([[1'),
      'Should have group 1 in initial Map'
    );
  });

  it('defines GridLeaf type concept (type: leaf, groupId)', () => {
    assert.ok(
      src.includes("type: 'leaf'") && src.includes('groupId'),
      'Should use leaf nodes with type and groupId'
    );
  });

  it('defines GridBranch type concept (type: branch, direction, ratio, children)', () => {
    assert.ok(
      src.includes("type: 'branch'"),
      'Should use branch nodes with type: branch'
    );
    assert.ok(
      src.includes('direction') && src.includes('ratio') && src.includes('children'),
      'Branch nodes should have direction, ratio, and children'
    );
  });
});

// ============ Derived values ============

describe('editor-groups.svelte.js: derived values', () => {
  it('has hasSplit getter (checks gridRoot.type)', () => {
    assert.ok(
      src.includes('hasSplit') && (src.includes("=== 'branch'") || src.includes("!== 'leaf'")),
      'Should have hasSplit that checks gridRoot type'
    );
  });

  it('has groupCount getter', () => {
    assert.ok(src.includes('groupCount'), 'Should have groupCount getter');
  });

  it('has focusedGroup getter', () => {
    assert.ok(src.includes('focusedGroup'), 'Should have focusedGroup getter');
  });

  it('has allGroupIds getter', () => {
    assert.ok(
      src.includes('allGroupIds') || src.includes('groupIds'),
      'Should have a way to get all group IDs'
    );
  });
});

// ============ Methods ============

describe('editor-groups.svelte.js: methods', () => {
  it('has splitGroup method', () => {
    assert.ok(src.includes('splitGroup(') || src.includes('splitGroup ('), 'Should have splitGroup method');
  });

  it('splitGroup creates a branch node', () => {
    assert.ok(
      src.includes("type: 'branch'"),
      'splitGroup should create branch nodes'
    );
  });

  it('splitGroup accepts direction parameter (horizontal/vertical)', () => {
    assert.ok(
      src.includes('direction') && (src.includes("'horizontal'") || src.includes("'vertical'")),
      'splitGroup should accept direction parameter'
    );
  });

  it('splitGroup creates new group in Map', () => {
    assert.ok(
      src.includes('groups.set(') || src.includes('.set(nextGroupId') || src.includes('.set(newGroupId'),
      'splitGroup should add new group to Map'
    );
  });

  it('has closeGroup method', () => {
    assert.ok(src.includes('closeGroup(') || src.includes('closeGroup ('), 'Should have closeGroup method');
  });

  it('closeGroup collapses branch to sibling', () => {
    // When closing a group, its parent branch should be replaced by the sibling
    assert.ok(
      src.includes('sibling') || (src.includes('children') && src.includes('replace')),
      'closeGroup should collapse branch to sibling node'
    );
  });

  it('has setFocusedGroup method', () => {
    assert.ok(src.includes('setFocusedGroup(') || src.includes('setFocusedGroup ('), 'Should have setFocusedGroup method');
  });

  it('has setActiveTabForGroup method', () => {
    assert.ok(
      src.includes('setActiveTabForGroup') || src.includes('activeTabId'),
      'Should have a way to set active tab for a group'
    );
  });

  it('has getActiveTabForGroup method', () => {
    assert.ok(
      src.includes('getActiveTabForGroup') || (src.includes('groups.get(') && src.includes('activeTabId')),
      'Should have a way to get active tab for a group'
    );
  });

  it('has reset method', () => {
    assert.ok(src.includes('reset(') || src.includes('reset ('), 'Should have reset method');
  });
});

// ============ Tree utilities ============

describe('editor-groups.svelte.js: tree utilities', () => {
  it('has findLeaf function', () => {
    assert.ok(
      src.includes('findLeaf') || src.includes('find') && src.includes("type: 'leaf'"),
      'Should have a function to find leaf nodes'
    );
  });

  it('has replaceLeaf function', () => {
    assert.ok(
      src.includes('replaceLeaf') || src.includes('replace'),
      'Should have a function to replace leaf nodes'
    );
  });

  it('has collectLeafIds function', () => {
    assert.ok(
      src.includes('collectLeafIds') || src.includes('collectLeaves') || src.includes('leafIds'),
      'Should have a function to collect leaf IDs'
    );
  });

  it('has countLeaves function', () => {
    assert.ok(
      src.includes('countLeaves') || src.includes('groupCount'),
      'Should have a function to count leaf nodes'
    );
  });
});
