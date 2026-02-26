const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabStrip.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalTabStrip.svelte -- imports', () => {
  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import store');
  });
  it('imports from terminal-tabs.svelte.js', () => {
    assert.ok(src.includes('terminal-tabs.svelte.js'), 'Should import from correct store file');
  });
});

describe('TerminalTabStrip.svelte -- structure', () => {
  it('has tab-strip container', () => {
    assert.ok(src.includes('tab-strip'), 'Should have tab-strip class');
  });
  it('has role=tablist', () => {
    assert.ok(src.includes('role="tablist"'), 'Should have tablist role');
  });
  it('iterates groups', () => {
    assert.ok(src.includes('{#each') && src.includes('groups'), 'Should iterate groups');
  });
  it('has group-tab class', () => {
    assert.ok(src.includes('group-tab'), 'Should have group-tab class');
  });
});

describe('TerminalTabStrip.svelte -- active highlighting', () => {
  it('has class:active binding', () => {
    assert.ok(src.includes('class:active'), 'Should highlight active group');
  });
  it('compares to activeGroupId', () => {
    assert.ok(src.includes('activeGroupId'), 'Should compare against activeGroupId');
  });
});

describe('TerminalTabStrip.svelte -- click behavior', () => {
  it('calls setActiveGroup on click', () => {
    assert.ok(src.includes('setActiveGroup'), 'Should switch group on click');
  });
  it('has keyboard handler', () => {
    assert.ok(src.includes('onkeydown'), 'Should handle keyboard events');
  });
});

describe('TerminalTabStrip.svelte -- split badge', () => {
  it('shows split badge for multi-instance groups', () => {
    assert.ok(src.includes('split-badge'), 'Should have split badge class');
  });
  it('checks instanceIds.length > 1', () => {
    assert.ok(src.includes('instanceIds.length > 1'), 'Should check for multiple instances');
  });
});

describe('TerminalTabStrip.svelte -- first instance title', () => {
  it('gets first instance via getInstance', () => {
    assert.ok(src.includes('getInstance'), 'Should get first instance');
  });
  it('shows instance title with fallback', () => {
    assert.ok(src.includes("'Terminal'") || src.includes('"Terminal"'), 'Should have Terminal fallback');
  });
});

describe('TerminalTabStrip.svelte -- accessibility', () => {
  it('has role=tab on items', () => {
    assert.ok(src.includes('role="tab"'), 'Should have tab role');
  });
  it('has aria-selected', () => {
    assert.ok(src.includes('aria-selected'), 'Should indicate selected state');
  });
  it('has tabindex', () => {
    assert.ok(src.includes('tabindex="0"'), 'Should be focusable');
  });
});

describe('TerminalTabStrip.svelte -- context menu support', () => {
  it('accepts oncontextmenu prop', () => {
    assert.ok(src.includes('oncontextmenu'), 'Should accept context menu callback');
  });
});
