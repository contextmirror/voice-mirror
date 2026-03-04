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

describe('mod.rs: workspace symbols', () => {
  it('has request_workspace_symbols method', () => {
    assert.ok(modSrc.includes('request_workspace_symbols'), 'Should have request_workspace_symbols');
  });

  it('sends workspace/symbol request', () => {
    assert.ok(modSrc.includes('workspace/symbol'), 'Should send workspace/symbol request');
  });
});

describe('commands/lsp.rs: workspace symbols command', () => {
  it('has lsp_request_workspace_symbols command', () => {
    assert.ok(cmdSrc.includes('lsp_request_workspace_symbols'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_workspace_symbols');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: workspace symbols', () => {
  it('exports lspRequestWorkspaceSymbols', () => {
    assert.ok(apiSrc.includes('export async function lspRequestWorkspaceSymbols('),
      'Should export lspRequestWorkspaceSymbols');
  });

  it('invokes lsp_request_workspace_symbols', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_workspace_symbols'"),
      'Should invoke correct command');
  });
});
