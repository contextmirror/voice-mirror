/**
 * overlay-components.test.js -- Source-inspection tests for tauri/src/components/overlay/
 *
 * Tests Orb.svelte and OverlayPanel.svelte.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OVERLAY_DIR = path.join(__dirname, '../../src/components/overlay');

function readComponent(name) {
  return fs.readFileSync(path.join(OVERLAY_DIR, name), 'utf-8');
}

// ---- Orb.svelte ----

describe('Orb.svelte', () => {
  const src = readComponent('Orb.svelte');

  it('uses $props for state, size, onclick', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('state:'), 'Should accept state prop (renamed as orbState)');
    assert.ok(src.includes('size'), 'Should accept size prop');
    assert.ok(src.includes('onclick'), 'Should accept onclick prop');
  });

  it('defaults orbState to idle', () => {
    assert.ok(src.includes("orbState = 'idle'"), 'Should default orbState to idle');
  });

  it('defaults size to 80', () => {
    assert.ok(src.includes('size = 80'), 'Should default size to 80');
  });

  it('has canvas element', () => {
    assert.ok(src.includes('<canvas'), 'Should have a canvas element');
  });

  it('binds canvas element via bind:this', () => {
    assert.ok(src.includes('bind:this={canvasEl}'), 'Should bind canvas ref');
  });

  it('has orb-canvas CSS class', () => {
    assert.ok(src.includes('.orb-canvas'), 'Should have orb-canvas CSS class');
  });

  it('has orb-wrapper CSS class', () => {
    assert.ok(src.includes('.orb-wrapper'), 'Should have orb-wrapper CSS class');
  });

  it('has -webkit-app-region: no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag for frameless window');
  });

  it('has z-index: 10001', () => {
    assert.ok(src.includes('z-index: 10001'), 'Should have high z-index above resize edges');
  });

  it('has aria-label for accessibility', () => {
    assert.ok(src.includes('aria-label='), 'Should have aria-label');
    assert.ok(src.includes('AI status orb'), 'Should describe orb state');
  });

  it('has role="button" (conditional for non-static)', () => {
    assert.ok(src.includes("role="), 'Should have button role');
    assert.ok(src.includes("'button'"), 'Should reference button role string');
  });

  it('has tabindex for keyboard accessibility', () => {
    assert.ok(src.includes('tabindex='), 'Should be keyboard focusable');
  });

  it('uses preset-driven animation system', () => {
    assert.ok(src.includes('activePreset'), 'Should use activePreset for rendering');
    assert.ok(src.includes('resolveOrbPreset'), 'Should import resolveOrbPreset');
    assert.ok(src.includes('ORB_PRESETS'), 'Should import ORB_PRESETS');
  });

  it('has state-based color shifting via applyStateColor', () => {
    assert.ok(src.includes('function applyStateColor'), 'Should have applyStateColor function');
  });

  it('handles listening state via drawHumanIcon or preset icon style', () => {
    assert.ok(src.includes("'listening'"), 'Should reference listening state');
    assert.ok(src.includes('drawHumanIcon') || src.includes('drawGeometricIcon'), 'Should have icon for listening');
  });

  it('handles speaking state via drawRobotIcon or preset icon style', () => {
    assert.ok(src.includes("'speaking'"), 'Should reference speaking state');
    assert.ok(src.includes('drawRobotIcon') || src.includes('drawGeometricIcon'), 'Should have icon for speaking');
  });

  it('handles thinking state via drawThinkingDot', () => {
    assert.ok(src.includes("'thinking'"), 'Should reference thinking state');
    assert.ok(src.includes('drawThinkingDot'), 'Should have thinking dot');
  });

  it('handles error state via drawErrorX', () => {
    assert.ok(src.includes("'error'"), 'Should reference error state');
    assert.ok(src.includes('drawErrorX'), 'Should have error X icon');
  });

  it('handles dictating state via drawWaveformBars or preset icon style', () => {
    assert.ok(src.includes("'dictating'"), 'Should reference dictating state');
    assert.ok(src.includes('drawWaveformBars') || src.includes('drawGeometricIcon'), 'Should have icon for dictating');
  });

  it('has renderOrb function for Canvas 2D drawing', () => {
    assert.ok(src.includes('function renderOrb'), 'Should have renderOrb function');
  });

  it('creates radial gradient for orb body', () => {
    assert.ok(src.includes('createRadialGradient'), 'Should use radial gradient');
  });

  it('draws human icon for listening state', () => {
    assert.ok(src.includes('drawHumanIcon'), 'Should draw human icon');
  });

  it('draws robot icon for speaking state', () => {
    assert.ok(src.includes('drawRobotIcon'), 'Should draw robot icon');
  });

  it('draws waveform bars for dictating state', () => {
    assert.ok(src.includes('drawWaveformBars'), 'Should draw waveform bars');
  });

  it('draws thinking dot for thinking state', () => {
    assert.ok(src.includes('drawThinkingDot'), 'Should draw thinking dot');
  });

  it('draws error X for error state', () => {
    assert.ok(src.includes('drawErrorX'), 'Should draw error X');
  });

  it('derives orbColors from theme', () => {
    assert.ok(src.includes('orbColors'), 'Should derive orbColors');
    assert.ok(src.includes('resolveTheme'), 'Should use resolveTheme');
    assert.ok(src.includes('hexToRgb'), 'Should use hexToRgb');
  });

  it('uses requestAnimationFrame for animation loop', () => {
    assert.ok(src.includes('requestAnimationFrame'), 'Should use rAF for animation');
  });

  it('cancels animation frame on cleanup', () => {
    assert.ok(src.includes('cancelAnimationFrame'), 'Should cancel rAF on cleanup');
  });

  it('supports prefers-reduced-motion', () => {
    assert.ok(src.includes('prefers-reduced-motion'), 'Should detect reduced motion');
    assert.ok(src.includes('reducedMotion'), 'Should track reducedMotion state');
  });

  it('supports HiDPI rendering', () => {
    assert.ok(src.includes('devicePixelRatio'), 'Should handle HiDPI');
  });

  it('handles keyboard Enter/Space for click', () => {
    assert.ok(src.includes("e.key === 'Enter'"), 'Should handle Enter key');
    assert.ok(src.includes("e.key === ' '"), 'Should handle Space key');
  });
});

// ---- OverlayPanel.svelte ----

describe('OverlayPanel.svelte', () => {
  const src = readComponent('OverlayPanel.svelte');

  it('imports Orb component', () => {
    assert.ok(src.includes("import Orb from './Orb.svelte'"), 'Should import Orb');
  });

  it('imports overlayStore', () => {
    assert.ok(src.includes("import { overlayStore }"), 'Should import overlayStore');
  });

  it('imports configStore', () => {
    assert.ok(src.includes("import { configStore }"), 'Should import configStore');
  });

  it('imports getCurrentWindow from Tauri API', () => {
    assert.ok(src.includes("import { getCurrentWindow }"), 'Should import getCurrentWindow');
  });

  it('has overlay-panel CSS class', () => {
    assert.ok(src.includes('.overlay-panel'), 'Should have overlay-panel CSS');
  });

  it('has orb-container CSS class', () => {
    assert.ok(src.includes('.orb-container'), 'Should have orb-container CSS');
  });

  it('has transparent background', () => {
    assert.ok(src.includes('background: transparent'), 'Should have transparent background');
  });

  it('renders Orb component', () => {
    assert.ok(src.includes('<Orb'), 'Should render Orb component');
  });

  it('derives orbState from overlayStore', () => {
    assert.ok(src.includes('overlayStore.orbState'), 'Should derive orbState from store');
  });

  it('derives orbSize from configStore', () => {
    assert.ok(src.includes('configStore.value'), 'Should get orbSize from config');
    assert.ok(src.includes('orbSize'), 'Should have orbSize derived');
  });

  it('has drag support via startDragging', () => {
    assert.ok(src.includes('startDragging'), 'Should support window dragging');
  });

  it('has drag vs click detection with threshold', () => {
    assert.ok(src.includes('dragStart'), 'Should track drag start position');
    assert.ok(src.includes('hasDragged'), 'Should detect if user dragged');
  });

  it('uses 3px movement threshold for drag detection', () => {
    assert.ok(src.includes('> 3'), 'Should use 3px threshold');
  });

  it('calls overlayStore.expand on orb click', () => {
    assert.ok(src.includes('overlayStore.expand'), 'Should expand on click');
  });

  it('has pointer event handlers', () => {
    assert.ok(src.includes('onpointerdown'), 'Should handle pointer down');
    assert.ok(src.includes('onpointermove'), 'Should handle pointer move');
  });

  it('has grab cursor for drag affordance', () => {
    assert.ok(src.includes('cursor: grab'), 'Should show grab cursor');
    assert.ok(src.includes('cursor: grabbing'), 'Should show grabbing cursor on active');
  });

  it('has z-index: 10001 on orb container', () => {
    assert.ok(src.includes('z-index: 10001'), 'Should have high z-index');
  });
});
