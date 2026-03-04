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

describe('mod.rs: inlay hints', () => {
  it('has request_inlay_hints method', () => {
    assert.ok(modSrc.includes('request_inlay_hints'), 'Should have request_inlay_hints');
  });

  it('sends textDocument/inlayHint request', () => {
    assert.ok(modSrc.includes('textDocument/inlayHint'), 'Should send inlayHint request');
  });
});

describe('commands/lsp.rs: inlay hints command', () => {
  it('has lsp_request_inlay_hints command', () => {
    assert.ok(cmdSrc.includes('lsp_request_inlay_hints'), 'Should have command');
  });

  it('is a tauri::command', () => {
    const idx = cmdSrc.indexOf('lsp_request_inlay_hints');
    const preceding = cmdSrc.substring(Math.max(0, idx - 200), idx);
    assert.ok(preceding.includes('#[tauri::command]'), 'Should be a tauri::command');
  });
});

describe('api.js: inlay hints', () => {
  it('exports lspRequestInlayHints', () => {
    assert.ok(apiSrc.includes('export async function lspRequestInlayHints('),
      'Should export lspRequestInlayHints');
  });

  it('invokes lsp_request_inlay_hints', () => {
    assert.ok(apiSrc.includes("invoke('lsp_request_inlay_hints'"),
      'Should invoke correct command');
  });
});

describe('editor-lsp.svelte.js: inlay hints', () => {
  it('imports lspRequestInlayHints', () => {
    assert.ok(editorLspSrc.includes('lspRequestInlayHints'),
      'Should import lspRequestInlayHints');
  });

  it('has inlay hint widget or decoration', () => {
    assert.ok(
      editorLspSrc.includes('inlay-hint') || editorLspSrc.includes('InlayHint') || editorLspSrc.includes('inlayHint'),
      'Should have inlay hint rendering'
    );
  });

  it('has inlayHintExtension or similar factory', () => {
    assert.ok(
      editorLspSrc.includes('inlayHint'),
      'Should have inlay hint extension factory'
    );
  });
});
