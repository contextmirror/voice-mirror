/**
 * lsp-on-type-formatting.test.cjs -- Source-inspection tests for on-type formatting LSP support.
 *
 * Verifies that the Rust backend, Tauri command, and API wrapper are all wired up
 * for textDocument/onTypeFormatting.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: on-type formatting', () => {
  it('has request_on_type_formatting method', () => {
    assert.ok(modSrc.includes('request_on_type_formatting'), 'Should have method');
  });
  it('sends textDocument/onTypeFormatting request', () => {
    assert.ok(modSrc.includes('textDocument/onTypeFormatting'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: on-type formatting', () => {
  it('has lsp_request_on_type_formatting command', () => {
    assert.ok(cmdSrc.includes('lsp_request_on_type_formatting'), 'Should have command');
  });
  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_on_type_formatting');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: on-type formatting', () => {
  it('exports lspRequestOnTypeFormatting', () => {
    assert.ok(apiSrc.includes('export async function lspRequestOnTypeFormatting('), 'Should export');
  });
  it('invokes lsp_request_on_type_formatting', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_on_type_formatting'"), 'Should invoke correct command');
  });
});
