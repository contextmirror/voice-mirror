/**
 * lens-preview.test.cjs -- Source-inspection tests for LensPreview.svelte
 *
 * Validates the Lens preview component including browser tab integration.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensPreview.svelte'),
  'utf-8'
);

describe('LensPreview.svelte: browser tabs integration', () => {
  it('imports browserTabsStore', () => {
    assert.ok(src.includes('browserTabsStore'), 'Should import browserTabsStore');
  });

  it('imports from browser-tabs.svelte.js', () => {
    assert.ok(src.includes('browser-tabs.svelte.js'), 'Should import from browser-tabs store path');
  });

  it('exports createNewTab function', () => {
    assert.ok(src.includes('export function createNewTab'), 'Should export createNewTab');
  });

  it('createNewTab uses browserTabsStore.openTab', () => {
    assert.ok(src.includes('browserTabsStore.openTab'), 'createNewTab should call browserTabsStore.openTab');
  });

  it('imports lensCloseAllTabs from api', () => {
    assert.ok(src.includes('lensCloseAllTabs'), 'Should import lensCloseAllTabs');
  });

  it('listens for lens-open-tab events', () => {
    assert.ok(src.includes('lens-open-tab'), 'Should listen for lens-open-tab event');
  });

  it('calls clearAll on destroy', () => {
    assert.ok(src.includes('browserTabsStore.clearAll()'), 'Should clear all tabs on unmount');
  });

  it('syncs lensStore URL when active browser tab changes', () => {
    assert.ok(src.includes('browserTabsStore.activeTab'), 'Should watch active browser tab');
    assert.ok(src.includes('lensStore.setUrl(active.url)'), 'Should sync URL to lensStore');
  });
});

describe('LensPreview.svelte: core imports', () => {
  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'), 'Should import lensStore');
  });

  it('imports DEFAULT_URL', () => {
    assert.ok(src.includes('DEFAULT_URL'), 'Should import DEFAULT_URL');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports lensResizeWebview', () => {
    assert.ok(src.includes('lensResizeWebview'), 'Should import lensResizeWebview');
  });

  it('imports listen from tauri events', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"), 'Should import from tauri events');
  });
});

describe('LensPreview.svelte: webview lifecycle', () => {
  it('uses onMount for webview creation', () => {
    assert.ok(src.includes('onMount'), 'Should use onMount');
  });

  it('uses onDestroy for cleanup', () => {
    assert.ok(src.includes('onDestroy'), 'Should use onDestroy');
  });

  it('listens for lens-url-changed events', () => {
    assert.ok(src.includes('lens-url-changed'), 'Should listen for URL change events');
  });

  it('has retry logic for webview creation', () => {
    assert.ok(src.includes('MAX_RETRIES'), 'Should have retry limit');
    assert.ok(src.includes('scheduleRetry'), 'Should have retry scheduling');
  });

  it('has loading timeout safety net', () => {
    assert.ok(src.includes('LOADING_TIMEOUT_MS'), 'Should have loading timeout');
  });
});

describe('LensPreview.svelte: bounds handling', () => {
  it('has getAbsoluteBounds helper', () => {
    assert.ok(src.includes('getAbsoluteBounds'), 'Should have getAbsoluteBounds');
  });

  it('has syncBounds helper', () => {
    assert.ok(src.includes('syncBounds'), 'Should have syncBounds for resize');
  });

  it('uses ResizeObserver', () => {
    assert.ok(src.includes('ResizeObserver'), 'Should observe container resize');
  });
});

describe('LensPreview.svelte: dev server detection', () => {
  it('imports detectDevServers', () => {
    assert.ok(src.includes('detectDevServers'), 'Should import detectDevServers');
  });

  it('has detectAndNavigate function', () => {
    assert.ok(src.includes('detectAndNavigate'), 'Should have detectAndNavigate');
  });

  it('imports devServerManager', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
  });
});
