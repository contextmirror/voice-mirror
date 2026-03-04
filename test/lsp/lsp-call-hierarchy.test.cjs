const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: call hierarchy', () => {
  it('has prepare_call_hierarchy method', () => {
    assert.ok(modSrc.includes('prepare_call_hierarchy'), 'Should have prepare method');
  });
  it('has request_incoming_calls method', () => {
    assert.ok(modSrc.includes('request_incoming_calls'), 'Should have incoming method');
  });
  it('has request_outgoing_calls method', () => {
    assert.ok(modSrc.includes('request_outgoing_calls'), 'Should have outgoing method');
  });
  it('sends prepareCallHierarchy', () => {
    assert.ok(modSrc.includes('textDocument/prepareCallHierarchy'), 'correct LSP method');
  });
  it('sends incomingCalls', () => {
    assert.ok(modSrc.includes('callHierarchy/incomingCalls'), 'correct LSP method');
  });
  it('sends outgoingCalls', () => {
    assert.ok(modSrc.includes('callHierarchy/outgoingCalls'), 'correct LSP method');
  });
});

describe('commands/lsp.rs: call hierarchy', () => {
  it('has prepare command', () => {
    assert.ok(cmdSrc.includes('lsp_prepare_call_hierarchy'), 'Should have command');
  });
  it('has incoming command', () => {
    assert.ok(cmdSrc.includes('lsp_request_incoming_calls'), 'Should have command');
  });
  it('has outgoing command', () => {
    assert.ok(cmdSrc.includes('lsp_request_outgoing_calls'), 'Should have command');
  });
});

describe('api.js: call hierarchy', () => {
  it('exports lspPrepareCallHierarchy', () => {
    assert.ok(apiSrc.includes('export async function lspPrepareCallHierarchy('), 'Should export');
  });
  it('exports lspRequestIncomingCalls', () => {
    assert.ok(apiSrc.includes('export async function lspRequestIncomingCalls('), 'Should export');
  });
  it('exports lspRequestOutgoingCalls', () => {
    assert.ok(apiSrc.includes('export async function lspRequestOutgoingCalls('), 'Should export');
  });
});
