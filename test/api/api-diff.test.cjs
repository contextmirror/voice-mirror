/**
 * api-diff.test.cjs -- Parameter-passing tests for getFileGitContent API wrapper
 *
 * Export/invoke existence is already covered by api-signatures.test.cjs.
 * These tests verify parameter passing and JSDoc documentation.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- getFileGitContent parameter passing', () => {
  it('accepts path and root parameters', () => {
    assert.ok(
      src.includes('getFileGitContent(path, root)') || src.includes('getFileGitContent(path,root)'),
      'Should accept path and root parameters'
    );
  });

  it('passes path to invoke', () => {
    const invokeIdx = src.indexOf("invoke('get_file_git_content'");
    assert.ok(invokeIdx !== -1, 'Should have invoke call');
    const snippet = src.slice(invokeIdx, invokeIdx + 100);
    assert.ok(snippet.includes('path'), 'Should pass path to invoke');
  });

  it('passes root || null to invoke', () => {
    const fnStart = src.indexOf('function getFileGitContent(');
    const fnEnd = src.indexOf('}', src.indexOf("invoke('get_file_git_content'"));
    const fnBody = src.slice(fnStart, fnEnd + 1);
    assert.ok(
      fnBody.includes('root || null') || fnBody.includes('root ?? null'),
      'Should pass root || null to invoke'
    );
  });

  it('has JSDoc describing return shape', () => {
    const fnIdx = src.indexOf('function getFileGitContent(');
    const preceding = src.slice(Math.max(0, fnIdx - 300), fnIdx);
    assert.ok(
      preceding.includes('content') && preceding.includes('isNew'),
      'Should document content and isNew in return shape'
    );
  });

  it('documents binary return case', () => {
    const fnIdx = src.indexOf('function getFileGitContent(');
    const preceding = src.slice(Math.max(0, fnIdx - 300), fnIdx);
    assert.ok(
      preceding.includes('binary'),
      'Should document binary file case'
    );
  });
});
