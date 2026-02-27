const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalContextMenu.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalContextMenu.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports from terminal-tabs.svelte.js', () => {
    assert.ok(src.includes('terminal-tabs.svelte.js'), 'Should import from correct store file');
  });
});

describe('TerminalContextMenu.svelte -- props', () => {
  it('accepts instanceId prop', () => {
    assert.ok(src.includes('instanceId'), 'Should accept instanceId');
  });
  it('accepts x prop', () => {
    assert.ok(src.includes('x'), 'Should accept x coordinate');
  });
  it('accepts y prop', () => {
    assert.ok(src.includes('y'), 'Should accept y coordinate');
  });
  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should accept visible flag');
  });
  it('accepts onClose prop', () => {
    assert.ok(src.includes('onClose'), 'Should accept close callback');
  });
});

describe('TerminalContextMenu.svelte -- positioning', () => {
  it('uses position: fixed', () => {
    assert.ok(src.includes('position: fixed'), 'Should use fixed positioning');
  });
  it('uses z-index: 10000', () => {
    assert.ok(src.includes('z-index: 10000'), 'Should have high z-index');
  });
  it('positions with x/y coordinates', () => {
    assert.ok(src.includes('left: {x}px') && src.includes('top: {y}px'), 'Should position via props');
  });
});

describe('TerminalContextMenu.svelte -- menu items', () => {
  it('has Split Terminal option', () => {
    assert.ok(src.includes('Split Terminal'), 'Should have split option');
  });
  it('has Change Color option', () => {
    assert.ok(src.includes('Change Color'), 'Should have color option');
  });
  it('has Change Icon option', () => {
    assert.ok(src.includes('Change Icon'), 'Should have icon option');
  });
  it('has Rename option', () => {
    assert.ok(src.includes('Rename'), 'Should have rename option');
  });
  it('has Kill Terminal option', () => {
    assert.ok(src.includes('Kill Terminal'), 'Should have kill option');
  });
  it('has Unsplit Terminal option', () => {
    assert.ok(src.includes('Unsplit Terminal'), 'Should have unsplit option');
  });
});

describe('TerminalContextMenu.svelte -- keyboard shortcuts', () => {
  it('shows Ctrl+Shift+5 for split', () => {
    assert.ok(src.includes('Ctrl+Shift+5'), 'Should show split shortcut');
  });
  it('shows F2 for rename', () => {
    assert.ok(src.includes('F2'), 'Should show rename shortcut');
  });
  it('shows Delete for kill', () => {
    assert.ok(src.includes('Delete'), 'Should show kill shortcut');
  });
});

describe('TerminalContextMenu.svelte -- store methods', () => {
  it('calls splitInstance', () => {
    assert.ok(src.includes('splitInstance'), 'Should call splitInstance');
  });
  it('calls killInstance', () => {
    assert.ok(src.includes('killInstance'), 'Should call killInstance');
  });
  it('calls unsplitGroup', () => {
    assert.ok(src.includes('unsplitGroup'), 'Should call unsplitGroup');
  });
  it('calls renameInstance', () => {
    assert.ok(src.includes('renameInstance'), 'Should call renameInstance');
  });
});

describe('TerminalContextMenu.svelte -- picker imports', () => {
  it('imports TerminalColorPicker', () => {
    assert.ok(src.includes("import TerminalColorPicker from"), 'Should import color picker');
  });
  it('imports TerminalIconPicker', () => {
    assert.ok(src.includes("import TerminalIconPicker from"), 'Should import icon picker');
  });
  it('renders TerminalColorPicker component', () => {
    assert.ok(src.includes('<TerminalColorPicker'), 'Should render color picker component');
  });
  it('renders TerminalIconPicker component', () => {
    assert.ok(src.includes('<TerminalIconPicker'), 'Should render icon picker component');
  });
  it('tracks colorPickerOpen state', () => {
    assert.ok(src.includes('colorPickerOpen'), 'Should track color picker state');
  });
  it('tracks iconPickerOpen state', () => {
    assert.ok(src.includes('iconPickerOpen'), 'Should track icon picker state');
  });
  it('has closeColorPicker handler', () => {
    assert.ok(src.includes('closeColorPicker'), 'Should have close color picker handler');
  });
  it('has closeIconPicker handler', () => {
    assert.ok(src.includes('closeIconPicker'), 'Should have close icon picker handler');
  });
});

describe('TerminalContextMenu.svelte -- dividers', () => {
  it('has context-menu-divider', () => {
    assert.ok(src.includes('context-menu-divider'), 'Should have dividers');
  });
});

describe('TerminalContextMenu.svelte -- conditional visibility', () => {
  it('conditionally renders based on visible prop', () => {
    assert.ok(src.includes('{#if visible'), 'Should check visible flag');
  });
  it('conditionally shows unsplit based on group size', () => {
    assert.ok(src.includes('canUnsplit'), 'Should check if unsplit is possible');
  });
});

describe('TerminalContextMenu.svelte -- outside click handling', () => {
  it('closes on outside click', () => {
    assert.ok(src.includes('window.addEventListener'), 'Should listen for outside clicks');
  });
  it('uses $effect for cleanup', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for lifecycle');
  });
});

describe('TerminalContextMenu.svelte -- danger styling', () => {
  it('kill terminal has danger class', () => {
    assert.ok(src.includes('danger'), 'Should style kill as danger');
  });
});
