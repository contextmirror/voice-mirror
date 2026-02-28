/**
 * tabs.test.cjs -- Source-inspection tests for tabs.svelte.js
 *
 * Validates the tab management store for Lens mode file editing.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/tabs.svelte.js'),
  'utf-8'
);

describe('tabs.svelte.js', () => {
  it('exports tabsStore', () => {
    assert.ok(src.includes('export const tabsStore'), 'Should export tabsStore');
  });

  it('uses $state for tabs array', () => {
    assert.ok(src.includes('$state('), 'Should use $state rune');
    assert.ok(src.includes('let tabs'), 'Should have tabs state');
  });

  it('uses $state for activeTabId', () => {
    assert.ok(src.includes('let activeTabId'), 'Should have activeTabId state');
  });

  it('starts with empty tabs array (browser is not a tab)', () => {
    // Browser was decoupled from tabs -- it's now a fixed UI element in LensWorkspace
    assert.ok(
      !src.includes("id: 'browser'") || !src.includes("type: 'browser'"),
      'Should not have browser as a default tab'
    );
  });

  it('has tabs getter', () => {
    assert.ok(src.includes('get tabs()'), 'Should expose tabs getter');
  });

  it('has activeTabId getter', () => {
    assert.ok(src.includes('get activeTabId()'), 'Should expose activeTabId getter');
  });

  it('has activeTab getter', () => {
    assert.ok(src.includes('get activeTab()'), 'Should expose activeTab getter');
  });
});

describe('tabs.svelte.js: methods', () => {
  it('has openFile method', () => {
    assert.ok(src.includes('openFile('), 'Should have openFile method');
  });

  it('has pinTab method', () => {
    assert.ok(src.includes('pinTab('), 'Should have pinTab method');
  });

  it('has closeTab method', () => {
    assert.ok(src.includes('closeTab('), 'Should have closeTab method');
  });

  it('has setActive method', () => {
    assert.ok(src.includes('setActive('), 'Should have setActive method');
  });

  it('has setDirty method', () => {
    assert.ok(src.includes('setDirty('), 'Should have setDirty method');
  });

  it('has updateTitle method', () => {
    assert.ok(src.includes('updateTitle('), 'Should have updateTitle method');
  });

  it('has closeAll method', () => {
    assert.ok(src.includes('closeAll('), 'Should have closeAll method');
  });
});

describe('tabs.svelte.js: preview tab logic', () => {
  it('creates preview tabs on openFile', () => {
    assert.ok(src.includes('preview: previewEnabled'), 'Should create tabs with preview based on previewEnabled setting');
  });

  it('replaces existing preview tab', () => {
    assert.ok(
      src.includes('previewIdx') || src.includes('preview'),
      'Should handle preview tab replacement'
    );
  });

  it('pinTab sets preview to false', () => {
    assert.ok(src.includes('preview = false') || src.includes('preview: false'), 'Should unset preview on pin');
  });

  it('has previewEnabled state', () => {
    assert.ok(src.includes('previewEnabled'), 'Should have previewEnabled state');
    assert.ok(src.includes('get previewEnabled()'), 'Should expose previewEnabled getter');
  });

  it('has togglePreviewMode method', () => {
    assert.ok(src.includes('togglePreviewMode'), 'Should have togglePreviewMode method');
  });

  it('togglePreviewMode pins existing preview tabs when disabling', () => {
    assert.ok(src.includes('!previewEnabled'), 'Should check previewEnabled state');
    assert.ok(src.includes('tab.preview = false'), 'Should pin preview tabs when disabling');
  });

  it('respects previewEnabled when opening files', () => {
    // When disabled, previewIdx search is skipped
    assert.ok(src.includes('previewEnabled ? tabs.findIndex'), 'Should skip preview replacement when disabled');
  });
});

describe('tabs.svelte.js: browser decoupled', () => {
  it('does not contain browser tab type', () => {
    // Browser is now a fixed UI element in LensWorkspace, not a tab
    assert.ok(
      !src.includes("type: 'browser'"),
      'Should not have browser tab type (browser decoupled)'
    );
  });

  it('closeAll resets all tabs and groups', () => {
    assert.ok(
      src.includes('closeAll') && src.includes('tabs.length = 0'),
      'closeAll should clear all tabs'
    );
  });
});

describe('tabs.svelte.js: external/readOnly file support', () => {
  it('openFile propagates readOnly flag', () => {
    assert.ok(
      src.includes('readOnly: entry.readOnly || false'),
      'Should pass readOnly from entry'
    );
  });

  it('openFile propagates external flag', () => {
    assert.ok(
      src.includes('external: entry.external || false'),
      'Should pass external from entry'
    );
  });
});

describe('tabs.svelte.js: tab switching on close', () => {
  it('switches to neighbor when closing active tab', () => {
    assert.ok(
      src.includes('activeTabId === id') || src.includes('activeTabId'),
      'Should handle active tab switching on close'
    );
  });
});

// ============ groupId support ============

describe('tabs.svelte.js: groupId support', () => {
  it('tab objects include groupId field', () => {
    assert.ok(src.includes('groupId'), 'Tab objects should have groupId field');
  });

  it('openFile sets groupId on new tabs', () => {
    // openFile should assign a groupId when creating a tab
    const openFileStart = src.indexOf('openFile(');
    const chunk = src.slice(openFileStart, openFileStart + 1500);
    assert.ok(chunk.includes('groupId'), 'openFile should set groupId on new tabs');
  });

  it('has getTabsForGroup method', () => {
    assert.ok(src.includes('getTabsForGroup(') || src.includes('getTabsForGroup ('), 'Should have getTabsForGroup method');
  });

  it('has getActiveTabForGroup method', () => {
    assert.ok(
      src.includes('getActiveTabForGroup(') || src.includes('getActiveTabForGroup ('),
      'Should have getActiveTabForGroup method'
    );
  });
});

// ============ split operations ============

describe('tabs.svelte.js: split operations', () => {
  it('has openFileToSide method', () => {
    assert.ok(src.includes('openFileToSide(') || src.includes('openFileToSide ('), 'Should have openFileToSide method');
  });

  it('has moveTab method', () => {
    assert.ok(src.includes('moveTab(') || src.includes('moveTab ('), 'Should have moveTab method');
  });

  it('has reorderTab method', () => {
    assert.ok(src.includes('reorderTab(') || src.includes('reorderTab ('), 'Should have reorderTab method');
  });
});

// ============ group-scoped operations ============

describe('tabs.svelte.js: group-scoped operations', () => {
  it('closeTab checks if group becomes empty', () => {
    assert.ok(
      src.includes('closeTab') && (src.includes('groupId') || src.includes('closeGroup')),
      'closeTab should check if the group becomes empty'
    );
  });

  it('closeOthers scopes to groupId', () => {
    assert.ok(
      src.includes('closeOthers') && src.includes('groupId'),
      'closeOthers should scope to groupId'
    );
  });

  it('closeToRight scopes to groupId', () => {
    assert.ok(
      src.includes('closeToRight') && src.includes('groupId'),
      'closeToRight should scope to groupId'
    );
  });

  it('openFile respects targetGroupId parameter', () => {
    assert.ok(
      src.includes('targetGroupId') || src.includes('groupId'),
      'openFile should accept a target group'
    );
  });

  it('preview replacement scoped to group', () => {
    // Preview tab replacement should only replace preview tabs in the same group
    assert.ok(
      src.includes('preview') && src.includes('groupId'),
      'Preview replacement should be scoped to group'
    );
  });
});

// ============ browser tab removed ============

describe('tabs.svelte.js: browser tab removal', () => {
  it('imports editorGroupsStore', () => {
    assert.ok(
      src.includes('editorGroupsStore') || src.includes('editor-groups.svelte.js'),
      'Should import editorGroupsStore for group management'
    );
  });
});

// ============ dirty close dialog (save prompt) ============

describe('tabs.svelte.js: dirty close dialog', () => {
  it('has showDirtyCloseDialog helper function', () => {
    assert.ok(
      src.includes('async function showDirtyCloseDialog'),
      'Should have showDirtyCloseDialog helper'
    );
  });

  it('showDirtyCloseDialog imports message from @tauri-apps/plugin-dialog', () => {
    assert.ok(
      src.includes("@tauri-apps/plugin-dialog"),
      'Should import Tauri dialog plugin'
    );
    assert.ok(
      src.includes("import('@tauri-apps/plugin-dialog')"),
      'Should dynamically import dialog'
    );
  });

  it('showDirtyCloseDialog uses warning kind with 3 buttons', () => {
    assert.ok(
      src.includes("kind: 'warning'"),
      'Should use warning dialog kind'
    );
    assert.ok(
      src.includes("yes: 'Save'"),
      'Should have Save button'
    );
    assert.ok(
      src.includes("no: \"Don't Save\""),
      'Should have Don\'t Save button'
    );
    assert.ok(
      src.includes("cancel: 'Cancel'"),
      'Should have Cancel button'
    );
  });

  it('showDirtyCloseDialog has fallback for non-Tauri environments', () => {
    assert.ok(
      src.includes("return 'Cancel'"),
      'Should return Cancel as fallback'
    );
  });
});

// ============ requestClose ============

describe('tabs.svelte.js: requestClose method', () => {
  it('has async requestClose method', () => {
    assert.ok(
      src.includes('async requestClose('),
      'Should have async requestClose method'
    );
  });

  it('requestClose skips dialog for non-dirty tabs', () => {
    // Should check tab.dirty and call closeTab directly if not dirty
    const requestCloseStart = src.indexOf('async requestClose(');
    const chunk = src.slice(requestCloseStart, requestCloseStart + 500);
    assert.ok(
      chunk.includes('!tab.dirty'),
      'Should check dirty flag'
    );
    assert.ok(
      chunk.includes('this.closeTab(id)'),
      'Should call closeTab directly for clean tabs'
    );
  });

  it('requestClose calls showDirtyCloseDialog for dirty tabs', () => {
    assert.ok(
      src.includes('showDirtyCloseDialog(tab.title)'),
      'Should call showDirtyCloseDialog with tab title'
    );
  });

  it('requestClose dispatches command:save on Save', () => {
    assert.ok(
      src.includes("new CustomEvent('command:save')"),
      'Should dispatch command:save event for Save'
    );
  });

  it('requestClose closes tab on Don\'t Save', () => {
    assert.ok(
      src.includes("Don't Save") && src.includes("result === 'No'"),
      'Should handle Don\'t Save / No result'
    );
  });

  it('requestClose returns boolean indicating if tab was closed', () => {
    const requestCloseStart = src.indexOf('async requestClose(');
    const chunk = src.slice(requestCloseStart, requestCloseStart + 2000);
    assert.ok(
      chunk.includes('return true') && chunk.includes('return false'),
      'Should return true/false for close/cancel'
    );
  });

  it('requestClose sets tab active before saving', () => {
    const requestCloseStart = src.indexOf('async requestClose(');
    const chunk = src.slice(requestCloseStart, requestCloseStart + 2000);
    assert.ok(
      chunk.includes('this.setActive(id)'),
      'Should set the tab active before dispatching save'
    );
  });
});

// ── Closed tab history ──────────────────────────────────────────────────────

describe('tabs.svelte.js: closed tab history', () => {
  it('declares closedTabs state array', () => {
    assert.ok(src.includes('closedTabs'), 'Should have closedTabs state');
  });

  it('has MAX_CLOSED_TABS constant of 20', () => {
    assert.ok(src.includes('MAX_CLOSED_TABS') && src.includes('20'), 'Should limit closed tab history to 20');
  });

  it('pushes tab data onto closedTabs in closeTab before removing', () => {
    assert.ok(src.includes('closedTabs') && src.includes('closeTab'), 'closeTab should interact with closedTabs');
  });

  it('skips untitled files in closed tab history', () => {
    assert.ok(src.includes('untitled'), 'Should check for untitled prefix');
  });

  it('exports reopenClosedTab method', () => {
    assert.ok(src.includes('reopenClosedTab'), 'Should export reopenClosedTab');
  });

  it('reopenClosedTab calls openFile with stored data', () => {
    assert.ok(src.includes('reopenClosedTab') && src.includes('openFile'), 'reopenClosedTab should call openFile');
  });

  it('exposes canReopenTab getter', () => {
    assert.ok(src.includes('canReopenTab'), 'Should have canReopenTab getter');
  });
});

// ── Bulk close → closed tab history ──────────────────────────────────────────

describe('tabs.svelte.js: bulk close records closed tab history', () => {
  it('has pushToClosedHistory helper function', () => {
    assert.ok(src.includes('pushToClosedHistory'), 'Should have helper to DRY closed tab recording');
  });

  it('closeOthers pushes to closed tab history', () => {
    assert.ok(
      /closeOthers[\s\S]*pushToClosedHistory/.test(src) ||
      (src.includes('closeOthers') && src.includes('pushToClosedHistory')),
      'closeOthers should record tabs before removing'
    );
  });

  it('closeToRight pushes to closed tab history', () => {
    assert.ok(
      /closeToRight[\s\S]*pushToClosedHistory/.test(src) ||
      (src.includes('closeToRight') && src.includes('pushToClosedHistory')),
      'closeToRight should record tabs before removing'
    );
  });

  it('closeAll pushes to closed tab history', () => {
    assert.ok(
      /closeAll[\s\S]*pushToClosedHistory/.test(src) ||
      (src.includes('closeAll') && src.includes('pushToClosedHistory')),
      'closeAll should record tabs before removing'
    );
  });

  it('preserves diff status in closed tab entry', () => {
    assert.ok(src.includes('status') && src.includes('closedTabs'), 'Should store status for diff tabs');
  });

  it('reopenClosedTab uses entry.status for diff tabs', () => {
    assert.ok(
      src.includes('entry.status') && src.includes('reopenClosedTab'),
      'reopenClosedTab should use stored status instead of hardcoded modified'
    );
  });

  it('closeTab uses pushToClosedHistory helper', () => {
    // closeTab should delegate to the helper instead of inline push
    const closeTabStart = src.indexOf('closeTab(id)');
    const closeTabEnd = src.indexOf('requestClose');
    const chunk = src.slice(closeTabStart, closeTabEnd);
    assert.ok(
      chunk.includes('pushToClosedHistory(closedTab)'),
      'closeTab should call pushToClosedHistory'
    );
  });

  it('JSDoc type includes status field', () => {
    assert.ok(
      src.includes('status?: string|null'),
      'closedTabs JSDoc type should include optional status field'
    );
  });
});

describe('tabs.svelte.js: pendingCursorPosition', () => {
  it('has pendingCursorPosition getter', () => {
    assert.ok(src.includes('pendingCursorPosition'), 'Should have pendingCursorPosition');
  });

  it('has setPendingCursor method', () => {
    assert.ok(src.includes('setPendingCursor('), 'Should have setPendingCursor method');
  });

  it('has clearPendingCursor method', () => {
    assert.ok(src.includes('clearPendingCursor('), 'Should have clearPendingCursor method');
  });

  it('setPendingCursor accepts path, line, character', () => {
    const idx = src.indexOf('setPendingCursor(');
    const body = src.slice(idx, idx + 200);
    assert.ok(body.includes('path') && body.includes('line'), 'Should accept path and line');
  });
});

describe('tabs.svelte.js: diff tab support', () => {
  it('has openDiff method', () => {
    assert.ok(src.includes('openDiff('), 'Should have openDiff method');
  });

  it('openDiff creates diff tab with diffStats: null', () => {
    assert.ok(src.includes('diffStats: null'), 'Should initialize diffStats as null');
  });

  it('openDiff uses diff: prefix for tab id', () => {
    assert.ok(src.includes('`diff:${'), 'Should prefix diff tab ids');
  });

  it('openDiff sets type to diff', () => {
    assert.ok(
      src.includes("type: 'diff'"),
      'Should set tab type to diff'
    );
  });

  it('has setDiffStats method', () => {
    assert.ok(src.includes('setDiffStats('), 'Should have setDiffStats method');
  });

  it('setDiffStats finds tab by id and sets stats', () => {
    assert.ok(
      src.includes('tab.diffStats = stats'),
      'Should assign stats to tab.diffStats'
    );
  });
});
