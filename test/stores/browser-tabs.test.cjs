/**
 * browser-tabs.test.cjs -- Source-inspection tests for browser-tabs.svelte.js
 *
 * Validates the browser sub-tab store for Lens multi-tab WebView2 management.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/browser-tabs.svelte.js'),
  'utf-8'
);

describe('browser-tabs.svelte.js: exports', () => {
  it('exports browserTabsStore', () => {
    assert.ok(src.includes('export const browserTabsStore'), 'Should export browserTabsStore');
  });

  it('creates store via createBrowserTabsStore factory', () => {
    assert.ok(src.includes('function createBrowserTabsStore()'), 'Should define createBrowserTabsStore factory');
  });
});

describe('browser-tabs.svelte.js: reactive state', () => {
  it('uses $state rune', () => {
    assert.ok(src.includes('$state('), 'Should use $state rune');
  });

  it('has tabs state as array', () => {
    assert.ok(src.includes('let tabs = $state('), 'Should have tabs $state');
  });

  it('has activeTabId state', () => {
    assert.ok(src.includes('let activeTabId = $state('), 'Should have activeTabId $state');
  });
});

describe('browser-tabs.svelte.js: constants', () => {
  it('has MAX_TABS constant', () => {
    assert.ok(src.includes('MAX_TABS'), 'Should have MAX_TABS constant');
  });

  it('MAX_TABS is 8', () => {
    assert.ok(src.includes('MAX_TABS = 8'), 'MAX_TABS should be 8');
  });
});

describe('browser-tabs.svelte.js: getters', () => {
  it('has tabs getter', () => {
    assert.ok(src.includes('get tabs()'), 'Should expose tabs getter');
  });

  it('has activeTabId getter', () => {
    assert.ok(src.includes('get activeTabId()'), 'Should expose activeTabId getter');
  });

  it('has activeTab getter', () => {
    assert.ok(src.includes('get activeTab()'), 'Should expose activeTab getter');
  });

  it('has canAddTab getter', () => {
    assert.ok(src.includes('get canAddTab()'), 'Should expose canAddTab getter');
  });

  it('canAddTab checks MAX_TABS', () => {
    assert.ok(src.includes('tabs.length < MAX_TABS'), 'canAddTab should compare against MAX_TABS');
  });
});

describe('browser-tabs.svelte.js: methods', () => {
  const methods = [
    'openTab',
    'closeTab',
    'switchTab',
    'setTabUrl',
    'setTabTitle',
    'setTabLoading',
    'setTabInputUrl',
    'clearAll',
    'getActiveWebviewLabel',
  ];

  for (const method of methods) {
    it(`has ${method} method`, () => {
      assert.ok(src.includes(`${method}(`), `Should have ${method} method`);
    });
  }
});

describe('browser-tabs.svelte.js: tab model', () => {
  it('tab has id field', () => {
    const tabBlock = src.split('const tab = {')[1]?.split('}')[0] || '';
    assert.ok(tabBlock.includes('id'), 'Tab model should have id field');
  });

  it('tab has url field', () => {
    const tabBlock = src.split('const tab = {')[1]?.split('}')[0] || '';
    assert.ok(tabBlock.includes('url'), 'Tab model should have url field');
  });

  it('tab has inputUrl field', () => {
    const tabBlock = src.split('const tab = {')[1]?.split('}')[0] || '';
    assert.ok(tabBlock.includes('inputUrl'), 'Tab model should have inputUrl field');
  });

  it('tab has title field', () => {
    const tabBlock = src.split('const tab = {')[1]?.split('}')[0] || '';
    assert.ok(tabBlock.includes('title'), 'Tab model should have title field');
  });

  it('tab has webviewLabel field', () => {
    const tabBlock = src.split('const tab = {')[1]?.split('}')[0] || '';
    assert.ok(tabBlock.includes('webviewLabel'), 'Tab model should have webviewLabel field');
  });

  it('tab has loading field', () => {
    const tabBlock = src.split('const tab = {')[1]?.split('}')[0] || '';
    assert.ok(tabBlock.includes('loading'), 'Tab model should have loading field');
  });
});

describe('browser-tabs.svelte.js: tab ID generation', () => {
  it('generates unique tab IDs with btab prefix', () => {
    assert.ok(src.includes("'btab-'") || src.includes('`btab-'), 'Tab IDs should use btab- prefix');
  });

  it('uses counter for uniqueness', () => {
    assert.ok(src.includes('counter'), 'Should use counter for tab ID uniqueness');
  });
});

describe('browser-tabs.svelte.js: imports', () => {
  it('imports lensCreateTab from api', () => {
    assert.ok(src.includes('lensCreateTab'), 'Should import lensCreateTab');
  });

  it('imports lensCloseTab from api', () => {
    assert.ok(src.includes('lensCloseTab'), 'Should import lensCloseTab');
  });

  it('imports lensSwitchTab from api', () => {
    assert.ok(src.includes('lensSwitchTab'), 'Should import lensSwitchTab');
  });

  it('imports from ../api.js', () => {
    assert.ok(
      src.includes("'../api.js'") || src.includes('"../api.js"'),
      'Should import from ../api.js'
    );
  });
});

describe('browser-tabs.svelte.js: error handling', () => {
  it('has try/catch in openTab', () => {
    const openBlock = src.split('async openTab')[1]?.split('async ')[0] || '';
    assert.ok(openBlock.includes('catch'), 'openTab should have error handling');
  });

  it('removes tab on openTab failure', () => {
    assert.ok(src.includes('tabs.splice(idx, 1)'), 'Should remove tab on backend failure');
  });

  it('has try/catch in closeTab', () => {
    const closeBlock = src.split('async closeTab')[1]?.split('async ')[0] || '';
    assert.ok(closeBlock.includes('catch'), 'closeTab should have error handling');
  });

  it('has try/catch in switchTab', () => {
    const switchBlock = src.split('async switchTab')[1]?.split('async ')[0] || '';
    assert.ok(switchBlock.includes('catch'), 'switchTab should have error handling');
  });
});

describe('browser-tabs.svelte.js: close tab logic', () => {
  it('prevents closing last tab', () => {
    assert.ok(src.includes('tabs.length <= 1'), 'Should prevent closing when only 1 tab');
  });

  it('switches to neighbor when closing active tab', () => {
    const closeBlock = src.split('async closeTab')[1]?.split('async ')[0] || '';
    assert.ok(closeBlock.includes('activeTabId === id'), 'Should check if closing active tab');
  });

  it('calls lensSwitchTab after closing to sync backend', () => {
    const closeBlock = src.split('async closeTab')[1]?.split('async ')[0] || '';
    assert.ok(closeBlock.includes('lensSwitchTab(neighborId)'), 'Should call lensSwitchTab for the new active tab');
  });
});

describe('browser-tabs.svelte.js: clearAll', () => {
  it('resets tabs to empty', () => {
    assert.ok(src.includes('tabs.length = 0'), 'clearAll should empty tabs array');
  });

  it('resets activeTabId to null', () => {
    assert.ok(src.includes('activeTabId = null'), 'clearAll should reset activeTabId');
  });
});
