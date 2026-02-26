const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalPanel.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalPanel.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports Terminal component', () => {
    assert.ok(src.includes("import Terminal from"), 'Should import Terminal');
  });
  it('imports SplitPanel', () => {
    assert.ok(src.includes("import SplitPanel from"), 'Should import SplitPanel');
  });
});

describe('TerminalPanel.svelte -- structure', () => {
  it('has terminal-panel-inner container', () => {
    assert.ok(src.includes('terminal-panel-inner'), 'Should have inner container');
  });
  it('has terminal-header', () => {
    assert.ok(src.includes('terminal-header'), 'Should have header');
  });
  it('has terminal-body', () => {
    assert.ok(src.includes('terminal-body'), 'Should have body');
  });
  it('has terminal-content area', () => {
    assert.ok(src.includes('terminal-content'), 'Should have content');
  });
  it('has terminal-sidebar area', () => {
    assert.ok(src.includes('terminal-sidebar'), 'Should have sidebar');
  });
});

describe('TerminalPanel.svelte -- group tabs', () => {
  it('iterates groups', () => {
    assert.ok(src.includes('{#each') && src.includes('groups'), 'Should iterate groups');
  });
  it('has group-tab class', () => {
    assert.ok(src.includes('group-tab'), 'Should have group tab class');
  });
  it('has class:active for active group', () => {
    assert.ok(src.includes('class:active'), 'Should highlight active');
  });
  it('clicks call setActiveGroup', () => {
    assert.ok(src.includes('setActiveGroup'), 'Should switch group on click');
  });
});

describe('TerminalPanel.svelte -- terminal rendering', () => {
  it('renders Terminal component', () => {
    assert.ok(src.includes('<Terminal'), 'Should render Terminal');
  });
  it('passes shellId to Terminal', () => {
    assert.ok(src.includes('shellId'), 'Should pass shellId');
  });
  it('uses SplitPanel for multi-instance groups', () => {
    assert.ok(src.includes('<SplitPanel') || src.includes('SplitPanel'), 'Should use SplitPanel');
  });
});

describe('TerminalPanel.svelte -- sidebar', () => {
  it('shows sidebar conditionally', () => {
    assert.ok(src.includes('showSidebar') || src.includes('sidebarVisible'), 'Should conditionally show');
  });
  it('has tree characters for splits', () => {
    assert.ok(src.includes('┌') || src.includes('├') || src.includes('└'), 'Should have tree chars');
  });
  it('sidebar items call focusInstance', () => {
    assert.ok(src.includes('focusInstance'), 'Should focus on click');
  });
  it('has sidebar-instance class', () => {
    assert.ok(src.includes('sidebar-instance'), 'Should have instance class');
  });
});

describe('TerminalPanel.svelte -- action bar', () => {
  it('has add group button', () => {
    assert.ok(src.includes('addGroup'), 'Should have new terminal button');
  });
  it('has split button', () => {
    assert.ok(src.includes('splitInstance'), 'Should have split button');
  });
});

describe('TerminalPanel.svelte -- auto-spawn', () => {
  it('auto-spawns on mount if no groups', () => {
    assert.ok(src.includes('onMount') || src.includes('$effect'), 'Should auto-spawn');
    assert.ok(src.includes('addGroup'), 'Should call addGroup');
  });
});

describe('TerminalPanel.svelte -- SplitPanel integration', () => {
  it('uses panelA snippet (not first)', () => {
    assert.ok(src.includes('{#snippet panelA()}'), 'Should use panelA snippet matching SplitPanel API');
  });
  it('uses panelB snippet (not second)', () => {
    assert.ok(src.includes('{#snippet panelB()}'), 'Should use panelB snippet matching SplitPanel API');
  });
  it('passes direction to SplitPanel', () => {
    assert.ok(src.includes('direction="horizontal"'), 'Should pass horizontal direction');
  });
  it('binds ratio to SplitPanel', () => {
    assert.ok(src.includes('bind:ratio'), 'Should bind ratio for resizable splits');
  });
});

describe('TerminalPanel.svelte -- accessibility', () => {
  it('has role attributes on interactive elements', () => {
    assert.ok(src.includes('role="tab"') || src.includes('role="option"'), 'Should have ARIA roles');
  });
  it('has aria-selected on tabs', () => {
    assert.ok(src.includes('aria-selected'), 'Should indicate selected state');
  });
});
