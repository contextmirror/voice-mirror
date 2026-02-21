const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/StatusDropdown.svelte'),
  'utf-8'
);

describe('StatusDropdown.svelte', () => {
  it('has status badge button', () => {
    assert.ok(src.includes('status-badge'));
  });
  it('has status panel dropdown', () => {
    assert.ok(src.includes('status-panel'));
  });
  it('has aria-expanded for accessibility', () => {
    assert.ok(src.includes('aria-expanded'));
  });
  it('has aria-haspopup for accessibility', () => {
    assert.ok(src.includes('aria-haspopup'));
  });
  it('has servers tab', () => {
    assert.ok(src.includes("'servers'"));
    assert.ok(src.includes('Servers'));
  });
  it('has MCP tab', () => {
    assert.ok(src.includes("'mcp'"));
    assert.ok(src.includes('MCP'));
  });
  it('has provider tab', () => {
    assert.ok(src.includes("'provider'"));
    assert.ok(src.includes('Provider'));
  });
  it('has status dot indicators (ok/warn/danger)', () => {
    assert.ok(src.includes('entry-dot ok'));
    assert.ok(src.includes('entry-dot warn'));
  });
  it('has manage servers button', () => {
    assert.ok(src.includes('Manage servers'));
  });
  it('uses ok color for connected status', () => {
    assert.ok(src.includes('var(--ok)'));
  });
  it('closes on outside click', () => {
    assert.ok(src.includes('svelte:window'));
    assert.ok(src.includes('handleWindowClick'));
  });
  it('has high z-index for dropdown panel', () => {
    assert.ok(src.includes('z-index: 10002'));
  });
  it('toggles open state', () => {
    assert.ok(/let\s+open\s*=\s*\$state/.test(src));
  });
  it('tracks active tab', () => {
    assert.ok(/let\s+activeTab\s*=\s*\$state/.test(src));
  });
});
