/**
 * lsp-folding-ranges.test.cjs -- Source-inspection tests for folding ranges LSP support.
 *
 * Verifies that the Rust backend, Tauri command, API wrapper, and CM extension are all
 * wired up for textDocument/foldingRange.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');
const editorLspSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8');

describe('mod.rs: folding ranges', () => {
  it('has request_folding_ranges method', () => {
    assert.ok(modSrc.includes('request_folding_ranges'), 'Should have method');
  });
  it('sends textDocument/foldingRange request', () => {
    assert.ok(modSrc.includes('textDocument/foldingRange'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: folding ranges', () => {
  it('has lsp_request_folding_ranges command', () => {
    assert.ok(cmdSrc.includes('lsp_request_folding_ranges'), 'Should have command');
  });
  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_folding_ranges');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: folding ranges', () => {
  it('exports lspRequestFoldingRanges', () => {
    assert.ok(apiSrc.includes('export async function lspRequestFoldingRanges('), 'Should export');
  });
  it('invokes lsp_request_folding_ranges', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_folding_ranges'"), 'Should invoke correct command');
  });
});

describe('editor-lsp.svelte.js: folding range extension', () => {
  it('has foldingRangeExtension factory', () => {
    assert.ok(editorLspSrc.includes('function foldingRangeExtension('), 'Should have factory');
  });
  it('imports lspRequestFoldingRanges', () => {
    assert.ok(editorLspSrc.includes('lspRequestFoldingRanges'), 'Should import API');
  });
  it('returns foldingRangeExtension in extensions list', () => {
    assert.ok(editorLspSrc.includes('foldingRangeExtension'), 'Should be in extensions');
  });
});
