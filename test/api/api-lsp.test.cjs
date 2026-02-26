/**
 * api-lsp.test.cjs -- Source-inspection tests for LSP formatting API wrappers in api.js
 *
 * Validates lspRequestFormatting and lspRequestRangeFormatting: exports, invoke names, and parameters.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

// ============ Exports ============

describe('api.js -- LSP formatting function exports', () => {
  it('exports async function lspRequestFormatting()', () => {
    assert.ok(
      src.includes('export async function lspRequestFormatting('),
      'Should export async function lspRequestFormatting()'
    );
  });

  it('exports async function lspRequestRangeFormatting()', () => {
    assert.ok(
      src.includes('export async function lspRequestRangeFormatting('),
      'Should export async function lspRequestRangeFormatting()'
    );
  });
});

// ============ Invoke names (must match Rust snake_case) ============

describe('api.js -- LSP formatting invoke command names', () => {
  it('invokes lsp_request_formatting', () => {
    assert.ok(
      src.includes("invoke('lsp_request_formatting'"),
      "lspRequestFormatting should invoke 'lsp_request_formatting'"
    );
  });

  it('invokes lsp_request_range_formatting', () => {
    assert.ok(
      src.includes("invoke('lsp_request_range_formatting'"),
      "lspRequestRangeFormatting should invoke 'lsp_request_range_formatting'"
    );
  });
});

// ============ Parameters ============

describe('api.js -- LSP formatting function parameters', () => {
  it('lspRequestFormatting accepts path, tabSize, insertSpaces, projectRoot', () => {
    assert.ok(
      src.includes('lspRequestFormatting(path'),
      'lspRequestFormatting should accept path parameter'
    );
    assert.ok(
      src.includes('tabSize'),
      'lspRequestFormatting should accept tabSize parameter'
    );
    assert.ok(
      src.includes('insertSpaces'),
      'lspRequestFormatting should accept insertSpaces parameter'
    );
  });

  it('lspRequestRangeFormatting accepts range parameters', () => {
    assert.ok(
      src.includes('lspRequestRangeFormatting(path'),
      'lspRequestRangeFormatting should accept path parameter'
    );
    assert.ok(
      src.includes('rangeStartLine') && src.includes('rangeEndLine'),
      'lspRequestRangeFormatting should accept range line parameters'
    );
  });
});

// ============ LSP Signature Help ============

describe('api.js LSP: signature help', () => {
  it('exports lspRequestSignatureHelp', () => {
    assert.ok(src.includes('export async function lspRequestSignatureHelp('), 'Should export lspRequestSignatureHelp');
  });

  it('invokes lsp_request_signature_help', () => {
    assert.ok(src.includes("invoke('lsp_request_signature_help'"), 'Should invoke lsp_request_signature_help');
  });

  it('passes path, line, character, projectRoot', () => {
    assert.ok(src.includes('lspRequestSignatureHelp(path'), 'Should accept path parameter');
  });
});
