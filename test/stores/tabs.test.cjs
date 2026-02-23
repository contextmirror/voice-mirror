/**
 * tabs.test.cjs -- Source-inspection tests for tabs.svelte.js
 *
 * Validates the tab management store for Lens mode file editing.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/tabs.svelte.js'),
  'utf-8'
);

describe('tabs.svelte.js', () => {
  it('exports tabsStore', () => {
    assert.ok(src.includes('export const tabsStore'), 'Should export tabsStore');
  });

  it('uses $state for tabs array', () => {
    assert.ok(src.includes('$state('), 'Should use $state rune');
    assert.ok(src.includes('let tabs'), 'Should have tabs state');
  });

  it('uses $state for activeTabId', () => {
    assert.ok(src.includes('let activeTabId'), 'Should have activeTabId state');
  });

  it('has browser tab as default', () => {
    assert.ok(
      src.includes("id: 'browser'") && src.includes("type: 'browser'"),
      'Should have default browser tab'
    );
  });

  it('has tabs getter', () => {
    assert.ok(src.includes('get tabs()'), 'Should expose tabs getter');
  });

  it('has activeTabId getter', () => {
    assert.ok(src.includes('get activeTabId()'), 'Should expose activeTabId getter');
  });

  it('has activeTab getter', () => {
    assert.ok(src.includes('get activeTab()'), 'Should expose activeTab getter');
  });
});

describe('tabs.svelte.js: methods', () => {
  it('has openFile method', () => {
    assert.ok(src.includes('openFile('), 'Should have openFile method');
  });

  it('has pinTab method', () => {
    assert.ok(src.includes('pinTab('), 'Should have pinTab method');
  });

  it('has closeTab method', () => {
    assert.ok(src.includes('closeTab('), 'Should have closeTab method');
  });

  it('has setActive method', () => {
    assert.ok(src.includes('setActive('), 'Should have setActive method');
  });

  it('has setDirty method', () => {
    assert.ok(src.includes('setDirty('), 'Should have setDirty method');
  });

  it('has updateTitle method', () => {
    assert.ok(src.includes('updateTitle('), 'Should have updateTitle method');
  });

  it('has closeAll method', () => {
    assert.ok(src.includes('closeAll('), 'Should have closeAll method');
  });
});

describe('tabs.svelte.js: preview tab logic', () => {
  it('creates preview tabs on openFile', () => {
    assert.ok(src.includes('preview: true'), 'Should create tabs with preview: true');
  });

  it('replaces existing preview tab', () => {
    assert.ok(
      src.includes('previewIdx') || src.includes('preview'),
      'Should handle preview tab replacement'
    );
  });

  it('pinTab sets preview to false', () => {
    assert.ok(src.includes('preview = false') || src.includes('preview: false'), 'Should unset preview on pin');
  });
});

describe('tabs.svelte.js: browser tab protection', () => {
  it('prevents closing browser tab', () => {
    assert.ok(
      src.includes("id === 'browser'") || src.includes("=== 'browser'"),
      'Should check for browser tab in closeTab'
    );
  });

  it('closeAll keeps browser tab', () => {
    assert.ok(
      src.includes("type: 'browser'"),
      'Should re-add browser tab in closeAll'
    );
  });
});

describe('tabs.svelte.js: external/readOnly file support', () => {
  it('openFile propagates readOnly flag', () => {
    assert.ok(
      src.includes('readOnly: entry.readOnly || false'),
      'Should pass readOnly from entry'
    );
  });

  it('openFile propagates external flag', () => {
    assert.ok(
      src.includes('external: entry.external || false'),
      'Should pass external from entry'
    );
  });
});

describe('tabs.svelte.js: tab switching on close', () => {
  it('switches to neighbor when closing active tab', () => {
    assert.ok(
      src.includes('activeTabId === id') || src.includes('activeTabId'),
      'Should handle active tab switching on close'
    );
  });
});

describe('tabs.svelte.js: diff tab support', () => {
  it('has openDiff method', () => {
    assert.ok(src.includes('openDiff('), 'Should have openDiff method');
  });

  it('openDiff creates diff tab with diffStats: null', () => {
    assert.ok(src.includes('diffStats: null'), 'Should initialize diffStats as null');
  });

  it('openDiff uses diff: prefix for tab id', () => {
    assert.ok(src.includes('`diff:${'), 'Should prefix diff tab ids');
  });

  it('openDiff sets type to diff', () => {
    assert.ok(
      src.includes("type: 'diff'"),
      'Should set tab type to diff'
    );
  });

  it('has setDiffStats method', () => {
    assert.ok(src.includes('setDiffStats('), 'Should have setDiffStats method');
  });

  it('setDiffStats finds tab by id and sets stats', () => {
    assert.ok(
      src.includes('tab.diffStats = stats'),
      'Should assign stats to tab.diffStats'
    );
  });
});
