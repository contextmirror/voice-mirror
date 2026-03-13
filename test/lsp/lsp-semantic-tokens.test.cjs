/**
 * lsp-semantic-tokens.test.cjs -- Source-inspection tests for semantic tokens LSP support.
 *
 * Verifies that the Rust backend, Tauri command, API wrapper, and CM extension are all
 * wired up for textDocument/semanticTokens/full.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);
const editorLspSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8'
);

describe('mod.rs: semantic tokens', () => {
  it('has request_semantic_tokens_full method', () => {
    assert.ok(modSrc.includes('request_semantic_tokens_full'), 'Should have method');
  });

  it('sends textDocument/semanticTokens/full request', () => {
    assert.ok(modSrc.includes('textDocument/semanticTokens/full'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: semantic tokens', () => {
  it('has lsp_request_semantic_tokens_full command', () => {
    assert.ok(cmdSrc.includes('lsp_request_semantic_tokens_full'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_semantic_tokens_full');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: semantic tokens', () => {
  it('exports lspRequestSemanticTokensFull', () => {
    assert.ok(apiSrc.includes('export async function lspRequestSemanticTokensFull('), 'Should export');
  });

  it('invokes lsp_request_semantic_tokens_full', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_semantic_tokens_full'"), 'Should invoke correct command');
  });
});

describe('editor-lsp.svelte.js: semantic tokens extension', () => {
  it('has semanticTokensExtension factory', () => {
    assert.ok(editorLspSrc.includes('function semanticTokensExtension('), 'Should have factory');
  });
  it('imports lspRequestSemanticTokensFull', () => {
    assert.ok(editorLspSrc.includes('lspRequestSemanticTokensFull'), 'Should import API');
  });
  it('returns semanticTokensExtension in extensions list', () => {
    assert.ok(editorLspSrc.includes('semanticTokensExtension'), 'Should be in extensions');
  });
});
