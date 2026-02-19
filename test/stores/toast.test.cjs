/**
 * toast.test.js -- Source-inspection tests for tauri/src/lib/stores/toast.svelte.js
 *
 * Since this is a .svelte.js file that uses $state (Svelte 5 runes),
 * it cannot be directly imported in Node.js. We read the source text
 * and assert on expected patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/toast.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('toast.svelte.js -- constants', () => {
  it('defines MAX_TOASTS constant', () => {
    assert.ok(src.includes('const MAX_TOASTS'), 'Should define MAX_TOASTS');
  });

  it('sets MAX_TOASTS to 5', () => {
    assert.ok(src.includes('MAX_TOASTS = 5'), 'MAX_TOASTS should be 5');
  });

  it('defines DEFAULT_DURATION constant', () => {
    assert.ok(src.includes('const DEFAULT_DURATION'), 'Should define DEFAULT_DURATION');
  });

  it('sets DEFAULT_DURATION to 5000', () => {
    assert.ok(src.includes('DEFAULT_DURATION = 5000'), 'DEFAULT_DURATION should be 5000ms');
  });
});

describe('toast.svelte.js -- store export', () => {
  it('exports toastStore', () => {
    assert.ok(src.includes('export const toastStore'), 'Should export toastStore');
  });

  it('creates store via createToastStore factory', () => {
    assert.ok(src.includes('function createToastStore'), 'Should define createToastStore');
    assert.ok(src.includes('createToastStore()'), 'Should call createToastStore');
  });
});

describe('toast.svelte.js -- store methods', () => {
  it('has addToast method', () => {
    assert.ok(src.includes('function addToast'), 'Should have addToast method');
  });

  it('has dismissToast method', () => {
    assert.ok(src.includes('function dismissToast'), 'Should have dismissToast method');
  });

  it('has dismissAll method', () => {
    assert.ok(src.includes('function dismissAll'), 'Should have dismissAll method');
  });

  it('returns addToast, dismissToast, dismissAll in store API', () => {
    assert.ok(src.includes('addToast,'), 'Store should expose addToast');
    assert.ok(src.includes('dismissToast,'), 'Store should expose dismissToast');
    assert.ok(src.includes('dismissAll,'), 'Store should expose dismissAll');
  });

  it('exposes toasts getter', () => {
    assert.ok(
      src.includes('get toasts()'),
      'Store should expose a toasts getter'
    );
  });
});

describe('toast.svelte.js -- Toast object shape', () => {
  it('toast has id field', () => {
    assert.ok(src.includes('id,') || src.includes('id:'), 'Toast should have id');
  });

  it('toast has message field', () => {
    assert.ok(src.includes('message,') || src.includes('message:'), 'Toast should have message');
  });

  it('toast has severity field', () => {
    assert.ok(src.includes('severity'), 'Toast should have severity');
  });

  it('toast has duration field', () => {
    assert.ok(src.includes('duration'), 'Toast should have duration');
  });

  it('toast has createdAt field', () => {
    assert.ok(src.includes('createdAt:'), 'Toast should have createdAt timestamp');
  });

  it('toast has optional action field', () => {
    assert.ok(src.includes('action'), 'Toast should support optional action');
  });

  it('severity defaults to info', () => {
    assert.ok(src.includes("severity = 'info'"), 'severity should default to info');
  });
});

describe('toast.svelte.js -- reactivity', () => {
  it('uses $state for reactivity', () => {
    assert.ok(src.includes('$state('), 'Should use Svelte 5 $state rune');
  });

  it('initializes toasts as empty $state array', () => {
    assert.ok(src.includes('$state([])'), 'Should initialize toasts as $state([])');
  });
});

describe('toast.svelte.js -- auto-dismiss behavior', () => {
  it('has scheduleDismiss function', () => {
    assert.ok(src.includes('function scheduleDismiss'), 'Should have scheduleDismiss');
  });

  it('uses window.setTimeout for auto-dismiss', () => {
    assert.ok(src.includes('window.setTimeout'), 'Should use window.setTimeout');
  });

  it('uses clearTimeout when dismissing', () => {
    assert.ok(src.includes('clearTimeout'), 'Should clear timer on dismiss');
  });

  it('tracks timers with a Map', () => {
    assert.ok(src.includes('new Map()'), 'Should track timers in a Map');
  });
});

describe('toast.svelte.js -- max toast enforcement', () => {
  it('checks toasts.length against MAX_TOASTS before adding', () => {
    assert.ok(
      src.includes('toasts.length >= MAX_TOASTS'),
      'Should enforce MAX_TOASTS limit'
    );
  });

  it('dismisses oldest toast when over limit', () => {
    assert.ok(
      src.includes('toasts[0]'),
      'Should reference oldest toast (index 0) for dismissal'
    );
  });
});

describe('toast.svelte.js -- uid import', () => {
  it('imports uid from utils', () => {
    assert.ok(
      src.includes("import { uid } from '../utils.js'") ||
      src.includes("import { uid } from '../utils'"),
      'Should import uid from utils module'
    );
  });

  it('uses uid() for toast IDs', () => {
    assert.ok(src.includes('uid()'), 'Should use uid() to generate toast IDs');
  });
});

describe('toast.svelte.js -- severity levels documented', () => {
  it('documents info severity', () => {
    assert.ok(src.includes('info'), 'Should document info severity');
  });

  it('documents success severity', () => {
    assert.ok(src.includes('success'), 'Should document success severity');
  });

  it('documents warning severity', () => {
    assert.ok(src.includes('warning'), 'Should document warning severity');
  });

  it('documents error severity', () => {
    assert.ok(src.includes('error'), 'Should document error severity');
  });
});
