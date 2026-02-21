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

describe('TitleBar: window controls', () => {
  it('uses native decorum controls for min/max/close', () => {
    assert.ok(src.includes('data-tauri-decorum-tb'), 'Should use decorum plugin for native controls');
  });

  it('has compact/orb button', () => {
    assert.ok(src.includes('win-compact'), 'Should have compact button');
  });

  it('has decorum-controls container', () => {
    assert.ok(src.includes('decorum-controls'), 'Should have decorum-controls class');
  });
});
