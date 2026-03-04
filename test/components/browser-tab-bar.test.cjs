/**
 * browser-tab-bar.test.cjs -- Source-inspection tests for BrowserTabBar.svelte
 *
 * Validates the browser tab bar component for Lens multi-tab support.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/BrowserTabBar.svelte'),
  'utf-8'
);

describe('BrowserTabBar.svelte: imports', () => {
  it('imports browserTabsStore', () => {
    assert.ok(src.includes('browserTabsStore'), 'Should import browserTabsStore');
  });

  it('imports from browser-tabs.svelte.js', () => {
    assert.ok(src.includes('browser-tabs.svelte.js'), 'Should import from browser-tabs store path');
  });
});

describe('BrowserTabBar.svelte: props', () => {
  it('has onNewTab prop', () => {
    assert.ok(src.includes('onNewTab'), 'Should accept onNewTab prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props() rune');
  });
});

describe('BrowserTabBar.svelte: CSS structure', () => {
  it('has .browser-tab-bar CSS class', () => {
    assert.ok(src.includes('.browser-tab-bar'), 'Should have .browser-tab-bar class');
  });

  it('has -webkit-app-region: no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should set no-drag for frameless window');
  });

  it('has active class binding', () => {
    assert.ok(src.includes('class:active'), 'Should have class:active binding');
  });

  it('has loading class binding', () => {
    assert.ok(src.includes('class:loading'), 'Should have class:loading binding');
  });
});

describe('BrowserTabBar.svelte: tab interactions', () => {
  it('has switchTab call', () => {
    assert.ok(src.includes('switchTab'), 'Should call switchTab on tab click');
  });

  it('has closeTab call', () => {
    assert.ok(src.includes('closeTab'), 'Should call closeTab');
  });

  it('has close button', () => {
    assert.ok(src.includes('browser-tab-close'), 'Should have close button element');
  });

  it('has stopPropagation on close button', () => {
    assert.ok(src.includes('stopPropagation'), 'Should stop propagation to prevent tab switch when closing');
  });
});

describe('BrowserTabBar.svelte: add tab', () => {
  it('has new tab / add button', () => {
    assert.ok(src.includes('browser-tab-add'), 'Should have add tab button');
  });

  it('has canAddTab check', () => {
    assert.ok(src.includes('canAddTab'), 'Should check canAddTab before showing add button');
  });

  it('calls onNewTab on add button click', () => {
    assert.ok(src.includes('onNewTab'), 'Should invoke onNewTab callback');
  });
});

describe('BrowserTabBar.svelte: context menu items', () => {
  it('imports lensReload from api', () => {
    assert.ok(src.includes('lensReload'), 'Should import lensReload');
  });

  it('imports lensHardRefresh from api', () => {
    assert.ok(src.includes('lensHardRefresh'), 'Should import lensHardRefresh');
  });

  it('has Reload menu item', () => {
    assert.ok(src.includes('Reload'), 'Should have Reload context menu item');
  });

  it('has Hard Refresh menu item', () => {
    assert.ok(src.includes('Hard Refresh'), 'Should have Hard Refresh context menu item');
  });

  it('has New Tab menu item', () => {
    assert.ok(src.includes('New Tab'), 'Should have New Tab context menu item');
  });

  it('has Close Tab menu item', () => {
    assert.ok(src.includes('Close Tab'), 'Should have Close Tab context menu item');
  });

  it('has context-menu-divider between groups', () => {
    assert.ok(src.includes('context-menu-divider'), 'Should have divider between menu groups');
  });
});

describe('BrowserTabBar.svelte: tab rendering', () => {
  it('iterates over tabs with #each', () => {
    assert.ok(src.includes('{#each'), 'Should use {#each} to render tabs');
  });

  it('uses tab.id as key', () => {
    assert.ok(src.includes('(tab.id)'), 'Should key each tab by id');
  });

  it('displays tab title', () => {
    assert.ok(src.includes('tab.title'), 'Should display tab title');
  });

  it('has truncate helper for long titles', () => {
    assert.ok(src.includes('truncate'), 'Should have truncate function for titles');
  });
});
