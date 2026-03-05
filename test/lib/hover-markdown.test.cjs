/**
 * hover-markdown.test.cjs -- Source-inspection tests for hover-markdown.js
 *
 * Validates the hover-specific markdown renderer with highlight.js
 * syntax highlighting for LSP hover tooltips.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/hover-markdown.js');
const src = fs.existsSync(SRC_PATH) ? fs.readFileSync(SRC_PATH, 'utf-8') : '';

describe('hover-markdown.js: file exists', () => {
  it('source file exists', () => {
    assert.ok(fs.existsSync(SRC_PATH), 'src/lib/hover-markdown.js should exist');
  });
});

describe('hover-markdown.js: exports', () => {
  it('exports renderHoverMarkdown function', () => {
    assert.ok(src.includes('export function renderHoverMarkdown'), 'Should export renderHoverMarkdown');
  });
});

describe('hover-markdown.js: dependencies', () => {
  it('imports marked', () => {
    assert.ok(src.includes("from 'marked'"), 'Should import from marked');
  });

  it('imports markedHighlight from marked-highlight', () => {
    assert.ok(src.includes("from 'marked-highlight'"), 'Should import from marked-highlight');
  });

  it('imports highlight.js core', () => {
    assert.ok(
      src.includes("from 'highlight.js/lib/core'"),
      'Should import highlight.js core (not full bundle)'
    );
  });

  it('imports DOMPurify', () => {
    assert.ok(src.includes("from 'dompurify'"), 'Should import DOMPurify');
  });
});

describe('hover-markdown.js: language registrations', () => {
  it('registers JavaScript', () => {
    assert.ok(src.includes("highlight.js/lib/languages/javascript"), 'Should register JS');
  });

  it('registers TypeScript', () => {
    assert.ok(src.includes("highlight.js/lib/languages/typescript"), 'Should register TS');
  });

  it('registers CSS', () => {
    assert.ok(src.includes("highlight.js/lib/languages/css"), 'Should register CSS');
  });

  it('registers Rust', () => {
    assert.ok(src.includes("highlight.js/lib/languages/rust"), 'Should register Rust');
  });

  it('registers JSON', () => {
    assert.ok(src.includes("highlight.js/lib/languages/json"), 'Should register JSON');
  });

  it('registers XML/HTML', () => {
    assert.ok(src.includes("highlight.js/lib/languages/xml"), 'Should register XML (covers HTML)');
  });

  it('registers Python', () => {
    assert.ok(src.includes("highlight.js/lib/languages/python"), 'Should register Python');
  });
});

describe('hover-markdown.js: marked configuration', () => {
  it('creates a separate Marked instance (not global)', () => {
    assert.ok(src.includes('new Marked('), 'Should create a new Marked instance');
  });

  it('uses markedHighlight for code highlighting', () => {
    assert.ok(src.includes('markedHighlight'), 'Should use markedHighlight extension');
  });

  it('calls hljs.highlight for known languages', () => {
    assert.ok(src.includes('hljs.highlight'), 'Should call hljs.highlight');
  });

  it('falls back to highlightAuto for unknown languages', () => {
    assert.ok(src.includes('hljs.highlightAuto'), 'Should fallback to highlightAuto');
  });

  it('does NOT enable breaks (hover is not chat)', () => {
    // The hover renderer should NOT have breaks: true
    // (chat markdown.js has it, hover should not)
    assert.ok(!src.includes('breaks: true'), 'Should NOT enable breaks for hover tooltips');
  });
});

describe('hover-markdown.js: renderHoverMarkdown implementation', () => {
  it('handles empty/falsy input', () => {
    assert.ok(
      src.includes("if (!text)") || src.includes("if(!text)"),
      'Should handle falsy input'
    );
  });

  it('calls parse on the marked instance', () => {
    assert.ok(src.includes('.parse(text)'), 'Should call parse on text');
  });

  it('sanitizes output with DOMPurify', () => {
    assert.ok(src.includes('DOMPurify.sanitize'), 'Should sanitize HTML output');
  });

  it('allows span tags through DOMPurify (for hljs classes)', () => {
    assert.ok(
      src.includes('FORBID_TAGS') === false || src.includes("'span'"),
      'Should allow span tags for syntax highlighting'
    );
  });
});
