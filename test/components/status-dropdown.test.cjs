/**
 * status-dropdown.test.cjs -- Source-inspection tests for StatusDropdown.svelte
 *
 * OpenCode-style status popover with Servers/MCP/LSP tabs.
 * Lives in the FileTree header (right panel, pure DOM — no HWND overlap).
 * Includes inline "Manage servers" view that expands the popover.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/StatusDropdown.svelte'),
  'utf-8'
);
const serversSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/ServersTab.svelte'),
  'utf-8'
);
const mcpSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/McpTab.svelte'),
  'utf-8'
);
const lspSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LspTab.svelte'),
  'utf-8'
);

describe('StatusDropdown.svelte: badge trigger', () => {
  it('has status badge button', () => {
    assert.ok(src.includes('status-badge'));
  });
  it('has aria-expanded for accessibility', () => {
    assert.ok(src.includes('aria-expanded'));
  });
  it('has aria-haspopup for accessibility', () => {
    assert.ok(src.includes('aria-haspopup'));
  });
  it('has status dot indicator', () => {
    assert.ok(src.includes('status-dot'));
  });
  it('has ok/starting/stopped states on dot', () => {
    assert.ok(src.includes('class:ok={healthy}'));
    assert.ok(src.includes('class:starting'));
    assert.ok(src.includes('class:stopped'));
  });
  it('matches tab styling (no border, transparent bg)', () => {
    assert.ok(src.includes('border: none'));
    assert.ok(src.includes('background: transparent'));
  });
  it('has badge element ref for outside click', () => {
    assert.ok(src.includes('bind:this={badgeEl}'));
  });
  it('has active class when open', () => {
    assert.ok(src.includes('class:active={open}'));
  });
  it('toggles open state', () => {
    assert.ok(/let\s+open\s*=\s*\$state/.test(src));
  });
});

describe('StatusDropdown.svelte: reactive data', () => {
  it('imports aiStatusStore', () => {
    assert.ok(src.includes('aiStatusStore'));
    assert.ok(src.includes('ai-status.svelte.js'));
  });
  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'));
    assert.ok(src.includes('lens.svelte.js'));
  });
  it('derives healthy from aiStatusStore.running', () => {
    assert.ok(src.includes('aiStatusStore.running'));
  });
  it('derives server count', () => {
    assert.ok(src.includes('serverCount'));
  });
  it('derives provider name from displayName', () => {
    assert.ok(src.includes('aiStatusStore.displayName'));
  });
  it('detects CLI vs API provider type', () => {
    assert.ok(src.includes('aiStatusStore.isCliProvider'));
    assert.ok(src.includes('aiStatusStore.isApiProvider'));
  });
  it('derives MCP connected status', () => {
    assert.ok(src.includes('mcpConnected'));
  });
});

describe('StatusDropdown.svelte: popover panel', () => {
  it('has popover container', () => {
    assert.ok(src.includes('status-popover'));
  });
  it('has panel element ref', () => {
    assert.ok(src.includes('bind:this={panelEl}'));
  });
  it('has 320px width', () => {
    assert.ok(src.includes('width: 320px'));
  });
  it('uses position: fixed to escape overflow clipping', () => {
    assert.ok(src.includes('position: fixed'));
  });
  it('calculates position from badge bounding rect', () => {
    assert.ok(src.includes('getBoundingClientRect'));
    assert.ok(src.includes('updatePopoverPosition'));
  });
  it('has high z-index for popover', () => {
    assert.ok(src.includes('z-index: 10002'));
  });
  it('has dialog role', () => {
    assert.ok(src.includes('role="dialog"'));
  });
  it('has outside click handler', () => {
    assert.ok(src.includes('handleWindowClick'));
  });
  it('guards against detached targets in outside click', () => {
    assert.ok(src.includes('e.target.isConnected'));
  });
  it('uses margin-left auto for right alignment', () => {
    assert.ok(src.includes('margin-left: auto'));
  });
});

describe('StatusDropdown.svelte: tabs (OpenCode layout)', () => {
  it('has tablist role', () => {
    assert.ok(src.includes('role="tablist"'));
  });
  it('has tab roles', () => {
    assert.ok(src.includes('role="tab"'));
  });
  it('has tabpanel role', () => {
    assert.ok(src.includes('role="tabpanel"'));
  });
  it('has aria-selected on tabs', () => {
    assert.ok(src.includes('aria-selected'));
  });
  it('tracks active tab', () => {
    assert.ok(/let\s+activeTab\s*=\s*\$state/.test(src));
  });
  it('defaults to servers tab', () => {
    assert.ok(src.includes("activeTab === 'servers'"));
  });
  it('has Servers tab with count', () => {
    assert.ok(src.includes("'servers'"));
    assert.ok(src.includes('serverCount'));
    assert.ok(src.includes('Servers'));
  });
  it('has MCP tab with count', () => {
    assert.ok(src.includes("'mcp'"));
    assert.ok(src.includes('MCP'));
    assert.ok(src.includes('mcpConnected'));
  });
  it('has LSP tab', () => {
    assert.ok(src.includes("'lsp'"));
    assert.ok(src.includes('LSP'));
  });
});

describe('StatusDropdown.svelte: servers tab content', () => {
  it('shows provider name', () => {
    assert.ok(serversSrc.includes('providerName'));
  });
  it('shows provider type as version', () => {
    assert.ok(serversSrc.includes('providerType'));
  });
  it('has checkmark for connected server', () => {
    assert.ok(serversSrc.includes('row-check'));
    assert.ok(serversSrc.includes('polyline'));
  });
  it('shows dev server entry', () => {
    assert.ok(serversSrc.includes('Dev Server'));
  });
  it('has status rows with dot indicators', () => {
    assert.ok(serversSrc.includes('status-row'));
    assert.ok(serversSrc.includes('row-dot'));
  });
  it('has Manage servers button', () => {
    assert.ok(serversSrc.includes('manage-btn'));
    assert.ok(serversSrc.includes('Manage servers'));
  });
  it('imports ServersTab in StatusDropdown', () => {
    assert.ok(src.includes("import ServersTab from './ServersTab.svelte'"));
  });
});

describe('StatusDropdown.svelte: MCP tab content', () => {
  it('shows voice-mirror MCP entry for CLI providers', () => {
    assert.ok(mcpSrc.includes('voice-mirror'));
  });
  it('shows tool count', () => {
    assert.ok(mcpSrc.includes('55 tools'));
  });
  it('has toggle switch for MCP', () => {
    assert.ok(mcpSrc.includes('row-toggle'));
    assert.ok(mcpSrc.includes('toggle-track'));
    assert.ok(mcpSrc.includes('toggle-thumb'));
  });
  it('toggle has cursor: default (non-interactive, auto-managed)', () => {
    assert.ok(mcpSrc.includes('cursor: default'), 'Toggle should have cursor: default');
  });
  it('toggle has title tooltip explaining auto-management', () => {
    assert.ok(mcpSrc.includes('title="Auto-managed by provider"'), 'Toggle should have explanatory tooltip');
  });
  it('uses --muted for stopped dot (not --danger)', () => {
    assert.ok(mcpSrc.includes('.row-dot.stopped { background: var(--muted)'), 'MCP stopped dot should be muted gray');
  });
  it('shows empty state for non-CLI providers', () => {
    assert.ok(mcpSrc.includes('No MCP tools configured'));
  });
  it('imports McpTab in StatusDropdown', () => {
    assert.ok(src.includes("import McpTab from './McpTab.svelte'"));
  });
});

describe('StatusDropdown.svelte: LSP tab content', () => {
  it('shows auto-detected LSP message', () => {
    assert.ok(lspSrc.includes('Auto-detected from open file types'));
  });
  it('imports LspTab in StatusDropdown', () => {
    assert.ok(src.includes("import LspTab from './LspTab.svelte'"));
  });
});

describe('StatusDropdown.svelte: OpenCode-style styling', () => {
  it('has rounded popover panel', () => {
    assert.ok(src.includes('border-radius: 10px'));
  });
  it('has inner content background', () => {
    assert.ok(src.includes('popover-content'));
  });
  it('has dot pulse animation for starting state', () => {
    assert.ok(src.includes('dot-pulse'));
    assert.ok(src.includes('@keyframes dot-pulse'));
  });
});

describe('StatusDropdown.svelte: inline manage view', () => {
  it('has managing state', () => {
    assert.ok(/let\s+managing\s*=\s*\$state/.test(src));
  });
  it('has searchQuery state', () => {
    assert.ok(/let\s+searchQuery\s*=\s*\$state/.test(src));
  });
  it('has openManage function', () => {
    assert.ok(src.includes('function openManage()'));
  });
  it('has closeManage function', () => {
    assert.ok(src.includes('function closeManage()'));
  });
  it('widens popover when managing (class:wide)', () => {
    assert.ok(src.includes('class:wide={managing}'));
    assert.ok(src.includes('width: 380px'));
  });
  it('toggles between managing and tabs view', () => {
    assert.ok(src.includes('{#if managing}'));
  });
  it('Escape key closes manage view first', () => {
    assert.ok(src.includes('if (managing) closeManage()'));
  });
  it('close() resets managing and searchQuery', () => {
    assert.ok(src.includes('managing = false'));
    assert.ok(src.includes("searchQuery = ''"));
  });
});

describe('StatusDropdown.svelte: manage header', () => {
  it('has manage header', () => {
    assert.ok(src.includes('manage-header'));
  });
  it('has back button with aria-label', () => {
    assert.ok(src.includes('manage-back'));
    assert.ok(src.includes('aria-label="Back"'));
  });
  it('has Servers title', () => {
    assert.ok(src.includes('manage-title'));
    assert.ok(src.includes('>Servers</h3>'));
  });
  it('has close button', () => {
    assert.ok(src.includes('manage-close-btn'));
    assert.ok(src.includes('aria-label="Close"'));
  });
});

describe('StatusDropdown.svelte: manage search', () => {
  it('has search container', () => {
    assert.ok(src.includes('manage-search'));
  });
  it('has search input with placeholder', () => {
    assert.ok(src.includes('Search servers'));
    assert.ok(src.includes('bind:value={searchQuery}'));
  });
  it('has filteredServers derived that filters by searchQuery', () => {
    assert.ok(src.includes('filteredServers'), 'Should have filteredServers');
    assert.ok(src.includes('searchQuery'), 'Should use searchQuery for filtering');
  });
  it('filters by framework name (case-insensitive)', () => {
    assert.ok(src.includes("(s.framework || '').toLowerCase().includes(searchQuery.toLowerCase())"), 'Should filter by framework');
  });
  it('filters by port number', () => {
    assert.ok(src.includes('String(s.port).includes(searchQuery)'), 'Should filter by port');
  });
  it('uses filteredServers in each loop', () => {
    assert.ok(src.includes('{#each filteredServers as server}'), 'Should iterate filteredServers, not devServers');
  });
});

describe('StatusDropdown.svelte: manage server list', () => {
  it('has manage list container', () => {
    assert.ok(src.includes('manage-list'));
  });
  it('has manage rows', () => {
    assert.ok(src.includes('manage-row'));
  });
  it('shows provider name and type', () => {
    assert.ok(src.includes('manage-row-name'));
    assert.ok(src.includes('manage-row-version'));
  });
  it('has Current Server badge', () => {
    assert.ok(src.includes('manage-row-badge'));
    assert.ok(src.includes('Current Server'));
  });
  it('shows dev servers from lensStore with localhost port', () => {
    assert.ok(src.includes('server.framework'));
    assert.ok(src.includes('server.port'));
  });
  it('does not have noop server options menu button', () => {
    assert.ok(!src.includes('manage-row-menu'), 'Noop menu button should be removed');
    assert.ok(!src.includes('Server options'), 'Server options aria-label should be removed');
  });
  it('has Add server button', () => {
    assert.ok(src.includes('manage-add'));
    assert.ok(src.includes('Add server'));
  });
});

describe('StatusDropdown.svelte: row-dot stopped color consistency', () => {
  it('uses --muted for stopped dot (not --danger)', () => {
    // .row-dot.stopped should use var(--muted), consistent with ServersTab
    assert.ok(src.includes('.row-dot.stopped { background: var(--muted)'), 'Stopped dot should be muted gray, not danger red');
    assert.ok(!src.includes('.row-dot.stopped { background: var(--danger)'), 'Stopped dot should NOT use --danger');
  });
});

describe('StatusDropdown.svelte: crash recovery UI', () => {
  it('imports devServerManager', () => {
    assert.ok(src.includes('devServerManager'));
    assert.ok(src.includes('dev-server-manager.svelte.js'));
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'));
    assert.ok(src.includes('terminal-tabs.svelte.js'));
  });

  it('checks crashedServers from devServerManager', () => {
    assert.ok(src.includes('devServerManager.crashedServers'));
  });

  it('shows Crashed badge for crashed servers', () => {
    assert.ok(src.includes('crashed-badge'));
    assert.ok(src.includes('Crashed'));
  });

  it('has Restart button for crashed (non-looping) servers', () => {
    assert.ok(src.includes('manage-restart-btn'));
    assert.ok(src.includes('Restart'));
  });

  it('calls devServerManager.restartServer on restart click', () => {
    assert.ok(src.includes('devServerManager.restartServer'));
  });

  it('shows crash loop warning text when crash-looped', () => {
    assert.ok(src.includes('crash-loop-text'));
    assert.ok(src.includes('Crash loop'));
    assert.ok(src.includes('check terminal'));
  });

  it('checks crashLoopDetected flag', () => {
    assert.ok(src.includes('crashLoopDetected'));
  });

  it('has Show Terminal button for hidden tabs', () => {
    assert.ok(src.includes('manage-show-terminal-btn'));
    assert.ok(src.includes('Show Terminal'));
  });

  it('calls terminalTabsStore.unhideTab on Show Terminal click', () => {
    assert.ok(src.includes('terminalTabsStore.unhideTab'));
  });

  it('checks hiddenTabs for hidden terminal tabs', () => {
    assert.ok(src.includes('terminalTabsStore.hiddenTabs'));
  });

  it('has crashed CSS class on row dot', () => {
    assert.ok(src.includes('class:crashed'));
    assert.ok(src.includes('.row-dot.crashed'));
  });
});
