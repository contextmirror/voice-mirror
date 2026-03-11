/**
 * lsp-document-colors.test.cjs -- Source-inspection tests for document colors LSP support.
 *
 * Verifies that the Rust backend, Tauri command, API wrapper, and CM extension are all
 * wired up for textDocument/documentColor.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');
const editorLspSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');

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
  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_document_colors');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: document colors', () => {
  it('exports lspRequestDocumentColors', () => {
    assert.ok(apiSrc.includes('export async function lspRequestDocumentColors('), 'Should export');
  });
  it('invokes lsp_request_document_colors', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_document_colors'"), 'Should invoke correct command');
  });
});

describe('editor-lsp.svelte.js: document colors extension', () => {
  it('has documentColorsExtension factory', () => {
    assert.ok(editorLspSrc.includes('function documentColorsExtension('), 'Should have factory');
  });
  it('imports lspRequestDocumentColors', () => {
    assert.ok(editorLspSrc.includes('lspRequestDocumentColors'), 'Should import API');
  });
  it('returns documentColorsExtension in extensions list', () => {
    assert.ok(editorLspSrc.includes('documentColorsExtension'), 'Should be in extensions');
  });
});
