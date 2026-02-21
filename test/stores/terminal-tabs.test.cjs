const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('terminal-tabs.svelte.js -- exports', () => {
  it('exports terminalTabsStore', () => {
    assert.ok(src.includes('export const terminalTabsStore'), 'Should export terminalTabsStore');
  });
});

describe('terminal-tabs.svelte.js -- reactive state', () => {
  it('uses $state for tabs array', () => {
    assert.ok(src.includes('$state(['), 'Should use $state for tabs');
  });

  it('uses $state for activeTabId', () => {
    assert.ok(src.includes("let activeTabId = $state("), 'Should use $state for activeTabId');
  });

  it('has AI tab as default with id ai', () => {
    assert.ok(src.includes("id: 'ai'"), 'Should have AI tab with id ai');
  });

  it('has AI tab with type ai', () => {
    assert.ok(src.includes("type: 'ai'"), 'Should have AI tab with type ai');
  });
});

describe('terminal-tabs.svelte.js -- getters', () => {
  it('has tabs getter', () => {
    assert.ok(src.includes('get tabs()'), 'Should have tabs getter');
  });

  it('has activeTabId getter', () => {
    assert.ok(src.includes('get activeTabId()'), 'Should have activeTabId getter');
  });

  it('has activeTab getter', () => {
    assert.ok(src.includes('get activeTab()'), 'Should have activeTab getter');
  });
});

describe('terminal-tabs.svelte.js -- methods', () => {
  it('has setActive method', () => {
    assert.ok(src.includes('setActive('), 'Should have setActive method');
  });

  it('has addShellTab method', () => {
    assert.ok(src.includes('addShellTab('), 'Should have addShellTab method');
  });

  it('has closeTab method', () => {
    assert.ok(src.includes('closeTab('), 'Should have closeTab method');
  });

  it('has markExited method', () => {
    assert.ok(src.includes('markExited('), 'Should have markExited method');
  });

  it('has renameTab method', () => {
    assert.ok(src.includes('renameTab('), 'Should have renameTab method');
  });
});

describe('terminal-tabs.svelte.js -- behavior', () => {
  it('prevents closing AI tab', () => {
    assert.ok(src.includes("if (id === 'ai') return"), 'Should prevent closing AI tab');
  });

  it('imports shellSpawn from api', () => {
    assert.ok(src.includes('shellSpawn'), 'Should import shellSpawn');
  });

  it('imports shellKill from api', () => {
    assert.ok(src.includes('shellKill'), 'Should import shellKill');
  });

  it('calls shellSpawn in addShellTab', () => {
    assert.ok(src.includes('await shellSpawn('), 'Should call shellSpawn');
  });

  it('calls shellKill in closeTab', () => {
    assert.ok(src.includes('await shellKill('), 'Should call shellKill');
  });
});
