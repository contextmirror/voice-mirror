const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalColorPicker.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalColorPicker.svelte -- structure', () => {
  it('has color grid', () => {
    assert.ok(src.includes('color-grid'), 'Should have color grid');
  });
  it('has color swatches', () => {
    assert.ok(src.includes('color-swatch'), 'Should have color swatches');
  });
  it('has a label', () => {
    assert.ok(src.includes('color-picker-label'), 'Should have picker label');
  });
});

describe('TerminalColorPicker.svelte -- theme colors', () => {
  it('includes theme variable colors', () => {
    assert.ok(src.includes('var(--accent)'), 'Should use theme accent color');
  });
  it('includes danger color', () => {
    assert.ok(src.includes('var(--danger)'), 'Should use danger color');
  });
  it('includes warn color', () => {
    assert.ok(src.includes('var(--warn)'), 'Should use warn color');
  });
  it('includes ok color', () => {
    assert.ok(src.includes('var(--ok)'), 'Should use ok color');
  });
});

describe('TerminalColorPicker.svelte -- props', () => {
  it('accepts onSelect callback', () => {
    assert.ok(src.includes('onSelect') && src.includes('$props'), 'Should accept onSelect');
  });
  it('accepts onClose callback', () => {
    assert.ok(src.includes('onClose'), 'Should accept onClose');
  });
  it('accepts instanceId prop', () => {
    assert.ok(src.includes('instanceId') && src.includes('$props'), 'Should accept instanceId');
  });
  it('accepts x and y position props', () => {
    assert.ok(src.includes('x =') && src.includes('y ='), 'Should accept position props');
  });
  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should accept visible prop');
  });
});

describe('TerminalColorPicker.svelte -- color options', () => {
  it('has predefined color options', () => {
    assert.ok(src.includes('COLORS'), 'Should define color options');
  });
  it('has red color', () => {
    assert.ok(src.includes("'red'") || src.includes('"red"'), 'Should have red');
  });
  it('has blue color', () => {
    assert.ok(src.includes("'blue'") || src.includes('"blue"'), 'Should have blue');
  });
  it('has none/remove color option', () => {
    assert.ok(src.includes("'none'") && src.includes('None'), 'Should have none option');
  });
});

describe('TerminalColorPicker.svelte -- store integration', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('calls setInstanceColor on select', () => {
    assert.ok(src.includes('setInstanceColor'), 'Should call store method');
  });
});

describe('TerminalColorPicker.svelte -- behavior', () => {
  it('closes on outside click', () => {
    assert.ok(src.includes('addEventListener') && src.includes('click'), 'Should close on outside click');
  });
  it('uses $effect for outside click cleanup', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for lifecycle');
  });
  it('stops propagation on picker click', () => {
    assert.ok(src.includes('stopPropagation'), 'Should stop propagation');
  });
});

describe('TerminalColorPicker.svelte -- styling', () => {
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
