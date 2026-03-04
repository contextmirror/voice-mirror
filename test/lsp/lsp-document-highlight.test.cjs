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

describe('mod.rs: document highlight', () => {
  it('has request_document_highlight method', () => {
    assert.ok(modSrc.includes('request_document_highlight'), 'Should have request_document_highlight');
  });

  it('sends textDocument/documentHighlight request', () => {
    assert.ok(modSrc.includes('textDocument/documentHighlight'), 'Should send documentHighlight request');
  });
});

describe('commands/lsp.rs: document highlight command', () => {
  it('has lsp_request_document_highlight command', () => {
    assert.ok(cmdSrc.includes('lsp_request_document_highlight'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_document_highlight');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});
