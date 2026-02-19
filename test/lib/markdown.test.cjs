/**
 * markdown.test.js -- Source-inspection tests for tauri/src/lib/markdown.js
 *
 * This is a plain .js file (not .svelte.js) that uses ES module syntax.
 * We still use source-inspection since it imports browser-only modules
 * (marked, DOMPurify) that aren't available in Node.js test environment.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/markdown.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('markdown.js -- exports', () => {
  it('exports renderMarkdown function', () => {
    assert.ok(src.includes('export function renderMarkdown'), 'Should export renderMarkdown');
  });
});

describe('markdown.js -- dependencies', () => {
  it('imports marked library', () => {
    assert.ok(src.includes("import { marked } from 'marked'"), 'Should import marked');
  });

  it('imports DOMPurify for XSS prevention', () => {
    assert.ok(src.includes("import DOMPurify from 'dompurify'"), 'Should import DOMPurify');
  });
});

describe('markdown.js -- marked configuration', () => {
  it('calls marked.setOptions', () => {
    assert.ok(src.includes('marked.setOptions'), 'Should configure marked');
  });

  it('enables breaks (GFM line breaks)', () => {
    assert.ok(src.includes('breaks: true'), 'Should enable line breaks');
  });

  it('enables gfm (GitHub-flavored markdown)', () => {
    assert.ok(src.includes('gfm: true'), 'Should enable GFM');
  });

  it('disables headerIds', () => {
    assert.ok(src.includes('headerIds: false'), 'Should disable header IDs');
  });
});

describe('markdown.js -- renderMarkdown implementation', () => {
  it('handles empty/falsy input', () => {
    assert.ok(src.includes("if (!text) return ''"), 'Should return empty string for falsy input');
  });

  it('calls marked.parse on input text', () => {
    assert.ok(src.includes('marked.parse(text)'), 'Should call marked.parse');
  });

  it('sanitizes output with DOMPurify.sanitize', () => {
    assert.ok(src.includes('DOMPurify.sanitize'), 'Should sanitize HTML output');
  });

  it('returns sanitized HTML string', () => {
    assert.ok(src.includes('return DOMPurify.sanitize(raw)'), 'Should return sanitized result');
  });
});

describe('markdown.js -- JSDoc documentation', () => {
  it('documents text parameter', () => {
    assert.ok(src.includes('@param {string} text'), 'Should document text param');
  });

  it('documents return type', () => {
    assert.ok(src.includes('@returns {string}'), 'Should document return type');
  });

  it('mentions sanitized HTML in docs', () => {
    assert.ok(
      src.includes('Sanitized HTML') || src.includes('sanitized') || src.includes('Sanitize'),
      'Should mention sanitization in docs'
    );
  });
});
