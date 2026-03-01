/**
 * terminal-link-overlay.test.cjs -- Source-inspection tests for
 * the terminal Ctrl+click link overlay module.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const overlaySource = fs.readFileSync(
  path.join(__dirname, '../../src/lib/terminal-link-overlay.js'), 'utf-8'
);

const terminalSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/Terminal.svelte'), 'utf-8'
);

describe('terminal-link-overlay module', () => {
  it('exports createLinkOverlay function', () => {
    assert.ok(overlaySource.includes('export function createLinkOverlay'));
  });

  it('imports detectURLs from terminal-links', () => {
    assert.ok(overlaySource.includes("import { detectURLs, detectFilePaths } from './terminal-links.js'"));
  });

  it('creates overlay DOM element', () => {
    assert.ok(overlaySource.includes("document.createElement('div')"));
    assert.ok(overlaySource.includes('terminal-link-overlay'));
  });

  it('creates tooltip DOM element', () => {
    assert.ok(overlaySource.includes('terminal-link-tooltip'));
  });

  it('accepts container option', () => {
    assert.ok(overlaySource.includes('container'));
    assert.ok(overlaySource.includes('container.appendChild'));
  });

  it('accepts getTerm option', () => {
    assert.ok(overlaySource.includes('getTerm'));
  });

  it('accepts onOpenUrl callback', () => {
    assert.ok(overlaySource.includes('onOpenUrl'));
  });

  it('accepts onOpenFile callback', () => {
    assert.ok(overlaySource.includes('onOpenFile'));
  });

  it('accepts getCwd option', () => {
    assert.ok(overlaySource.includes('getCwd'));
  });

  it('returns object with destroy method', () => {
    assert.ok(overlaySource.includes('destroy()'));
    assert.ok(overlaySource.includes('overlay.remove()'));
    assert.ok(overlaySource.includes('tooltip.remove()'));
  });

  it('tracks Ctrl key state', () => {
    assert.ok(overlaySource.includes('ctrlHeld'));
    assert.ok(overlaySource.includes("e.key === 'Control'"));
  });

  it('registers mousemove listener on container', () => {
    assert.ok(overlaySource.includes("container.addEventListener('mousemove'"));
  });

  it('registers click listener in capture phase', () => {
    assert.ok(overlaySource.includes("container.addEventListener('click', handleClick, true)"));
  });

  it('registers keydown/keyup on document for Ctrl tracking', () => {
    assert.ok(overlaySource.includes("document.addEventListener('keydown'"));
    assert.ok(overlaySource.includes("document.addEventListener('keyup'"));
  });

  it('cleans up all event listeners on destroy', () => {
    assert.ok(overlaySource.includes("container.removeEventListener('mousemove'"));
    assert.ok(overlaySource.includes("container.removeEventListener('click'"));
    assert.ok(overlaySource.includes("container.removeEventListener('mouseleave'"));
    assert.ok(overlaySource.includes("document.removeEventListener('keydown'"));
    assert.ok(overlaySource.includes("document.removeEventListener('keyup'"));
  });

  it('calculates cell dimensions from terminal', () => {
    assert.ok(overlaySource.includes('getCellDimensions'));
    assert.ok(overlaySource.includes('cellWidth'));
    assert.ok(overlaySource.includes('cellHeight'));
  });

  it('converts mouse position to cell coordinates', () => {
    assert.ok(overlaySource.includes('mouseToCell'));
    assert.ok(overlaySource.includes('Math.floor'));
  });

  it('reads buffer line text for link detection', () => {
    assert.ok(overlaySource.includes('getLineText'));
    assert.ok(overlaySource.includes('buffer.getLine'));
    assert.ok(overlaySource.includes('translateToString'));
  });

  it('accounts for viewport scroll offset', () => {
    assert.ok(overlaySource.includes('viewportY'));
  });

  it('shows overlay with underline styling', () => {
    assert.ok(overlaySource.includes('showOverlay'));
    assert.ok(overlaySource.includes('borderBottom'));
    assert.ok(overlaySource.includes("display = 'block'"));
  });

  it('hides overlay and resets cursor', () => {
    assert.ok(overlaySource.includes('hideOverlay'));
    assert.ok(overlaySource.includes("display = 'none'"));
    assert.ok(overlaySource.includes("container.style.cursor = ''"));
  });

  it('changes cursor to pointer when link detected', () => {
    assert.ok(overlaySource.includes("container.style.cursor = 'pointer'"));
  });

  it('shows tooltip with Ctrl+click hint', () => {
    assert.ok(overlaySource.includes('Ctrl+click to open'));
  });

  it('checks both URL and file path matches', () => {
    assert.ok(overlaySource.includes('findMatchAtCol'));
    assert.ok(overlaySource.includes("type: 'url'"));
    assert.ok(overlaySource.includes("type: 'file'"));
  });

  it('prevents default and stops propagation on Ctrl+click', () => {
    assert.ok(overlaySource.includes('e.preventDefault()'));
    assert.ok(overlaySource.includes('e.stopPropagation()'));
  });

  it('dispatches URL matches to onOpenUrl', () => {
    assert.ok(overlaySource.includes("currentMatch.type === 'url'"));
    assert.ok(overlaySource.includes('onOpenUrl(currentMatch.url)'));
  });

  it('dispatches file matches to onOpenFile', () => {
    assert.ok(overlaySource.includes("currentMatch.type === 'file'"));
    assert.ok(overlaySource.includes('onOpenFile('));
  });

  it('hides overlay on mouse leave', () => {
    assert.ok(overlaySource.includes('handleMouseLeave'));
    assert.ok(overlaySource.includes("'mouseleave'"));
  });

  it('hides overlay when Ctrl is released', () => {
    // handleKeyUp should hide overlay when Ctrl is released
    assert.ok(overlaySource.includes('handleKeyUp'));
    const keyUpFn = overlaySource.match(/function handleKeyUp[\s\S]*?^  \}/m);
    assert.ok(keyUpFn, 'handleKeyUp function exists');
    assert.ok(keyUpFn[0].includes('ctrlHeld = false'));
    assert.ok(keyUpFn[0].includes('hideOverlay'));
  });
});

describe('Terminal.svelte link overlay integration', () => {
  it('imports createLinkOverlay', () => {
    assert.ok(terminalSource.includes("import { createLinkOverlay } from '../../lib/terminal-link-overlay.js'"));
  });

  it('imports tabsStore for opening files', () => {
    assert.ok(terminalSource.includes("import { tabsStore } from '../../lib/stores/tabs.svelte.js'"));
  });

  it('imports projectStore for CWD', () => {
    assert.ok(terminalSource.includes("import { projectStore } from '../../lib/stores/project.svelte.js'"));
  });

  it('imports open from tauri plugin-shell for URLs', () => {
    assert.ok(terminalSource.includes("import { open } from '@tauri-apps/plugin-shell'"));
  });

  it('declares linkOverlay variable', () => {
    assert.ok(terminalSource.includes('let linkOverlay'));
  });

  it('creates link overlay after terminal initialization', () => {
    assert.ok(terminalSource.includes('linkOverlay = createLinkOverlay'));
  });

  it('passes container element to overlay', () => {
    assert.ok(terminalSource.includes('container: containerEl'));
  });

  it('passes term getter to overlay', () => {
    assert.ok(terminalSource.includes('getTerm: () => term'));
  });

  it('uses projectStore path for CWD', () => {
    assert.ok(terminalSource.includes('projectStore.activeProject?.path'));
  });

  it('opens URLs via tauri shell open', () => {
    assert.ok(terminalSource.includes('open(url)'));
  });

  it('opens files via tabsStore.openFile', () => {
    assert.ok(terminalSource.includes('tabsStore.openFile'));
  });

  it('sets pending cursor position for file navigation', () => {
    assert.ok(terminalSource.includes('tabsStore.setPendingCursor'));
  });

  it('converts 1-based line/col to 0-based for setPendingCursor', () => {
    assert.ok(terminalSource.includes('match.line - 1'));
    assert.ok(terminalSource.includes('(match.col || 1) - 1'));
  });

  it('destroys link overlay on cleanup', () => {
    assert.ok(terminalSource.includes('linkOverlay.destroy()'));
    assert.ok(terminalSource.includes('linkOverlay = null'));
  });
});
