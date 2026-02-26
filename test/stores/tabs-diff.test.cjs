/**
 * tabs-diff.test.cjs -- Source-inspection tests for openDiff in tabs.svelte.js
 *
 * Validates the diff tab functionality in the tab management store.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/tabs.svelte.js'),
  'utf-8'
);

describe('tabs.svelte.js: openDiff method', () => {
  it('has openDiff method', () => {
    assert.ok(src.includes('openDiff('), 'Should have openDiff method');
  });

  it('accepts a change parameter', () => {
    assert.ok(src.includes('openDiff(change'), 'Should accept change parameter');
  });

  it('creates tabs with type diff', () => {
    assert.ok(src.includes("type: 'diff'"), 'Should create tabs with type: diff');
  });

  it('uses diff: prefix for tab IDs', () => {
    assert.ok(
      src.includes('`diff:${') || src.includes("'diff:' +"),
      'Should use diff: prefix for tab IDs'
    );
  });

  it('sets status property on diff tabs', () => {
    // Verify the status from the change is passed to the tab
    assert.ok(src.includes('status: change.status'), 'Should set status from change entry');
  });

  it('creates preview tabs for diffs', () => {
    // openDiff creates preview tabs based on previewEnabled setting
    const openDiffStart = src.indexOf('openDiff(');
    const openDiffEnd = src.indexOf('},', openDiffStart);
    const openDiffBody = src.slice(openDiffStart, openDiffEnd);
    assert.ok(openDiffBody.includes('preview: previewEnabled'), 'Should create diff tabs with preview based on previewEnabled');
  });

  it('extracts filename from path for title', () => {
    const openDiffStart = src.indexOf('openDiff(');
    const openDiffEnd = src.indexOf('},', openDiffStart);
    const openDiffBody = src.slice(openDiffStart, openDiffEnd);
    assert.ok(
      openDiffBody.includes('.split(') && openDiffBody.includes('.pop()'),
      'Should extract filename by splitting path and popping last segment'
    );
  });

  it('handles both forward and back slashes in paths', () => {
    assert.ok(
      src.includes('[/\\\\]') || src.includes('/[\\/\\\\]/') || src.includes('/[/\\\\]/'),
      'Should split on both / and \\ for cross-platform paths'
    );
  });

  it('focuses existing diff tab if already open', () => {
    const openDiffStart = src.indexOf('openDiff(');
    const openDiffEnd = src.indexOf('},', openDiffStart);
    const openDiffBody = src.slice(openDiffStart, openDiffEnd);
    assert.ok(
      openDiffBody.includes('existing') && openDiffBody.includes('return'),
      'Should check for existing tab and return early'
    );
  });

  it('replaces existing preview tab', () => {
    const openDiffStart = src.indexOf('openDiff(');
    const openDiffEnd = src.indexOf('},', openDiffStart);
    const openDiffBody = src.slice(openDiffStart, openDiffEnd);
    assert.ok(
      openDiffBody.includes('previewIdx'),
      'Should find and replace existing preview tab'
    );
  });

  it('sets dirty to false on new diff tabs', () => {
    const openDiffStart = src.indexOf('openDiff(');
    const openDiffEnd = src.indexOf('},', openDiffStart);
    const openDiffBody = src.slice(openDiffStart, openDiffEnd);
    assert.ok(openDiffBody.includes('dirty: false'), 'Should set dirty: false on new diff tabs');
  });

  it('updates activeTabId to the diff tab', () => {
    const openDiffStart = src.indexOf('openDiff(');
    const openDiffEnd = src.indexOf('},', openDiffStart);
    const openDiffBody = src.slice(openDiffStart, openDiffEnd);
    assert.ok(
      openDiffBody.includes('activeTabId = '),
      'Should set activeTabId to the new diff tab'
    );
  });
});
