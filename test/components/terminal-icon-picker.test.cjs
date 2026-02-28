const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalIconPicker.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalIconPicker.svelte -- structure', () => {
  it('has icon grid', () => {
    assert.ok(src.includes('icon-grid'), 'Should have icon grid');
  });
  it('has icon options', () => {
    assert.ok(src.includes('icon-option'), 'Should have icon options');
  });
  it('has a label', () => {
    assert.ok(src.includes('icon-picker-label'), 'Should have picker label');
  });
});

describe('TerminalIconPicker.svelte -- filter', () => {
  it('has search/filter input', () => {
    assert.ok(src.includes('icon-filter'), 'Should have filter input');
  });
  it('has filter placeholder text', () => {
    assert.ok(src.includes('Filter icons'), 'Should have placeholder text');
  });
  it('filters icons by text', () => {
    assert.ok(src.includes('filter') && src.includes('includes'), 'Should filter icons');
  });
  it('uses $derived for filtered icons', () => {
    assert.ok(src.includes('$derived') && src.includes('filteredIcons'), 'Should use derived for filtering');
  });
});

describe('TerminalIconPicker.svelte -- props', () => {
  it('accepts onSelect callback', () => {
    assert.ok(src.includes('onSelect') && src.includes('$props'), 'Should accept onSelect');
  });
  it('accepts onClose callback', () => {
    assert.ok(src.includes('onClose'), 'Should accept onClose');
  });
  it('accepts instanceId prop', () => {
    assert.ok(src.includes('instanceId') && src.includes('$props'), 'Should accept instanceId');
  });
  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should accept visible');
  });
  it('accepts x and y position props', () => {
    assert.ok(src.includes('x =') && src.includes('y ='), 'Should accept position props');
  });
});

describe('TerminalIconPicker.svelte -- icon options', () => {
  it('has predefined icon options', () => {
    assert.ok(src.includes('ICONS'), 'Should define icon options');
  });
  it('has terminal icon', () => {
    assert.ok(src.includes("'terminal'"), 'Should have terminal icon');
  });
  it('has code icon', () => {
    assert.ok(src.includes("'code'"), 'Should have code icon');
  });
  it('has bug icon', () => {
    assert.ok(src.includes("'bug'"), 'Should have bug icon');
  });
  it('has server icon', () => {
    assert.ok(src.includes("'server'"), 'Should have server icon');
  });
  it('has default/none option', () => {
    assert.ok(src.includes("'none'") && src.includes('Default'), 'Should have default option');
  });
});

describe('TerminalIconPicker.svelte -- store integration', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('calls setInstanceIcon on select', () => {
    assert.ok(src.includes('setInstanceIcon'), 'Should call store method');
  });
});

describe('TerminalIconPicker.svelte -- behavior', () => {
  it('closes on outside click', () => {
    assert.ok(src.includes('addEventListener') && src.includes('click'), 'Should close on outside click');
  });
  it('uses $effect for outside click cleanup', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for lifecycle');
  });
  it('stops propagation on picker click', () => {
    assert.ok(src.includes('stopPropagation'), 'Should stop propagation');
  });
  it('uses SVG icons via @html', () => {
    assert.ok(src.includes('@html'), 'Should render SVG via @html');
  });
});

describe('TerminalIconPicker.svelte -- styling', () => {
  it('has fixed positioning', () => {
    assert.ok(src.includes('position: fixed'), 'Should use fixed positioning');
  });
  it('has z-index above context menu', () => {
    assert.ok(src.includes('z-index: 10001'), 'Should have z-index 10001');
  });
  it('uses bg-elevated background', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use elevated background');
  });
});
