/**
 * lsp-enhanced-hover.test.cjs -- Source-inspection tests for hover rendering.
 *
 * Validates that request_hover uses the standard textDocument/hover path
 * (vtsls already formats markdown like VS Code), and that the
 * quickinfo_to_markdown helper exists for potential non-vtsls use.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'),
  'utf-8'
);

describe('mod.rs: request_hover uses standard textDocument/hover', () => {
  it('request_hover method exists', () => {
    assert.ok(
      modSrc.includes('fn request_hover'),
      'Should have request_hover method'
    );
  });

  it('delegates to standard_hover', () => {
    assert.ok(
      modSrc.includes('standard_hover'),
      'Should delegate to standard_hover for all servers'
    );
  });

  it('standard_hover uses textDocument/hover', () => {
    assert.ok(
      modSrc.includes('textDocument/hover'),
      'Should use standard textDocument/hover LSP method'
    );
  });
});

describe('mod.rs: quickinfo_to_markdown helper (retained for non-vtsls)', () => {
  it('function exists', () => {
    assert.ok(
      modSrc.includes('fn quickinfo_to_markdown'),
      'Should have quickinfo_to_markdown function'
    );
  });

  it('wraps displayString in typescript code block', () => {
    assert.ok(
      modSrc.includes('displayString') && modSrc.includes('```typescript'),
      'Should wrap displayString in a typescript code block'
    );
  });

  it('handles documentation as string or array', () => {
    assert.ok(
      modSrc.includes('as_str()') && modSrc.includes('as_array()'),
      'Should handle both string and array documentation formats'
    );
  });

  it('joins sections with --- horizontal rules (matching VS Code)', () => {
    assert.ok(
      modSrc.includes('---'),
      'Should use --- separator between sections'
    );
  });

  it('has separate variables for code_block, doc_text, and tag_lines', () => {
    assert.ok(
      modSrc.includes('code_block') && modSrc.includes('doc_text') && modSrc.includes('tag_lines'),
      'Should track three distinct sections for proper separator placement'
    );
  });
});
