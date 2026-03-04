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
const editorLspSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8'
);

describe('mod.rs: implementation', () => {
  it('has request_implementation method', () => {
    assert.ok(modSrc.includes('request_implementation'), 'Should have request_implementation');
  });

  it('sends textDocument/implementation request', () => {
    assert.ok(modSrc.includes('textDocument/implementation'), 'Should send implementation request');
  });
});

describe('commands/lsp.rs: implementation command', () => {
  it('has lsp_request_implementation command', () => {
    assert.ok(cmdSrc.includes('lsp_request_implementation'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_implementation');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: implementation', () => {
  it('exports lspRequestImplementation wrapper', () => {
    assert.ok(
      apiSrc.includes('export async function lspRequestImplementation('),
      'Should export lspRequestImplementation'
    );
  });

  it('invokes lsp_request_implementation command', () => {
    assert.ok(
      apiSrc.includes("invoke('lsp_request_implementation'"),
      'Should invoke lsp_request_implementation'
    );
  });
});

describe('editor-lsp.svelte.js: implementation', () => {
  it('has handleGoToImplementation handler', () => {
    assert.ok(
      editorLspSrc.includes('handleGoToImplementation'),
      'Should have handleGoToImplementation'
    );
  });

  it('exports handleGoToImplementation from createEditorLsp', () => {
    assert.ok(
      editorLspSrc.includes('handleGoToImplementation,') || editorLspSrc.includes('handleGoToImplementation\n'),
      'Should export handleGoToImplementation'
    );
  });
});
