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
