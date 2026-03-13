/**
 * lsp-selection-range.test.cjs -- Source-inspection tests for selection range LSP support.
 *
 * Verifies that the Rust backend, Tauri command, and API wrapper are all wired up
 * for textDocument/selectionRange.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: selection range', () => {
  it('has request_selection_range method', () => {
    assert.ok(modSrc.includes('request_selection_range'), 'Should have method');
  });
  it('sends textDocument/selectionRange request', () => {
    assert.ok(modSrc.includes('textDocument/selectionRange'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: selection range', () => {
  it('has lsp_request_selection_range command', () => {
    assert.ok(cmdSrc.includes('lsp_request_selection_range'), 'Should have command');
  });
  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_selection_range');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: selection range', () => {
  it('exports lspRequestSelectionRange', () => {
    assert.ok(apiSrc.includes('export async function lspRequestSelectionRange('), 'Should export');
  });
  it('invokes lsp_request_selection_range', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_selection_range'"), 'Should invoke correct command');
  });
});
