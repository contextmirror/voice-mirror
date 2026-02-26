const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/attachments.svelte.js'),
  'utf-8'
);

describe('attachments.svelte.js — context field', () => {
  it('Attachment typedef includes optional context field', () => {
    assert.ok(src.includes('context?'), 'Should have context? in typedef');
  });

  it('typedef documents context as string', () => {
    assert.ok(src.includes('context?: string'), 'Should be context?: string');
  });
});
