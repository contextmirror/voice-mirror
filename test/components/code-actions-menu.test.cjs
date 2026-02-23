const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/CodeActionsMenu.svelte'), 'utf-8');

describe('CodeActionsMenu.svelte: props', () => {
  it('accepts actions prop', () => {
    assert.ok(src.includes('actions'), 'Should have actions prop');
  });

  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should have visible prop');
  });

  it('accepts x and y props', () => {
    assert.ok(src.includes('x ='), 'Should have x prop');
    assert.ok(src.includes('y ='), 'Should have y prop');
  });

  it('accepts onClose prop', () => {
    assert.ok(src.includes('onClose'), 'Should have onClose prop');
  });

  it('accepts onApply prop', () => {
    assert.ok(src.includes('onApply'), 'Should have onApply prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });
});

describe('CodeActionsMenu.svelte: rendering', () => {
  it('has code-actions-menu class', () => {
    assert.ok(src.includes('code-actions-menu'), 'Should have code-actions-menu class');
  });

  it('has code-action-item class', () => {
    assert.ok(src.includes('code-action-item'), 'Should have code-action-item class');
  });

  it('renders action titles', () => {
    assert.ok(src.includes('action.title'), 'Should render action title');
  });
});

describe('CodeActionsMenu.svelte: grouping', () => {
  it('groups actions by kind', () => {
    assert.ok(src.includes('quickfix'), 'Should group quickfix');
    assert.ok(src.includes('refactor'), 'Should group refactor');
    assert.ok(src.includes('source'), 'Should group source');
  });

  it('uses $derived for grouped actions', () => {
    assert.ok(src.includes('groups = $derived'), 'Should use $derived for grouping');
  });

  it('shows group labels when multiple groups exist', () => {
    assert.ok(src.includes('code-actions-label'), 'Should have group label class');
    assert.ok(src.includes('group.label'), 'Should render group label');
  });

  it('shows separator between groups', () => {
    assert.ok(src.includes('code-actions-separator'), 'Should have separator class');
  });
});

describe('CodeActionsMenu.svelte: behavior', () => {
  it('calls onApply on action click', () => {
    assert.ok(src.includes('onApply(action)'), 'Should call onApply');
  });

  it('closes on Escape key', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should close on Escape');
  });

  it('handles click outside', () => {
    assert.ok(src.includes('handleClickOutside'), 'Should handle click outside');
  });

  it('uses position clamping', () => {
    assert.ok(src.includes('menuStyle'), 'Should have menuStyle');
    assert.ok(src.includes('Math.min'), 'Should clamp position');
  });
});

describe('CodeActionsMenu.svelte: styles', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have style block');
  });

  it('uses z-index 10003 for overlay', () => {
    assert.ok(src.includes('z-index: 10003'), 'Should use z-index 10003');
  });

  it('uses CSS variables', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated');
    assert.ok(src.includes('var(--accent)'), 'Should use --accent');
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });
});
