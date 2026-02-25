/**
 * titlebar.test.cjs -- Source-inspection tests for TitleBar.svelte
 *
 * Validates the mode toggle pill, accessibility, and Tauri frameless requirements.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/shared/TitleBar.svelte'),
  'utf-8'
);

describe('TitleBar.svelte', () => {
  it('imports navigationStore', () => {
    assert.ok(src.includes('navigationStore'), 'Should import navigationStore');
  });

  it('derives appMode from navigationStore', () => {
    assert.ok(src.includes('navigationStore.appMode'), 'Should derive appMode');
  });

  it('has mode-toggle container', () => {
    assert.ok(src.includes('mode-toggle'), 'Should have mode toggle class');
  });

  it('has Mirror button', () => {
    assert.ok(src.includes('>Mirror</button>') || src.includes('>Mirror<'), 'Should have Mirror button text');
  });

  it('has Lens button', () => {
    assert.ok(src.includes('>Lens</button>') || src.includes('>Lens<'), 'Should have Lens button text');
  });

  it('uses radiogroup role for accessibility', () => {
    assert.ok(src.includes('role="radiogroup"'), 'Should have radiogroup role');
  });

  it('has radio role on mode buttons', () => {
    assert.ok(src.includes('role="radio"'), 'Should have radio role on buttons');
  });

  it('has aria-checked on mode buttons', () => {
    assert.ok(src.includes('aria-checked'), 'Should have aria-checked');
  });

  it('mode toggle has no-drag for Tauri frameless', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag on mode toggle');
  });

  it('mode toggle has pointer-events auto', () => {
    assert.ok(src.includes('pointer-events: auto'), 'Should have pointer-events auto');
  });

  it('calls setMode or handleModeSwitch', () => {
    assert.ok(
      src.includes('setMode') || src.includes('handleModeSwitch'),
      'Should call mode switch handler'
    );
  });

  it('does not show static "Voice Mirror" text', () => {
    assert.ok(!src.includes('Voice Mirror</span>'), 'Should not have static Voice Mirror span');
  });

  it('has active class for current mode', () => {
    assert.ok(src.includes("class:active="), 'Should use class:active directive');
  });

  it('has pill-shaped toggle styling', () => {
    assert.ok(src.includes('9999px') || src.includes('border-radius'), 'Should have pill border-radius');
  });
});

describe('TitleBar: Zed-style menu bar', () => {
  it('defines menuBarItems with all 8 menus', () => {
    assert.ok(src.includes('menuBarItems'), 'Should define menuBarItems');
    for (const label of ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']) {
      assert.ok(src.includes(`label: '${label}'`), `Should have ${label} menu`);
    }
  });

  it('defines menuDefinitions with submenu items', () => {
    assert.ok(src.includes('menuDefinitions'), 'Should define menuDefinitions');
    for (const id of ['file', 'edit', 'selection', 'view', 'go', 'run', 'terminal', 'help']) {
      assert.ok(src.includes(`${id}:`), `Should have ${id} submenu definition`);
    }
  });

  it('menu bar is conditional on appMenuOpen', () => {
    assert.ok(src.includes('{#if appMenuOpen}'), 'Should conditionally render menu bar');
    assert.ok(src.includes('class="menu-bar"'), 'Should have menu-bar class');
  });

  it('menu bar items have hover-through behavior', () => {
    assert.ok(src.includes('handleMenuHover'), 'Should have hover handler');
    assert.ok(src.includes('onmouseenter'), 'Should use onmouseenter for hover-through');
  });

  it('tracks activeMenuId for submenu display', () => {
    assert.ok(src.includes('activeMenuId'), 'Should track activeMenuId');
    assert.ok(src.includes('toggleSubmenu'), 'Should have toggleSubmenu function');
  });

  it('submenu dropdown positioned via getBoundingClientRect', () => {
    assert.ok(src.includes('getBoundingClientRect'), 'Should use getBoundingClientRect for positioning');
    assert.ok(src.includes('submenuLeft'), 'Should track submenuLeft position');
  });

  it('File menu has real action handlers', () => {
    assert.ok(src.includes("action: handleOpenFile"), 'File menu should have Open File action');
    assert.ok(src.includes("action: handleOpenProject"), 'File menu should have Open Project action');
    assert.ok(src.includes("action: handleSettings"), 'File menu should have Settings action');
  });

  it('non-File menus have disabled placeholder items', () => {
    // Edit menu items should NOT have action properties
    assert.ok(src.includes("{ label: 'Undo', kbd: 'Ctrl+Z' }"), 'Edit items should be placeholders (no action)');
  });

  it('submenu item disabled class for items without action', () => {
    assert.ok(src.includes('class:disabled={!item.action}'), 'Should disable items without action');
    assert.ok(src.includes('disabled={!item.action}'), 'Should set disabled attribute');
  });

  it('submenu dropdown has no-drag for Tauri frameless', () => {
    const submenuMatch = src.match(/\.submenu-dropdown\s*\{[^}]*-webkit-app-region:\s*no-drag/);
    assert.ok(submenuMatch, 'Submenu dropdown should have -webkit-app-region: no-drag');
  });

  it('menu bar has no-drag for Tauri frameless', () => {
    const menuBarMatch = src.match(/\.menu-bar\s*\{[^}]*-webkit-app-region:\s*no-drag/);
    assert.ok(menuBarMatch, 'Menu bar should have -webkit-app-region: no-drag');
  });

  it('menu bar has z-index above resize edges', () => {
    const menuBarMatch = src.match(/\.menu-bar\s*\{[^}]*z-index:\s*1000[1-9]/);
    assert.ok(menuBarMatch, 'Menu bar should have z-index >= 10001');
  });

  it('mode toggle slides right when menu is open', () => {
    assert.ok(src.includes('class:menu-open={appMenuOpen}'), 'Mode toggle should have menu-open class binding');
    assert.ok(src.includes('.mode-toggle.menu-open'), 'Should have CSS for mode-toggle.menu-open');
    // Should have transition on mode-toggle for smooth slide
    const toggleMatch = src.match(/\.mode-toggle\s*\{[^}]*transition/);
    assert.ok(toggleMatch, 'Mode toggle should have CSS transition');
  });

  it('has keyboard shortcut labels in menu items', () => {
    assert.ok(src.includes("kbd: 'Ctrl+O'"), 'Should have Ctrl+O shortcut for Open File');
    assert.ok(src.includes("kbd: 'Ctrl+,'"), 'Should have Ctrl+, shortcut for Settings');
    assert.ok(src.includes('<kbd>'), 'Should render kbd elements');
  });

  it('has menu bar entrance animation', () => {
    assert.ok(src.includes('menu-bar-in'), 'Should have menu-bar-in animation');
    assert.ok(src.includes('@keyframes menu-bar-in'), 'Should define menu-bar-in keyframes');
  });

  it('closes menu on Escape key', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should handle Escape key');
    assert.ok(src.includes('closeAppMenu'), 'Should call closeAppMenu');
  });

  it('closes menu on click-outside', () => {
    assert.ok(src.includes('svelte:document'), 'Should have svelte:document listener');
    assert.ok(src.includes('onclick={closeAppMenu}'), 'Should close on document click');
  });

  it('has separator support in submenus', () => {
    assert.ok(src.includes('separator: true'), 'Should define separator items');
    assert.ok(src.includes('app-menu-separator'), 'Should render separator div');
  });

  it('has submenu entrance animation', () => {
    assert.ok(src.includes('submenu-in'), 'Should have submenu-in animation');
    assert.ok(src.includes('@keyframes submenu-in'), 'Should define submenu-in keyframes');
  });

  it('respects prefers-reduced-motion', () => {
    assert.ok(src.includes('prefers-reduced-motion'), 'Should have reduced motion media query');
    assert.ok(src.includes('animation: none'), 'Should disable animations for reduced motion');
  });

  it('submenu dropdown has proper z-index above menu bar', () => {
    const submenuZ = src.match(/\.submenu-dropdown\s*\{[^}]*z-index:\s*(\d+)/);
    assert.ok(submenuZ, 'Submenu should have z-index');
    assert.ok(parseInt(submenuZ[1]) >= 10002, 'Submenu z-index should be >= 10002');
  });

  it('uses role="menu" and role="menuitem" for accessibility', () => {
    assert.ok(src.includes('role="menu"'), 'Should have role="menu" on submenu');
    assert.ok(src.includes('role="menuitem"'), 'Should have role="menuitem" on items');
  });
});

describe('TitleBar: window controls', () => {
  it('uses native decorum controls for min/max/close', () => {
    assert.ok(src.includes('data-tauri-decorum-tb'), 'Should use decorum plugin for native controls');
  });

  it('has compact/orb button', () => {
    assert.ok(src.includes('win-compact'), 'Should have compact button');
  });

  it('imports Orb component for compact button preview', () => {
    assert.ok(src.includes("import Orb from"), 'Should import Orb component');
  });

  it('renders mini static Orb in compact button', () => {
    assert.ok(src.includes('isStatic={true}'), 'Should render Orb with isStatic');
    assert.ok(src.includes('<Orb'), 'Should render Orb component');
  });

  it('has decorum-controls container', () => {
    assert.ok(src.includes('decorum-controls'), 'Should have decorum-controls class');
  });
});
