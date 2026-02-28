/**
 * editor-pane.test.cjs -- Source-inspection tests for EditorPane.svelte
 *
 * Validates the editor pane component including tab drag split zones.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/EditorPane.svelte'),
  'utf-8'
);

// ============ Component structure ============

describe('EditorPane.svelte: component structure', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'File should have content');
  });

  it('uses $props() for groupId', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('groupId'), 'Should accept groupId prop');
  });

  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });

  it('imports editorGroupsStore', () => {
    assert.ok(src.includes('editorGroupsStore'), 'Should import editorGroupsStore');
  });

  it('imports DropZoneOverlay', () => {
    assert.ok(src.includes('DropZoneOverlay'), 'Should import DropZoneOverlay');
  });

  it('imports GroupTabBar', () => {
    assert.ok(src.includes('GroupTabBar'), 'Should import GroupTabBar');
  });

  it('imports FileEditor', () => {
    assert.ok(src.includes('FileEditor'), 'Should import FileEditor');
  });

  it('imports DiffViewer', () => {
    assert.ok(src.includes('DiffViewer'), 'Should import DiffViewer');
  });
});

// ============ File tree drag support ============

describe('EditorPane.svelte: file tree drag support', () => {
  it('tracks fileTreeDragActive state', () => {
    assert.ok(src.includes('fileTreeDragActive'), 'Should track file tree drag state');
  });

  it('listens for file-tree-drag-start and file-tree-drag-end events', () => {
    assert.ok(src.includes('file-tree-drag-start'), 'Should listen for file-tree-drag-start');
    assert.ok(src.includes('file-tree-drag-end'), 'Should listen for file-tree-drag-end');
  });

  it('has detectZone function with edge threshold', () => {
    assert.ok(src.includes('detectZone'), 'Should have detectZone function');
    assert.ok(src.includes('EDGE_THRESHOLD'), 'Should have edge threshold constant');
  });

  it('handles file drops with split logic', () => {
    assert.ok(src.includes('splitGroup'), 'Should split on file drop');
    assert.ok(src.includes('openFile'), 'Should open file on drop');
  });
});

// ============ Tab drag split zones ============

describe('EditorPane.svelte: tab drag split zones', () => {
  it('detects tab drag via application/x-voice-mirror-tab MIME type', () => {
    assert.ok(src.includes('application/x-voice-mirror-tab'), 'Should check for tab MIME type');
  });

  it('shows DropZoneOverlay for tab drags', () => {
    assert.ok(src.includes('DropZoneOverlay'), 'Should use DropZoneOverlay');
  });

  it('handles tab drop with split logic', () => {
    assert.ok(src.includes('tabId') && src.includes('splitGroup'), 'Should split on tab drop');
  });

  it('tracks tab drag state', () => {
    assert.ok(src.includes('tabDragActive'), 'Should track tab drag state');
  });

  it('listens for tab-drag-start and tab-drag-end events', () => {
    assert.ok(src.includes('tab-drag-start') && src.includes('tab-drag-end'), 'Should listen for tab drag events');
  });

  it('moves tab to existing group on center drop', () => {
    assert.ok(src.includes('moveTab'), 'Should use moveTab for center zone');
  });
});

// ============ Drop zone overlay ============

describe('EditorPane.svelte: drop zone overlay', () => {
  it('shows DropZoneOverlay when drag is active over this pane', () => {
    assert.ok(src.includes('dragOverThis'), 'Should track dragOverThis state');
  });

  it('tracks current drop zone (center, left, right, top, bottom)', () => {
    assert.ok(src.includes('dropZone'), 'Should track drop zone');
    assert.ok(src.includes("'center'"), 'Should have center zone');
    assert.ok(src.includes("'left'"), 'Should have left zone');
    assert.ok(src.includes("'right'"), 'Should have right zone');
    assert.ok(src.includes("'top'"), 'Should have top zone');
    assert.ok(src.includes("'bottom'"), 'Should have bottom zone');
  });

  it('DropZoneOverlay responds to both file-tree and tab drags', () => {
    assert.ok(
      src.includes('fileTreeDragActive') && src.includes('tabDragActive'),
      'Should respond to both file-tree and tab drag sources'
    );
  });
});
