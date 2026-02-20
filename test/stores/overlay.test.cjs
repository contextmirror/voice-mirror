/**
 * overlay.test.js -- Source-inspection tests for overlay.svelte.js
 *
 * Validates exports, orb states, size constants, and methods
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'overlay.svelte.js'),
  'utf-8'
);

// ============ VALID_ORB_STATES ============

describe('overlay: VALID_ORB_STATES', () => {
  const expectedStates = ['idle', 'listening', 'speaking', 'thinking', 'dictating', 'error'];

  it('defines VALID_ORB_STATES as a const', () => {
    assert.ok(src.includes('const VALID_ORB_STATES'), 'Should define const VALID_ORB_STATES');
  });

  for (const state of expectedStates) {
    it(`contains "${state}"`, () => {
      assert.ok(
        src.includes(`'${state}'`) || src.includes(`"${state}"`),
        `VALID_ORB_STATES should contain "${state}"`
      );
    });
  }

  it('exports VALID_ORB_STATES', () => {
    assert.ok(
      src.includes('export') && src.includes('VALID_ORB_STATES'),
      'Should export VALID_ORB_STATES'
    );
  });
});

// ============ Size constants ============

describe('overlay: size constants', () => {
  it('defines OVERLAY_SIZE', () => {
    assert.ok(src.includes('const OVERLAY_SIZE'), 'Should define OVERLAY_SIZE');
  });

  it('defines EXPANDED_SIZE', () => {
    assert.ok(src.includes('const EXPANDED_SIZE'), 'Should define EXPANDED_SIZE');
  });

  it('OVERLAY_SIZE has width and height', () => {
    assert.ok(src.includes('OVERLAY_SIZE') && src.includes('width') && src.includes('height'),
      'OVERLAY_SIZE should have width and height');
  });

  it('EXPANDED_SIZE has width and height', () => {
    assert.ok(src.includes('EXPANDED_SIZE') && src.includes('width') && src.includes('height'),
      'EXPANDED_SIZE should have width and height');
  });

  it('exports OVERLAY_SIZE', () => {
    assert.ok(
      src.includes('export') && src.includes('OVERLAY_SIZE'),
      'Should export OVERLAY_SIZE'
    );
  });

  it('exports EXPANDED_SIZE', () => {
    assert.ok(
      src.includes('export') && src.includes('EXPANDED_SIZE'),
      'Should export EXPANDED_SIZE'
    );
  });
});

// ============ Exports ============

describe('overlay: exports', () => {
  it('exports overlayStore', () => {
    assert.ok(src.includes('export const overlayStore'), 'Should export overlayStore');
  });

  it('creates store via createOverlayStore factory', () => {
    assert.ok(src.includes('function createOverlayStore()'), 'Should define createOverlayStore factory');
  });
});

// ============ Store methods ============

describe('overlay: store methods', () => {
  it('has setOrbState method', () => {
    assert.ok(src.includes('setOrbState('), 'Store should have setOrbState method');
  });

  it('has toggleOverlay method', () => {
    assert.ok(src.includes('async toggleOverlay()'), 'Store should have async toggleOverlay method');
  });

  it('has expand method', () => {
    assert.ok(src.includes('async expand()'), 'Store should have async expand method');
  });

  it('has compact method', () => {
    assert.ok(src.includes('async compact()'), 'Store should have async compact method');
  });

  it('has initEventListeners method', () => {
    assert.ok(src.includes('async initEventListeners()'), 'Store should have async initEventListeners method');
  });

  it('has destroyEventListeners method', () => {
    assert.ok(src.includes('destroyEventListeners()'), 'Store should have destroyEventListeners method');
  });
});

// ============ Store getters ============

describe('overlay: store getters', () => {
  it('has getter "isOverlayMode"', () => {
    assert.ok(src.includes('get isOverlayMode()'), 'Should have getter "isOverlayMode"');
  });

  it('has getter "orbState"', () => {
    assert.ok(src.includes('get orbState()'), 'Should have getter "orbState"');
  });
});

// ============ $state reactivity ============

describe('overlay: $state reactivity', () => {
  it('uses $state for isOverlayMode', () => {
    assert.ok(/let\s+isOverlayMode\s*=\s*\$state\(/.test(src), 'Should use $state for isOverlayMode');
  });

  it('uses $state for orbState', () => {
    assert.ok(/let\s+orbState\s*=\s*\$state\(/.test(src), 'Should use $state for orbState');
  });

  it('isOverlayMode initialized to false', () => {
    assert.ok(src.includes("isOverlayMode = $state(false)"), 'isOverlayMode should start as false');
  });

  it('orbState initialized to "idle"', () => {
    assert.ok(
      src.includes("orbState = $state('idle')") || src.includes('orbState = $state("idle")'),
      'orbState should start as "idle"'
    );
  });
});

// ============ setOrbState validation ============

describe('overlay: setOrbState validation', () => {
  it('validates state against VALID_ORB_STATES', () => {
    assert.ok(
      src.includes('VALID_ORB_STATES.includes(state)'),
      'setOrbState should validate against VALID_ORB_STATES'
    );
  });

  it('warns on invalid state', () => {
    assert.ok(
      src.includes('Invalid orb state'),
      'Should warn about invalid orb state'
    );
  });
});

// ============ toggleOverlay behavior ============

describe('overlay: toggleOverlay behavior', () => {
  it('toggles isOverlayMode flag', () => {
    assert.ok(
      src.includes('isOverlayMode = entering') || src.includes('isOverlayMode = !isOverlayMode'),
      'toggleOverlay should flip isOverlayMode'
    );
  });

  it('calls setAlwaysOnTop', () => {
    assert.ok(src.includes('setAlwaysOnTop'), 'Should call setAlwaysOnTop');
  });

  it('calls setWindowSize', () => {
    assert.ok(src.includes('setWindowSize'), 'Should call setWindowSize');
  });

  it('calls setResizable', () => {
    assert.ok(src.includes('setResizable'), 'Should call setResizable');
  });

  it('uses OVERLAY_SIZE dimensions for compact mode', () => {
    assert.ok(
      src.includes('OVERLAY_SIZE.width') && src.includes('OVERLAY_SIZE.height'),
      'Should use OVERLAY_SIZE for compact mode dimensions'
    );
  });

  it('persists overlay mode to config', () => {
    assert.ok(
      src.includes('updateConfig('),
      'Should persist overlay mode to config'
    );
  });

  it('reverts state on failure', () => {
    assert.ok(
      src.includes('isOverlayMode = !entering'),
      'Should revert isOverlayMode on failure'
    );
  });

  it('adds/removes overlay-mode CSS class on body', () => {
    assert.ok(
      src.includes("classList.add('overlay-mode')") || src.includes('classList.add("overlay-mode")'),
      'Should add overlay-mode class to body'
    );
    assert.ok(
      src.includes("classList.remove('overlay-mode')") || src.includes('classList.remove("overlay-mode")'),
      'Should remove overlay-mode class from body'
    );
  });
});

// ============ expand and compact ============

describe('overlay: expand and compact', () => {
  it('expand does nothing if already expanded', () => {
    assert.ok(
      src.includes('if (!isOverlayMode) return'),
      'expand() should return early if not in overlay mode'
    );
  });

  it('compact does nothing if already in overlay mode', () => {
    assert.ok(
      src.includes('if (isOverlayMode) return'),
      'compact() should return early if already in overlay mode'
    );
  });

  it('expand calls toggleOverlay', () => {
    // expand and compact both delegate to toggleOverlay
    assert.ok(
      src.includes('this.toggleOverlay()'),
      'expand/compact should delegate to toggleOverlay'
    );
  });
});

// ============ Event listeners ============

describe('overlay: event listeners', () => {
  it('listens to "voice-event" for orb state updates', () => {
    assert.ok(
      src.includes("'voice-event'") || src.includes('"voice-event"'),
      'Should listen to voice-event for orb state'
    );
  });

  it('listens to "ai-stream-token" for thinking state', () => {
    assert.ok(
      src.includes("'ai-stream-token'") || src.includes('"ai-stream-token"'),
      'Should listen to ai-stream-token'
    );
  });

  it('listens to "ai-response" for speaking state', () => {
    assert.ok(
      src.includes("'ai-response'") || src.includes('"ai-response"'),
      'Should listen to ai-response'
    );
  });

  it('listens to "ai-stream-end" for idle state', () => {
    assert.ok(
      src.includes("'ai-stream-end'") || src.includes('"ai-stream-end"'),
      'Should listen to ai-stream-end'
    );
  });

  it('listens to "ai-error" for error state', () => {
    assert.ok(
      src.includes("'ai-error'") || src.includes('"ai-error"'),
      'Should listen to ai-error'
    );
  });

  it('uses dictatingMode flag to set dictating orb state', () => {
    assert.ok(
      src.includes('dictatingMode') && src.includes("'dictating'"),
      'Should check dictatingMode flag and set dictating state'
    );
  });

  it('has setDictatingMode method', () => {
    assert.ok(
      src.includes('setDictatingMode'),
      'Should expose setDictatingMode for App.svelte to call'
    );
  });

  it('destroyEventListeners cleans up all listeners', () => {
    assert.ok(
      src.includes('eventUnlisteners'),
      'Should track event unlisteners for cleanup'
    );
  });

  it('initEventListeners calls destroyEventListeners first', () => {
    assert.ok(
      src.includes('this.destroyEventListeners()'),
      'initEventListeners should clean up previous listeners first'
    );
  });

  it('auto-recovers from error state after timeout', () => {
    assert.ok(
      src.includes('setTimeout('),
      'Should auto-recover from error state via setTimeout'
    );
  });
});
