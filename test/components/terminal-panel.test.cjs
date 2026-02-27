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
  it('imports TerminalSidebar', () => {
    assert.ok(src.includes("import TerminalSidebar from './TerminalSidebar.svelte'"), 'Should import TerminalSidebar');
  });
  it('imports TerminalContextMenu', () => {
    assert.ok(src.includes("import TerminalContextMenu from './TerminalContextMenu.svelte'"), 'Should import TerminalContextMenu');
  });
  it('imports setActionHandler from shortcuts store', () => {
    assert.ok(src.includes('setActionHandler'), 'Should import setActionHandler');
  });
});

describe('TerminalPanel.svelte -- uses sub-components', () => {
  it('renders TerminalSidebar', () => {
    assert.ok(src.includes('<TerminalSidebar'), 'Should use TerminalSidebar component');
  });
  it('renders TerminalContextMenu', () => {
    assert.ok(src.includes('<TerminalContextMenu'), 'Should use TerminalContextMenu component');
  });
  it('does NOT render TerminalTabStrip (moved to outer strip)', () => {
    assert.ok(!src.includes('<TerminalTabStrip'), 'TerminalTabStrip moved to TerminalTabs outer strip');
  });
  it('does NOT render TerminalActionBar (moved to outer strip)', () => {
    assert.ok(!src.includes('<TerminalActionBar'), 'TerminalActionBar moved to TerminalTabs outer strip');
  });
});

describe('TerminalPanel.svelte -- structure', () => {
  it('has terminal-panel-inner container', () => {
    assert.ok(src.includes('terminal-panel-inner'), 'Should have inner container');
  });
  it('has terminal-body', () => {
    assert.ok(src.includes('terminal-body'), 'Should have body');
  });
  it('has terminal-content area', () => {
    assert.ok(src.includes('terminal-content'), 'Should have content');
  });
  it('shows sidebar conditionally', () => {
    assert.ok(src.includes('showSidebar'), 'Should conditionally show sidebar');
  });
  it('no inner header strip (managed by outer TerminalTabs)', () => {
    assert.ok(!src.includes('terminal-header'), 'Should NOT have inner header strip');
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

describe('TerminalPanel.svelte -- context menu wiring', () => {
  it('has context menu state', () => {
    assert.ok(src.includes('ctxMenu'), 'Should have context menu state');
  });
  it('passes oncontextmenu to TerminalSidebar', () => {
    assert.ok(src.includes('TerminalSidebar') && src.includes('oncontextmenu'), 'Should wire sidebar context menu');
  });
  it('passes props to TerminalContextMenu', () => {
    assert.ok(src.includes('instanceId={ctxMenu.instanceId}'), 'Should pass instanceId');
    assert.ok(src.includes('visible={ctxMenu.visible}'), 'Should pass visible');
    assert.ok(src.includes('onClose={closeContextMenu}'), 'Should pass onClose');
  });
});

describe('TerminalPanel.svelte -- auto-spawn', () => {
  it('auto-spawns on mount if no groups', () => {
    assert.ok(src.includes('onMount') || src.includes('$effect'), 'Should auto-spawn');
    assert.ok(src.includes('addGroup'), 'Should call addGroup');
  });
});

describe('TerminalPanel.svelte -- keyboard shortcut handlers', () => {
  it('registers new-terminal handler', () => {
    assert.ok(src.includes("'new-terminal'"), 'Should register new-terminal handler');
  });
  it('registers split-terminal handler', () => {
    assert.ok(src.includes("'split-terminal'"), 'Should register split-terminal handler');
  });
  it('registers focus-prev-pane handler', () => {
    assert.ok(src.includes("'focus-prev-pane'"), 'Should register focus-prev-pane handler');
  });
  it('registers focus-next-pane handler', () => {
    assert.ok(src.includes("'focus-next-pane'"), 'Should register focus-next-pane handler');
  });
  it('unregisters handlers on cleanup with null', () => {
    const nullCalls = src.match(/setActionHandler\([^)]+,\s*null\)/g);
    assert.ok(nullCalls && nullCalls.length >= 4, 'Should unregister at least 4 handlers with null');
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
