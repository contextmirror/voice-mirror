const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: document colors', () => {
  it('has request_document_colors method', () => {
    assert.ok(modSrc.includes('request_document_colors'), 'Should have method');
  });
  it('sends textDocument/documentColor request', () => {
    assert.ok(modSrc.includes('textDocument/documentColor'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: document colors', () => {
  it('has lsp_request_document_colors command', () => {
    assert.ok(cmdSrc.includes('lsp_request_document_colors'), 'Should have command');
  });
});

describe('api.js: document colors', () => {
  it('exports lspRequestDocumentColors', () => {
    assert.ok(apiSrc.includes('export async function lspRequestDocumentColors('), 'Should export');
  });
});
