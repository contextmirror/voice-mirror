/**
 * tab-context-menu.test.cjs -- Source-inspection tests for TabContextMenu.svelte
 *
 * Right-click menu for editor tabs with close/path/reveal actions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/TabContextMenu.svelte'),
  'utf-8'
);

const tabBarSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/TabBar.svelte'),
  'utf-8'
);

const tabsSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/tabs.svelte.js'),
  'utf-8'
);

describe('TabContextMenu.svelte: imports', () => {
  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'));
    assert.ok(src.includes('tabs.svelte.js'));
  });
  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'));
  });
  it('imports revealInExplorer', () => {
    assert.ok(src.includes('revealInExplorer'));
  });
});

describe('TabContextMenu.svelte: props', () => {
  it('accepts x and y position', () => {
    assert.ok(src.includes('x = 0'));
    assert.ok(src.includes('y = 0'));
  });
  it('accepts tab prop', () => {
    assert.ok(src.includes('tab = null'));
  });
  it('accepts visible prop', () => {
    assert.ok(src.includes('visible = false'));
  });
  it('accepts onClose callback', () => {
    assert.ok(src.includes('onClose'));
  });
});

describe('TabContextMenu.svelte: close actions', () => {
  it('has Close button', () => {
    assert.ok(src.includes('handleClose'));
    assert.ok(src.includes('closeTab'));
  });
  it('has Close Others button', () => {
    assert.ok(src.includes('handleCloseOthers'));
    assert.ok(src.includes('Close Others'));
    assert.ok(src.includes('closeOthers'));
  });
  it('has Close to the Right button', () => {
    assert.ok(src.includes('handleCloseToRight'));
    assert.ok(src.includes('Close to the Right'));
    assert.ok(src.includes('closeToRight'));
  });
  it('has Close All button', () => {
    assert.ok(src.includes('handleCloseAll'));
    assert.ok(src.includes('Close All'));
    assert.ok(src.includes('closeAll'));
  });
  it('skips Close for browser tab', () => {
    assert.ok(src.includes('isBrowser'));
    assert.ok(src.includes('{#if !isBrowser}'));
  });
  it('disables Close Others when no other tabs', () => {
    assert.ok(src.includes('hasOtherTabs'));
    assert.ok(src.includes('disabled={!hasOtherTabs}'));
  });
  it('disables Close to the Right when no tabs to right', () => {
    assert.ok(src.includes('hasTabsToRight'));
    assert.ok(src.includes('disabled={!hasTabsToRight}'));
  });
});

describe('TabContextMenu.svelte: path actions', () => {
  it('has Copy Path action', () => {
    assert.ok(src.includes('handleCopyPath'));
    assert.ok(src.includes('Copy Path'));
  });
  it('has Copy Relative Path action', () => {
    assert.ok(src.includes('handleCopyRelativePath'));
    assert.ok(src.includes('Copy Relative Path'));
  });
  it('has Reveal in File Explorer action', () => {
    assert.ok(src.includes('handleReveal'));
    assert.ok(src.includes('Reveal in File Explorer'));
  });
  it('only shows path actions when tab has a path', () => {
    assert.ok(src.includes('hasPath'));
    assert.ok(src.includes('{#if hasPath}'));
  });
});

describe('TabContextMenu.svelte: menu behavior', () => {
  it('has context-menu container with role', () => {
    assert.ok(src.includes('role="menu"'));
  });
  it('has menuitem roles on buttons', () => {
    assert.ok(src.includes('role="menuitem"'));
  });
  it('has z-index 10002', () => {
    assert.ok(src.includes('z-index: 10002'));
  });
  it('has Escape key handler', () => {
    assert.ok(src.includes("e.key === 'Escape'"));
  });
  it('has click-outside handler', () => {
    assert.ok(src.includes('handleClickOutside'));
  });
  it('clamps position to viewport', () => {
    assert.ok(src.includes('Math.min'));
    assert.ok(src.includes('window.innerWidth'));
  });
  it('has keyboard shortcut hint for Close', () => {
    assert.ok(src.includes('Ctrl+W'));
  });
  it('has disabled styling', () => {
    assert.ok(src.includes(':disabled'));
  });
});

describe('TabBar.svelte: tab context menu integration', () => {
  it('imports TabContextMenu', () => {
    assert.ok(tabBarSrc.includes("import TabContextMenu from './TabContextMenu.svelte'"));
  });
  it('has tabMenu state', () => {
    assert.ok(tabBarSrc.includes('tabMenu'));
  });
  it('has oncontextmenu handler on tabs', () => {
    assert.ok(tabBarSrc.includes('oncontextmenu'));
    assert.ok(tabBarSrc.includes('handleTabContextMenu'));
  });
  it('mounts TabContextMenu component', () => {
    assert.ok(tabBarSrc.includes('<TabContextMenu'));
  });
  it('passes tab and position to menu', () => {
    assert.ok(tabBarSrc.includes('tab={tabMenu.tab}'));
    assert.ok(tabBarSrc.includes('x={tabMenu.x}'));
    assert.ok(tabBarSrc.includes('y={tabMenu.y}'));
  });
});

describe('tabs.svelte.js: closeOthers and closeToRight', () => {
  it('has closeOthers method', () => {
    assert.ok(tabsSrc.includes('closeOthers(id)'));
  });
  it('closeOthers keeps browser tab', () => {
    assert.ok(tabsSrc.includes("t.id === 'browser'"));
  });
  it('has closeToRight method', () => {
    assert.ok(tabsSrc.includes('closeToRight(id)'));
  });
  it('closeToRight splices tabs after index', () => {
    assert.ok(tabsSrc.includes('tabs.splice(idx + 1)'));
  });
});
