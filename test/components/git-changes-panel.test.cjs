/**
 * git-changes-panel.test.js -- Source-inspection tests for GitChangesPanel.svelte
 *
 * Validates the git changes display component extracted from FileTree.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../src/components/lens/GitChangesPanel.svelte');
const src = fs.readFileSync(filePath, 'utf-8');

describe('GitChangesPanel.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0);
  });

  // ── Imports ──

  it('imports chooseIconName from file-icons', () => {
    assert.ok(src.includes('chooseIconName'), 'Should import chooseIconName');
    assert.ok(src.includes('file-icons.js'), 'Should import from file-icons.js');
  });

  it('imports sprite URL', () => {
    assert.ok(src.includes('spriteUrl'), 'Should import spriteUrl');
    assert.ok(src.includes('file-icons-sprite.svg'), 'Should reference sprite SVG');
  });

  // ── Props ──

  it('accepts change data props via $props()', () => {
    assert.ok(src.includes('stagedChanges'), 'Should have stagedChanges prop');
    assert.ok(src.includes('unstagedChanges'), 'Should have unstagedChanges prop');
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });

  it('accepts activeDiffPath prop', () => {
    assert.ok(src.includes('activeDiffPath'), 'Should have activeDiffPath prop');
  });

  it('accepts callback props', () => {
    assert.ok(src.includes('onStageAll'), 'Should have onStageAll prop');
    assert.ok(src.includes('onUnstageAll'), 'Should have onUnstageAll prop');
    assert.ok(src.includes('onStage'), 'Should have onStage prop');
    assert.ok(src.includes('onUnstage'), 'Should have onUnstage prop');
    assert.ok(src.includes('onDiscard'), 'Should have onDiscard prop');
    assert.ok(src.includes('onChangeClick'), 'Should have onChangeClick prop');
    assert.ok(src.includes('onChangeDblClick'), 'Should have onChangeDblClick prop');
    assert.ok(src.includes('onContextMenu'), 'Should have onContextMenu prop');
  });

  // ── Git changes display ──

  it('shows status badges for changes (A/M/D)', () => {
    assert.ok(src.includes('change-badge'), 'Should have change badge class');
    assert.ok(src.includes("'A'"), 'Should show A for added');
    assert.ok(src.includes("'D'"), 'Should show D for deleted');
    assert.ok(src.includes("'M'"), 'Should show M for modified');
  });

  it('has styled badges for added/modified/deleted', () => {
    assert.ok(src.includes('class:added'), 'Should have added class');
    assert.ok(src.includes('class:modified'), 'Should have modified class');
    assert.ok(src.includes('class:deleted'), 'Should have deleted class');
  });

  it('handles empty changes state', () => {
    assert.ok(src.includes('No changes'), 'Should show empty state for no changes');
    assert.ok(src.includes('changes-empty'), 'Should have empty state class');
  });

  it('shows change file path', () => {
    assert.ok(src.includes('change-path'), 'Should have change-path class');
    assert.ok(src.includes('change.path'), 'Should render change path');
  });

  it('change items are clickable', () => {
    assert.ok(
      src.includes('class="change-item"'),
      'Should have change-item class'
    );
  });

  it('calls onChangeClick when change item is clicked', () => {
    assert.ok(
      src.includes('onChangeClick(change)'),
      'Should call onChangeClick with change object'
    );
  });

  it('has ondblclick on change items', () => {
    assert.ok(src.includes('ondblclick'), 'Change items should have double-click handler');
  });

  it('calls onChangeDblClick on double-click', () => {
    assert.ok(src.includes('onChangeDblClick(change)'), 'Should call onChangeDblClick with change');
  });

  it('highlights active change item', () => {
    assert.ok(src.includes('change.path === activeDiffPath'), 'Should compare change path to activeDiffPath');
    assert.ok(src.includes('class:active'), 'Change items should have active class');
  });

  // ── Staged/unstaged groups ──

  it('has changes-group-header class', () => {
    assert.ok(src.includes('changes-group-header'), 'Should have changes-group-header CSS class');
  });

  it('has changes-group-action class', () => {
    assert.ok(src.includes('changes-group-action'), 'Should have changes-group-action CSS class');
  });

  it('has change-action class for per-file actions', () => {
    assert.ok(src.includes('change-action'), 'Should have change-action CSS class');
  });

  it('has discard action with special hover color', () => {
    assert.ok(src.includes('change-action discard'), 'Should have discard action class');
  });

  it('shows staged changes group header', () => {
    assert.ok(src.includes('Staged Changes'), 'Should show staged changes header');
  });

  it('shows unstaged changes group header', () => {
    assert.ok(src.includes('Changes ('), 'Should show unstaged changes header with count');
  });

  it('has stage all button', () => {
    assert.ok(src.includes('Stage All'), 'Should have Stage All button title');
  });

  it('has unstage all button', () => {
    assert.ok(src.includes('Unstage All'), 'Should have Unstage All button title');
  });

  // ── Styles ──

  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped style block');
  });

  it('has .change-item.active CSS rule', () => {
    const styleBlock = src.substring(src.indexOf('<style>'));
    assert.ok(styleBlock.includes('.change-item.active'), 'Should have active style for change items');
  });

  it('has git change color coding', () => {
    assert.ok(src.includes('var(--ok)'), 'Should use ok color for added');
    assert.ok(src.includes('var(--danger)'), 'Should use danger color for deleted');
  });

  it('uses CSS variables for theming', () => {
    assert.ok(src.includes('var(--text)'), 'Should use --text variable');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted variable');
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use --bg-elevated variable');
  });

  it('uses monospace font', () => {
    assert.ok(src.includes('var(--font-mono)'), 'Should use monospace font');
  });

  it('uses no-drag for frameless window compatibility', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag for interactivity');
  });

  it('hides action buttons until hover', () => {
    assert.ok(src.includes('opacity: 0'), 'Actions should be hidden by default');
    assert.ok(src.includes('.change-item:hover .change-action'), 'Actions should show on hover');
  });
});
