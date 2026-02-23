const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/RenameInput.svelte'), 'utf-8');

describe('RenameInput.svelte: props', () => {
  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should have visible prop');
  });

  it('accepts x and y props', () => {
    assert.ok(src.includes('x ='), 'Should have x prop');
    assert.ok(src.includes('y ='), 'Should have y prop');
  });

  it('accepts currentName prop', () => {
    assert.ok(src.includes('currentName'), 'Should have currentName prop');
  });

  it('accepts onConfirm prop', () => {
    assert.ok(src.includes('onConfirm'), 'Should have onConfirm prop');
  });

  it('accepts onCancel prop', () => {
    assert.ok(src.includes('onCancel'), 'Should have onCancel prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });
});

describe('RenameInput.svelte: state', () => {
  it('has inputValue state', () => {
    assert.ok(src.includes('inputValue = $state('), 'Should have inputValue state');
  });

  it('syncs inputValue from currentName on visible', () => {
    assert.ok(src.includes('inputValue = currentName'), 'Should sync from currentName');
  });
});

describe('RenameInput.svelte: behavior', () => {
  it('handles Enter key for confirm', () => {
    assert.ok(src.includes("e.key === 'Enter'"), 'Should handle Enter');
  });

  it('handles Escape key for cancel', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should handle Escape');
  });

  it('calls onConfirm with new name', () => {
    assert.ok(src.includes('onConfirm('), 'Should call onConfirm');
  });

  it('calls onCancel on escape or blur', () => {
    assert.ok(src.includes('onCancel()'), 'Should call onCancel');
  });

  it('cancels on blur', () => {
    assert.ok(src.includes('handleBlur'), 'Should handle blur');
  });

  it('has autofocus action', () => {
    assert.ok(src.includes('use:autofocus'), 'Should use autofocus action');
    assert.ok(src.includes('node.focus()'), 'Should focus on mount');
    assert.ok(src.includes('node.select()'), 'Should select text on mount');
  });

  it('only confirms when name changed', () => {
    assert.ok(src.includes('inputValue !== currentName'), 'Should check if name changed');
  });
});

describe('RenameInput.svelte: rendering', () => {
  it('has rename-input class', () => {
    assert.ok(src.includes('rename-input'), 'Should have rename-input class');
  });

  it('conditionally renders based on visible', () => {
    assert.ok(src.includes('{#if visible}'), 'Should check visible');
  });

  it('positions using x and y', () => {
    assert.ok(src.includes('left: {x}px'), 'Should position with x');
    assert.ok(src.includes('top: {y}px'), 'Should position with y');
  });

  it('binds input value', () => {
    assert.ok(src.includes('bind:value={inputValue}'), 'Should bind inputValue');
  });
});

describe('RenameInput.svelte: styles', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have style block');
  });

  it('uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'), 'Should use fixed position');
  });

  it('uses CSS variables', () => {
    assert.ok(src.includes('var(--accent)'), 'Should use --accent');
    assert.ok(src.includes('var(--text)'), 'Should use --text');
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });

  it('uses z-index for overlay', () => {
    assert.ok(src.includes('z-index: 10003'), 'Should use z-index');
  });
});
