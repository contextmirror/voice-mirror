const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalSidebar.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalSidebar.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports from terminal-tabs.svelte.js', () => {
    assert.ok(src.includes('terminal-tabs.svelte.js'), 'Should import from correct store file');
  });
});

describe('TerminalSidebar.svelte -- structure', () => {
  it('has terminal-sidebar container', () => {
    assert.ok(src.includes('terminal-sidebar'), 'Should have sidebar class');
  });
  it('iterates groups', () => {
    assert.ok(src.includes('{#each') && src.includes('groups'), 'Should iterate groups');
  });
  it('iterates instance IDs', () => {
    assert.ok(src.includes('instanceIds'), 'Should iterate instanceIds');
  });
});

describe('TerminalSidebar.svelte -- tree characters', () => {
  it('has top corner character for first instance', () => {
    assert.ok(src.includes('\\u250C') || src.includes('\u250C'), 'Should have top corner tree char');
  });
  it('has bottom corner character for last instance', () => {
    assert.ok(src.includes('\\u2514') || src.includes('\u2514'), 'Should have bottom corner tree char');
  });
  it('has branch character for middle instances', () => {
    assert.ok(src.includes('\\u251C') || src.includes('\u251C'), 'Should have branch tree char');
  });
  it('has tree-char CSS class', () => {
    assert.ok(src.includes('tree-char'), 'Should have tree-char class');
  });
  it('no prefix for single-instance groups', () => {
    assert.ok(src.includes("instanceIds.length <= 1"), 'Should skip prefix for single instances');
  });
});

describe('TerminalSidebar.svelte -- click behavior', () => {
  it('calls focusInstance on click', () => {
    assert.ok(src.includes('focusInstance'), 'Should focus instance on click');
  });
  it('has keyboard handler', () => {
    assert.ok(src.includes('onkeydown'), 'Should handle keyboard events');
  });
});

describe('TerminalSidebar.svelte -- active highlighting', () => {
  it('has class:active binding', () => {
    assert.ok(src.includes('class:active'), 'Should highlight active instance');
  });
  it('compares to activeInstanceId', () => {
    assert.ok(src.includes('activeInstanceId'), 'Should compare against activeInstanceId');
  });
  it('has sidebar-instance class', () => {
    assert.ok(src.includes('sidebar-instance'), 'Should have instance class');
  });
});

describe('TerminalSidebar.svelte -- context menu support', () => {
  it('accepts oncontextmenu prop', () => {
    assert.ok(src.includes('oncontextmenu'), 'Should accept context menu callback');
  });
  it('calls preventDefault on right-click', () => {
    assert.ok(src.includes('preventDefault'), 'Should prevent default context menu');
  });
});

describe('TerminalSidebar.svelte -- accessibility', () => {
  it('has role=option on items', () => {
    assert.ok(src.includes('role="option"'), 'Should have option role');
  });
  it('has aria-selected', () => {
    assert.ok(src.includes('aria-selected'), 'Should indicate selected state');
  });
  it('has tabindex', () => {
    assert.ok(src.includes('tabindex="0"'), 'Should be focusable');
  });
});
