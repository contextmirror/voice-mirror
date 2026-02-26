/**
 * main.test.cjs -- Source-inspection tests for main.js
 *
 * Validates the app entry point and global behaviors.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/main.js'),
  'utf-8'
);

describe('main.js: app mount', () => {
  it('imports mount from svelte', () => {
    assert.ok(src.includes("import { mount } from 'svelte'"), 'Should import mount');
  });

  it('imports App component', () => {
    assert.ok(src.includes('App.svelte'), 'Should import App.svelte');
  });

  it('mounts to #app element', () => {
    assert.ok(src.includes("getElementById('app')"), 'Should mount to #app');
  });
});

describe('main.js: global scrollbar jump-to-click', () => {
  it('registers a global mousedown listener on document', () => {
    assert.ok(
      src.includes("document.addEventListener('mousedown'"),
      'Should add global mousedown listener'
    );
  });

  it('uses capture phase for the listener', () => {
    // The last argument to addEventListener should be true (capture)
    const listenerIdx = src.indexOf("document.addEventListener('mousedown'");
    const chunk = src.slice(listenerIdx, listenerIdx + 1500);
    assert.ok(chunk.includes(', true)'), 'Should use capture phase');
  });

  it('checks for left mouse button only', () => {
    assert.ok(src.includes('e.button !== 0'), 'Should only handle left-clicks');
  });

  it('detects scrollbar region using 14px width', () => {
    assert.ok(
      src.includes('rect.right - 14'),
      'Should detect clicks in rightmost 14px (scrollbar width)'
    );
  });

  it('calculates scroll ratio from click position', () => {
    assert.ok(
      src.includes('clickY / rect.height') || src.includes('ratio'),
      'Should calculate scroll ratio from click Y position'
    );
  });

  it('temporarily disables smooth scroll for instant jump', () => {
    assert.ok(
      src.includes("scrollBehavior = 'auto'"),
      'Should disable smooth scroll during jump'
    );
  });

  it('restores scroll behavior on next frame', () => {
    assert.ok(
      src.includes('requestAnimationFrame'),
      'Should restore scroll behavior via rAF'
    );
  });

  it('walks up DOM to find scrollable ancestor', () => {
    assert.ok(
      src.includes('scrollHeight > el.clientHeight') || src.includes('scrollHeight'),
      'Should walk up DOM tree looking for scrollable elements'
    );
  });

  it('prevents default and stops propagation on scrollbar clicks', () => {
    assert.ok(src.includes('preventDefault'), 'Should prevent default');
    assert.ok(src.includes('stopPropagation'), 'Should stop propagation');
  });
});
