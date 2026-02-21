/**
 * shortcuts.test.js -- Source-inspection tests for shortcuts.svelte.js
 *
 * Validates exports, default shortcuts, handler registration, and in-app
 * keyboard handling by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'shortcuts.svelte.js'),
  'utf-8'
);

// ============ Exports ============

describe('shortcuts: exports', () => {
  it('exports shortcutsStore', () => {
    assert.ok(src.includes('export const shortcutsStore'), 'Should export shortcutsStore');
  });

  it('exports DEFAULT_GLOBAL_SHORTCUTS', () => {
    assert.ok(
      src.includes('export const DEFAULT_GLOBAL_SHORTCUTS'),
      'Should export DEFAULT_GLOBAL_SHORTCUTS'
    );
  });

  it('exports IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes('export const IN_APP_SHORTCUTS'),
      'Should export IN_APP_SHORTCUTS'
    );
  });

  it('exports setActionHandler', () => {
    assert.ok(
      src.includes('export function setActionHandler'),
      'Should export setActionHandler'
    );
  });

  it('exports setReleaseHandler', () => {
    assert.ok(
      src.includes('export function setReleaseHandler'),
      'Should export setReleaseHandler'
    );
  });

  it('exports getActionHandler', () => {
    assert.ok(
      src.includes('export function getActionHandler'),
      'Should export getActionHandler'
    );
  });

  it('exports setupInAppShortcuts', () => {
    assert.ok(
      src.includes('export function setupInAppShortcuts'),
      'Should export setupInAppShortcuts'
    );
  });
});

// ============ DEFAULT_GLOBAL_SHORTCUTS entries ============

describe('shortcuts: DEFAULT_GLOBAL_SHORTCUTS entries', () => {
  const expectedGlobals = [
    { id: 'toggle-voice', keys: 'Ctrl+Shift+Space', label: 'Toggle voice recording' },
    { id: 'toggle-mute', keys: 'Ctrl+Shift+M', label: 'Toggle mute' },
    { id: 'toggle-overlay', keys: 'Ctrl+Shift+O', label: 'Toggle overlay mode' },
    { id: 'toggle-window', keys: 'Ctrl+Shift+H', label: 'Show/hide window' },
  ];

  for (const { id, keys, label } of expectedGlobals) {
    it(`has entry "${id}" with keys "${keys}"`, () => {
      assert.ok(
        src.includes(`'${id}'`) || src.includes(`"${id}"`),
        `DEFAULT_GLOBAL_SHORTCUTS should contain "${id}"`
      );
      assert.ok(
        src.includes(`'${keys}'`) || src.includes(`"${keys}"`),
        `"${id}" should have keys "${keys}"`
      );
    });

    it(`"${id}" has label "${label}"`, () => {
      assert.ok(
        src.includes(`'${label}'`) || src.includes(`"${label}"`),
        `"${id}" should have label "${label}"`
      );
    });

    it(`"${id}" has category "global"`, () => {
      // The global shortcuts all have category: 'global'
      assert.ok(src.includes("category: 'global'"), 'Global shortcuts should have category "global"');
    });
  }
});

// ============ IN_APP_SHORTCUTS entries ============

describe('shortcuts: IN_APP_SHORTCUTS entries', () => {
  const expectedInApp = [
    { id: 'open-settings', keys: 'Ctrl+,', label: 'Open settings' },
    { id: 'new-chat', keys: 'Ctrl+N', label: 'New chat' },
    { id: 'switch-terminal', keys: 'Ctrl+T', label: 'Switch to terminal' },
    { id: 'close-panel', keys: 'Escape', label: 'Close current panel/modal' },
    { id: 'open-file-search', keys: 'F1', label: 'Search files and commands' },
  ];

  for (const { id, keys, label } of expectedInApp) {
    it(`has entry "${id}" with keys "${keys}"`, () => {
      assert.ok(
        src.includes(`'${id}'`) || src.includes(`"${id}"`),
        `IN_APP_SHORTCUTS should contain "${id}"`
      );
      assert.ok(
        src.includes(`'${keys}'`) || src.includes(`"${keys}"`),
        `"${id}" should have keys "${keys}"`
      );
    });

    it(`"${id}" has label "${label}"`, () => {
      assert.ok(
        src.includes(`'${label}'`) || src.includes(`"${label}"`),
        `"${id}" should have label "${label}"`
      );
    });
  }

  it('in-app shortcuts have category "in-app"', () => {
    assert.ok(src.includes("category: 'in-app'"), 'In-app shortcuts should have category "in-app"');
  });
});

// ============ Store init method ============

describe('shortcuts: store init method', () => {
  it('has async init method', () => {
    assert.ok(
      src.includes('async init('),
      'Store should have an async init method'
    );
  });

  it('init checks if already initialized', () => {
    assert.ok(
      src.includes('if (initialized) return'),
      'init should guard against double-initialization'
    );
  });

  it('init registers global shortcuts with registerShortcut', () => {
    assert.ok(
      src.includes('registerShortcut(id, binding.keys)') || src.includes('registerShortcut('),
      'init should register global shortcuts via registerShortcut'
    );
  });

  it('init sets initialized to true at the end', () => {
    assert.ok(
      src.includes('initialized = true'),
      'init should set initialized = true'
    );
  });

  it('has destroy method for cleanup', () => {
    assert.ok(
      src.includes('async destroy()'),
      'Store should have an async destroy method'
    );
  });

  it('has rebind method for changing key bindings', () => {
    assert.ok(
      src.includes('async rebind('),
      'Store should have an async rebind method'
    );
  });
});

// ============ setupInAppShortcuts ============

describe('shortcuts: setupInAppShortcuts', () => {
  it('adds a keydown event listener', () => {
    assert.ok(
      src.includes("addEventListener('keydown'") || src.includes('addEventListener("keydown"'),
      'setupInAppShortcuts should add a keydown listener'
    );
  });

  it('returns a cleanup function that removes the listener', () => {
    assert.ok(
      src.includes("removeEventListener('keydown'") || src.includes('removeEventListener("keydown"'),
      'Should return a cleanup that removes the keydown listener'
    );
  });

  it('checks for Ctrl/Meta key', () => {
    assert.ok(
      src.includes('event.ctrlKey') || src.includes('event.metaKey'),
      'Should check for Ctrl or Meta key modifier'
    );
  });

  it('skips shortcuts in INPUT/TEXTAREA (except Escape)', () => {
    assert.ok(src.includes('INPUT'), 'Should skip shortcuts in INPUT elements');
    assert.ok(src.includes('TEXTAREA'), 'Should skip shortcuts in TEXTAREA elements');
    assert.ok(src.includes('isContentEditable'), 'Should skip shortcuts in contentEditable elements');
  });

  it('handles Ctrl+, for open-settings', () => {
    assert.ok(
      src.includes("event.key === ','") || src.includes("key === ','"),
      'Should handle Ctrl+, for open-settings'
    );
  });

  it('handles Ctrl+N for new-chat', () => {
    assert.ok(
      src.includes("event.key === 'n'") || src.includes("key === 'n'"),
      'Should handle Ctrl+N for new-chat'
    );
  });

  it('handles Ctrl+T for switch-terminal', () => {
    assert.ok(
      src.includes("event.key === 't'") || src.includes("key === 't'"),
      'Should handle Ctrl+T for switch-terminal'
    );
  });

  it('handles F1 for open-file-search', () => {
    assert.ok(
      src.includes("event.key === 'F1'") || src.includes("key === 'F1'"),
      'Should handle F1 for open-file-search'
    );
    assert.ok(
      src.includes("actionHandlers['open-file-search']"),
      'Should dispatch to open-file-search action handler'
    );
  });

  it('handles Escape for close-panel', () => {
    assert.ok(
      src.includes("event.key === 'Escape'") || src.includes("key === 'Escape'"),
      'Should handle Escape for close-panel'
    );
  });

  it('calls event.preventDefault() on matched shortcuts', () => {
    assert.ok(
      src.includes('event.preventDefault()'),
      'Should call event.preventDefault() on matched shortcuts'
    );
  });
});

// ============ Handler registration ============

describe('shortcuts: handler registration', () => {
  it('setActionHandler validates handler is a function', () => {
    assert.ok(
      src.includes("typeof handler !== 'function'") || src.includes('typeof handler !== "function"'),
      'setActionHandler should validate handler type'
    );
  });

  it('setReleaseHandler validates handler is a function', () => {
    // Both setActionHandler and setReleaseHandler check typeof
    const matches = src.match(/typeof handler !== 'function'/g) || src.match(/typeof handler !== "function"/g);
    assert.ok(matches && matches.length >= 2, 'Both handler setters should validate function type');
  });

  it('stores action handlers in actionHandlers map', () => {
    assert.ok(src.includes('actionHandlers[id] = handler'), 'Should store handler in actionHandlers');
  });

  it('stores release handlers in releaseHandlers map', () => {
    assert.ok(src.includes('releaseHandlers[id] = handler'), 'Should store handler in releaseHandlers');
  });

  it('getActionHandler returns from actionHandlers map', () => {
    assert.ok(
      src.includes('return actionHandlers[id]'),
      'getActionHandler should return from actionHandlers'
    );
  });
});

// ============ $state reactivity ============

describe('shortcuts: $state reactivity', () => {
  it('uses $state for bindings', () => {
    assert.ok(/let\s+bindings\s*=\s*\$state\(/.test(src), 'Should use $state for bindings');
  });

  it('uses $state for initialized', () => {
    assert.ok(/let\s+initialized\s*=\s*\$state\(/.test(src), 'Should use $state for initialized');
  });

  it('uses $state for error', () => {
    assert.ok(/let\s+error\s*=\s*\$state\(/.test(src), 'Should use $state for error');
  });
});

// ============ Tauri event listeners ============

describe('shortcuts: Tauri event listeners', () => {
  it('listens to "shortcut-pressed" events', () => {
    assert.ok(
      src.includes("'shortcut-pressed'") || src.includes('"shortcut-pressed"'),
      'Should listen for shortcut-pressed events'
    );
  });

  it('listens to "shortcut-released" events', () => {
    assert.ok(
      src.includes("'shortcut-released'") || src.includes('"shortcut-released"'),
      'Should listen for shortcut-released events'
    );
  });

  it('dispatches to actionHandlers on press', () => {
    assert.ok(
      src.includes('actionHandlers[id]') || src.includes('const handler = actionHandlers[id]'),
      'Should dispatch to actionHandlers on press'
    );
  });

  it('dispatches to releaseHandlers on release', () => {
    assert.ok(
      src.includes('releaseHandlers[id]') || src.includes('const handler = releaseHandlers[id]'),
      'Should dispatch to releaseHandlers on release'
    );
  });
});
