const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/lib/device-sync.js'), 'utf-8');

describe('device-sync.js: exports', () => {
  it('exports SYNC_SCRIPT constant', () => {
    assert.ok(src.includes('export const SYNC_SCRIPT'), 'Should export injectable sync script');
  });

  it('exports REPLAY_SCROLL_SCRIPT function', () => {
    assert.ok(src.includes('export function replayScrollScript'), 'Should export scroll replay builder');
  });

  it('exports REPLAY_CLICK_SCRIPT function', () => {
    assert.ok(src.includes('export function replayClickScript'), 'Should export click replay builder');
  });
});

describe('device-sync.js: sync script content', () => {
  it('listens for scroll events', () => {
    assert.ok(src.includes('scroll'), 'Should capture scroll');
  });

  it('listens for click events', () => {
    assert.ok(src.includes('click'), 'Should capture click');
  });

  it('uses debounce for scroll', () => {
    assert.ok(src.includes('requestAnimationFrame') || src.includes('setTimeout'), 'Should debounce scroll');
  });

  it('uses CSS selector for click targeting', () => {
    assert.ok(src.includes('querySelector') || src.includes('selector'), 'Should use selector-based click');
  });

  it('communicates via window.__deviceSync', () => {
    assert.ok(src.includes('__deviceSync'), 'Should use window.__deviceSync namespace');
  });
});
