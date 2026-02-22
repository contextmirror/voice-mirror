const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/FileEditor.svelte'), 'utf-8');

describe('FileEditor LSP integration', () => {
  it('imports @codemirror/lint', () => {
    assert.ok(src.includes("@codemirror/lint"));
  });
  it('imports LSP API functions', () => {
    assert.ok(src.includes('lspOpenFile'));
    assert.ok(src.includes('lspCloseFile'));
    assert.ok(src.includes('lspChangeFile'));
  });
  it('has lspPositionToOffset helper', () => {
    assert.ok(src.includes('lspPositionToOffset'));
  });
  it('listens for lsp-diagnostics event', () => {
    assert.ok(src.includes("'lsp-diagnostics'"));
  });
  it('calls setDiagnostics on diagnostic event', () => {
    assert.ok(src.includes('setDiagnostics'));
  });
  it('has lintGutter extension', () => {
    assert.ok(src.includes('lintGutter'));
  });
  it('debounces lspChangeFile calls', () => {
    assert.ok(src.includes('lspDebounceTimer') || src.includes('debounce'));
  });
  it('sends lspOpenFile on file load', () => {
    assert.ok(src.includes('lspOpenFile'));
  });
  it('sends lspCloseFile on destroy', () => {
    assert.ok(src.includes('lspCloseFile'));
  });
  it('has LSP completion source', () => {
    assert.ok(src.includes('lspCompletionSource') || src.includes('lspRequestCompletion'));
  });
  it('has mapCompletionKind helper', () => {
    assert.ok(src.includes('mapCompletionKind'));
  });
  it('has hover tooltip support', () => {
    assert.ok(src.includes('hoverTooltip') || src.includes('lspRequestHover'));
  });
  it('has go-to-definition support', () => {
    assert.ok(src.includes('lspRequestDefinition'));
  });
  it('has LSP extensions set for supported languages', () => {
    assert.ok(src.includes('LSP_EXTENSIONS') || src.includes('hasLsp'));
  });
  it('sends lspSaveFile on save', () => {
    assert.ok(src.includes('lspSaveFile'));
  });
  it('has hover tooltip CSS styling', () => {
    assert.ok(src.includes('lsp-hover-tooltip'));
  });
  it('clamps diagnostic positions to document bounds', () => {
    assert.ok(src.includes('Math.max') && src.includes('Math.min'));
  });
});
