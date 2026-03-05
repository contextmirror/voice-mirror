/**
 * document-colors-wiring.test.cjs -- Verify document colors extension is wired into the editor
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LSP_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');
const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');
const THEME_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

describe('Document Colors — factory', () => {
  it('editor-lsp.svelte.js has documentColorsExtension function', () => {
    assert.ok(LSP_SRC.includes('function documentColorsExtension'), 'Should have documentColorsExtension factory');
  });

  it('imports lspRequestDocumentColors', () => {
    assert.ok(LSP_SRC.includes('lspRequestDocumentColors'), 'Should import lspRequestDocumentColors');
  });

  it('exports documentColorsExtension', () => {
    assert.ok(LSP_SRC.includes('documentColorsExtension,'), 'Should export documentColorsExtension');
  });

  it('has ColorSwatchWidget class', () => {
    assert.ok(LSP_SRC.includes('ColorSwatchWidget'), 'Should have ColorSwatchWidget');
  });
});

describe('Document Colors — wiring', () => {
  it('editor-extensions.js calls documentColorsExtension', () => {
    assert.ok(EXT_SRC.includes('documentColorsExtension'), 'Should wire documentColorsExtension');
  });
});

describe('Document Colors — CSS', () => {
  it('has .cm-color-swatch class', () => {
    assert.ok(THEME_SRC.includes('.cm-color-swatch'), 'Should have .cm-color-swatch CSS');
  });
});
