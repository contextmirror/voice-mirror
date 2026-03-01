/**
 * file-tree-nav.test.mjs — Unit tests for file-tree-nav.js pure utility functions.
 *
 * These are real functional tests (not source-inspection) since the module
 * is pure ESM with no DOM or Svelte dependencies.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flattenVisibleEntries, isDescendantOf, getParentPath } from '../../src/lib/file-tree-nav.js';

// ── flattenVisibleEntries ──

describe('flattenVisibleEntries', () => {
  it('returns empty array for empty entries', () => {
    const result = flattenVisibleEntries([], new Set(), new Map());
    assert.deepStrictEqual(result, []);
  });

  it('returns root-level entries at depth 0 with empty parentPath', () => {
    const entries = [
      { name: 'a.js', path: 'a.js', type: 'file' },
      { name: 'b.js', path: 'b.js', type: 'file' },
    ];
    const result = flattenVisibleEntries(entries, new Set(), new Map());
    assert.equal(result.length, 2);
    assert.equal(result[0].depth, 0);
    assert.equal(result[0].parentPath, '');
    assert.equal(result[1].depth, 0);
    assert.equal(result[1].parentPath, '');
  });

  it('includes children of expanded directories at depth 1', () => {
    const entries = [
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'readme.md', path: 'readme.md', type: 'file' },
    ];
    const expanded = new Set(['src']);
    const children = new Map([
      ['src', [
        { name: 'a.js', path: 'src/a.js', type: 'file' },
        { name: 'b.js', path: 'src/b.js', type: 'file' },
      ]],
    ]);
    const result = flattenVisibleEntries(entries, expanded, children);
    assert.equal(result.length, 4); // src, a.js, b.js, readme.md
    assert.equal(result[0].entry.path, 'src');
    assert.equal(result[0].depth, 0);
    assert.equal(result[1].entry.path, 'src/a.js');
    assert.equal(result[1].depth, 1);
    assert.equal(result[1].parentPath, 'src');
    assert.equal(result[2].entry.path, 'src/b.js');
    assert.equal(result[2].depth, 1);
    assert.equal(result[3].entry.path, 'readme.md');
    assert.equal(result[3].depth, 0);
  });

  it('excludes children of collapsed directories', () => {
    const entries = [
      { name: 'src', path: 'src', type: 'directory' },
    ];
    const children = new Map([
      ['src', [{ name: 'a.js', path: 'src/a.js', type: 'file' }]],
    ]);
    const result = flattenVisibleEntries(entries, new Set(), children);
    assert.equal(result.length, 1); // only the dir itself
    assert.equal(result[0].entry.path, 'src');
  });

  it('handles deeply nested expanded directories', () => {
    const entries = [{ name: 'a', path: 'a', type: 'directory' }];
    const expanded = new Set(['a', 'a/b']);
    const children = new Map([
      ['a', [{ name: 'b', path: 'a/b', type: 'directory' }]],
      ['a/b', [{ name: 'c.js', path: 'a/b/c.js', type: 'file' }]],
    ]);
    const result = flattenVisibleEntries(entries, expanded, children);
    assert.equal(result.length, 3);
    assert.equal(result[0].depth, 0);
    assert.equal(result[0].parentPath, '');
    assert.equal(result[1].depth, 1);
    assert.equal(result[1].parentPath, 'a');
    assert.equal(result[2].depth, 2);
    assert.equal(result[2].parentPath, 'a/b');
    assert.equal(result[2].entry.path, 'a/b/c.js');
  });

  it('handles expanded dir with no cached children gracefully', () => {
    const entries = [{ name: 'src', path: 'src', type: 'directory' }];
    const expanded = new Set(['src']);
    const children = new Map(); // no children cached
    const result = flattenVisibleEntries(entries, expanded, children);
    assert.equal(result.length, 1); // just the dir
  });

  it('preserves entry order as given', () => {
    const entries = [
      { name: 'z.js', path: 'z.js', type: 'file' },
      { name: 'a.js', path: 'a.js', type: 'file' },
      { name: 'm.js', path: 'm.js', type: 'file' },
    ];
    const result = flattenVisibleEntries(entries, new Set(), new Map());
    assert.equal(result[0].entry.name, 'z.js');
    assert.equal(result[1].entry.name, 'a.js');
    assert.equal(result[2].entry.name, 'm.js');
  });
});

// ── isDescendantOf ──

describe('isDescendantOf', () => {
  it('returns true for self (same path)', () => {
    assert.ok(isDescendantOf('src', 'src'));
  });

  it('returns true for direct child', () => {
    assert.ok(isDescendantOf('src/a.js', 'src'));
  });

  it('returns true for deeply nested descendant', () => {
    assert.ok(isDescendantOf('src/lib/utils/helpers.js', 'src'));
  });

  it('returns false for sibling path', () => {
    assert.ok(!isDescendantOf('test/a.js', 'src'));
  });

  it('returns false for partial name match (src vs src-backup)', () => {
    assert.ok(!isDescendantOf('src-backup/a.js', 'src'));
  });

  it('returns false for parent path', () => {
    assert.ok(!isDescendantOf('src', 'src/lib'));
  });

  it('returns false when ancestorPath is empty', () => {
    assert.ok(!isDescendantOf('src/a.js', ''));
  });
});

// ── getParentPath ──

describe('getParentPath', () => {
  it('returns empty string for root-level file', () => {
    assert.equal(getParentPath('readme.md'), '');
  });

  it('returns parent directory for nested file', () => {
    assert.equal(getParentPath('src/a.js'), 'src');
  });

  it('returns immediate parent for deeply nested file', () => {
    assert.equal(getParentPath('src/lib/utils/helpers.js'), 'src/lib/utils');
  });

  it('returns parent for directory path', () => {
    assert.equal(getParentPath('src/lib'), 'src');
  });

  it('returns empty string for root-level directory', () => {
    assert.equal(getParentPath('src'), '');
  });
});
