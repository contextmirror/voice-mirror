const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'), 'utf-8'
);

describe('editor-lsp.svelte.js: range formatting', () => {
  it('has formatSelection method', () => {
    assert.ok(src.includes('formatSelection'), 'Should have formatSelection');
  });

  it('imports lspRequestRangeFormatting', () => {
    assert.ok(src.includes('lspRequestRangeFormatting'), 'Should import range formatting API');
  });

  it('exports formatSelection from return object', () => {
    // Check that formatSelection appears in the return object (not just as a function definition)
    const returnBlock = src.slice(src.lastIndexOf('return {'));
    assert.ok(returnBlock.includes('formatSelection'), 'Should export formatSelection from return object');
  });

  it('checks for empty selection before requesting', () => {
    assert.ok(src.includes('sel.from === sel.to'), 'Should guard against empty selection');
  });

  it('calls lspRequestRangeFormatting with selection coordinates', () => {
    assert.ok(
      /lspRequestRangeFormatting\s*\(/.test(src),
      'Should call lspRequestRangeFormatting'
    );
  });

  it('sorts edits in reverse order for range formatting', () => {
    // formatSelection should sort edits just like formatDocument does
    const fnStart = src.indexOf('async function formatSelection');
    assert.ok(fnStart !== -1, 'Should have formatSelection function');
    const fnBody = src.slice(fnStart, src.indexOf('\n  }', fnStart + 100));
    assert.ok(fnBody.includes('.sort('), 'Should sort range formatting edits in reverse order');
  });

  it('dispatches changes to the editor view', () => {
    const fnStart = src.indexOf('async function formatSelection');
    assert.ok(fnStart !== -1, 'Should have formatSelection function');
    const fnBody = src.slice(fnStart, src.indexOf('\n  }', fnStart + 100));
    assert.ok(fnBody.includes('view.dispatch('), 'Should dispatch changes to the editor');
  });

  it('returns false when no LSP', () => {
    const fnStart = src.indexOf('async function formatSelection');
    assert.ok(fnStart !== -1, 'Should have formatSelection function');
    const fnBody = src.slice(fnStart, src.indexOf('\n  }', fnStart + 100));
    assert.ok(fnBody.includes('if (!hasLsp) return false'), 'Should return false when no LSP');
  });
});
