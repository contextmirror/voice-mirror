/**
 * lens-components.test.js -- Source-inspection tests for Lens components
 *
 * Validates imports, structure, and key elements of LensPanel, LensToolbar,
 * and LensPreview by reading source files and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LENS_DIR = path.join(__dirname, '../../src/components/lens');

function readComponent(name) {
  return fs.readFileSync(path.join(LENS_DIR, name), 'utf-8');
}

// ============ LensPanel ============

describe('LensPanel.svelte', () => {
  const src = readComponent('LensPanel.svelte');

  it('imports LensToolbar', () => {
    assert.ok(src.includes("import LensToolbar from './LensToolbar.svelte'"));
  });

  it('imports LensPreview', () => {
    assert.ok(src.includes("import LensPreview from './LensPreview.svelte'"));
  });

  it('has lens-panel CSS class', () => {
    assert.ok(src.includes('.lens-panel'));
  });

  it('renders LensToolbar', () => {
    assert.ok(src.includes('<LensToolbar'));
  });

  it('renders LensPreview', () => {
    assert.ok(src.includes('<LensPreview'));
  });

  it('uses flex column layout', () => {
    assert.ok(src.includes('flex-direction: column'));
  });

  it('has height 100%', () => {
    assert.ok(src.includes('height: 100%'));
  });
});

// ============ LensToolbar ============

describe('LensToolbar.svelte', () => {
  const src = readComponent('LensToolbar.svelte');

  it('imports lensStore', () => {
    assert.ok(src.includes('import { lensStore }'));
  });

  it('has url-input element', () => {
    assert.ok(src.includes('url-input'));
  });

  it('has back button with aria-label', () => {
    assert.ok(src.includes('Go back'));
  });

  it('has forward button with aria-label', () => {
    assert.ok(src.includes('Go forward'));
  });

  it('has reload button with aria-label', () => {
    assert.ok(src.includes('Reload'));
  });

  it('has lens-toolbar CSS class', () => {
    assert.ok(src.includes('.lens-toolbar'));
  });

  it('has form with onsubmit', () => {
    assert.ok(src.includes('onsubmit'));
  });

  it('disables back when canGoBack is false', () => {
    assert.ok(src.includes('lensStore.canGoBack'));
  });

  it('disables forward when canGoForward is false', () => {
    assert.ok(src.includes('lensStore.canGoForward'));
  });

  it('binds url input value', () => {
    assert.ok(src.includes('bind:value'));
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'));
  });

  it('is a browser-only toolbar (no toggle props)', () => {
    assert.ok(!src.includes('showChat'), 'LensToolbar should not have showChat prop');
    assert.ok(!src.includes('showTerminal'), 'LensToolbar should not have showTerminal prop');
  });
});

// ============ LensPreview ============

describe('LensPreview.svelte', () => {
  const src = readComponent('LensPreview.svelte');

  it('imports lensCreateWebview from api', () => {
    assert.ok(src.includes('lensCreateWebview'));
  });

  it('imports lensResizeWebview from api', () => {
    assert.ok(src.includes('lensResizeWebview'));
  });

  it('imports lensCloseWebview from api', () => {
    assert.ok(src.includes('lensCloseWebview'));
  });

  it('imports listen from tauri event', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"));
  });

  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'));
  });

  it('uses bind:this for container', () => {
    assert.ok(src.includes('bind:this={containerEl}'));
  });

  it('uses ResizeObserver for bounds syncing', () => {
    assert.ok(src.includes('ResizeObserver'));
  });

  it('uses getBoundingClientRect for position', () => {
    assert.ok(src.includes('getBoundingClientRect'));
  });

  it('has lens-preview CSS class', () => {
    assert.ok(src.includes('.lens-preview'));
  });

  it('has loading state display', () => {
    assert.ok(src.includes('webviewReady'));
  });

  it('listens for lens-url-changed event', () => {
    assert.ok(src.includes('lens-url-changed'));
  });

  it('cleans up webview on unmount', () => {
    // The cleanup function should call lensCloseWebview
    const cleanupSection = src.split('return () =>').pop() || '';
    assert.ok(cleanupSection.includes('lensCloseWebview'), 'Cleanup should close webview');
  });

  it('uses $effect for lifecycle', () => {
    assert.ok(src.includes('$effect'), 'Should use $effect for setup/cleanup');
  });

  it('debounces resize observer', () => {
    assert.ok(src.includes('setTimeout'), 'Should debounce resize updates');
  });
});
