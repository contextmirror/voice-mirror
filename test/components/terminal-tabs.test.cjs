const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalTabs.svelte -- imports', () => {
  it('imports Terminal component', () => {
    assert.ok(src.includes("import Terminal from"), 'Should import Terminal');
  });

  it('imports ShellTerminal component', () => {
    assert.ok(src.includes("import ShellTerminal from"), 'Should import ShellTerminal');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });
});

describe('TerminalTabs.svelte -- structure', () => {
  it('has terminal-tabs-container class', () => {
    assert.ok(src.includes('terminal-tabs-container'), 'Should have container class');
  });

  it('has terminal-tab-bar class', () => {
    assert.ok(src.includes('terminal-tab-bar'), 'Should have tab bar class');
  });

  it('has terminal-panels class', () => {
    assert.ok(src.includes('terminal-panels'), 'Should have panels class');
  });

  it('has terminal-panel class', () => {
    assert.ok(src.includes('terminal-panel'), 'Should have panel class');
  });
});

describe('TerminalTabs.svelte -- tab bar', () => {
  it('iterates tabs with each block', () => {
    assert.ok(src.includes('{#each terminalTabsStore.tabs'), 'Should iterate tabs');
  });

  it('has class:active directive', () => {
    assert.ok(src.includes('class:active='), 'Should have active class binding');
  });

  it('has class:exited directive', () => {
    assert.ok(src.includes('class:exited='), 'Should have exited class binding');
  });

  it('has class:hidden directive', () => {
    assert.ok(src.includes('class:hidden='), 'Should have hidden class binding');
  });

  it('has tab-close button for shell tabs', () => {
    assert.ok(src.includes('tab-close'), 'Should have close button');
  });

  it('has tab-add button', () => {
    assert.ok(src.includes('tab-add'), 'Should have add button');
  });

  it('uses stopPropagation on close button', () => {
    assert.ok(src.includes('stopPropagation'), 'Should stop propagation on close');
  });

  it('has aria-label on add button', () => {
    assert.ok(src.includes('aria-label="New terminal"'), 'Should have aria-label');
  });
});

describe('TerminalTabs.svelte -- terminal rendering', () => {
  it('renders AI Terminal always', () => {
    assert.ok(src.includes('<Terminal'), 'Should render Terminal component');
  });

  it('renders ShellTerminal with shellId prop', () => {
    assert.ok(src.includes('shellId={tab.shellId}'), 'Should pass shellId prop');
  });

  it('passes visible prop to ShellTerminal', () => {
    assert.ok(src.includes('visible={'), 'Should pass visible prop');
  });

  it('has handleAddShell function', () => {
    assert.ok(src.includes('handleAddShell'), 'Should have handleAddShell');
  });

  it('uses keyed each block for tabs', () => {
    assert.ok(src.includes('(tab.id)'), 'Should use keyed each block');
  });
});

describe('TerminalTabs.svelte -- CSS', () => {
  it('hides inactive panels with display none', () => {
    assert.ok(src.includes('display: none'), 'Should hide inactive panels');
  });

  it('uses position absolute for panels', () => {
    assert.ok(src.includes('position: absolute'), 'Should use absolute positioning');
  });
});
