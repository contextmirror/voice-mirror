const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/OutputPanel.svelte'),
  'utf-8'
);

describe('OutputPanel.svelte', () => {
  it('imports outputStore', () => {
    assert.ok(src.includes("from '../../lib/stores/output.svelte.js'"));
  });

  it('has channel dropdown', () => {
    assert.ok(src.includes('channel-select'));
    assert.ok(src.includes('outputStore.switchChannel'));
  });

  it('has level filter buttons', () => {
    assert.ok(src.includes('level-filters'));
    assert.ok(src.includes('outputStore.setLevelFilter'));
  });

  it('renders log entries with level classes', () => {
    assert.ok(src.includes('log-error'));
    assert.ok(src.includes('log-warn'));
    assert.ok(src.includes('log-debug'));
    assert.ok(src.includes('log-trace'));
  });

  it('has auto-scroll behavior', () => {
    assert.ok(src.includes('autoScroll'));
    assert.ok(src.includes('scrollTop'));
  });

  it('has clear button', () => {
    assert.ok(src.includes('clearChannel'));
    assert.ok(src.includes('clear-btn'));
  });

  it('color-codes error and warn levels', () => {
    assert.ok(src.includes('var(--danger)'));
    assert.ok(src.includes('var(--warn)'));
  });
});
