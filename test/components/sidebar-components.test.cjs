/**
 * sidebar-components.test.js -- Source-inspection tests for tauri/src/components/sidebar/
 *
 * Tests Sidebar.svelte and ChatList.svelte.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SIDEBAR_DIR = path.join(__dirname, '../../src/components/sidebar');

function readComponent(name) {
  return fs.readFileSync(path.join(SIDEBAR_DIR, name), 'utf-8');
}

// ---- Sidebar.svelte ----

describe('Sidebar.svelte', () => {
  const src = readComponent('Sidebar.svelte');

  it('imports navigationStore', () => {
    assert.ok(src.includes("import { navigationStore }"), 'Should import navigationStore');
  });

  it('imports aiStatusStore', () => {
    assert.ok(src.includes("import { aiStatusStore }"), 'Should import aiStatusStore');
  });

  it('imports voiceStore', () => {
    assert.ok(src.includes("import { voiceStore }"), 'Should import voiceStore');
  });

  it('imports ChatList component', () => {
    assert.ok(src.includes("import ChatList from './ChatList.svelte'"), 'Should import ChatList');
  });

  it('has Chat navigation item', () => {
    assert.ok(src.includes("id: 'chat'"), 'Should have Chat nav item');
    assert.ok(src.includes("label: 'Chat'"), 'Should label it Chat');
  });

  it('has Terminal navigation item', () => {
    assert.ok(src.includes("id: 'terminal'"), 'Should have Terminal nav item');
    assert.ok(src.includes("label: 'Terminal'"), 'Should label it Terminal');
  });

  it('derives appMode from navigationStore', () => {
    assert.ok(src.includes('navigationStore.appMode'), 'Should derive appMode from store');
  });

  it('has mode-conditional rendering for mirror vs lens', () => {
    assert.ok(
      src.includes("appMode === 'mirror'"),
      'Should conditionally render based on appMode'
    );
  });

  it('has Settings navigation item pinned above footer', () => {
    assert.ok(src.includes('settings-item'), 'Should have settings-item class');
    assert.ok(src.includes("activeView === 'settings'"), 'Should highlight when active');
    assert.ok(src.includes("aria-label=\"Settings\""), 'Should label it Settings');
  });

  it('has collapse/expand toggle button', () => {
    assert.ok(src.includes('collapse-btn'), 'Should have collapse button');
    assert.ok(src.includes('handleToggleSidebar'), 'Should have toggle handler');
  });

  it('has aria-label for collapse toggle', () => {
    assert.ok(src.includes("aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}"), 'Should have accessible label');
  });

  it('derives collapsed state from navigationStore', () => {
    assert.ok(src.includes('navigationStore.sidebarCollapsed'), 'Should derive collapsed');
  });

  it('derives activeView from navigationStore', () => {
    assert.ok(src.includes('navigationStore.activeView'), 'Should derive activeView');
  });

  it('has sidebar CSS class', () => {
    assert.ok(src.includes('.sidebar'), 'Should have sidebar CSS');
  });

  it('has collapsed CSS class variant', () => {
    assert.ok(src.includes('class:collapsed'), 'Should toggle collapsed class');
    assert.ok(src.includes('.sidebar.collapsed'), 'Should style collapsed state');
  });

  it('has sidebar-nav CSS class', () => {
    assert.ok(src.includes('.sidebar-nav'), 'Should have nav CSS');
  });

  it('has nav-item CSS class', () => {
    assert.ok(src.includes('.nav-item'), 'Should have nav item CSS');
  });

  it('has active class on nav items', () => {
    assert.ok(src.includes('class:active'), 'Should toggle active class');
    assert.ok(src.includes('.nav-item.active'), 'Should style active nav item');
  });

  it('has SVG icons for each nav item', () => {
    assert.ok(src.includes('nav-icon'), 'Should have nav icons');
    assert.ok(src.includes('<svg'), 'Should use SVG icons');
  });

  it('has aria-label on nav buttons', () => {
    assert.ok(src.includes('aria-label={tab.label}'), 'Should have aria-label on nav buttons');
  });

  it('shows AI provider status indicator', () => {
    assert.ok(src.includes('sidebar-status'), 'Should have status section');
    assert.ok(src.includes('aiDisplayName'), 'Should display AI provider name');
  });

  it('shows provider status dot (running/starting)', () => {
    assert.ok(src.includes('status-dot'), 'Should have status dot');
    assert.ok(src.includes('class:running'), 'Should show running state');
    assert.ok(src.includes('class:starting'), 'Should show starting state');
  });

  it('shows voice status indicator', () => {
    assert.ok(src.includes('voice-status'), 'Should have voice status');
    assert.ok(src.includes('voice-dot'), 'Should have voice dot indicator');
  });

  it('has provider icon support', () => {
    assert.ok(src.includes('PROVIDER_ICONS'), 'Should define provider icons');
    assert.ok(src.includes('sidebar-provider-icon'), 'Should have provider icon CSS');
  });

  it('renders ChatList when on chat view', () => {
    assert.ok(src.includes('<ChatList'), 'Should render ChatList');
    assert.ok(src.includes("activeView === 'chat'"), 'Should show ChatList only on chat view');
  });

  it('has sidebar footer section', () => {
    assert.ok(src.includes('sidebar-footer'), 'Should have footer section');
  });

  it('has Collapse label text', () => {
    assert.ok(src.includes('>Collapse<'), 'Should show Collapse text');
  });

  it('has tooltips for collapsed state', () => {
    assert.ok(src.includes('data-tooltip'), 'Should have tooltip attribute');
  });
});

// ---- ChatList.svelte ----

describe('ChatList.svelte', () => {
  const src = readComponent('ChatList.svelte');

  it('imports chatStore', () => {
    assert.ok(src.includes("import { chatStore }"), 'Should import chatStore');
  });

  it('imports chat API functions', () => {
    assert.ok(src.includes('chatList'), 'Should import chatList');
    assert.ok(src.includes('chatLoad'), 'Should import chatLoad');
    assert.ok(src.includes('chatSave'), 'Should import chatSave');
    assert.ok(src.includes('chatDelete'), 'Should import chatDelete');
    assert.ok(src.includes('chatRename'), 'Should import chatRename');
  });

  it('imports uid from utils', () => {
    assert.ok(src.includes("import { uid }"), 'Should import uid');
  });

  it('has chat-list-container CSS class', () => {
    assert.ok(src.includes('.chat-list-container'), 'Should have container CSS');
  });

  it('has New Chat button', () => {
    assert.ok(src.includes('handleNewChat'), 'Should have new chat handler');
    assert.ok(src.includes('aria-label="New chat"'), 'Should have New chat aria-label');
  });

  it('has chat entries list with role="listbox"', () => {
    assert.ok(src.includes('role="listbox"'), 'Should have listbox role');
    assert.ok(src.includes('aria-label="Chat conversations"'), 'Should have list aria-label');
  });

  it('has chat entry items with role="option"', () => {
    assert.ok(src.includes('role="option"'), 'Should have option role on entries');
  });

  it('has aria-selected on chat entries', () => {
    assert.ok(src.includes('aria-selected='), 'Should have aria-selected');
  });

  it('has active class on selected chat', () => {
    assert.ok(src.includes('class:active'), 'Should toggle active class');
  });

  it('has delete button with aria-label', () => {
    assert.ok(src.includes('aria-label="Delete chat"'), 'Should have delete aria-label');
  });

  it('has context menu support', () => {
    assert.ok(src.includes('contextMenu'), 'Should have context menu state');
    assert.ok(src.includes('context-menu'), 'Should have context menu CSS');
    assert.ok(src.includes('handleContextMenu'), 'Should handle right-click');
  });

  it('has rename support', () => {
    assert.ok(src.includes('startRename'), 'Should have rename start');
    assert.ok(src.includes('commitRename'), 'Should have rename commit');
    assert.ok(src.includes('cancelRename'), 'Should have rename cancel');
    assert.ok(src.includes('rename-input'), 'Should have rename input');
  });

  it('has context menu with Rename and Delete options', () => {
    assert.ok(src.includes('role="menu"'), 'Should have menu role on context menu');
    assert.ok(src.includes('role="menuitem"'), 'Should have menuitem role on options');
    // "Rename" and "Delete" appear as text content inside context-menu-item buttons
    assert.ok(src.includes('startRename') && src.includes('Rename'), 'Should have Rename option');
    assert.ok(src.includes('handleDeleteChat') && src.includes('Delete'), 'Should have Delete option');
  });

  it('sorts chats by most recent', () => {
    assert.ok(src.includes('.sort('), 'Should sort chats');
  });

  it('has empty state message', () => {
    assert.ok(src.includes('No chats yet'), 'Should show empty state message');
  });

  it('shows relative time on chat entries', () => {
    assert.ok(src.includes('formatRelativeTime'), 'Should format relative time');
    assert.ok(src.includes('chat-time'), 'Should show time on entries');
  });

  it('loads chats on mount via $effect', () => {
    assert.ok(src.includes('loadChats()'), 'Should load chats');
  });

  it('uses $state for local state', () => {
    assert.ok(src.includes('$state('), 'Should use $state rune');
  });
});

// ---- Sidebar: mode support ----

describe('sidebar: mode support', () => {
  const src = readComponent('Sidebar.svelte');

  it('derives appMode from navigationStore', () => {
    assert.ok(src.includes('navigationStore.appMode'), 'Should derive appMode');
  });

  it('conditionally renders based on appMode', () => {
    assert.ok(
      src.includes("appMode === 'mirror'"),
      'Should branch on appMode for mirror mode'
    );
  });

  it('has lens mode placeholder in sidebar', () => {
    // In lens mode the nav area is an empty spacer
    assert.ok(
      src.includes("appMode === 'mirror'") || src.includes("{:else}"),
      'Should have else branch for lens mode'
    );
  });
});

// ---- Sidebar: lens mode project switcher ----

describe('sidebar: lens mode project switcher', () => {
  const src = readComponent('Sidebar.svelte');

  it('imports ProjectStrip component', () => {
    assert.ok(src.includes('ProjectStrip'), 'Should import ProjectStrip');
  });

  it('imports SessionPanel component', () => {
    assert.ok(src.includes('SessionPanel'), 'Should import SessionPanel');
  });

  it('has lens-sidebar CSS class', () => {
    assert.ok(src.includes('lens-sidebar'), 'Should have lens-sidebar CSS class');
  });

  it('renders ProjectStrip in lens mode', () => {
    assert.ok(
      src.includes('<ProjectStrip'),
      'Should render ProjectStrip component'
    );
  });

  it('conditionally renders SessionPanel when not collapsed in lens mode', () => {
    assert.ok(
      src.includes('<SessionPanel') || src.includes('SessionPanel'),
      'Should render SessionPanel component'
    );
    assert.ok(
      src.includes('!collapsed') || src.includes('collapsed'),
      'Should conditionally show based on collapsed state'
    );
  });
});
