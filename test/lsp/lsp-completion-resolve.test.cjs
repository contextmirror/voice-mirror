const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');
const cmdSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('mod.rs: completion resolve', () => {
  it('has resolve_completion_item method', () => {
    assert.ok(modSrc.includes('resolve_completion_item'), 'Should have method');
  });
  it('sends completionItem/resolve request', () => {
    assert.ok(modSrc.includes('completionItem/resolve'), 'Should send correct method');
  });
});
describe('commands/lsp.rs: completion resolve', () => {
  it('has lsp_resolve_completion_item command', () => {
    assert.ok(cmdSrc.includes('lsp_resolve_completion_item'), 'Should have command');
  });
});
describe('api.js: completion resolve', () => {
  it('exports lspResolveCompletionItem', () => {
    assert.ok(apiSrc.includes('export async function lspResolveCompletionItem('), 'Should export');
  });
});
