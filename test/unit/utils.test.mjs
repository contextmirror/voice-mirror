/**
 * utils.test.mjs -- Tests for tauri/src/lib/utils.js
 *
 * Direct ES module import tests for deepMerge, formatTime, uid.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, formatTime, formatLogTime, formatRelativeTime, uid, basename, unwrapResult } from '../../src/lib/utils.js';

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

// ============ basename ============

describe('basename', () => {
  it('extracts filename from forward-slash path', () => {
    assert.equal(basename('src/lib/utils.js'), 'utils.js');
  });

  it('extracts filename from backslash path', () => {
    assert.equal(basename('src\\lib\\utils.js'), 'utils.js');
  });

  it('extracts filename from mixed separators', () => {
    assert.equal(basename('src/lib\\stores/tabs.svelte.js'), 'tabs.svelte.js');
  });

  it('returns string as-is when no separators', () => {
    assert.equal(basename('file.txt'), 'file.txt');
  });

  it('returns null for null input', () => {
    assert.equal(basename(null), null);
  });

  it('returns undefined for undefined input', () => {
    assert.equal(basename(undefined), undefined);
  });

  it('returns empty string for empty string input', () => {
    assert.equal(basename(''), '');
  });
});

// ============ unwrapResult ============

describe('unwrapResult', () => {
  it('extracts .data from wrapped result', () => {
    assert.equal(unwrapResult({ data: 'hello' }), 'hello');
  });

  it('returns result directly if no .data property', () => {
    assert.equal(unwrapResult('hello'), 'hello');
  });

  it('returns result directly if .data is undefined', () => {
    assert.deepStrictEqual(unwrapResult({ other: 1 }), { other: 1 });
  });

  it('returns fallback for null result', () => {
    assert.equal(unwrapResult(null, 'fb'), 'fb');
  });

  it('returns fallback for undefined result', () => {
    assert.equal(unwrapResult(undefined, 'fb'), 'fb');
  });

  it('returns null as default fallback', () => {
    assert.equal(unwrapResult(null), null);
  });

  it('preserves falsy .data value 0', () => {
    assert.equal(unwrapResult({ data: 0 }), 0);
  });

  it('preserves falsy .data value empty string', () => {
    assert.equal(unwrapResult({ data: '' }), '');
  });

  it('preserves falsy .data value false', () => {
    assert.equal(unwrapResult({ data: false }), false);
  });
});

// ============ formatLogTime ============

describe('formatLogTime', () => {
  it('returns HH:MM:SS format', () => {
    // 2024-01-15 14:05:30 local time
    const ts = new Date(2024, 0, 15, 14, 5, 30).getTime();
    const result = formatLogTime(ts);
    assert.equal(result, '14:05:30');
  });

  it('pads single-digit hours with zero', () => {
    const ts = new Date(2024, 0, 15, 9, 0, 0).getTime();
    const result = formatLogTime(ts);
    assert.equal(result, '09:00:00');
  });

  it('handles midnight', () => {
    const ts = new Date(2024, 0, 15, 0, 0, 0).getTime();
    const result = formatLogTime(ts);
    assert.equal(result, '00:00:00');
  });

  it('returns exactly 8 characters', () => {
    assert.equal(formatLogTime(Date.now()).length, 8);
  });

  it('matches HH:MM:SS pattern', () => {
    const result = formatLogTime(Date.now());
    assert.ok(/^\d{2}:\d{2}:\d{2}$/.test(result), `Expected HH:MM:SS, got "${result}"`);
  });
});

// ============ formatRelativeTime ============

describe('formatRelativeTime', () => {
  it('returns "just now" for timestamps less than 60s ago', () => {
    const ts = Date.now() - 30000; // 30 seconds ago
    assert.equal(formatRelativeTime(ts), 'just now');
  });

  it('returns "just now" for current time', () => {
    assert.equal(formatRelativeTime(Date.now()), 'just now');
  });

  it('returns minutes ago for 1-59 minutes', () => {
    const ts = Date.now() - 5 * 60000; // 5 minutes ago
    assert.equal(formatRelativeTime(ts), '5m ago');
  });

  it('returns "1m ago" at exactly 60 seconds', () => {
    const ts = Date.now() - 60000;
    assert.equal(formatRelativeTime(ts), '1m ago');
  });

  it('returns hours ago for 1-23 hours', () => {
    const ts = Date.now() - 3 * 3600000; // 3 hours ago
    assert.equal(formatRelativeTime(ts), '3h ago');
  });

  it('returns "1h ago" at exactly 60 minutes', () => {
    const ts = Date.now() - 3600000;
    assert.equal(formatRelativeTime(ts), '1h ago');
  });

  it('returns days ago for 24+ hours', () => {
    const ts = Date.now() - 2 * 86400000; // 2 days ago
    assert.equal(formatRelativeTime(ts), '2d ago');
  });

  it('returns "1d ago" at exactly 24 hours', () => {
    const ts = Date.now() - 86400000;
    assert.equal(formatRelativeTime(ts), '1d ago');
  });

  it('floors minutes (does not round)', () => {
    const ts = Date.now() - 90000; // 1.5 minutes ago
    assert.equal(formatRelativeTime(ts), '1m ago');
  });

  it('floors hours (does not round)', () => {
    const ts = Date.now() - 5400000; // 1.5 hours ago
    assert.equal(formatRelativeTime(ts), '1h ago');
  });
});
