/**
 * status-dropdown.test.cjs -- Source-inspection tests for StatusDropdown.svelte
 *
 * OpenCode-style status popover with Servers/MCP/LSP tabs.
 * Lives in the FileTree header (right panel, pure DOM — no HWND overlap).
 * Includes "Manage servers" dialog modal.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/StatusDropdown.svelte'),
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
  it('imports lensStore for freeze/unfreeze', () => {
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
  it('has high z-index for popover', () => {
    assert.ok(src.includes('z-index: 10002'));
  });
  it('has dialog role', () => {
    assert.ok(src.includes('role="dialog"'));
  });
  it('has outside click handler', () => {
    assert.ok(src.includes('handleWindowClick'));
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
    assert.ok(src.includes('providerName'));
  });
  it('shows provider type as version', () => {
    assert.ok(src.includes('providerType'));
  });
  it('has checkmark for connected server', () => {
    assert.ok(src.includes('row-check'));
    assert.ok(src.includes('polyline'));
  });
  it('shows dev server entry', () => {
    assert.ok(src.includes('Dev Server'));
  });
  it('has status rows with dot indicators', () => {
    assert.ok(src.includes('status-row'));
    assert.ok(src.includes('row-dot'));
  });
  it('has Manage servers button', () => {
    assert.ok(src.includes('manage-btn'));
    assert.ok(src.includes('Manage servers'));
  });
});

describe('StatusDropdown.svelte: MCP tab content', () => {
  it('shows voice-mirror MCP entry for CLI providers', () => {
    assert.ok(src.includes('voice-mirror'));
  });
  it('shows tool count', () => {
    assert.ok(src.includes('55 tools'));
  });
  it('has toggle switch for MCP', () => {
    assert.ok(src.includes('row-toggle'));
    assert.ok(src.includes('toggle-track'));
    assert.ok(src.includes('toggle-thumb'));
  });
  it('shows empty state for non-CLI providers', () => {
    assert.ok(src.includes('No MCP tools configured'));
  });
});

describe('StatusDropdown.svelte: LSP tab content', () => {
  it('shows auto-detected LSP message', () => {
    assert.ok(src.includes('Auto-detected from open file types'));
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

describe('StatusDropdown.svelte: Manage Servers dialog', () => {
  it('has dialogOpen state', () => {
    assert.ok(/let\s+dialogOpen\s*=\s*\$state/.test(src));
  });
  it('has dialogEl element ref', () => {
    assert.ok(src.includes('bind:this={dialogEl}'));
  });
  it('has searchQuery state', () => {
    assert.ok(/let\s+searchQuery\s*=\s*\$state/.test(src));
  });
  it('has openDialog function', () => {
    assert.ok(src.includes('function openDialog()'));
  });
  it('has closeDialog function', () => {
    assert.ok(src.includes('function closeDialog()'));
  });
  it('freezes lens on dialog open', () => {
    const openFn = src.slice(src.indexOf('function openDialog'), src.indexOf('function closeDialog'));
    assert.ok(openFn.includes('lensStore.freeze()'));
  });
  it('unfreezes lens on dialog close', () => {
    const closeFn = src.slice(src.indexOf('function closeDialog'), src.indexOf('function handleWindowClick'));
    assert.ok(closeFn.includes('lensStore.unfreeze()'));
  });
  it('uses portal action to escape overflow ancestors', () => {
    assert.ok(src.includes('function portal(node)'), 'Should define portal action');
    assert.ok(src.includes('document.body.appendChild(node)'), 'Should append to body');
    assert.ok(src.includes('use:portal'), 'Should apply portal to dialog backdrop');
  });
  it('has dialog backdrop', () => {
    assert.ok(src.includes('dialog-backdrop'));
  });
  it('has dialog panel', () => {
    assert.ok(src.includes('dialog-panel'));
  });
  it('has aria-modal for dialog', () => {
    assert.ok(src.includes('aria-modal="true"'));
  });
  it('has dialog title "Servers"', () => {
    assert.ok(src.includes('dialog-title'));
    assert.ok(src.includes('>Servers</h2>'));
  });
  it('has dialog close button', () => {
    assert.ok(src.includes('dialog-close'));
  });
  it('has search input', () => {
    assert.ok(src.includes('dialog-search'));
    assert.ok(src.includes('Search servers'));
    assert.ok(src.includes('bind:value={searchQuery}'));
  });
  it('has dialog server list', () => {
    assert.ok(src.includes('dialog-list'));
    assert.ok(src.includes('dialog-row'));
  });
  it('shows provider in dialog', () => {
    assert.ok(src.includes('dialog-row-name'));
    assert.ok(src.includes('dialog-row-version'));
  });
  it('has Current Server badge', () => {
    assert.ok(src.includes('dialog-row-badge'));
    assert.ok(src.includes('Current Server'));
  });
  it('shows dev server in dialog with localhost', () => {
    assert.ok(src.includes('Dev Server (Vite)'));
    assert.ok(src.includes('localhost:1420'));
  });
  it('has server options menu button', () => {
    assert.ok(src.includes('dialog-row-menu'));
    assert.ok(src.includes('Server options'));
  });
  it('has Add server button', () => {
    assert.ok(src.includes('dialog-add'));
    assert.ok(src.includes('Add server'));
  });
  it('has high z-index for dialog backdrop', () => {
    assert.ok(src.includes('z-index: 20000'));
  });
  it('has 560px dialog panel width', () => {
    assert.ok(src.includes('width: 560px'));
  });
  it('dialog backdrop uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'));
  });
  it('Escape closes dialog', () => {
    const keydown = src.slice(src.indexOf('function handleKeydown'), src.indexOf('</script>'));
    assert.ok(keydown.includes('dialogOpen'));
    assert.ok(keydown.includes('closeDialog'));
  });
  it('outside click on dialog backdrop closes dialog', () => {
    const clickHandler = src.slice(src.indexOf('function handleWindowClick'), src.indexOf('function handleKeydown'));
    assert.ok(clickHandler.includes('dialogOpen'));
    assert.ok(clickHandler.includes('closeDialog'));
  });
});
