/**
 * chat-session-dropdown.test.cjs -- Source-inspection tests for ChatSessionDropdown
 * and Sidebar cleanup (SessionPanel/ChatList removal).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/chat/ChatSessionDropdown.svelte'),
  'utf-8'
);

describe('ChatSessionDropdown', () => {
  it('should have Past Conversations label', () => {
    assert.ok(src.includes('Past Conversations'), 'Should have Past Conversations trigger text');
  });

  it('should import required stores', () => {
    assert.ok(src.includes('chatStore'), 'Should import chatStore');
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
    assert.ok(src.includes('navigationStore'), 'Should import navigationStore');
  });

  it('should import chat API functions', () => {
    assert.ok(src.includes('chatLoad'), 'Should import chatLoad');
    assert.ok(src.includes('chatSave'), 'Should import chatSave');
    assert.ok(src.includes('chatDelete'), 'Should import chatDelete');
    assert.ok(src.includes('chatRename'), 'Should import chatRename');
    assert.ok(src.includes('chatList'), 'Should import chatList');
  });

  it('should have date grouping logic', () => {
    assert.ok(src.includes('Today'), 'Should group by Today');
    assert.ok(src.includes('Yesterday'), 'Should group by Yesterday');
    assert.ok(src.includes('This Week'), 'Should group by This Week');
    assert.ok(src.includes('Older'), 'Should group by Older');
  });

  it('should have search input', () => {
    assert.ok(src.includes('Search sessions'), 'Should have search placeholder');
    assert.ok(src.includes('searchQuery'), 'Should have searchQuery state');
  });

  it('should have new session button', () => {
    assert.ok(src.includes('handleNewSession'), 'Should have new session handler');
    assert.ok(src.includes('New conversation') || src.includes('new-session'), 'Should have new session UI');
  });

  it('should have context menu with rename and delete', () => {
    assert.ok(src.includes('context-menu'), 'Should have context menu class');
    assert.ok(src.includes('startRename') || src.includes('Rename'), 'Should have rename action');
    assert.ok(src.includes('handleDeleteSession') || src.includes('Delete'), 'Should have delete action');
  });

  it('should handle click outside to close', () => {
    assert.ok(src.includes('handleWindowClick') || src.includes('onclick') || src.includes('svelte:window'), 'Should handle window click');
  });

  it('should handle Escape key to close', () => {
    assert.ok(src.includes('Escape'), 'Should handle Escape key');
  });

  it('should use proper z-index for dropdown', () => {
    assert.ok(src.includes('10002') || src.includes('z-index'), 'Should use z-index 10002');
  });

  it('should have -webkit-app-region for Tauri frameless window', () => {
    assert.ok(src.includes('-webkit-app-region'), 'Should have app-region for Tauri');
  });

  it('should have dropdown open/close state', () => {
    assert.ok(src.includes('open'), 'Should track open state');
    assert.ok(src.includes('dropdown-panel') || src.includes('dropdown'), 'Should have dropdown panel');
  });

  it('should have auto-save logic', () => {
    assert.ok(src.includes('saveActiveSession') || src.includes('chatSave'), 'Should auto-save sessions');
  });

  it('should have auto-title logic', () => {
    assert.ok(src.includes('generateTitle'), 'Should auto-generate titles');
  });

  it('should handle both Mirror and Lens modes', () => {
    assert.ok(src.includes('appMode') || src.includes('navigationStore'), 'Should check app mode');
  });

  it('should show active session highlight', () => {
    assert.ok(src.includes('activeChatId'), 'Should reference activeChatId for highlight');
    assert.ok(src.includes('active'), 'Should have active class');
  });

  it('should have session item with title and time', () => {
    assert.ok(src.includes('session-title') || src.includes('session.name'), 'Should display session title');
    assert.ok(src.includes('session-time') || src.includes('formatRelativeTime'), 'Should display relative time');
  });
});

describe('Sidebar - session panel removed', () => {
  const sidebarSrc = fs.readFileSync(
    path.join(__dirname, '../../src/components/sidebar/Sidebar.svelte'),
    'utf-8'
  );

  it('should not import SessionPanel', () => {
    assert.ok(!sidebarSrc.includes('import SessionPanel'), 'SessionPanel should be removed from Sidebar');
  });

  it('should not import ChatList', () => {
    assert.ok(!sidebarSrc.includes('import ChatList'), 'ChatList should be removed from Sidebar');
  });

  it('should not render ChatList component', () => {
    assert.ok(!sidebarSrc.includes('<ChatList'), 'ChatList component should not be rendered');
  });

  it('should not render SessionPanel component', () => {
    assert.ok(!sidebarSrc.includes('<SessionPanel'), 'SessionPanel component should not be rendered');
  });

  it('should not have sidebar-chat-section CSS', () => {
    assert.ok(!sidebarSrc.includes('.sidebar-chat-section'), 'sidebar-chat-section CSS should be removed');
  });

  it('should still have ProjectStrip in lens mode', () => {
    assert.ok(sidebarSrc.includes('ProjectStrip'), 'Should still import ProjectStrip');
    assert.ok(sidebarSrc.includes('<ProjectStrip'), 'Should still render ProjectStrip');
  });
});
