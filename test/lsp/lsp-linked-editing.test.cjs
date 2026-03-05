/**
 * lsp-linked-editing.test.cjs -- Source-inspection tests for linked editing range
 *
 * Verifies that the linked editing range (HTML tag pair editing) plumbing exists
 * across the Rust backend (mod.rs, commands/lsp.rs), API wrapper (api.js),
 * and frontend handler (editor-lsp.svelte.js).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');
const editorLspSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');

describe('mod.rs: linked editing range', () => {
  it('has request_linked_editing_range method', () => {
    assert.ok(modSrc.includes('request_linked_editing_range'), 'Should have method');
  });
  it('sends textDocument/linkedEditingRange request', () => {
    assert.ok(modSrc.includes('textDocument/linkedEditingRange'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: linked editing range', () => {
  it('has lsp_request_linked_editing_range command', () => {
    assert.ok(cmdSrc.includes('lsp_request_linked_editing_range'), 'Should have command');
  });
});

describe('api.js: linked editing range', () => {
  it('exports lspRequestLinkedEditingRange', () => {
    assert.ok(apiSrc.includes('export async function lspRequestLinkedEditingRange('), 'Should export');
  });
});

describe('editor-lsp.svelte.js: linked editing', () => {
  it('has handleLinkedEditing', () => {
    assert.ok(editorLspSrc.includes('handleLinkedEditing'), 'Should have handler');
  });
  it('imports lspRequestLinkedEditingRange', () => {
    assert.ok(editorLspSrc.includes('lspRequestLinkedEditingRange'), 'Should import API');
  });
});
