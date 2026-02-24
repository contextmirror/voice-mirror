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
  it('shows file actions only for non-browser tabs', () => {
    assert.ok(src.includes('isBrowser'));
    assert.ok(src.includes('{:else}'));
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

describe('TabContextMenu.svelte: browser-specific imports', () => {
  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'), 'Should import lensStore');
    assert.ok(src.includes('lens.svelte.js'), 'Should import from lens.svelte.js');
  });
  it('imports browserTabsStore', () => {
    assert.ok(src.includes('browserTabsStore'), 'Should import browserTabsStore');
    assert.ok(src.includes('browser-tabs.svelte.js'), 'Should import from browser-tabs.svelte.js');
  });
  it('imports lensHardRefresh and lensClearCache', () => {
    assert.ok(src.includes('lensHardRefresh'), 'Should import lensHardRefresh');
    assert.ok(src.includes('lensClearCache'), 'Should import lensClearCache');
  });
  it('imports open from @tauri-apps/plugin-shell', () => {
    assert.ok(src.includes("from '@tauri-apps/plugin-shell'"), 'Should import shell plugin');
    assert.ok(src.includes('open'), 'Should import open function');
  });
});

describe('TabContextMenu.svelte: browser-specific actions', () => {
  it('has Reload action', () => {
    assert.ok(src.includes('handleReload'), 'Should have handleReload');
    assert.ok(src.includes('Reload'), 'Should show Reload text');
  });
  it('has Hard Refresh action', () => {
    assert.ok(src.includes('handleHardRefresh'), 'Should have handleHardRefresh');
    assert.ok(src.includes('Hard Refresh'), 'Should show Hard Refresh text');
  });
  it('has Copy URL action', () => {
    assert.ok(src.includes('handleCopyUrl'), 'Should have handleCopyUrl');
    assert.ok(src.includes('Copy URL'), 'Should show Copy URL text');
  });
  it('has Open in Default Browser action', () => {
    assert.ok(src.includes('handleOpenExternal'), 'Should have handleOpenExternal');
    assert.ok(src.includes('Open in Default Browser'), 'Should show Open in Default Browser text');
  });
  it('has New Browser Tab action', () => {
    assert.ok(src.includes('handleNewBrowserTab'), 'Should have handleNewBrowserTab');
    assert.ok(src.includes('New Browser Tab'), 'Should show New Browser Tab text');
  });
  it('has Clear Cache action', () => {
    assert.ok(src.includes('handleClearCache'), 'Should have handleClearCache');
    assert.ok(src.includes('Clear Cache'), 'Should show Clear Cache text');
  });
  it('shows keyboard shortcut for Reload', () => {
    assert.ok(src.includes('Ctrl+R'), 'Should have Ctrl+R shortcut');
  });
  it('shows keyboard shortcut for Hard Refresh', () => {
    assert.ok(src.includes('Ctrl+Shift+R'), 'Should have Ctrl+Shift+R shortcut');
  });
  it('branches on isBrowser for browser vs file actions', () => {
    assert.ok(src.includes('{#if isBrowser}'), 'Should branch on isBrowser');
    assert.ok(src.includes('{:else}'), 'Should have else branch for file tabs');
  });
});

describe('TabContextMenu.svelte: browser action edge cases', () => {
  it('has hasRealUrl derived for URL validation', () => {
    assert.ok(src.includes('hasRealUrl'), 'Should have hasRealUrl derived');
  });
  it('disables Copy URL when no real URL', () => {
    assert.ok(src.includes('disabled={!hasRealUrl}'), 'Should disable when no real URL');
  });
  it('only allows http/https URLs for external open', () => {
    assert.ok(src.includes("url.startsWith('http://')"), 'Should check http://');
    assert.ok(src.includes("url.startsWith('https://')"), 'Should check https://');
  });
  it('guards against about:blank for external open', () => {
    assert.ok(src.includes("url === 'about:blank'"), 'Should guard about:blank');
  });
  it('disables New Browser Tab at max capacity', () => {
    assert.ok(src.includes('canAddTab'), 'Should check canAddTab');
  });
  it('handles clipboard write failure gracefully', () => {
    assert.ok(src.includes('.catch('), 'Should catch clipboard errors');
  });
  it('accepts onNewBrowserTab callback prop', () => {
    assert.ok(src.includes('onNewBrowserTab'), 'Should have onNewBrowserTab prop');
  });
});

describe('TabBar.svelte: browser context menu prop chain', () => {
  it('accepts onNewBrowserTab prop', () => {
    assert.ok(tabBarSrc.includes('onNewBrowserTab'), 'Should accept onNewBrowserTab prop');
  });
  it('passes onNewBrowserTab to TabContextMenu', () => {
    assert.ok(tabBarSrc.includes('{onNewBrowserTab}'), 'Should pass onNewBrowserTab to TabContextMenu');
  });
});

// ============ Split actions ============

describe('TabContextMenu.svelte: split actions', () => {
  it('has "Split Right" menu item', () => {
    assert.ok(src.includes('Split Right'), 'Should have Split Right menu item');
  });

  it('has "Split Down" menu item', () => {
    assert.ok(src.includes('Split Down'), 'Should have Split Down menu item');
  });

  it('has "Open to the Side" menu item', () => {
    assert.ok(
      src.includes('Open to the Side') || src.includes('Open to Side'),
      'Should have Open to the Side menu item'
    );
  });

  it('imports editorGroupsStore', () => {
    assert.ok(
      src.includes('editorGroupsStore') || src.includes('editor-groups.svelte.js'),
      'Should import editorGroupsStore'
    );
  });

  it('Split Right calls splitGroup with horizontal', () => {
    assert.ok(
      src.includes('splitGroup') && src.includes("'horizontal'"),
      'Split Right should call splitGroup with horizontal direction'
    );
  });

  it('Split Down calls splitGroup with vertical', () => {
    assert.ok(
      src.includes('splitGroup') && src.includes("'vertical'"),
      'Split Down should call splitGroup with vertical direction'
    );
  });

  it('shows Ctrl+\\ shortcut hint for Split Right', () => {
    assert.ok(
      src.includes('Ctrl+\\') || src.includes('Ctrl+\\\\'),
      'Should show keyboard shortcut hint for Split Right'
    );
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
