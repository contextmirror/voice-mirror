const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: type hierarchy', () => {
  it('has prepare_type_hierarchy method', () => {
    assert.ok(modSrc.includes('prepare_type_hierarchy'), 'Should have prepare method');
  });
  it('has request_supertypes method', () => {
    assert.ok(modSrc.includes('request_supertypes'), 'Should have supertypes method');
  });
  it('has request_subtypes method', () => {
    assert.ok(modSrc.includes('request_subtypes'), 'Should have subtypes method');
  });
  it('sends prepareTypeHierarchy', () => {
    assert.ok(modSrc.includes('textDocument/prepareTypeHierarchy'), 'correct LSP method');
  });
  it('sends supertypes', () => {
    assert.ok(modSrc.includes('typeHierarchy/supertypes'), 'correct LSP method');
  });
  it('sends subtypes', () => {
    assert.ok(modSrc.includes('typeHierarchy/subtypes'), 'correct LSP method');
  });
});

describe('commands/lsp.rs: type hierarchy', () => {
  it('has prepare command', () => {
    assert.ok(cmdSrc.includes('lsp_prepare_type_hierarchy'), 'Should have command');
  });
  it('has supertypes command', () => {
    assert.ok(cmdSrc.includes('lsp_request_supertypes'), 'Should have command');
  });
  it('has subtypes command', () => {
    assert.ok(cmdSrc.includes('lsp_request_subtypes'), 'Should have command');
  });
});

describe('api.js: type hierarchy', () => {
  it('exports lspPrepareTypeHierarchy', () => {
    assert.ok(apiSrc.includes('export async function lspPrepareTypeHierarchy('), 'Should export');
  });
  it('exports lspRequestSupertypes', () => {
    assert.ok(apiSrc.includes('export async function lspRequestSupertypes('), 'Should export');
  });
  it('exports lspRequestSubtypes', () => {
    assert.ok(apiSrc.includes('export async function lspRequestSubtypes('), 'Should export');
  });
});
