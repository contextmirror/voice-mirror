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
