const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf-8');

describe('api.js: document highlight', () => {
  it('exports lspRequestDocumentHighlight', () => {
    assert.ok(src.includes('export async function lspRequestDocumentHighlight('),
      'Should export lspRequestDocumentHighlight');
  });

  it('invokes lsp_request_document_highlight', () => {
    assert.ok(src.includes("invoke('lsp_request_document_highlight'"),
      'Should invoke lsp_request_document_highlight');
  });
});
