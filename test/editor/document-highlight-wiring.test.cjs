/**
 * document-highlight-wiring.test.cjs -- Verify document highlight extension is wired into the editor
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');
const THEME_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

describe('Document Highlight wiring', () => {
  it('editor-extensions.js calls documentHighlightExtension', () => {
    assert.ok(EXT_SRC.includes('documentHighlightExtension'), 'Should wire documentHighlightExtension');
  });
});

describe('Document Highlight CSS', () => {
  it('editor-theme.js has .cm-lsp-highlight class', () => {
    assert.ok(THEME_SRC.includes('.cm-lsp-highlight'), 'Should have .cm-lsp-highlight CSS');
  });

  it('uses color-mix for semi-transparent background', () => {
    assert.ok(THEME_SRC.includes('color-mix'), 'Should use color-mix for highlight background');
  });
});
