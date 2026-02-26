/**
 * terminal-tabs-confirm.test.cjs -- Source-inspection tests for TerminalTabs
 * pinned tab structure and TerminalPanel placeholder.
 *
 * (Replaces the old dev-server close confirmation tests -- that functionality
 * will move inside TerminalPanel in a later task.)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

const PANEL_PATH = path.join(__dirname, '../../src/components/terminal/TerminalPanel.svelte');
const panelSrc = fs.readFileSync(PANEL_PATH, 'utf-8');

describe('TerminalTabs.svelte -- pinned tab strip (no individual tabs)', () => {
  it('imports devServerManager store (kept for future use)', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
    assert.ok(src.includes('dev-server-manager.svelte.js'), 'Should import from correct store');
  });

  it('does NOT have requestCloseTab function', () => {
    assert.ok(!src.includes('function requestCloseTab'), 'Should NOT have requestCloseTab');
  });

  it('does NOT have confirmStopAndClose function', () => {
    assert.ok(!src.includes('confirmStopAndClose'), 'Should NOT have confirmStopAndClose');
  });

  it('does NOT have confirmHideTab function', () => {
    assert.ok(!src.includes('confirmHideTab'), 'Should NOT have confirmHideTab');
  });

  it('does NOT have cancelCloseConfirm function', () => {
    assert.ok(!src.includes('cancelCloseConfirm'), 'Should NOT have cancelCloseConfirm');
  });

  it('does NOT have close-confirm-overlay', () => {
    assert.ok(!src.includes('close-confirm-overlay'), 'Should NOT have close confirmation dialog');
  });

  it('does NOT iterate individual terminal/dev-server tabs', () => {
    assert.ok(!src.includes("t.type === 'dev-server'"), 'Should NOT filter dev-server tabs');
    assert.ok(!src.includes("t.type === 'terminal'"), 'Should NOT filter terminal tabs');
  });

  it('does NOT render individual Terminal components (only TerminalPanel)', () => {
    // Should not have <Terminal (without Panel suffix) as a standalone component
    assert.ok(!src.includes('<Terminal '), 'Should NOT render individual Terminal components');
    assert.ok(!src.includes("import Terminal from './Terminal.svelte'"), 'Should NOT import Terminal component');
  });

  it('does NOT have onMount terminal auto-spawn', () => {
    // Should NOT spawn default terminal tab on mount
    assert.ok(!src.includes('addTerminalTab'), 'Should NOT call addTerminalTab');
  });
});

describe('TerminalPanel.svelte -- placeholder', () => {
  it('exists as a file', () => {
    assert.ok(panelSrc.length > 0, 'TerminalPanel.svelte should exist');
  });

  it('has terminal-panel-inner class', () => {
    assert.ok(panelSrc.includes('terminal-panel-inner'), 'Should have terminal-panel-inner class');
  });

  it('has placeholder text', () => {
    assert.ok(panelSrc.includes('coming soon'), 'Should have placeholder text');
  });

  it('uses flex column layout', () => {
    assert.ok(panelSrc.includes('flex-direction: column'), 'Should use flex column');
  });

  it('has 100% width and height', () => {
    assert.ok(panelSrc.includes('width: 100%'), 'Should have full width');
    assert.ok(panelSrc.includes('height: 100%'), 'Should have full height');
  });
});

describe('TerminalTabs.svelte -- theme variables in context menus', () => {
  it('dialog uses theme variables', () => {
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated');
    assert.ok(src.includes('var(--text)'), 'Should use --text');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted');
  });

  it('has danger styling for stop provider', () => {
    assert.ok(src.includes('var(--danger'), 'Should use --danger color');
  });

  it('has accent styling', () => {
    assert.ok(src.includes('var(--accent)'), 'Should use --accent color');
  });
});
