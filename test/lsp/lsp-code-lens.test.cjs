const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);

describe('mod.rs: code lens', () => {
  it('has request_code_lens method', () => {
    assert.ok(modSrc.includes('request_code_lens'), 'Should have method');
  });

  it('sends textDocument/codeLens request', () => {
    assert.ok(modSrc.includes('textDocument/codeLens'), 'Should send correct LSP method');
  });
});

describe('commands/lsp.rs: code lens', () => {
  it('has lsp_request_code_lens command', () => {
    assert.ok(cmdSrc.includes('lsp_request_code_lens'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_code_lens');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: code lens', () => {
  it('exports lspRequestCodeLens', () => {
    assert.ok(apiSrc.includes('export async function lspRequestCodeLens('), 'Should export');
  });

  it('invokes lsp_request_code_lens', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_code_lens'"), 'Should invoke correct command');
  });
});
