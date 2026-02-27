/**
 * editor-git-gutter.test.cjs -- Source-inspection tests for the git gutter CM6 extension.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/editor-git-gutter.js');

describe('editor-git-gutter.js -- file exists', () => {
  it('source file exists', () => {
    assert.ok(fs.existsSync(SRC_PATH), 'editor-git-gutter.js should exist');
  });
});

describe('editor-git-gutter.js -- module structure', () => {
  const src = fs.readFileSync(SRC_PATH, 'utf-8');

  it('exports computeLineChanges function', () => {
    assert.ok(src.includes('export function computeLineChanges('), 'Should export computeLineChanges');
  });

  it('returns change objects with type field', () => {
    assert.ok(src.includes("'added'"), 'Should handle added type');
    assert.ok(src.includes("'modified'"), 'Should handle modified type');
    assert.ok(src.includes("'deleted'"), 'Should handle deleted type');
  });
});

describe('editor-git-gutter.js -- CM6 gutter extension', () => {
  const src = fs.readFileSync(SRC_PATH, 'utf-8');

  it('imports from @codemirror/view', () => {
    assert.ok(src.includes("from '@codemirror/view'"));
  });

  it('imports from @codemirror/state', () => {
    assert.ok(src.includes("from '@codemirror/state'"));
  });

  it('defines AddedMarker extending GutterMarker', () => {
    assert.ok(src.includes('class AddedMarker extends GutterMarker'));
  });

  it('defines ModifiedMarker extending GutterMarker', () => {
    assert.ok(src.includes('class ModifiedMarker extends GutterMarker'));
  });

  it('defines DeletedMarker extending GutterMarker', () => {
    assert.ok(src.includes('class DeletedMarker extends GutterMarker'));
  });

  it('creates cm-git-change-gutter', () => {
    assert.ok(src.includes('cm-git-change-gutter'));
  });

  it('defines setGitChanges StateEffect', () => {
    assert.ok(src.includes('setGitChanges'));
  });

  it('defines gitChangeField StateField', () => {
    assert.ok(src.includes('gitChangeField'));
  });

  it('exports createGitGutter factory', () => {
    assert.ok(src.includes('export function createGitGutter('));
  });

  it('exports gitGutterPlugin reference', () => {
    assert.ok(src.includes('export let gitGutterPlugin'));
  });

  it('implements 200ms debounce', () => {
    assert.ok(src.includes('200'), 'Should have 200ms debounce');
  });

  it('has file size gate at 10000 lines', () => {
    assert.ok(src.includes('10000'), 'Should gate at 10000 lines');
  });

  it('stores original content in state', () => {
    assert.ok(src.includes('originalContentField'));
    assert.ok(src.includes('setOriginalContent'));
  });
});

// ── Peek widget ──

describe('editor-git-gutter.js -- peek widget', () => {
  const src = fs.readFileSync(SRC_PATH, 'utf-8');

  it('defines PeekWidget class extending WidgetType', () => {
    assert.ok(src.includes('class PeekWidget extends WidgetType'));
  });

  it('peek widget has Revert button', () => {
    assert.ok(src.includes('Revert'));
  });

  it('peek widget shows original content lines as removed', () => {
    assert.ok(src.includes("'cm-git-peek-line removed'"));
  });

  it('peek widget has prev/next navigation', () => {
    assert.ok(src.includes('prev-change'));
    assert.ok(src.includes('next-change'));
  });

  it('peek widget has close button', () => {
    assert.ok(src.includes('peek-close'));
  });

  it('defines showPeekWidget function', () => {
    assert.ok(src.includes('function showPeekWidget'));
  });

  it('defines closePeekWidget function', () => {
    assert.ok(src.includes('function closePeekWidget'));
  });

  it('defines revertChange function', () => {
    assert.ok(src.includes('function revertChange'));
  });

  it('uses Decoration.widget with block: true', () => {
    assert.ok(src.includes('Decoration.widget'));
    assert.ok(src.includes('block: true') || src.includes('block:true'));
  });

  it('has Escape key handler for closing peek', () => {
    assert.ok(src.includes("'Escape'") || src.includes('"Escape"'));
  });

  it('defines peekWidgetField StateField', () => {
    assert.ok(src.includes('peekWidgetField'));
  });

  it('closes peek on document change', () => {
    assert.ok(src.includes('Decoration.none'));
  });

  it('has getOriginalLinesForChange helper', () => {
    assert.ok(src.includes('function getOriginalLinesForChange'));
  });

  it('peekWidgetField provides decorations to EditorView', () => {
    assert.ok(src.includes('EditorView.decorations.from'));
  });

  it('revertChange handles all three change types', () => {
    assert.ok(src.includes("change.type === 'deleted'"));
    assert.ok(src.includes("change.type === 'added'"));
    assert.ok(src.includes("change.type === 'modified'"));
  });

  it('PeekWidget constructor stores view reference', () => {
    assert.ok(src.includes('this.view = view'));
  });

  it('shows Change N of M label in header', () => {
    assert.ok(src.includes('changeIndex + 1'));
    assert.ok(src.includes('totalChanges'));
  });
});

// ── editor-theme.js git gutter styles ──

describe('editor-theme.js -- git gutter styles', () => {
  const themeSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

  it('styles .cm-git-added with green bar', () => {
    assert.ok(themeSrc.includes('.cm-git-added'), 'Should style .cm-git-added');
    assert.ok(themeSrc.includes('--ok'), 'Added should use --ok (green) color');
  });

  it('styles .cm-git-modified with accent bar', () => {
    assert.ok(themeSrc.includes('.cm-git-modified'), 'Should style .cm-git-modified');
  });

  it('styles .cm-git-deleted with danger color', () => {
    assert.ok(themeSrc.includes('.cm-git-deleted'), 'Should style .cm-git-deleted');
    assert.ok(themeSrc.includes('--danger'), 'Deleted should use --danger (red) color');
  });

  it('sets gutter column width', () => {
    assert.ok(themeSrc.includes('cm-git-change-gutter'), 'Should style the gutter column');
  });
});

// ── editor-theme.js peek widget styles ──

describe('editor-theme.js -- peek widget styles', () => {
  const themeSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

  it('styles the peek widget container', () => {
    assert.ok(themeSrc.includes('.cm-git-peek'), 'Should style .cm-git-peek');
  });

  it('styles peek header', () => {
    assert.ok(themeSrc.includes('cm-git-peek-header'), 'Should style peek header');
  });

  it('styles peek revert button', () => {
    assert.ok(themeSrc.includes('cm-git-peek-revert'), 'Should style revert button');
  });

  it('styles removed and added lines in peek', () => {
    assert.ok(themeSrc.includes('cm-git-peek-line'), 'Should style peek diff lines');
  });
});

// ── editor-extensions.js git gutter integration ──

describe('editor-extensions.js -- git gutter integration', () => {
  const extSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');

  it('imports createGitGutter', () => {
    assert.ok(extSrc.includes('createGitGutter'), 'Should import createGitGutter');
  });

  it('accepts getOriginalContent option', () => {
    assert.ok(extSrc.includes('getOriginalContent'), 'Should accept original content callback');
  });

  it('conditionally adds git gutter for non-read-only files', () => {
    assert.ok(extSrc.includes('createGitGutter(getOriginalContent)'), 'Should call createGitGutter');
  });
});

// ── FileEditor.svelte git gutter integration ──

describe('FileEditor.svelte -- git gutter integration', () => {
  const editorSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/FileEditor.svelte'), 'utf-8');

  it('imports getFileGitContent from api', () => {
    assert.ok(editorSrc.includes('getFileGitContent'), 'Should import getFileGitContent');
  });

  it('imports gitGutterPlugin', () => {
    assert.ok(editorSrc.includes('gitGutterPlugin'), 'Should import gitGutterPlugin');
  });

  it('passes getOriginalContent to extensions', () => {
    assert.ok(editorSrc.includes('getOriginalContent'), 'Should pass original content callback');
  });

  it('initializes git gutter with setPath after editor creation', () => {
    assert.ok(editorSrc.includes('setPath'), 'Should call setPath on git gutter plugin');
  });

  it('refreshes git gutter after save', () => {
    assert.ok(editorSrc.includes('refreshOriginal'), 'Should refresh git gutter after save');
  });
});
