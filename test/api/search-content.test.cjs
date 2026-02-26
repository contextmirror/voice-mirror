/**
 * search-content.test.cjs -- Source-inspection tests for searchContent in api.js
 *
 * Validates the searchContent API wrapper exists, invokes the correct
 * Tauri command, and accepts the expected parameters.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'),
  'utf-8'
);

describe('api.js: searchContent', () => {
  it('exports searchContent as async function', () => {
    assert.ok(
      src.includes('export async function searchContent('),
      'Should export async function searchContent'
    );
  });

  it('invokes search_content command', () => {
    assert.ok(
      src.includes("invoke('search_content'"),
      'searchContent should invoke search_content'
    );
  });

  it('accepts query as first parameter', () => {
    assert.ok(
      src.includes('searchContent(query'),
      'searchContent should accept query parameter'
    );
  });

  it('accepts options as second parameter', () => {
    assert.ok(
      src.includes('searchContent(query, options'),
      'searchContent should accept options parameter'
    );
  });

  it('passes root option', () => {
    // Within the invoke call for search_content
    assert.ok(
      src.includes('root: options.root'),
      'Should pass root option from options'
    );
  });

  it('passes caseSensitive option', () => {
    assert.ok(
      src.includes('caseSensitive: options.caseSensitive'),
      'Should pass caseSensitive option'
    );
  });

  it('passes isRegex option', () => {
    assert.ok(
      src.includes('isRegex: options.isRegex'),
      'Should pass isRegex option'
    );
  });

  it('passes wholeWord option', () => {
    assert.ok(
      src.includes('wholeWord: options.wholeWord'),
      'Should pass wholeWord option'
    );
  });

  it('passes includePattern option', () => {
    assert.ok(
      src.includes('includePattern: options.includePattern'),
      'Should pass includePattern option'
    );
  });

  it('passes excludePattern option', () => {
    assert.ok(
      src.includes('excludePattern: options.excludePattern'),
      'Should pass excludePattern option'
    );
  });

  it('has JSDoc comment describing the function', () => {
    assert.ok(
      src.includes('Search file contents'),
      'Should have JSDoc comment describing search functionality'
    );
  });

  it('defaults options to empty object', () => {
    assert.ok(
      src.includes('options = {}'),
      'Should default options to empty object'
    );
  });
});
