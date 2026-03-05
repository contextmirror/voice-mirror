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

describe('mod.rs: declaration', () => {
  it('has request_declaration method', () => {
    assert.ok(modSrc.includes('request_declaration'), 'Should have request_declaration');
  });

  it('sends textDocument/declaration request', () => {
    assert.ok(modSrc.includes('textDocument/declaration'), 'Should send declaration request');
  });
});

describe('commands/lsp.rs: declaration command', () => {
  it('has lsp_request_declaration command', () => {
    assert.ok(cmdSrc.includes('lsp_request_declaration'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_declaration');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: declaration', () => {
  it('exports lspRequestDeclaration wrapper', () => {
    assert.ok(
      apiSrc.includes('export async function lspRequestDeclaration('),
      'Should export lspRequestDeclaration'
    );
  });

  it('invokes lsp_request_declaration command', () => {
    assert.ok(
      apiSrc.includes("invoke('lsp_request_declaration'"),
      'Should invoke lsp_request_declaration'
    );
  });
});

describe('editor-lsp.svelte.js: declaration', () => {
  it('has handleGoToDeclaration handler', () => {
    assert.ok(
      editorLspSrc.includes('handleGoToDeclaration'),
      'Should have handleGoToDeclaration'
    );
  });

  it('exports handleGoToDeclaration from createEditorLsp', () => {
    assert.ok(
      editorLspSrc.includes('handleGoToDeclaration,') || editorLspSrc.includes('handleGoToDeclaration\n'),
      'Should export handleGoToDeclaration'
    );
  });
});
