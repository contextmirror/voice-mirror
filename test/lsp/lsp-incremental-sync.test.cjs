const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8');

describe('mod.rs: incremental document sync', () => {
  it('has change_document_incremental method', () => {
    assert.ok(modSrc.includes('change_document_incremental'), 'Should have incremental method');
  });

  it('sends contentChanges with incremental format', () => {
    assert.ok(modSrc.includes('contentChanges'), 'Should use contentChanges');
  });

  it('accepts a changes Vec parameter for incremental edits', () => {
    assert.ok(
      modSrc.includes('changes: Vec<'),
      'Should accept a Vec of changes for incremental edits'
    );
  });

  it('sends textDocument/didChange notification', () => {
    // The incremental method should use the same notification method as full sync
    const methodCount = (modSrc.match(/textDocument\/didChange/g) || []).length;
    assert.ok(methodCount >= 2, 'Should have at least two didChange senders (full + incremental)');
  });
});
