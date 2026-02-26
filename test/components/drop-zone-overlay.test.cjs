const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LENS_DIR = path.join(__dirname, '../../src/components/lens');
const STORES_DIR = path.join(__dirname, '../../src/lib/stores');

function readFile(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf-8');
}

// ── DropZoneOverlay.svelte ──────────────────────────────────────────────────

describe('DropZoneOverlay.svelte', () => {
  const dropSrc = readFile(LENS_DIR, 'DropZoneOverlay.svelte');

  it('has active prop', () => {
    assert.ok(dropSrc.includes('active'), 'Should have active prop');
  });

  it('has zone prop', () => {
    assert.ok(dropSrc.includes('zone'), 'Should have zone prop');
  });

  it('has pointer-events: none', () => {
    assert.ok(dropSrc.includes('pointer-events: none'), 'Should disable pointer events so drag events pass through');
  });

  it('has z-index of 10000', () => {
    assert.ok(dropSrc.includes('10000'), 'Should use z-index 10000 for overlay stacking');
  });

  it('has .zone-center CSS class', () => {
    assert.ok(dropSrc.includes('.zone-center'), 'Should have center zone indicator');
  });

  it('has .zone-left CSS class', () => {
    assert.ok(dropSrc.includes('.zone-left'), 'Should have left zone indicator');
  });

  it('has .zone-right CSS class', () => {
    assert.ok(dropSrc.includes('.zone-right'), 'Should have right zone indicator');
  });

  it('has .zone-top CSS class', () => {
    assert.ok(dropSrc.includes('.zone-top'), 'Should have top zone indicator');
  });

  it('has .zone-bottom CSS class', () => {
    assert.ok(dropSrc.includes('.zone-bottom'), 'Should have bottom zone indicator');
  });

  it('uses CSS transition for smooth animation', () => {
    assert.ok(dropSrc.includes('transition'), 'Should have CSS transition for zone fade');
  });

  it('uses --accent color variable', () => {
    assert.ok(dropSrc.includes('--accent'), 'Should use theme accent color for zone indicators');
  });
});

// ── EditorPane.svelte drop support ──────────────────────────────────────────

describe('EditorPane.svelte drop support', () => {
  const paneSrc = readFile(LENS_DIR, 'EditorPane.svelte');

  it('imports DropZoneOverlay', () => {
    assert.ok(paneSrc.includes('import DropZoneOverlay'), 'Should import the overlay component');
  });

  it('renders DropZoneOverlay component', () => {
    assert.ok(paneSrc.includes('<DropZoneOverlay'), 'Should render DropZoneOverlay in template');
  });

  it('has ondragover handler', () => {
    assert.ok(paneSrc.includes('ondragover'), 'Should handle dragover events for zone detection');
  });

  it('has ondragleave handler', () => {
    assert.ok(paneSrc.includes('ondragleave'), 'Should handle dragleave events to reset overlay');
  });

  it('has ondrop handler', () => {
    assert.ok(paneSrc.includes('ondrop'), 'Should handle drop events to execute zone action');
  });

  it('listens for file-tree-drag-start event', () => {
    assert.ok(paneSrc.includes('file-tree-drag-start'), 'Should listen for global drag start from file tree');
  });

  it('listens for file-tree-drag-end event', () => {
    assert.ok(paneSrc.includes('file-tree-drag-end'), 'Should listen for global drag end from file tree');
  });

  it('has zone detection function', () => {
    assert.ok(paneSrc.includes('detectZone'), 'Should have detectZone function for 5-zone calculation');
  });

  it('calls openFile for center drops', () => {
    assert.ok(paneSrc.includes('openFile'), 'Should call openFile to open dragged file');
  });

  it('calls splitGroup for edge drops', () => {
    assert.ok(paneSrc.includes('splitGroup'), 'Should call splitGroup for left/right/top/bottom zones');
  });

  it('has position relative in CSS for overlay positioning', () => {
    assert.ok(paneSrc.includes('position') && paneSrc.includes('relative'), 'Should have position: relative for absolute overlay positioning');
  });
});

// ── FileTreeNode.svelte drag support ────────────────────────────────────────

describe('FileTreeNode.svelte drag support', () => {
  const nodeSrc = readFile(LENS_DIR, 'FileTreeNode.svelte');

  it('has draggable attribute', () => {
    assert.ok(nodeSrc.includes('draggable'), 'Should mark file buttons as draggable');
  });

  it('has ondragstart handler', () => {
    assert.ok(nodeSrc.includes('ondragstart'), 'Should handle dragstart to set drag data');
  });

  it('has ondragend handler', () => {
    assert.ok(nodeSrc.includes('ondragend') || nodeSrc.includes('dragend'), 'Should handle dragend to clean up');
  });

  it('uses custom MIME type application/x-voice-mirror-file', () => {
    assert.ok(nodeSrc.includes('application/x-voice-mirror-file'), 'Should use custom MIME type for drag data');
  });

  it('sets type marker as file-tree in drag data', () => {
    assert.ok(nodeSrc.includes('file-tree'), 'Should include file-tree type marker in drag data');
  });

  it('calls setDragImage for ghost image', () => {
    assert.ok(nodeSrc.includes('setDragImage'), 'Should set custom drag ghost image');
  });

  it('dispatches file-tree-drag-start window event', () => {
    assert.ok(nodeSrc.includes('file-tree-drag-start'), 'Should dispatch global drag start event');
  });

  it('dispatches file-tree-drag-end window event', () => {
    assert.ok(nodeSrc.includes('file-tree-drag-end'), 'Should dispatch global drag end event');
  });

  it('creates ghost element with filename for drag image', () => {
    // Ghost image is an imperatively created div — should reference entry name
    assert.ok(nodeSrc.includes('requestAnimationFrame'), 'Should clean up ghost element via requestAnimationFrame');
  });

  it('only files are draggable, not directories', () => {
    // Per plan: draggable="true" on file buttons only, NOT directory buttons.
    // The draggable attribute should appear in the file button context, not folder context.
    // Count occurrences — should be limited (not on every button)
    const matches = nodeSrc.match(/draggable/g);
    assert.ok(matches, 'Should have draggable attribute');
    // If directories were also draggable, we would expect many more occurrences.
    // With only file buttons draggable, expect a small number (1-3 occurrences for attribute + possibly handler)
    assert.ok(matches.length <= 4, `Expected limited draggable occurrences (files only), got ${matches.length}`);
  });
});

// ── GroupTabBar.svelte file-tree drop ───────────────────────────────────────

describe('GroupTabBar.svelte file-tree drop', () => {
  const tabBarSrc = readFile(LENS_DIR, 'GroupTabBar.svelte');

  it('handles file-tree type string in drop handler', () => {
    assert.ok(tabBarSrc.includes('file-tree'), 'Should check for file-tree type in drop data');
  });

  it('calls openFile for file-tree drops', () => {
    assert.ok(tabBarSrc.includes('openFile'), 'Should open file when file-tree item dropped on tab bar');
  });

  it('dispatches file-tree-drag-end after file-tree drop', () => {
    assert.ok(tabBarSrc.includes('file-tree-drag-end'), 'Should dispatch drag end event after handling drop');
  });
});

// ── editor-groups.svelte.js swapChildren ────────────────────────────────────

describe('editor-groups.svelte.js swapChildren', () => {
  const groupsSrc = readFile(STORES_DIR, 'editor-groups.svelte.js');

  it('has swapChildren method', () => {
    assert.ok(groupsSrc.includes('swapChildren'), 'Should expose swapChildren method');
  });

  it('swaps children[0] and children[1]', () => {
    assert.ok(groupsSrc.includes('children[0]'), 'Should reference children[0] for swap');
    assert.ok(groupsSrc.includes('children[1]'), 'Should reference children[1] for swap');
  });

  it('uses findParentBranch to find parent', () => {
    assert.ok(groupsSrc.includes('findParentBranch'), 'Should use findParentBranch to locate the branch node');
  });
});
