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

describe('main.js: global browser suppression -- context menu', () => {
  it('blocks native context menu globally', () => {
    assert.ok(src.includes("addEventListener('contextmenu'"), 'Should block context menu');
  });
  it('allows context menu on textarea and input', () => {
    assert.ok(src.includes('TEXTAREA') && src.includes('INPUT'), 'Should whitelist form elements');
  });
  it('allows context menu on contentEditable', () => {
    assert.ok(src.includes('isContentEditable'), 'Should whitelist contentEditable');
  });
});

describe('main.js: global browser suppression -- keyboard shortcuts', () => {
  it('blocks F5 refresh', () => {
    assert.ok(src.includes("e.key === 'F5'"), 'Should block F5');
  });
  it('blocks Ctrl+R refresh', () => {
    assert.ok(src.includes("e.key === 'r'") && src.includes('e.ctrlKey'), 'Should block Ctrl+R');
  });
  it('blocks Ctrl+U view source', () => {
    assert.ok(src.includes("e.key === 'u'"), 'Should block Ctrl+U');
  });
  it('blocks Ctrl+S save page', () => {
    assert.ok(src.includes("e.key === 's'"), 'Should block Ctrl+S');
  });
  it('blocks F7 caret browsing', () => {
    assert.ok(src.includes("e.key === 'F7'"), 'Should block F7');
  });
  it('uses capture phase', () => {
    const idx = src.indexOf("addEventListener('keydown'");
    const chunk = src.slice(idx, idx + 1500);
    assert.ok(chunk.includes(', true)'), 'Keydown listener should use capture phase');
  });
});

describe('main.js: global browser suppression -- drag-and-drop', () => {
  it('blocks browser text/image drag', () => {
    assert.ok(src.includes("addEventListener('dragstart'"), 'Should block dragstart');
  });
  it('allows elements with explicit draggable=true', () => {
    assert.ok(src.includes("draggable") && src.includes("'true'"), 'Should whitelist draggable elements');
  });
});

describe('main.js: global browser suppression -- middle-click', () => {
  it('blocks middle-click auto-scroll', () => {
    assert.ok(src.includes('e.button !== 1'), 'Should detect middle button');
  });
  it('allows middle-click in terminal containers', () => {
    assert.ok(src.includes('terminal-container'), 'Should whitelist terminal for middle-click paste');
  });
});
