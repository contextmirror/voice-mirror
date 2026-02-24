/**
 * api-files.test.js -- Parameter-passing tests for file/directory API wrappers
 *
 * Export/invoke existence is already covered by api-signatures.test.cjs.
 * These tests verify correct parameter passing patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- listDirectory parameter passing', () => {
  it('passes path parameter', () => {
    assert.ok(
      src.includes('{ path:'),
      'Should pass path to invoke'
    );
  });

  it('handles null path for root directory', () => {
    assert.ok(
      src.includes('path || null') || src.includes('path ?? null'),
      'Should default path to null for root listing'
    );
  });

  it('accepts root parameter', () => {
    assert.ok(
      src.includes('listDirectory(path, root)') || src.includes('listDirectory(path,root)'),
      'Should accept root parameter'
    );
  });

  it('passes root to invoke call', () => {
    assert.ok(
      src.includes('root: root || null') || src.includes('root: root ?? null'),
      'Should pass root to invoke as root || null'
    );
  });
});

describe('api.js -- getGitChanges parameter passing', () => {
  it('accepts root parameter in function signature', () => {
    assert.ok(
      src.includes('getGitChanges(root)') || src.includes('getGitChanges(root,'),
      'Should accept root parameter'
    );
  });

  it('passes root parameter to invoke', () => {
    assert.ok(
      src.includes('root: root || null') || src.includes('root ?? null'),
      'Should pass root to invoke for get_git_changes'
    );
  });
});

describe('api.js -- readFile parameter passing', () => {
  it('accepts path and root parameters', () => {
    assert.ok(
      src.includes('readFile(path, root)') || src.includes('readFile(path,root)'),
      'Should accept path and root'
    );
  });
});

describe('api.js -- readExternalFile parameter passing', () => {
  it('accepts path parameter', () => {
    assert.ok(
      src.includes('readExternalFile(path)'),
      'Should accept path parameter'
    );
  });
});

describe('api.js -- writeFile parameter passing', () => {
  it('accepts path, content, and root parameters', () => {
    assert.ok(
      src.includes('writeFile(path, content, root)') || src.includes('writeFile(path,content,root)'),
      'Should accept path, content, and root'
    );
  });
});

describe('api.js -- getFileGitContent parameter passing', () => {
  it('accepts path and root parameters', () => {
    assert.ok(
      src.includes('getFileGitContent(path, root)') || src.includes('getFileGitContent(path,root)'),
      'Should accept path and root'
    );
  });

  it('passes root || null to invoke', () => {
    assert.ok(
      src.includes('root: root || null'),
      'Should pass root || null'
    );
  });
});

describe('api.js -- startFileWatching parameter passing', () => {
  it('passes projectRoot parameter', () => {
    assert.ok(
      src.includes('startFileWatching(projectRoot)'),
      'Should accept projectRoot parameter'
    );
    assert.ok(
      src.includes('{ projectRoot }') || src.includes('projectRoot'),
      'Should pass projectRoot to invoke'
    );
  });
});
