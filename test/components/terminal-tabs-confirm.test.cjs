/**
 * terminal-tabs-confirm.test.cjs -- Source-inspection tests for TerminalTabs
 * close confirmation dialog for dev-server tabs.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalTabs.svelte -- dev-server close confirmation', () => {
  it('imports devServerManager from dev-server-manager store', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
    assert.ok(src.includes('dev-server-manager.svelte.js'), 'Should import from correct store');
  });

  it('has closeConfirm reactive state', () => {
    assert.ok(/let\s+closeConfirm\s*=\s*\$state/.test(src), 'Should have closeConfirm $state');
  });

  it('closeConfirm has visible, tabId, and tab fields', () => {
    assert.ok(src.includes('visible: false'), 'Should init with visible: false');
    assert.ok(src.includes('tabId: null'), 'Should init with tabId: null');
    assert.ok(src.includes('tab: null'), 'Should init with tab: null');
  });

  it('has requestCloseTab function', () => {
    assert.ok(src.includes('function requestCloseTab(tabId)'), 'Should have requestCloseTab');
  });

  it('checks for dev-server type before showing confirmation', () => {
    assert.ok(src.includes("tab.type === 'dev-server'"), 'Should check dev-server type');
  });

  it('checks tab.running before showing confirmation', () => {
    const fnBlock = src.split('function requestCloseTab')[1]?.split('function ')[0] || '';
    assert.ok(fnBlock.includes('tab.running'), 'Should check if tab is running');
  });

  it('has confirmStopAndClose function', () => {
    assert.ok(src.includes('confirmStopAndClose'), 'Should have confirmStopAndClose');
  });

  it('calls devServerManager.stopServer in confirmStopAndClose', () => {
    assert.ok(src.includes('devServerManager.stopServer(tab.projectPath)'), 'Should stop via devServerManager');
  });

  it('confirmStopAndClose verifies tab still exists in store', () => {
    const fnBlock = src.split('function confirmStopAndClose')[1]?.split('\n  function ')[0] || '';
    assert.ok(fnBlock.includes('terminalTabsStore.tabs.find(t => t.id === tab.id)'), 'Should verify tab exists');
  });

  it('confirmStopAndClose returns early if tab no longer in store', () => {
    const fnBlock = src.split('function confirmStopAndClose')[1]?.split('\n  function ')[0] || '';
    assert.ok(fnBlock.includes('if (!current)'), 'Should check if current tab still exists');
  });

  it('has confirmHideTab function', () => {
    assert.ok(src.includes('confirmHideTab'), 'Should have confirmHideTab');
  });

  it('calls terminalTabsStore.hideTab in confirmHideTab', () => {
    assert.ok(src.includes('terminalTabsStore.hideTab(tab.id)'), 'Should hide tab via store');
  });

  it('has cancelCloseConfirm function', () => {
    assert.ok(src.includes('cancelCloseConfirm'), 'Should have cancelCloseConfirm');
  });

  it('uses requestCloseTab for X button close', () => {
    assert.ok(src.includes('requestCloseTab(tab.id)'), 'Should use requestCloseTab for close button');
  });

  it('uses requestCloseTab in context menu close', () => {
    const contextCloseFn = src.split('function contextClose')[1]?.split('function ')[0] || '';
    assert.ok(contextCloseFn.includes('requestCloseTab'), 'Context menu close should use requestCloseTab');
  });

  it('shows close button for dev-server tabs', () => {
    assert.ok(src.includes("tab.type === 'dev-server'"), 'Should show close for dev-server tabs');
  });
});

describe('TerminalTabs.svelte -- confirmation dialog markup', () => {
  it('has close-confirm-overlay class', () => {
    assert.ok(src.includes('close-confirm-overlay'), 'Should have overlay');
  });

  it('has close-confirm-dialog class', () => {
    assert.ok(src.includes('close-confirm-dialog'), 'Should have dialog');
  });

  it('shows dialog title "Dev server running"', () => {
    assert.ok(src.includes('Dev server running'), 'Should show dialog title');
  });

  it('shows server info in dialog message', () => {
    assert.ok(src.includes('closeConfirm.tab?.framework'), 'Should show framework');
    assert.ok(src.includes('closeConfirm.tab?.port'), 'Should show port');
  });

  it('has Stop Server button in dialog', () => {
    assert.ok(src.includes('Stop Server'), 'Should have Stop Server button');
  });

  it('has Hide Tab button in dialog', () => {
    assert.ok(src.includes('Hide Tab'), 'Should have Hide Tab button');
  });

  it('has Cancel button in dialog', () => {
    assert.ok(src.includes('cancelCloseConfirm'), 'Should have Cancel action');
  });

  it('conditionally renders dialog based on closeConfirm.visible', () => {
    assert.ok(src.includes('{#if closeConfirm.visible}'), 'Should conditionally render dialog');
  });

  it('has Escape key handler on overlay to dismiss dialog', () => {
    assert.ok(src.includes("if (e.key === 'Escape') cancelCloseConfirm()"), 'Should dismiss on Escape key');
  });

  it('dialog has role="alertdialog" for accessibility', () => {
    assert.ok(src.includes('role="alertdialog"'), 'Should have alertdialog role');
  });

  it('dialog has aria-modal="true"', () => {
    assert.ok(src.includes('aria-modal="true"'), 'Should have aria-modal');
  });

  it('dialog buttons have aria-labels', () => {
    assert.ok(src.includes('aria-label="Stop server and close tab"'), 'Stop button should have aria-label');
    assert.ok(src.includes('aria-label="Hide tab but keep server running"'), 'Hide button should have aria-label');
    assert.ok(src.includes('aria-label="Cancel closing"'), 'Cancel button should have aria-label');
  });

  it('Cancel button has autofocus action', () => {
    // The cancel button should get focus when dialog opens
    const dialogBlock = src.split('close-confirm-actions')[1]?.split('</div>')[0] || '';
    assert.ok(dialogBlock.includes('use:autofocus'), 'Cancel button should be auto-focused');
  });
});

describe('TerminalTabs.svelte -- dev-server terminal rendering', () => {
  it('renders dev-server tabs in terminal panels', () => {
    assert.ok(src.includes("t.type === 'dev-server'"), 'Should filter dev-server tabs for rendering');
  });

  it('uses ShellTerminal for dev-server tabs', () => {
    // dev-server tabs are rendered alongside shell tabs using ShellTerminal
    const panelBlock = src.split('terminal-panels')[1] || '';
    assert.ok(panelBlock.includes('ShellTerminal'), 'Should use ShellTerminal for dev-server tabs');
  });
});

describe('TerminalTabs.svelte -- close confirmation dialog styling', () => {
  it('has overlay with semi-transparent background', () => {
    assert.ok(src.includes('rgba(0, 0, 0, 0.5)'), 'Should have semi-transparent overlay');
  });

  it('dialog uses theme variables', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated');
    assert.ok(src.includes('var(--text)'), 'Should use --text');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted');
  });

  it('Stop button has danger styling', () => {
    assert.ok(src.includes('.close-confirm-btn.stop'), 'Should have stop button class');
    assert.ok(src.includes('var(--danger'), 'Should use --danger color');
  });

  it('Hide button has accent styling', () => {
    assert.ok(src.includes('.close-confirm-btn.hide'), 'Should have hide button class');
    assert.ok(src.includes('var(--accent)'), 'Should use --accent color');
  });

  it('has no-drag on dialog buttons', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag');
  });
});
