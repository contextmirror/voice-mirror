/**
 * semantic-tokens-wiring.test.cjs -- Verify semantic tokens extension is wired
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LSP_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');
const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');
const THEME_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

describe('Semantic Tokens — factory', () => {
  it('editor-lsp.svelte.js has semanticTokensExtension function', () => {
    assert.ok(LSP_SRC.includes('function semanticTokensExtension'), 'Should have semanticTokensExtension factory');
  });

  it('imports lspRequestSemanticTokensFull', () => {
    assert.ok(LSP_SRC.includes('lspRequestSemanticTokensFull'), 'Should import lspRequestSemanticTokensFull');
  });

  it('has SEMANTIC_TOKEN_TYPES legend', () => {
    assert.ok(LSP_SRC.includes('SEMANTIC_TOKEN_TYPES'), 'Should have token types legend');
  });

  it('has STYLED_TOKEN_TYPES filter', () => {
    assert.ok(LSP_SRC.includes('STYLED_TOKEN_TYPES'), 'Should have styled token types filter');
  });

  it('exports semanticTokensExtension', () => {
    assert.ok(LSP_SRC.includes('semanticTokensExtension,'), 'Should export semanticTokensExtension');
  });
});

describe('Semantic Tokens — wiring', () => {
  it('editor-extensions.js calls semanticTokensExtension', () => {
    assert.ok(EXT_SRC.includes('semanticTokensExtension'), 'Should wire semanticTokensExtension');
  });
});

describe('Semantic Tokens — CSS', () => {
  it('has .cm-semantic-type class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-type'), 'Should have type CSS');
  });

  it('has .cm-semantic-interface class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-interface'), 'Should have interface CSS');
  });

  it('has .cm-semantic-enum class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-enum'), 'Should have enum CSS');
  });

  it('has .cm-semantic-enumMember class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-enumMember'), 'Should have enumMember CSS');
  });

  it('has .cm-semantic-property class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-property'), 'Should have property CSS');
  });

  it('has .cm-semantic-namespace class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-namespace'), 'Should have namespace CSS');
  });

  it('has .cm-semantic-decorator class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-decorator'), 'Should have decorator CSS');
  });

  it('has .cm-semantic-macro class', () => {
    assert.ok(THEME_SRC.includes('.cm-semantic-macro'), 'Should have macro CSS');
  });
});
