/**
 * sidebar-components.test.js -- Source-inspection tests for tauri/src/components/sidebar/
 *
 * Tests Sidebar.svelte.
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

  it('imports voiceStore', () => {
    assert.ok(src.includes("import { voiceStore }"), 'Should import voiceStore');
  });

  it('does not import ChatList (moved to ChatSessionDropdown)', () => {
    assert.ok(!src.includes("import ChatList"), 'ChatList should be removed from Sidebar');
  });

  it('always renders the Lens ProjectStrip (Mirror nav removed)', () => {
    assert.ok(src.includes('ProjectStrip'), 'Should render ProjectStrip');
    assert.ok(src.includes('lens-sidebar'), 'Should use the lens-sidebar wrapper');
    assert.ok(!src.includes('navigationStore.appMode'), 'Should no longer branch on appMode');
    assert.ok(!src.includes("id: 'chat'"), 'Mirror chat/terminal nav tabs should be gone');
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

  it('has aria-label on the Settings nav button', () => {
    assert.ok(src.includes('aria-label="Settings"'), 'Settings button should have an aria-label');
  });

  it('shows voice status indicator', () => {
    assert.ok(src.includes('voice-status'), 'Should have voice status');
    assert.ok(src.includes('voice-dot'), 'Should have voice dot indicator');
  });

  it('does not render ChatList (moved to ChatSessionDropdown)', () => {
    assert.ok(!src.includes('<ChatList'), 'ChatList should not be rendered in Sidebar');
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

// ---- Sidebar: lens mode project switcher ----

describe('sidebar: lens mode project switcher', () => {
  const src = readComponent('Sidebar.svelte');

  it('imports ProjectStrip component', () => {
    assert.ok(src.includes('ProjectStrip'), 'Should import ProjectStrip');
  });

  it('does not import SessionPanel (moved to ChatSessionDropdown)', () => {
    assert.ok(!src.includes('SessionPanel'), 'SessionPanel should be removed from Sidebar');
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

  it('does not render SessionPanel (moved to ChatSessionDropdown)', () => {
    assert.ok(
      !src.includes('<SessionPanel'),
      'SessionPanel should not be rendered in Sidebar'
    );
  });
});
