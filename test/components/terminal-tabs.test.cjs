const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalTabs.svelte -- imports', () => {
  it('imports AiTerminal component', () => {
    assert.ok(src.includes("import AiTerminal from"), 'Should import AiTerminal');
  });

  it('imports TerminalPanel component', () => {
    assert.ok(src.includes("import TerminalPanel from"), 'Should import TerminalPanel');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports OutputPanel component', () => {
    assert.ok(src.includes("import OutputPanel from"), 'Should import OutputPanel');
  });

  it('imports outputStore', () => {
    assert.ok(src.includes('outputStore'), 'Should import outputStore');
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

describe('TerminalTabs.svelte -- 3 pinned tabs', () => {
  it('has Voice Agent tab label', () => {
    assert.ok(src.includes('Voice Agent'), 'Should have Voice Agent tab');
  });

  it('has Output tab label', () => {
    assert.ok(src.includes('>Output<'), 'Should have Output tab');
  });

  it('has Terminal tab label', () => {
    assert.ok(src.includes('>Terminal<'), 'Should have Terminal tab');
  });

  it('has bottomPanelMode state', () => {
    assert.ok(src.includes('bottomPanelMode'), 'Should have bottomPanelMode');
  });

  it('supports ai mode', () => {
    assert.ok(src.includes("'ai'"), 'Should support ai mode');
  });

  it('supports output mode', () => {
    assert.ok(src.includes("'output'"), 'Should support output mode');
  });

  it('supports terminal mode', () => {
    assert.ok(src.includes("'terminal'"), 'Should support terminal mode');
  });

  it('has class:active directive on tabs', () => {
    assert.ok(src.includes('class:active='), 'Should have active class binding');
  });

  it('has tab dividers between tabs', () => {
    assert.ok(src.includes('tab-divider'), 'Should have tab dividers');
  });

  it('does NOT have individual terminal tab loop', () => {
    assert.ok(!src.includes("{#each terminalTabsStore.tabs.filter(t => t.type !== 'ai')"), 'Should NOT iterate shell tabs');
  });

  it('does NOT have tab-add button', () => {
    assert.ok(!src.includes('tab-add'), 'Should NOT have add button');
  });

  it('does NOT have tab-close button', () => {
    assert.ok(!src.includes('tab-close'), 'Should NOT have close button');
  });

  it('does NOT have drag-to-reorder', () => {
    assert.ok(!src.includes('handleTabMousedown'), 'Should NOT have drag handler');
    assert.ok(!src.includes('dragTabId'), 'Should NOT have drag state');
    assert.ok(!src.includes('drag-over'), 'Should NOT have drag-over class');
  });

  it('does NOT have inline rename', () => {
    assert.ok(!src.includes('editingTabId'), 'Should NOT have editingTabId');
    assert.ok(!src.includes('tab-rename-input'), 'Should NOT have rename input');
    assert.ok(!src.includes('startRename'), 'Should NOT have startRename');
    assert.ok(!src.includes('ondblclick'), 'Should NOT have double-click rename');
  });

  it('does NOT have handleAddTerminal', () => {
    assert.ok(!src.includes('handleAddTerminal'), 'Should NOT have handleAddTerminal');
  });

  it('does NOT have close confirmation dialog', () => {
    assert.ok(!src.includes('close-confirm-overlay'), 'Should NOT have close confirmation');
    assert.ok(!src.includes('closeConfirmVisible'), 'Should NOT have close confirm state');
  });
});

describe('TerminalTabs.svelte -- content area rendering', () => {
  it('renders AiTerminal component', () => {
    assert.ok(src.includes('<AiTerminal'), 'Should render AiTerminal component');
  });

  it('renders TerminalPanel component', () => {
    assert.ok(src.includes('<TerminalPanel'), 'Should render TerminalPanel component');
  });

  it('renders OutputPanel component', () => {
    assert.ok(src.includes('<OutputPanel'), 'Should render OutputPanel component');
  });

  it('hides AI panel when not in ai mode', () => {
    assert.ok(src.includes("class:hidden={bottomPanelMode !== 'ai'}"), 'Should hide AI panel based on mode');
  });

  it('conditionally renders Output panel', () => {
    assert.ok(src.includes("bottomPanelMode === 'output'"), 'Should check for output mode');
  });

  it('conditionally renders Terminal panel', () => {
    assert.ok(src.includes("bottomPanelMode === 'terminal'"), 'Should check for terminal mode');
  });
});

describe('TerminalTabs.svelte -- Voice Agent context menu', () => {
  it('has context-menu class', () => {
    assert.ok(src.includes('context-menu'), 'Should have context menu element');
  });

  it('has showContextMenu function', () => {
    assert.ok(src.includes('showContextMenu'), 'Should have showContextMenu');
  });

  it('triggers on right-click', () => {
    assert.ok(src.includes('oncontextmenu'), 'Should have contextmenu handler');
  });

  it('has contextClear function', () => {
    assert.ok(src.includes('contextClear'), 'Should have contextClear action');
  });

  it('closes on outside click', () => {
    assert.ok(src.includes('closeContextMenu'), 'Should close on outside click');
  });

  it('uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'), 'Context menu should be fixed positioned');
  });
});

describe('TerminalTabs.svelte -- provider switching context menu', () => {
  it('imports switchProvider from ai-status store', () => {
    assert.ok(src.includes('switchProvider'), 'Should import switchProvider');
  });

  it('imports stopProvider from ai-status store', () => {
    assert.ok(src.includes('stopProvider'), 'Should import stopProvider');
  });

  it('imports PROVIDER_GROUPS from providers.js', () => {
    assert.ok(src.includes('PROVIDER_GROUPS'), 'Should import PROVIDER_GROUPS');
  });

  it('imports PROVIDER_ICONS from providers.js', () => {
    assert.ok(src.includes('PROVIDER_ICONS'), 'Should import PROVIDER_ICONS');
  });

  it('imports PROVIDER_NAMES from providers.js', () => {
    assert.ok(src.includes('PROVIDER_NAMES'), 'Should import PROVIDER_NAMES');
  });

  it('imports updateConfig from config store', () => {
    assert.ok(src.includes('updateConfig'), 'Should import updateConfig');
  });

  it('has contextSwitchProvider function', () => {
    assert.ok(src.includes('contextSwitchProvider'), 'Should have contextSwitchProvider');
  });

  it('has contextStopProvider function', () => {
    assert.ok(src.includes('contextStopProvider'), 'Should have contextStopProvider');
  });

  it('shows provider section only for AI tab', () => {
    assert.ok(src.includes("contextMenu.tabId === 'ai'"), 'Should conditionally show provider section');
  });

  it('iterates PROVIDER_GROUPS in context menu', () => {
    assert.ok(src.includes('{#each PROVIDER_GROUPS as group}'), 'Should iterate provider groups');
  });

  it('renders provider icons', () => {
    assert.ok(src.includes('ctx-provider-icon'), 'Should have provider icon class');
  });

  it('shows checkmark for current provider', () => {
    assert.ok(src.includes('ctx-check'), 'Should have checkmark element');
  });

  it('shows starting state for current provider', () => {
    assert.ok(src.includes('aiStatusStore.starting'), 'Should check starting state');
    assert.ok(src.includes('Starting...'), 'Should show starting text');
  });

  it('has Stop Provider button when running', () => {
    assert.ok(src.includes('Stop Provider'), 'Should have Stop Provider action');
  });

  it('has group label styling', () => {
    assert.ok(src.includes('context-menu-group-label'), 'Should have group label class');
  });

  it('has wide context menu variant for AI tab', () => {
    assert.ok(src.includes('class:wide='), 'Should have wide class binding');
  });

  it('persists provider choice via updateConfig', () => {
    assert.ok(src.includes('updateConfig('), 'Should persist provider in config');
  });

  it('closes context menu before switching', () => {
    const fnStart = src.indexOf('async function contextSwitchProvider');
    const fnBody = src.slice(fnStart, fnStart + 300);
    assert.ok(fnBody.includes('closeContextMenu()'), 'Should close menu before async work');
  });

  it('shows toast on successful switch', () => {
    assert.ok(src.includes('Switched to'), 'Should show success toast with provider name');
  });

  it('skips switch when clicking current provider', () => {
    assert.ok(src.includes('aiStatusStore.providerType') && src.includes('closeContextMenu'), 'Should no-op on same provider');
  });
});

describe('TerminalTabs.svelte -- Output tab context menu', () => {
  it('has showOutputContextMenu function', () => {
    assert.ok(src.includes('showOutputContextMenu'), 'Should have showOutputContextMenu');
  });

  it('has Clear Output action', () => {
    assert.ok(src.includes('outputContextClear'), 'Should have clear output action');
  });

  it('has Copy All action', () => {
    assert.ok(src.includes('outputContextCopyAll'), 'Should have copy all action');
  });

  it('has Word Wrap toggle', () => {
    assert.ok(src.includes('outputContextToggleWrap'), 'Should have word wrap toggle');
  });

  it('has Scroll Lock toggle', () => {
    assert.ok(src.includes('outputContextToggleScrollLock'), 'Should have scroll lock toggle');
  });
});

describe('TerminalTabs.svelte -- toolbar', () => {
  it('shows output controls when in output mode', () => {
    assert.ok(src.includes("bottomPanelMode === 'output'"), 'Should check for output mode in toolbar');
  });

  it('shows AI controls when in ai mode', () => {
    assert.ok(src.includes("bottomPanelMode === 'ai'"), 'Should check for ai mode in toolbar');
  });

  it('has output filter input', () => {
    assert.ok(src.includes('output-filter-input'), 'Should have filter input');
  });

  it('has channel dropdown', () => {
    assert.ok(src.includes('channel-dropdown-trigger'), 'Should have channel dropdown');
  });

  it('has voice button for AI mode', () => {
    assert.ok(src.includes('voice-btn'), 'Should have voice button');
  });

  it('has clear, copy, paste buttons for AI mode', () => {
    assert.ok(src.includes('handleClear'), 'Should have clear handler');
    assert.ok(src.includes('handleCopy'), 'Should have copy handler');
    assert.ok(src.includes('handlePaste'), 'Should have paste handler');
  });
});

describe('TerminalTabs.svelte -- keyboard cycling', () => {
  it('listens for Ctrl+Tab', () => {
    assert.ok(src.includes("e.key === 'Tab'"), 'Should listen for Tab key');
  });

  it('checks ctrlKey modifier', () => {
    assert.ok(src.includes('e.ctrlKey'), 'Should check ctrlKey');
  });

  it('cycles through panelOrder', () => {
    assert.ok(src.includes('panelOrder'), 'Should use panelOrder array');
  });

  it('uses capture phase for global keydown', () => {
    assert.ok(src.includes("'keydown', handleKeydown, true"), 'Should use capture phase');
  });

  it('uses onMount for keyboard listener', () => {
    assert.ok(src.includes("import { onMount } from 'svelte'"), 'Should import onMount');
  });
});

describe('TerminalTabs.svelte -- CSS', () => {
  it('hides inactive panels with display none', () => {
    assert.ok(src.includes('display: none'), 'Should hide inactive panels');
  });

  it('uses position absolute for panels', () => {
    assert.ok(src.includes('position: absolute'), 'Should use absolute positioning');
  });

  it('has terminal-panel-container style', () => {
    assert.ok(src.includes('terminal-panel-container'), 'Should have terminal panel container');
  });
});
