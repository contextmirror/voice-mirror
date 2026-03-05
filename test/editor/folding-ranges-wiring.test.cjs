/**
 * folding-ranges-wiring.test.cjs -- Verify folding ranges extension is wired
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LSP_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');
const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');

describe('Folding Ranges — factory', () => {
  it('editor-lsp.svelte.js has foldingRangeExtension function', () => {
    assert.ok(LSP_SRC.includes('function foldingRangeExtension'), 'Should have foldingRangeExtension factory');
  });

  it('imports lspRequestFoldingRanges', () => {
    assert.ok(LSP_SRC.includes('lspRequestFoldingRanges'), 'Should import lspRequestFoldingRanges');
  });

  it('imports foldService from @codemirror/language', () => {
    assert.ok(LSP_SRC.includes('foldService'), 'Should use foldService');
  });

  it('exports foldingRangeExtension', () => {
    assert.ok(LSP_SRC.includes('foldingRangeExtension,'), 'Should export foldingRangeExtension');
  });
});

describe('Folding Ranges — wiring', () => {
  it('editor-extensions.js calls foldingRangeExtension', () => {
    assert.ok(EXT_SRC.includes('foldingRangeExtension'), 'Should wire foldingRangeExtension');
  });

  it('spreads the extension array', () => {
    assert.ok(EXT_SRC.includes('...lsp.foldingRangeExtension'), 'Should spread extension array');
  });
});
