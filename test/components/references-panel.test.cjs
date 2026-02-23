const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/ReferencesPanel.svelte'), 'utf-8');

describe('ReferencesPanel.svelte: props', () => {
  it('accepts references prop', () => {
    assert.ok(src.includes('references'), 'Should have references prop');
  });

  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should have visible prop');
  });

  it('accepts onClose prop', () => {
    assert.ok(src.includes('onClose'), 'Should have onClose prop');
  });

  it('accepts onNavigate prop', () => {
    assert.ok(src.includes('onNavigate'), 'Should have onNavigate prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });
});

describe('ReferencesPanel.svelte: rendering', () => {
  it('has references-panel class', () => {
    assert.ok(src.includes('references-panel'), 'Should have references-panel class');
  });

  it('has references-header class', () => {
    assert.ok(src.includes('references-header'), 'Should have references-header class');
  });

  it('has reference-item class', () => {
    assert.ok(src.includes('reference-item'), 'Should have reference-item class');
  });

  it('has ref-file class', () => {
    assert.ok(src.includes('ref-file'), 'Should have ref-file class');
  });

  it('has ref-line class', () => {
    assert.ok(src.includes('ref-line'), 'Should have ref-line class');
  });

  it('shows reference count', () => {
    assert.ok(src.includes('references-count'), 'Should show references count');
    assert.ok(src.includes('references.length'), 'Should display count');
  });

  it('has close button', () => {
    assert.ok(src.includes('references-close'), 'Should have close button');
    assert.ok(src.includes('onClose'), 'Should call onClose');
  });

  it('conditionally renders based on visible', () => {
    assert.ok(src.includes('{#if visible'), 'Should check visible');
  });
});

describe('ReferencesPanel.svelte: behavior', () => {
  it('calls onNavigate on click', () => {
    assert.ok(src.includes('onNavigate(ref)'), 'Should call onNavigate');
  });

  it('has getFileName helper', () => {
    assert.ok(src.includes('getFileName'), 'Should have getFileName helper');
  });
});

describe('ReferencesPanel.svelte: styles', () => {
  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have style block');
  });

  it('uses CSS variables', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated');
    assert.ok(src.includes('var(--text)'), 'Should use --text');
  });

  it('uses z-index 10001 for overlay', () => {
    assert.ok(src.includes('z-index: 10001'), 'Should use z-index 10001');
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });
});
