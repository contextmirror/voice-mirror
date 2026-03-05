/**
 * code-lens-wiring.test.cjs -- Verify code lens extension is wired into the editor
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LSP_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');
const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');
const THEME_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

describe('Code Lens — factory', () => {
  it('editor-lsp.svelte.js has codeLensExtension function', () => {
    assert.ok(LSP_SRC.includes('function codeLensExtension'), 'Should have codeLensExtension factory');
  });

  it('imports lspRequestCodeLens', () => {
    assert.ok(LSP_SRC.includes('lspRequestCodeLens'), 'Should import lspRequestCodeLens');
  });

  it('exports codeLensExtension', () => {
    assert.ok(LSP_SRC.includes('codeLensExtension,'), 'Should export codeLensExtension');
  });
});

describe('Code Lens — wiring', () => {
  it('editor-extensions.js calls codeLensExtension', () => {
    assert.ok(EXT_SRC.includes('codeLensExtension'), 'Should wire codeLensExtension');
  });
});

describe('Code Lens — CSS', () => {
  it('has .cm-code-lens class', () => {
    assert.ok(THEME_SRC.includes('.cm-code-lens'), 'Should have .cm-code-lens CSS');
  });
});
