/**
 * search-files.test.cjs -- Parameter-passing tests for the searchFiles API function
 *
 * Export/invoke existence is already covered by api-signatures.test.cjs.
 * These tests verify parameter passing and documentation patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- searchFiles parameter passing', () => {
  it('passes root parameter to invoke', () => {
    assert.ok(
      src.includes("invoke('search_files', { root:"),
      'Should pass root parameter to invoke'
    );
  });

  it('accepts root as parameter', () => {
    assert.ok(
      src.includes('function searchFiles(root)'),
      'searchFiles should accept root parameter'
    );
  });

  it('defaults root to null when not provided', () => {
    assert.ok(
      src.includes('root: root || null'),
      'Should default root to null'
    );
  });

  it('is in the Files section', () => {
    const filesSectionIndex = src.indexOf('// ============ Files');
    const searchFilesIndex = src.indexOf('export async function searchFiles');
    assert.ok(filesSectionIndex > 0, 'Should have a Files section');
    assert.ok(searchFilesIndex > filesSectionIndex, 'searchFiles should be in the Files section');
  });
});
