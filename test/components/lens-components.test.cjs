/**
 * lens-components.test.js -- Source-inspection tests for Lens components
 *
 * Validates imports, structure, and key elements of LensToolbar.
 * LensPreview tests are in lens-preview.test.cjs.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LENS_DIR = path.join(__dirname, '../../src/components/lens');

function readComponent(name) {
  return fs.readFileSync(path.join(LENS_DIR, name), 'utf-8');
}

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

  it('has back button always enabled (WebView2 no-ops silently)', () => {
    assert.ok(src.includes('handleBack'), 'Should have back handler');
  });

  it('has forward button always enabled (WebView2 no-ops silently)', () => {
    assert.ok(src.includes('handleForward'), 'Should have forward handler');
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

  it('imports lensHardRefresh from api', () => {
    assert.ok(src.includes('lensHardRefresh'));
  });

  it('imports listen from tauri event', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"));
  });

  it('supports shift+click for hard refresh', () => {
    assert.ok(src.includes('event.shiftKey'));
  });

  it('listens for lens-hard-refresh event', () => {
    assert.ok(src.includes('lens-hard-refresh'));
  });

  it('has tooltip mentioning shift+click', () => {
    assert.ok(src.includes('Shift+click'));
  });
});

// ============ LensPreview ============
// Detailed LensPreview tests are in lens-preview.test.cjs
