const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalSidebar.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalSidebar.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports from terminal-tabs.svelte.js', () => {
    assert.ok(src.includes('terminal-tabs.svelte.js'), 'Should import from correct store file');
  });
});

describe('TerminalSidebar.svelte -- structure', () => {
  it('has terminal-sidebar container', () => {
    assert.ok(src.includes('terminal-sidebar'), 'Should have sidebar class');
  });
  it('iterates groups', () => {
    assert.ok(src.includes('{#each') && src.includes('groups'), 'Should iterate groups');
  });
  it('iterates instance IDs', () => {
    assert.ok(src.includes('instanceIds'), 'Should iterate instanceIds');
  });
});

describe('TerminalSidebar.svelte -- tree characters', () => {
  it('has top corner character for first instance', () => {
    assert.ok(src.includes('\\u250C') || src.includes('\u250C'), 'Should have top corner tree char');
  });
  it('has bottom corner character for last instance', () => {
    assert.ok(src.includes('\\u2514') || src.includes('\u2514'), 'Should have bottom corner tree char');
  });
  it('has branch character for middle instances', () => {
    assert.ok(src.includes('\\u251C') || src.includes('\u251C'), 'Should have branch tree char');
  });
  it('has tree-char CSS class', () => {
    assert.ok(src.includes('tree-char'), 'Should have tree-char class');
  });
  it('no prefix for single-instance groups', () => {
    assert.ok(src.includes("instanceIds.length <= 1"), 'Should skip prefix for single instances');
  });
});

describe('TerminalSidebar.svelte -- click behavior', () => {
  it('calls focusInstance on click', () => {
    assert.ok(src.includes('focusInstance'), 'Should focus instance on click');
  });
  it('has keyboard handler', () => {
    assert.ok(src.includes('onkeydown'), 'Should handle keyboard events');
  });
});

describe('TerminalSidebar.svelte -- active highlighting', () => {
  it('has class:active binding', () => {
    assert.ok(src.includes('class:active'), 'Should highlight active instance');
  });
  it('compares to activeInstanceId', () => {
    assert.ok(src.includes('activeInstanceId'), 'Should compare against activeInstanceId');
  });
  it('has sidebar-instance class', () => {
    assert.ok(src.includes('sidebar-instance'), 'Should have instance class');
  });
});

describe('TerminalSidebar.svelte -- context menu support', () => {
  it('accepts oncontextmenu prop', () => {
    assert.ok(src.includes('oncontextmenu'), 'Should accept context menu callback');
  });
  it('calls preventDefault on right-click', () => {
    assert.ok(src.includes('preventDefault'), 'Should prevent default context menu');
  });
});

describe('TerminalSidebar.svelte -- accessibility', () => {
  it('has role=option on items', () => {
    assert.ok(src.includes('role="option"'), 'Should have option role');
  });
  it('has aria-selected', () => {
    assert.ok(src.includes('aria-selected'), 'Should indicate selected state');
  });
  it('has tabindex', () => {
    assert.ok(src.includes('tabindex="0"'), 'Should be focusable');
  });
});

describe('TerminalSidebar.svelte -- hover action buttons', () => {
  it('has instance-actions container', () => {
    assert.ok(src.includes('instance-actions'), 'Should have actions container');
  });
  it('has split terminal button', () => {
    assert.ok(src.includes('Split Terminal'), 'Should have split button title');
  });
  it('has kill terminal button', () => {
    assert.ok(src.includes('Kill Terminal'), 'Should have kill button title');
  });
  it('split button calls splitGroup', () => {
    assert.ok(src.includes('splitGroup(group.id)'), 'Should call splitGroup with group id');
  });
  it('kill button calls killInstance', () => {
    assert.ok(src.includes('killInstance(instId)'), 'Should call killInstance with instance id');
  });
  it('buttons stop click propagation', () => {
    assert.ok(src.includes('stopPropagation'), 'Should prevent row click when clicking action');
  });
  it('has action-btn CSS class', () => {
    assert.ok(src.includes('.action-btn'), 'Should style action buttons');
  });
  it('actions hidden by default, shown on hover', () => {
    assert.ok(src.includes('.instance-actions') && src.includes('display: none'), 'Actions hidden by default');
    assert.ok(src.includes(':hover .instance-actions'), 'Actions shown on hover');
  });
});

describe('TerminalSidebar.svelte -- drag-to-reorder', () => {
  it('has draggable attribute on instances', () => {
    assert.ok(src.includes('draggable="true"'), 'Instances should be draggable');
  });
  it('has dragstart handler', () => {
    assert.ok(src.includes('ondragstart'), 'Should handle drag start');
  });
  it('has dragover handler', () => {
    assert.ok(src.includes('ondragover'), 'Should handle drag over');
  });
  it('has drop handler', () => {
    assert.ok(src.includes('ondrop'), 'Should handle drop');
  });
  it('has dragend handler', () => {
    assert.ok(src.includes('ondragend'), 'Should handle drag end');
  });
  it('has dragging class for visual feedback', () => {
    assert.ok(src.includes('class:dragging'), 'Should dim dragged item');
  });
  it('has drop-before indicator class', () => {
    assert.ok(src.includes('class:drop-before'), 'Should show top drop indicator');
  });
  it('has drop-after indicator class', () => {
    assert.ok(src.includes('class:drop-after'), 'Should show bottom drop indicator');
  });
  it('calls moveInstance on drop', () => {
    assert.ok(src.includes('moveInstance'), 'Should call store moveInstance');
  });
  it('tracks drag state', () => {
    assert.ok(src.includes('dragInstanceId'), 'Should track which instance is being dragged');
    assert.ok(src.includes('dropTargetId'), 'Should track drop target');
  });
});
