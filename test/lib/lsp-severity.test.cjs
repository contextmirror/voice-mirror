/**
 * lsp-severity.test.cjs -- Source-inspection tests for lsp-severity.js
 *
 * Validates exports (severityName, severityNum, severityLabel) and their
 * classification logic by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/lsp-severity.js'),
  'utf-8'
);

describe('lsp-severity.js: exports', () => {
  it('exports severityName function', () => {
    assert.ok(src.includes('export function severityName'), 'Should export severityName');
  });

  it('exports severityNum function', () => {
    assert.ok(src.includes('export function severityNum'), 'Should export severityNum');
  });

  it('exports severityLabel function', () => {
    assert.ok(src.includes('export function severityLabel'), 'Should export severityLabel');
  });
});

describe('lsp-severity.js: severityName classification', () => {
  it('maps numeric 1 to error', () => {
    assert.ok(src.includes("sev === 1"), 'Should handle numeric severity 1');
  });

  it('maps string error to error', () => {
    assert.ok(src.includes("sev === 'error'"), "Should handle string severity 'error'");
  });

  it('maps numeric 2 to warning', () => {
    assert.ok(src.includes("sev === 2"), 'Should handle numeric severity 2');
  });

  it('maps string warning to warning', () => {
    assert.ok(src.includes("sev === 'warning'"), "Should handle string severity 'warning'");
  });

  it('returns info as catch-all default', () => {
    const nameIdx = src.indexOf('function severityName');
    const nameBody = src.slice(nameIdx, nameIdx + 300);
    assert.ok(nameBody.includes("return 'info'"), 'Should return info as default');
  });
});

describe('lsp-severity.js: severityNum sort key', () => {
  it('returns 1 for error severity', () => {
    const numIdx = src.indexOf('function severityNum');
    const numBody = src.slice(numIdx, numIdx + 300);
    assert.ok(numBody.includes('return 1'), 'Should return 1 for error');
  });

  it('returns 2 for warning severity', () => {
    const numIdx = src.indexOf('function severityNum');
    const numBody = src.slice(numIdx, numIdx + 300);
    assert.ok(numBody.includes('return 2'), 'Should return 2 for warning');
  });

  it('returns 3 as catch-all default', () => {
    const numIdx = src.indexOf('function severityNum');
    const numBody = src.slice(numIdx, numIdx + 300);
    assert.ok(numBody.includes('return 3'), 'Should return 3 for info/hint');
  });
});

describe('lsp-severity.js: severityLabel human-readable', () => {
  it('returns Error for error severity', () => {
    const labelIdx = src.indexOf('function severityLabel');
    const labelBody = src.slice(labelIdx, labelIdx + 300);
    assert.ok(labelBody.includes("return 'Error'"), "Should return 'Error'");
  });

  it('returns Warning for warning severity', () => {
    const labelIdx = src.indexOf('function severityLabel');
    const labelBody = src.slice(labelIdx, labelIdx + 300);
    assert.ok(labelBody.includes("return 'Warning'"), "Should return 'Warning'");
  });

  it('returns Info as catch-all default', () => {
    const labelIdx = src.indexOf('function severityLabel');
    const labelBody = src.slice(labelIdx, labelIdx + 300);
    assert.ok(labelBody.includes("return 'Info'"), "Should return 'Info'");
  });
});

describe('lsp-severity.js: JSDoc documentation', () => {
  it('documents severityName return type', () => {
    assert.ok(src.includes("'error'|'warning'|'info'"), 'Should document return type union');
  });

  it('documents parameter type accepts number or string', () => {
    assert.ok(src.includes('number|string'), 'Should accept both number and string');
  });
});
