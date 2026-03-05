const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: pull diagnostics', () => {
  it('has request_diagnostics method', () => {
    assert.ok(modSrc.includes('request_diagnostics'), 'Should have method');
  });
  it('sends textDocument/diagnostic request', () => {
    assert.ok(modSrc.includes('textDocument/diagnostic'), 'Should send correct method');
  });
});
describe('commands/lsp.rs: pull diagnostics', () => {
  it('has lsp_request_diagnostics command', () => {
    assert.ok(cmdSrc.includes('lsp_request_diagnostics'), 'Should have command');
  });
});
describe('api.js: pull diagnostics', () => {
  it('exports lspRequestDiagnostics', () => {
    assert.ok(apiSrc.includes('export async function lspRequestDiagnostics('), 'Should export');
  });
});
