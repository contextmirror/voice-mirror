/**
 * utils.test.mjs -- Tests for tauri/src/lib/utils.js
 *
 * Direct ES module import tests for deepMerge, formatTime, uid.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, formatTime, uid } from '../../src/lib/utils.js';

// ============ deepMerge ============

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 }, { c: 3 });
    assert.deepStrictEqual(result, { a: 1, b: 2, c: 3 });
  });

  it('deep merges nested objects', () => {
    const target = { nested: { a: 1, b: 2 } };
    const source = { nested: { b: 99, c: 3 } };
    const result = deepMerge(target, source);
    assert.deepStrictEqual(result.nested, { a: 1, b: 99, c: 3 });
  });

  it('overrides scalars from source', () => {
    const result = deepMerge({ x: 'old' }, { x: 'new' });
    assert.equal(result.x, 'new');
  });

  it('does not mutate the target object', () => {
    const target = { a: 1, nested: { b: 2 } };
    const source = { a: 10, nested: { c: 3 } };
    const targetCopy = JSON.parse(JSON.stringify(target));
    deepMerge(target, source);
    assert.deepStrictEqual(target, targetCopy);
  });

  it('replaces arrays (does not merge them)', () => {
    const result = deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] });
    assert.deepStrictEqual(result.arr, [4, 5]);
  });

  it('handles empty source', () => {
    const target = { a: 1 };
    const result = deepMerge(target, {});
    assert.deepStrictEqual(result, { a: 1 });
  });

  it('handles empty target', () => {
    const result = deepMerge({}, { a: 1 });
    assert.deepStrictEqual(result, { a: 1 });
  });

  it('handles null values in source', () => {
    const result = deepMerge({ a: 1 }, { a: null });
    assert.equal(result.a, null);
  });

  it('handles undefined values in source', () => {
    const result = deepMerge({ a: 1 }, { a: undefined });
    assert.equal(result.a, undefined);
  });

  it('creates nested object when target key is missing', () => {
    const result = deepMerge({}, { nested: { a: 1 } });
    assert.deepStrictEqual(result.nested, { a: 1 });
  });

  it('returns a new object reference', () => {
    const target = { a: 1 };
    const result = deepMerge(target, { b: 2 });
    assert.notEqual(result, target);
  });

  it('handles deeply nested merge (3+ levels)', () => {
    const target = { l1: { l2: { l3: { a: 1 } } } };
    const source = { l1: { l2: { l3: { b: 2 } } } };
    const result = deepMerge(target, source);
    assert.deepStrictEqual(result.l1.l2.l3, { a: 1, b: 2 });
  });

  it('source scalar overrides target nested object', () => {
    const result = deepMerge({ a: { nested: true } }, { a: 'flat' });
    assert.equal(result.a, 'flat');
  });
});

// ============ formatTime ============

describe('formatTime', () => {
  it('formats a Date object to a time string', () => {
    const date = new Date(2024, 0, 15, 14, 34, 0);
    const result = formatTime(date);
    assert.equal(typeof result, 'string');
    // Should contain minute portion "34"
    assert.ok(result.includes('34'), `Expected "34" in "${result}"`);
  });

  it('formats a numeric timestamp', () => {
    const ts = new Date(2024, 0, 15, 9, 5, 0).getTime();
    const result = formatTime(ts);
    assert.equal(typeof result, 'string');
    // Should contain minute portion "05"
    assert.ok(result.includes('05'), `Expected "05" in "${result}"`);
  });

  it('formats an ISO string timestamp', () => {
    const result = formatTime('2024-01-15T14:34:00');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('returns a string', () => {
    assert.equal(typeof formatTime(Date.now()), 'string');
  });
});

// ============ uid ============

describe('uid', () => {
  it('returns a string', () => {
    assert.equal(typeof uid(), 'string');
  });

  it('returns unique values across 100 calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(uid());
    }
    assert.equal(ids.size, 100, 'All 100 IDs should be unique');
  });

  it('has reasonable length (8-20 chars)', () => {
    const id = uid();
    assert.ok(id.length >= 8, `ID "${id}" is too short (${id.length})`);
    assert.ok(id.length <= 20, `ID "${id}" is too long (${id.length})`);
  });

  it('contains only alphanumeric characters', () => {
    const id = uid();
    assert.ok(/^[a-z0-9]+$/.test(id), `ID "${id}" contains unexpected characters`);
  });
});
