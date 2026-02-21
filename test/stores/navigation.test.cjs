/**
 * navigation.test.js -- Source-inspection tests for navigation.svelte.js
 *
 * Validates exports, valid views, reactive state, and methods
 * by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'navigation.svelte.js'),
  'utf-8'
);

// ============ VALID_VIEWS ============

describe('navigation: VALID_VIEWS', () => {
  const expectedViews = ['chat', 'terminal', 'lens', 'settings'];

  it('defines VALID_VIEWS as a const', () => {
    assert.ok(src.includes('const VALID_VIEWS'), 'Should define const VALID_VIEWS');
  });

  for (const view of expectedViews) {
    it(`contains "${view}"`, () => {
      assert.ok(
        src.includes(`'${view}'`) || src.includes(`"${view}"`),
        `VALID_VIEWS should contain "${view}"`
      );
    });
  }

  it('exports VALID_VIEWS', () => {
    assert.ok(
      src.includes('export') && src.includes('VALID_VIEWS'),
      'Should export VALID_VIEWS'
    );
  });

  it('VALID_VIEWS is an array literal', () => {
    assert.ok(
      src.includes("['chat'") || src.includes('["chat"'),
      'VALID_VIEWS should be defined as an array literal'
    );
  });
});

// ============ Exports ============

describe('navigation: exports', () => {
  it('exports navigationStore', () => {
    assert.ok(src.includes('export const navigationStore'), 'Should export navigationStore');
  });

  it('creates store via createNavigationStore factory', () => {
    assert.ok(src.includes('function createNavigationStore()'), 'Should define createNavigationStore factory');
  });
});

// ============ Store methods ============

describe('navigation: store methods', () => {
  it('has setView method', () => {
    assert.ok(src.includes('setView('), 'Store should have setView method');
  });

  it('has toggleSidebar method', () => {
    assert.ok(src.includes('toggleSidebar()'), 'Store should have toggleSidebar method');
  });

  it('has initSidebarState method', () => {
    assert.ok(src.includes('initSidebarState('), 'Store should have initSidebarState method');
  });
});

// ============ Store getters ============

describe('navigation: store getters', () => {
  it('has getter "activeView"', () => {
    assert.ok(src.includes('get activeView()'), 'Should have getter "activeView"');
  });

  it('has getter "sidebarCollapsed"', () => {
    assert.ok(src.includes('get sidebarCollapsed()'), 'Should have getter "sidebarCollapsed"');
  });
});

// ============ $state reactivity ============

describe('navigation: $state reactivity', () => {
  it('uses $state for activeView', () => {
    assert.ok(/let\s+activeView\s*=\s*\$state\(/.test(src), 'Should use $state for activeView');
  });

  it('uses $state for sidebarCollapsed', () => {
    assert.ok(/let\s+sidebarCollapsed\s*=\s*\$state\(/.test(src), 'Should use $state for sidebarCollapsed');
  });

  it('activeView initialized to "chat"', () => {
    assert.ok(
      src.includes("$state('chat')") || src.includes('$state("chat")'),
      'activeView should start as "chat"'
    );
  });

  it('sidebarCollapsed initialized to false', () => {
    assert.ok(
      src.includes('sidebarCollapsed = $state(false)'),
      'sidebarCollapsed should start as false'
    );
  });
});

// ============ setView validation ============

describe('navigation: setView validation', () => {
  it('validates view against VALID_VIEWS', () => {
    assert.ok(
      src.includes('VALID_VIEWS.includes(view)'),
      'setView should validate against VALID_VIEWS'
    );
  });

  it('warns on invalid view', () => {
    assert.ok(
      src.includes('Invalid view'),
      'Should warn about invalid view'
    );
  });

  it('returns early for invalid views without changing state', () => {
    // The guard is: if (!VALID_VIEWS.includes(view)) { ...warn...; return; }
    assert.ok(
      src.includes('!VALID_VIEWS.includes(view)'),
      'Should guard against invalid views'
    );
  });

  it('sets activeView for valid views', () => {
    assert.ok(
      src.includes('activeView = view'),
      'Should set activeView when view is valid'
    );
  });
});

// ============ toggleSidebar ============

describe('navigation: toggleSidebar', () => {
  it('inverts sidebarCollapsed', () => {
    assert.ok(
      src.includes('sidebarCollapsed = !sidebarCollapsed'),
      'toggleSidebar should invert sidebarCollapsed'
    );
  });

  it('persists sidebar state to config', () => {
    assert.ok(
      src.includes('updateConfig('),
      'toggleSidebar should persist state via updateConfig'
    );
  });

  it('sends collapsed state in the config update', () => {
    assert.ok(
      src.includes('collapsed: sidebarCollapsed'),
      'Should send collapsed state in config update'
    );
  });
});

// ============ initSidebarState ============

describe('navigation: initSidebarState', () => {
  it('accepts a collapsed parameter', () => {
    assert.ok(
      src.includes('initSidebarState(collapsed)'),
      'initSidebarState should accept a collapsed parameter'
    );
  });

  it('coerces collapsed to boolean', () => {
    assert.ok(
      src.includes('!!collapsed'),
      'Should coerce collapsed to boolean with !!'
    );
  });
});

// ============ VALID_MODES ============

describe('navigation: VALID_MODES', () => {
  it('defines VALID_MODES as a const', () => {
    assert.ok(src.includes('const VALID_MODES'), 'Should define const VALID_MODES');
  });

  it('contains "mirror"', () => {
    assert.ok(
      src.includes("'mirror'") || src.includes('"mirror"'),
      'VALID_MODES should contain "mirror"'
    );
  });

  it('contains "lens"', () => {
    assert.ok(
      src.includes("'lens'") || src.includes('"lens"'),
      'VALID_MODES should contain "lens"'
    );
  });

  it('exports VALID_MODES', () => {
    assert.ok(
      src.includes('VALID_MODES') && src.includes('export'),
      'Should export VALID_MODES'
    );
  });
});

// ============ appMode ============

describe('navigation: appMode', () => {
  it('uses $state for appMode', () => {
    assert.ok(/let\s+appMode\s*=\s*\$state\(/.test(src), 'Should use $state for appMode');
  });

  it('appMode initialized to "mirror"', () => {
    assert.ok(
      src.includes("$state('mirror')") || src.includes('$state("mirror")'),
      'appMode should start as "mirror"'
    );
  });

  it('has getter "appMode"', () => {
    assert.ok(src.includes('get appMode()'), 'Should have getter "appMode"');
  });

  it('has setMode method', () => {
    assert.ok(src.includes('setMode('), 'Store should have setMode method');
  });

  it('has initMode method', () => {
    assert.ok(src.includes('initMode('), 'Store should have initMode method');
  });

  it('setMode validates against VALID_MODES', () => {
    assert.ok(
      src.includes('VALID_MODES.includes(mode)'),
      'setMode should validate against VALID_MODES'
    );
  });

  it('setMode persists mode to config', () => {
    assert.ok(
      src.includes('updateConfig({ sidebar: { mode }'),
      'setMode should persist mode via updateConfig'
    );
  });

  it('setMode switches activeView to chat for mirror mode', () => {
    assert.ok(
      src.includes("activeView = 'chat'"),
      'setMode should switch activeView to chat for mirror mode'
    );
  });

  it('setMode switches activeView to lens for lens mode', () => {
    assert.ok(
      src.includes("activeView = 'lens'"),
      'setMode should switch activeView to lens for lens mode'
    );
  });

  it('initMode does not persist to config', () => {
    // initMode should set state without calling updateConfig
    const initModeBlock = src.slice(src.indexOf('initMode(mode)'));
    const nextMethod = initModeBlock.indexOf('};');
    const body = initModeBlock.slice(0, nextMethod);
    assert.ok(
      !body.includes('updateConfig'),
      'initMode should not call updateConfig'
    );
  });
});

// ============ Imports ============

describe('navigation: imports', () => {
  it('imports updateConfig from config store', () => {
    assert.ok(
      src.includes('updateConfig'),
      'Should import updateConfig'
    );
  });

  it('imports from ./config.svelte.js', () => {
    assert.ok(
      src.includes("'./config.svelte.js'") || src.includes('"./config.svelte.js"'),
      'Should import from ./config.svelte.js'
    );
  });
});
