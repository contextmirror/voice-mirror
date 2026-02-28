/**
 * group-tab-bar.test.cjs -- Source-inspection tests for GroupTabBar.svelte
 *
 * Validates the per-group tab bar component for split editor.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/GroupTabBar.svelte'),
  'utf-8'
);

// ============ Component structure ============

describe('GroupTabBar.svelte: component structure', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0, 'File should have content');
  });

  it('uses $props() for groupId', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('groupId'), 'Should accept groupId prop');
  });

  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
    assert.ok(src.includes('tabs.svelte.js'), 'Should import from tabs.svelte.js');
  });

  it('imports editorGroupsStore', () => {
    assert.ok(src.includes('editorGroupsStore'), 'Should import editorGroupsStore');
    assert.ok(src.includes('editor-groups.svelte.js'), 'Should import from editor-groups.svelte.js');
  });
});

// ============ Tab rendering ============

describe('GroupTabBar.svelte: tab rendering', () => {
  it('renders tabs from tabsStore', () => {
    assert.ok(
      src.includes('getTabsForGroup') || src.includes('tabsStore'),
      'Should get tabs for this group'
    );
  });

  it('shows tab titles', () => {
    assert.ok(
      src.includes('tab.title') || src.includes('tab-title'),
      'Should display tab titles'
    );
  });

  it('shows dirty indicator', () => {
    assert.ok(
      src.includes('dirty') && (src.includes('class:dirty') || src.includes('dirty-dot')),
      'Should show dirty indicator'
    );
  });

  it('shows close button', () => {
    assert.ok(
      src.includes('closeTab') || src.includes('close'),
      'Should have close button'
    );
  });

  it('has active tab styling (class:active or similar)', () => {
    assert.ok(
      src.includes('class:active') || src.includes('active'),
      'Should have active tab styling'
    );
  });
});

// ============ Interactions ============

describe('GroupTabBar.svelte: interactions', () => {
  it('tab click calls setActive', () => {
    assert.ok(
      src.includes('setActive') || src.includes('onclick'),
      'Should handle tab click for activation'
    );
  });

  it('close button calls closeTab', () => {
    assert.ok(src.includes('closeTab'), 'Should call closeTab on close button');
  });

  it('double-click pins tab', () => {
    assert.ok(
      src.includes('ondblclick') || src.includes('dblclick'),
      'Should handle double-click for pinning'
    );
    assert.ok(src.includes('pinTab'), 'Should call pinTab');
  });

  it('has "+" button for new file', () => {
    assert.ok(
      src.includes('tab-add') || src.includes('+') || src.includes('add'),
      'Should have add button'
    );
  });
});

// ============ Drag and drop ============

describe('GroupTabBar.svelte: drag and drop', () => {
  it('tabs have draggable attribute', () => {
    assert.ok(
      src.includes('draggable') || src.includes('draggable="true"'),
      'Should have draggable attribute on tabs'
    );
  });

  it('has dragstart handler', () => {
    assert.ok(
      src.includes('dragstart') || src.includes('ondragstart'),
      'Should have dragstart handler'
    );
  });

  it('has dragover handler', () => {
    assert.ok(
      src.includes('dragover') || src.includes('ondragover'),
      'Should have dragover handler'
    );
  });

  it('has drop handler', () => {
    assert.ok(
      src.includes('ondrop') || src.includes('drop'),
      'Should have drop handler'
    );
  });

  it('uses dataTransfer for tab data', () => {
    assert.ok(
      src.includes('dataTransfer') || src.includes('setData') || src.includes('getData'),
      'Should use dataTransfer for tab data'
    );
  });
});

// ============ Focus indicator ============

describe('GroupTabBar.svelte: focus indicator', () => {
  it('has focused class based on focusedGroupId', () => {
    assert.ok(
      src.includes('focused') || src.includes('focusedGroupId'),
      'Should have focused indicator'
    );
  });
});

// ============ More actions menu ============

describe('GroupTabBar.svelte: more actions menu', () => {
  it('has moreMenu state', () => {
    assert.ok(src.includes('moreMenu'), 'Should have moreMenu state');
  });

  it('has a more actions button with "..." icon', () => {
    assert.ok(src.includes('More actions'), 'Should have more actions button');
  });

  it('has Show Opened Editors menu item', () => {
    assert.ok(src.includes('Show Opened Editors'), 'Should have Show Opened Editors item');
  });

  it('Show Opened Editors triggers go-to-file action handler', () => {
    assert.ok(src.includes("getActionHandler('go-to-file')"), 'Should call getActionHandler for go-to-file');
  });

  it('has Close All menu item with keyboard shortcut', () => {
    assert.ok(src.includes('handleCloseAll'), 'Should have Close All handler');
    assert.ok(src.includes('Ctrl+K W'), 'Should show Ctrl+K W shortcut');
  });

  it('Close All uses requestClose with save prompt for each tab', () => {
    assert.ok(src.includes('handleCloseAll'), 'Should have Close All handler');
    assert.ok(
      src.includes('tabsStore.requestClose(tab.id)'),
      'Should use requestClose (with save prompt) for each tab'
    );
  });

  it('has Close Saved menu item with keyboard shortcut', () => {
    assert.ok(src.includes('handleCloseSaved'), 'Should have Close Saved handler');
    assert.ok(src.includes('Ctrl+K U'), 'Should show Ctrl+K U shortcut');
  });

  it('Close Saved only closes non-dirty tabs', () => {
    assert.ok(src.includes('!tab.dirty'), 'Should check dirty flag before closing');
  });

  it('has Enable Preview Editors toggle item', () => {
    assert.ok(src.includes('Enable Preview Editors'), 'Should have Enable Preview Editors item');
    assert.ok(src.includes('previewEnabled'), 'Should track preview enabled state');
  });

  it('has Lock Group toggle item', () => {
    assert.ok(src.includes('Lock Group'), 'Should have Lock Group item');
    assert.ok(src.includes('isGroupLocked'), 'Should track group locked state');
  });

  it('shows checkmark for enabled toggle items', () => {
    assert.ok(src.includes('menu-icon-spacer'), 'Should have spacer for unchecked items');
    // Checkmark SVG (polyline points "20 6 9 17 4 12")
    assert.ok(src.includes('20 6 9 17 4 12'), 'Should have checkmark SVG');
  });

  it('imports getActionHandler from shortcuts store', () => {
    assert.ok(src.includes('getActionHandler'), 'Should import getActionHandler');
    assert.ok(src.includes('shortcuts.svelte.js'), 'Should import from shortcuts.svelte.js');
  });

  it('has backdrop for closing the menu', () => {
    assert.ok(src.includes('closeMoreMenu'), 'Should have closeMoreMenu handler');
  });
});

// ============ Middle-click to close ============

describe('GroupTabBar.svelte: middle-click to close', () => {
  it('has onauxclick handler on tab elements', () => {
    assert.ok(
      src.includes('onauxclick'),
      'Should have onauxclick handler on tabs'
    );
  });

  it('middle-click checks for button === 1', () => {
    assert.ok(
      src.includes('e.button === 1'),
      'Should check for middle mouse button (button === 1)'
    );
  });

  it('middle-click calls requestClose', () => {
    // Find onauxclick usage that calls requestClose
    assert.ok(
      src.includes('onauxclick') && src.includes('requestClose'),
      'Middle-click should call requestClose'
    );
  });
});

// ============ Save prompt on close ============

describe('GroupTabBar.svelte: save prompt on close', () => {
  it('close button uses requestClose instead of closeTab', () => {
    // The close button should use requestClose (which shows save dialog for dirty tabs)
    assert.ok(
      src.includes('tabsStore.requestClose(tab.id)'),
      'Close button should call requestClose'
    );
  });

  it('handleCloseAll is async', () => {
    assert.ok(
      src.includes('async function handleCloseAll'),
      'handleCloseAll should be async to await requestClose'
    );
  });

  it('handleCloseAll breaks on cancel', () => {
    const closeAllStart = src.indexOf('async function handleCloseAll');
    const chunk = src.slice(closeAllStart, closeAllStart + 300);
    assert.ok(
      chunk.includes('if (!closed) break'),
      'Should stop closing remaining tabs if user cancels'
    );
  });
});

// ============ Mouse wheel scroll ============

describe('GroupTabBar.svelte: mouse wheel scroll', () => {
  it('has onwheel handler on tabs-scroll container', () => {
    assert.ok(src.includes('onwheel'), 'Should have onwheel handler');
  });

  it('converts vertical wheel delta to horizontal scroll', () => {
    assert.ok(src.includes('deltaY') && src.includes('scrollLeft'), 'Should convert deltaY to scrollLeft');
  });
});

// ============ Tab drag MIME type ============

describe('GroupTabBar.svelte: tab drag MIME type', () => {
  it('sets application/x-voice-mirror-tab MIME type on drag start', () => {
    assert.ok(src.includes('application/x-voice-mirror-tab'), 'Should set custom tab MIME type');
  });

  it('dispatches tab-drag-start event', () => {
    assert.ok(src.includes('tab-drag-start'), 'Should dispatch tab-drag-start event');
  });

  it('dispatches tab-drag-end event', () => {
    assert.ok(src.includes('tab-drag-end'), 'Should dispatch tab-drag-end event');
  });
});

// ============ Styling ============

describe('GroupTabBar.svelte: styling', () => {
  it('uses -webkit-app-region: no-drag', () => {
    assert.ok(
      src.includes('-webkit-app-region: no-drag') || src.includes('app-region'),
      'Should use -webkit-app-region: no-drag for interactive elements'
    );
  });

  it('uses theme CSS variables (--bg, --text, --accent, --border)', () => {
    assert.ok(src.includes('var(--'), 'Should use CSS custom properties');
    const hasThemeVars = ['--bg', '--text', '--accent'].some(v => src.includes(`var(${v}`));
    assert.ok(hasThemeVars, 'Should use theme CSS variables');
  });

  it('has horizontal flex layout', () => {
    assert.ok(
      src.includes('display: flex') || src.includes('flex'),
      'Should have flex layout'
    );
  });
});
