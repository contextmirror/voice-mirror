const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/audit-log.js'), 'utf-8'
);

describe('audit-log.js -- core API', () => {
  it('exports audit function', () => {
    assert.ok(src.includes('export function audit'), 'Should export audit function');
  });

  it('audit accepts category and action parameters', () => {
    assert.ok(src.includes('category'), 'Should accept category');
    assert.ok(src.includes('action'), 'Should accept action');
  });

  it('uses logFrontendError with DEBUG level', () => {
    assert.ok(src.includes('logFrontendError'), 'Should use logFrontendError');
    assert.ok(src.includes("'DEBUG'"), 'Should use DEBUG level');
  });

  it('prefixes messages with [AUDIT]', () => {
    assert.ok(src.includes('[AUDIT]'), 'Should prefix with [AUDIT]');
  });

  it('includes optional details in context', () => {
    assert.ok(src.includes('details'), 'Should support optional details');
  });
});

describe('audit-log.js -- predefined categories', () => {
  it('has editor category helper', () => {
    assert.ok(src.includes('auditEditor'), 'Should have editor audit');
  });

  it('has terminal category helper', () => {
    assert.ok(src.includes('auditTerminal'), 'Should have terminal audit');
  });

  it('has LSP category helper', () => {
    assert.ok(src.includes('auditLsp'), 'Should have LSP audit');
  });

  it('has navigation category helper', () => {
    assert.ok(src.includes('auditNav'), 'Should have navigation audit');
  });
});

describe('audit-log.js -- safety', () => {
  it('wraps logging in try/catch', () => {
    assert.ok(src.includes('try') && src.includes('catch'), 'Should have try/catch safety');
  });

  it('is a plain .js file (no runes needed)', () => {
    assert.ok(!src.includes('$state') && !src.includes('$effect'), 'Should not use Svelte runes');
  });
});
