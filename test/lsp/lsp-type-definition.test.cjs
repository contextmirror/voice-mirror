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

describe('mod.rs: type definition', () => {
  it('has request_type_definition method', () => {
    assert.ok(modSrc.includes('request_type_definition'), 'Should have request_type_definition');
  });

  it('sends textDocument/typeDefinition request', () => {
    assert.ok(modSrc.includes('textDocument/typeDefinition'), 'Should send typeDefinition request');
  });
});

describe('commands/lsp.rs: type definition command', () => {
  it('has lsp_request_type_definition command', () => {
    assert.ok(cmdSrc.includes('lsp_request_type_definition'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_type_definition');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: type definition', () => {
  it('exports lspRequestTypeDefinition wrapper', () => {
    assert.ok(
      apiSrc.includes('export async function lspRequestTypeDefinition('),
      'Should export lspRequestTypeDefinition'
    );
  });

  it('invokes lsp_request_type_definition command', () => {
    assert.ok(
      apiSrc.includes("invoke('lsp_request_type_definition'"),
      'Should invoke lsp_request_type_definition'
    );
  });
});

describe('editor-lsp.svelte.js: type definition', () => {
  it('has handleGoToTypeDefinition handler', () => {
    assert.ok(
      editorLspSrc.includes('handleGoToTypeDefinition'),
      'Should have handleGoToTypeDefinition'
    );
  });

  it('exports handleGoToTypeDefinition from createEditorLsp', () => {
    assert.ok(
      editorLspSrc.includes('handleGoToTypeDefinition,') || editorLspSrc.includes('handleGoToTypeDefinition\n'),
      'Should export handleGoToTypeDefinition'
    );
  });
});
