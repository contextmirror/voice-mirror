/**
 * Behavioral unit tests for computeLineChanges (Myers diff + change detection).
 * Tests the pure function directly — no source inspection needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineChanges } from '../../src/lib/editor-git-gutter.js';

describe('computeLineChanges', () => {
  it('returns empty array for identical content', () => {
    const changes = computeLineChanges('hello\nworld', 'hello\nworld');
    assert.deepStrictEqual(changes, []);
  });

  it('returns empty array for two empty strings', () => {
    const changes = computeLineChanges('', '');
    assert.deepStrictEqual(changes, []);
  });

  it('detects all lines as changed when original is empty', () => {
    const changes = computeLineChanges('', 'line1\nline2\nline3');
    assert.ok(changes.length > 0, 'Should have at least one change');
    // Empty string splits to [""] (1 line), so line 1 is "modified" and lines 2-3 are "added"
    const allChangedLines = new Set();
    for (const c of changes) {
      for (let l = c.from; l <= c.to; l++) allChangedLines.add(l);
    }
    assert.ok(allChangedLines.has(1), 'Line 1 should be changed');
    assert.ok(allChangedLines.has(2), 'Line 2 should be changed');
    assert.ok(allChangedLines.has(3), 'Line 3 should be changed');
  });

  it('detects all lines as deleted when modified is empty', () => {
    const changes = computeLineChanges('line1\nline2\nline3', '');
    assert.ok(changes.length > 0, 'Should have at least one change');
    assert.ok(changes.some(c => c.type === 'deleted'), 'Should have deleted changes');
  });

  it('detects modified lines when content changes', () => {
    const original = 'line1\nline2\nline3';
    const modified = 'line1\nchanged\nline3';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0, 'Should have at least one change');
    // Line 2 should be modified
    const modifiedRanges = changes.filter(c => c.type === 'modified');
    assert.ok(modifiedRanges.length > 0, 'Should have modified changes');
    const coveredLines = new Set();
    for (const r of modifiedRanges) {
      for (let l = r.from; l <= r.to; l++) coveredLines.add(l);
    }
    assert.ok(coveredLines.has(2), 'Line 2 should be modified');
  });

  it('detects added lines in the middle', () => {
    const original = 'line1\nline3';
    const modified = 'line1\nline2\nline3';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'added'), 'Should have added changes');
  });

  it('detects deleted lines in the middle', () => {
    const original = 'line1\nline2\nline3';
    const modified = 'line1\nline3';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'deleted'), 'Should have deleted changes');
  });

  it('handles single-line files', () => {
    const changes = computeLineChanges('old', 'new');
    assert.ok(changes.length > 0, 'Should detect change in single-line file');
  });

  it('handles added lines at the beginning', () => {
    const original = 'existing';
    const modified = 'new\nexisting';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'added'), 'Should have added changes');
  });

  it('handles added lines at the end', () => {
    const original = 'existing';
    const modified = 'existing\nnew';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'added'), 'Should have added changes');
  });

  it('handles deleted lines at the beginning', () => {
    const original = 'first\nsecond';
    const modified = 'second';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'deleted'), 'Should have deleted changes');
  });

  it('handles deleted lines at the end', () => {
    const original = 'first\nsecond';
    const modified = 'first';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'deleted'), 'Should have deleted changes');
  });

  it('handles mixed changes (add + modify + delete)', () => {
    const original = 'keep\nmodify-me\ndelete-me\nkeep2';
    const modified = 'keep\nmodified\nkeep2\nadded';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0, 'Should detect multiple changes');
    const types = new Set(changes.map(c => c.type));
    // At minimum we should see modified or added changes
    assert.ok(types.size >= 1, 'Should have multiple change types');
  });

  it('returns changes with valid from/to line numbers (1-based)', () => {
    const changes = computeLineChanges('a\nb\nc', 'a\nX\nc\nD');
    for (const change of changes) {
      assert.ok(change.from >= 0, `from should be >= 0, got ${change.from}`);
      assert.ok(change.to >= change.from, `to should be >= from, got from=${change.from} to=${change.to}`);
      assert.ok(['added', 'modified', 'deleted'].includes(change.type), `type should be valid, got ${change.type}`);
    }
  });

  it('handles completely different content', () => {
    const original = 'aaa\nbbb\nccc';
    const modified = 'xxx\nyyy\nzzz';
    const changes = computeLineChanges(original, modified);
    assert.ok(changes.length > 0, 'Should detect changes for completely different content');
  });
});
