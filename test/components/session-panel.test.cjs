/**
 * session-panel.test.cjs -- Source-inspection tests for SessionPanel.svelte
 *
 * Validates imports, UI structure, behavior, and styles of the
 * SessionPanel component by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(__dirname, '../../src/components/sidebar/SessionPanel.svelte');
let src;
try {
  src = fs.readFileSync(filePath, 'utf-8');
} catch {
  // File may not exist yet if ui-coder hasn't finished; skip gracefully
  src = '';
}

describe('SessionPanel.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'SessionPanel.svelte should exist and have content');
  });

  // ── Imports ──

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports chat API functions', () => {
    assert.ok(src.includes('chatSave') || src.includes('chatLoad'), 'Should import chat API functions');
  });

  it('imports uid from utils', () => {
    assert.ok(src.includes('uid'), 'Should import uid utility');
  });

  it('imports formatRelativeTime', () => {
    assert.ok(src.includes('formatRelativeTime'), 'Should import formatRelativeTime');
  });

  // ── UI Structure ──

  it('has session-panel CSS class', () => {
    assert.ok(src.includes('session-panel'), 'Should have session-panel class');
  });

  it('has session-header class', () => {
    assert.ok(src.includes('session-header'), 'Should have session-header class');
  });

  it('has session-list class', () => {
    assert.ok(src.includes('session-list'), 'Should have session-list class');
  });

  it('has session-item class', () => {
    assert.ok(src.includes('session-item'), 'Should have session-item class');
  });

  it('has new session button', () => {
    assert.ok(src.includes('new-session-btn'), 'Should have new-session-btn class');
  });

  // ── Behavior ──

  it('has handleNewSession or similar handler', () => {
    assert.ok(
      src.includes('handleNewSession') || src.includes('newSession') || src.includes('handleNew'),
      'Should have a new session handler'
    );
  });

  it('has handleLoadSession or similar handler', () => {
    assert.ok(
      src.includes('handleLoadSession') || src.includes('loadSession') || src.includes('handleLoad'),
      'Should have a load session handler'
    );
  });

  it('uses formatRelativeTime for session timestamps', () => {
    assert.ok(src.includes('formatRelativeTime'), 'Should format relative time on sessions');
  });

  // ── Context Menu (Delete) ──

  it('imports chatDelete and chatRename from API', () => {
    assert.ok(src.includes('chatDelete'), 'Should import chatDelete');
    assert.ok(src.includes('chatRename'), 'Should import chatRename');
  });

  it('has context menu support', () => {
    assert.ok(src.includes('contextMenu'), 'Should have context menu state');
    assert.ok(src.includes('context-menu'), 'Should have context menu CSS');
    assert.ok(src.includes('handleContextMenu') || src.includes('oncontextmenu'), 'Should handle right-click');
  });

  it('has delete session handler', () => {
    assert.ok(src.includes('handleDeleteSession'), 'Should have delete session handler');
  });

  it('has context menu with Rename and Delete options', () => {
    assert.ok(src.includes('role="menu"'), 'Should have menu role');
    assert.ok(src.includes('role="menuitem"'), 'Should have menuitem role');
    assert.ok(src.includes('Rename'), 'Should have Rename text');
    assert.ok(src.includes('Delete'), 'Should have Delete text');
  });

  it('has inline rename support', () => {
    assert.ok(src.includes('startRename'), 'Should have startRename');
    assert.ok(src.includes('commitRename'), 'Should have commitRename');
    assert.ok(src.includes('cancelRename'), 'Should have cancelRename');
    assert.ok(src.includes('rename-input'), 'Should have rename input class');
    assert.ok(src.includes('renamingId'), 'Should track renaming state');
  });

  it('supports double-click to rename', () => {
    assert.ok(src.includes('ondblclick'), 'Should handle double-click for rename');
  });

  // ── State ──

  it('uses $state or $derived for reactivity', () => {
    assert.ok(
      src.includes('$state(') || src.includes('$derived('),
      'Should use Svelte 5 runes for reactivity'
    );
  });

  // ── Styles ──

  it('has scoped style block', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped styles');
  });
});
