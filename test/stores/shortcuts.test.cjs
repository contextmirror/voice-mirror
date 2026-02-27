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
    { id: 'toggle-voice', keys: 'Ctrl+Shift+;', label: 'Toggle voice recording' },
    { id: 'toggle-mute', keys: 'Ctrl+Shift+U', label: 'Toggle mute' },
    { id: 'toggle-overlay', keys: 'Ctrl+Shift+Y', label: 'Toggle overlay mode' },
    { id: 'toggle-window', keys: 'Ctrl+Shift+H', label: 'Show/hide window' },
    { id: 'stats-dashboard', keys: 'Ctrl+Shift+D', label: 'Toggle stats dashboard' },
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
    { id: 'open-text-search', keys: 'Ctrl+Shift+F', label: 'Search in files' },
    { id: 'new-terminal', keys: "Ctrl+Shift+'", label: 'New terminal' },
    { id: 'split-terminal', keys: 'Ctrl+Shift+5', label: 'Split terminal' },
    { id: 'toggle-terminal', keys: 'Ctrl+`', label: 'Toggle terminal panel' },
    { id: 'focus-prev-pane', keys: 'Alt+Left', label: 'Focus previous terminal pane' },
    { id: 'focus-next-pane', keys: 'Alt+Right', label: 'Focus next terminal pane' },
    { id: 'kill-terminal', keys: 'Delete', label: 'Kill terminal' },
    { id: 'rename-terminal', keys: 'F2', label: 'Rename terminal' },
    { id: 'close-tab', keys: 'Ctrl+W', label: 'Close active editor tab' },
    { id: 'toggle-sidebar', keys: 'Ctrl+B', label: 'Toggle sidebar' },
    { id: 'toggle-bottom-panel', keys: 'Ctrl+J', label: 'Toggle bottom panel' },
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

  it('handles Ctrl+Shift+P for open-file-search (avoids browser print dialog)', () => {
    assert.ok(
      src.includes("event.key === 'P'") || src.includes("key === 'P'"),
      'Should handle Ctrl+Shift+P for quick file open'
    );
  });

  it('handles Ctrl+Shift+F for open-text-search', () => {
    assert.ok(
      src.includes("event.shiftKey") && src.includes("event.key === 'F'"),
      'Should handle Ctrl+Shift+F for open-text-search'
    );
    assert.ok(
      src.includes("actionHandlers['open-text-search']"),
      'Should dispatch to open-text-search action handler'
    );
  });

  it('Ctrl+Shift+F works even inside INPUT/TEXTAREA', () => {
    // The Ctrl+Shift+F check is placed BEFORE the INPUT/TEXTAREA guard
    const shiftFIndex = src.indexOf("event.key === 'F'");
    const inputGuardIndex = src.indexOf("tag === 'INPUT'");
    assert.ok(
      shiftFIndex < inputGuardIndex,
      'Ctrl+Shift+F handler should be before INPUT/TEXTAREA guard'
    );
  });

  it('handles Escape for close-panel', () => {
    assert.ok(
      src.includes("event.key === 'Escape'") || src.includes("key === 'Escape'"),
      'Should handle Escape for close-panel'
    );
  });

  it('lets CodeMirror handle Escape when editor is focused', () => {
    assert.ok(
      src.includes('.cm-editor'),
      'Should check for .cm-editor to let CodeMirror handle Escape first'
    );
  });

  it('calls event.preventDefault() on matched shortcuts', () => {
    assert.ok(
      src.includes('event.preventDefault()'),
      'Should call event.preventDefault() on matched shortcuts'
    );
  });

  it('handles Ctrl+Shift+\' for new-terminal', () => {
    assert.ok(
      src.includes("event.key === \"'\"") || src.includes("event.key === '\\''"),
      'Should handle Ctrl+Shift+\' for new-terminal'
    );
    assert.ok(
      src.includes("actionHandlers['new-terminal']"),
      'Should dispatch to new-terminal action handler'
    );
  });

  it('handles Ctrl+Shift+5 for split-terminal', () => {
    assert.ok(
      src.includes("event.key === '5'"),
      'Should handle Ctrl+Shift+5 for split-terminal'
    );
    assert.ok(
      src.includes("actionHandlers['split-terminal']"),
      'Should dispatch to split-terminal action handler'
    );
  });

  it('handles Ctrl+` for toggle-terminal', () => {
    assert.ok(
      src.includes("event.key === '`'"),
      'Should handle Ctrl+` for toggle-terminal'
    );
    assert.ok(
      src.includes("actionHandlers['toggle-terminal']"),
      'Should dispatch to toggle-terminal action handler'
    );
  });

  it('handles Alt+Left for focus-prev-pane', () => {
    assert.ok(
      src.includes('event.altKey') && src.includes("event.key === 'ArrowLeft'"),
      'Should handle Alt+Left for focus-prev-pane'
    );
    assert.ok(
      src.includes("actionHandlers['focus-prev-pane']"),
      'Should dispatch to focus-prev-pane action handler'
    );
  });

  it('handles Alt+Right for focus-next-pane', () => {
    assert.ok(
      src.includes('event.altKey') && src.includes("event.key === 'ArrowRight'"),
      'Should handle Alt+Right for focus-next-pane'
    );
    assert.ok(
      src.includes("actionHandlers['focus-next-pane']"),
      'Should dispatch to focus-next-pane action handler'
    );
  });

  it('Alt+Left/Right requires no Ctrl modifier to avoid chord conflicts', () => {
    // The Alt+Arrow handlers should check !ctrl to avoid conflict with Ctrl+K chord
    assert.ok(
      src.includes("event.altKey && !ctrl") || src.includes("altKey && !ctrl"),
      'Alt+Arrow handlers should require no Ctrl modifier'
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

  it('setActionHandler accepts null to unregister a handler', () => {
    assert.ok(
      src.includes('handler === null') || src.includes('handler === undefined'),
      'setActionHandler should accept null/undefined for unregistration'
    );
    assert.ok(
      src.includes('delete actionHandlers[id]'),
      'Should delete the handler entry when null is passed'
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

// ============ Split editor keybindings ============

describe('shortcuts: split editor keybindings', () => {
  it('has split-editor in IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes("'split-editor'") || src.includes('"split-editor"'),
      'IN_APP_SHORTCUTS should contain split-editor'
    );
  });

  it('has focus-group-1 in IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes("'focus-group-1'") || src.includes('"focus-group-1"'),
      'IN_APP_SHORTCUTS should contain focus-group-1'
    );
  });

  it('has focus-group-2 in IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes("'focus-group-2'") || src.includes('"focus-group-2"'),
      'IN_APP_SHORTCUTS should contain focus-group-2'
    );
  });

  it('handles Ctrl+\\ for split-editor', () => {
    assert.ok(
      src.includes("event.key === '\\\\'") || src.includes("'Ctrl+\\\\'") || src.includes("Ctrl+\\\\"),
      'Should handle Ctrl+\\ for split-editor'
    );
  });

  it('handles Ctrl+1 for focus-group-1', () => {
    assert.ok(
      src.includes("event.key === '1'") || src.includes("'Ctrl+1'") || src.includes("Ctrl+1"),
      'Should handle Ctrl+1 for focus-group-1'
    );
  });

  it('handles Ctrl+2 for focus-group-2', () => {
    assert.ok(
      src.includes("event.key === '2'") || src.includes("'Ctrl+2'") || src.includes("Ctrl+2"),
      'Should handle Ctrl+2 for focus-group-2'
    );
  });

  it('Ctrl+1/2 skips when inside .cm-editor', () => {
    // The .cm-editor guard should also cover the group focus shortcuts
    assert.ok(
      src.includes('.cm-editor'),
      'Should check for .cm-editor to skip shortcuts inside CodeMirror'
    );
  });
});

// ============ New keyboard shortcuts (Ctrl+W, Ctrl+B, Ctrl+J) ============

describe('shortcuts: close-tab (Ctrl+W)', () => {
  it('has close-tab in IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes("'close-tab'") || src.includes('"close-tab"'),
      'IN_APP_SHORTCUTS should contain close-tab'
    );
  });

  it('handles Ctrl+W for close-tab', () => {
    assert.ok(
      src.includes("event.key === 'w'"),
      'Should handle Ctrl+W for close-tab'
    );
    assert.ok(
      src.includes("actionHandlers['close-tab']"),
      'Should dispatch to close-tab action handler'
    );
  });

  it('Ctrl+W calls preventDefault to avoid closing browser window', () => {
    // The Ctrl+W handler should be before the INPUT guard and call preventDefault
    const ctrlWIndex = src.indexOf("event.key === 'w'");
    const preventIndex = src.indexOf('event.preventDefault()', ctrlWIndex);
    assert.ok(
      ctrlWIndex > 0 && preventIndex > ctrlWIndex && preventIndex - ctrlWIndex < 200,
      'Ctrl+W handler should call preventDefault shortly after the key check'
    );
  });

  it('close-tab handler calls tabsStore.closeTab', () => {
    assert.ok(
      src.includes('tabsStore.closeTab(tabsStore.activeTabId)'),
      'close-tab handler should call tabsStore.closeTab with activeTabId'
    );
  });

  it('imports tabsStore', () => {
    assert.ok(
      src.includes("import { tabsStore }") || src.includes("from './tabs.svelte.js'"),
      'Should import tabsStore from tabs.svelte.js'
    );
  });
});

describe('shortcuts: toggle-sidebar (Ctrl+B)', () => {
  it('has toggle-sidebar in IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes("'toggle-sidebar'") || src.includes('"toggle-sidebar"'),
      'IN_APP_SHORTCUTS should contain toggle-sidebar'
    );
  });

  it('handles Ctrl+B for toggle-sidebar', () => {
    assert.ok(
      src.includes("event.key === 'b'"),
      'Should handle Ctrl+B for toggle-sidebar'
    );
    assert.ok(
      src.includes("actionHandlers['toggle-sidebar']"),
      'Should dispatch to toggle-sidebar action handler'
    );
  });

  it('toggle-sidebar handler calls navigationStore.toggleSidebar', () => {
    assert.ok(
      src.includes('navigationStore.toggleSidebar()'),
      'toggle-sidebar handler should call navigationStore.toggleSidebar()'
    );
  });
});

describe('shortcuts: toggle-bottom-panel (Ctrl+J)', () => {
  it('has toggle-bottom-panel in IN_APP_SHORTCUTS', () => {
    assert.ok(
      src.includes("'toggle-bottom-panel'") || src.includes('"toggle-bottom-panel"'),
      'IN_APP_SHORTCUTS should contain toggle-bottom-panel'
    );
  });

  it('handles Ctrl+J for toggle-bottom-panel', () => {
    assert.ok(
      src.includes("event.key === 'j'"),
      'Should handle Ctrl+J for toggle-bottom-panel'
    );
    assert.ok(
      src.includes("actionHandlers['toggle-bottom-panel']"),
      'Should dispatch to toggle-bottom-panel action handler'
    );
  });

  it('toggle-bottom-panel handler calls layoutStore.toggleTerminal', () => {
    assert.ok(
      src.includes('layoutStore.toggleTerminal()'),
      'toggle-bottom-panel handler should call layoutStore.toggleTerminal()'
    );
  });

  it('imports layoutStore', () => {
    assert.ok(
      src.includes("import { layoutStore }") || src.includes("from './layout.svelte.js'"),
      'Should import layoutStore from layout.svelte.js'
    );
  });
});

// ============ Shortcut conflict resolution ============

describe('shortcuts: no key binding conflicts', () => {
  it('toggle-mute does NOT use Ctrl+Shift+M (freed for IDE use)', () => {
    // Extract the toggle-mute block
    const toggleMuteIdx = src.indexOf("'toggle-mute'");
    const nextEntryIdx = src.indexOf("'toggle-overlay'");
    const toggleMuteBlock = src.slice(toggleMuteIdx, nextEntryIdx);
    assert.ok(
      !toggleMuteBlock.includes("Ctrl+Shift+M"),
      'toggle-mute should NOT use Ctrl+Shift+M (conflicts with VS Code Problems panel)'
    );
  });

  it('toggle-overlay does NOT use Ctrl+Shift+O (freed for go-to-symbol)', () => {
    // Extract the toggle-overlay block (global)
    const toggleOverlayIdx = src.indexOf("'toggle-overlay'");
    const nextEntryIdx = src.indexOf("'toggle-window'");
    const toggleOverlayBlock = src.slice(toggleOverlayIdx, nextEntryIdx);
    assert.ok(
      !toggleOverlayBlock.includes("Ctrl+Shift+O"),
      'toggle-overlay should NOT use Ctrl+Shift+O (conflicts with go-to-symbol)'
    );
  });

  it('stats-dashboard does NOT use Ctrl+Shift+M', () => {
    const dashIdx = src.indexOf("'stats-dashboard'");
    const dashEnd = src.indexOf('}', dashIdx + 50);
    const dashBlock = src.slice(dashIdx, dashEnd);
    assert.ok(
      !dashBlock.includes("Ctrl+Shift+M"),
      'stats-dashboard should NOT use Ctrl+Shift+M'
    );
  });

  it('no two DEFAULT_GLOBAL_SHORTCUTS share the same key binding', () => {
    // Extract key strings from DEFAULT_GLOBAL_SHORTCUTS
    const globalBlock = src.slice(
      src.indexOf('DEFAULT_GLOBAL_SHORTCUTS'),
      src.indexOf('IN_APP_SHORTCUTS')
    );
    const keyMatches = [...globalBlock.matchAll(/keys:\s*'([^']+)'/g)].map(m => m[1]);
    const unique = new Set(keyMatches);
    assert.equal(
      keyMatches.length, unique.size,
      `Global shortcuts should have unique keys, found: ${keyMatches.join(', ')}`
    );
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
