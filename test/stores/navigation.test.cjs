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
  const expectedViews = ['chat', 'terminal', 'browser', 'settings'];

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
