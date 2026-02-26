const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/OutputPanel.svelte'),
  'utf-8'
);

const tabsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte'),
  'utf-8'
);

describe('OutputPanel.svelte', () => {
  it('imports outputStore', () => {
    assert.ok(panelSrc.includes("from '../../lib/stores/output.svelte.js'"));
  });

  it('renders log entries with level classes', () => {
    assert.ok(panelSrc.includes('log-error'));
    assert.ok(panelSrc.includes('log-warn'));
    assert.ok(panelSrc.includes('log-debug'));
    assert.ok(panelSrc.includes('log-trace'));
  });

  it('has auto-scroll behavior', () => {
    assert.ok(panelSrc.includes('autoScroll'));
    assert.ok(panelSrc.includes('scrollTop'));
  });

  it('has scroll-to-bottom button', () => {
    assert.ok(panelSrc.includes('scroll-to-bottom'));
  });

  it('color-codes error and warn levels', () => {
    assert.ok(panelSrc.includes('var(--danger)'));
    assert.ok(panelSrc.includes('var(--warn)'));
  });

  it('uses entry.id as each key', () => {
    assert.ok(panelSrc.includes('(entry.id)'));
  });
});

describe('TerminalTabs output controls', () => {
  it('imports outputStore for output controls', () => {
    assert.ok(tabsSrc.includes("from '../../lib/stores/output.svelte.js'"));
  });

  it('has custom channel dropdown (not native select)', () => {
    assert.ok(tabsSrc.includes('channel-dropdown-trigger'));
    assert.ok(tabsSrc.includes('channel-dropdown-menu'));
    assert.ok(tabsSrc.includes('channelLabels'));
  });

  it('has level filter buttons with readable labels', () => {
    assert.ok(tabsSrc.includes('output-level-btn'));
    assert.ok(tabsSrc.includes('Errors'));
    assert.ok(tabsSrc.includes('Warnings'));
    assert.ok(tabsSrc.includes('Verbose'));
  });

  it('has clear output button', () => {
    assert.ok(tabsSrc.includes('outputStore.clearChannel'));
    assert.ok(tabsSrc.includes('Clear output'));
  });

  it('shows output controls only in output mode', () => {
    assert.ok(tabsSrc.includes("bottomPanelMode === 'output'"));
  });
});
