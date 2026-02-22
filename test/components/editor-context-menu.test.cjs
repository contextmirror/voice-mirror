/**
 * editor-context-menu.test.cjs -- Source-inspection tests for EditorContextMenu.svelte
 *
 * Right-click context menu for the code editor with AI actions, LSP actions,
 * edit operations, folding, and file actions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/EditorContextMenu.svelte'),
  'utf-8'
);

describe('EditorContextMenu.svelte: component structure', () => {
  it('has context-menu class', () => {
    assert.ok(src.includes('context-menu'));
  });
  it('has onClose callback in $props()', () => {
    assert.ok(src.includes('onClose'));
    assert.ok(src.includes('$props'));
  });
  it('has onAction callback in $props()', () => {
    assert.ok(src.includes('onAction'));
  });
  it('has hasSelection context prop', () => {
    assert.ok(src.includes('hasSelection'));
  });
  it('has hasLsp context prop', () => {
    assert.ok(src.includes('hasLsp'));
  });
  it('has hasDiagnostic context prop', () => {
    assert.ok(src.includes('hasDiagnostic'));
  });
  it('has diagnosticMessage context prop', () => {
    assert.ok(src.includes('diagnosticMessage'));
  });
});

describe('EditorContextMenu.svelte: AI actions section', () => {
  it('has "Fix This Error" action', () => {
    assert.ok(src.includes('Fix This Error'));
  });
  it('has "Ask AI: Explain This" action', () => {
    assert.ok(src.includes('Ask AI: Explain This'));
  });
  it('has "Ask AI: Refactor This" action', () => {
    assert.ok(src.includes('Ask AI: Refactor This'));
  });
  it('has "Ask AI: Add Tests" action', () => {
    assert.ok(src.includes('Ask AI: Add Tests'));
  });
});

describe('EditorContextMenu.svelte: LSP actions section', () => {
  it('has "Go to Definition" action', () => {
    assert.ok(src.includes('Go to Definition'));
  });
  it('has "Find References" action', () => {
    assert.ok(src.includes('Find References'));
  });
});

describe('EditorContextMenu.svelte: edit actions section', () => {
  it('has Cut button', () => {
    assert.ok(src.includes('Cut'));
  });
  it('has Copy button', () => {
    assert.ok(src.includes('Copy'));
  });
  it('has Paste button', () => {
    assert.ok(src.includes('Paste'));
  });
  it('has Select All button', () => {
    assert.ok(src.includes('Select All'));
  });
});

describe('EditorContextMenu.svelte: folding actions section', () => {
  it('has "Fold at Cursor" action', () => {
    assert.ok(src.includes('Fold at Cursor'));
  });
  it('has "Unfold at Cursor" action', () => {
    assert.ok(src.includes('Unfold at Cursor'));
  });
  it('has "Fold All" action', () => {
    assert.ok(src.includes('Fold All'));
  });
  it('has "Unfold All" action', () => {
    assert.ok(src.includes('Unfold All'));
  });
});

describe('EditorContextMenu.svelte: file actions section', () => {
  it('has "Copy Path" action', () => {
    assert.ok(src.includes('Copy Path'));
  });
  it('has "Copy Relative Path" action', () => {
    assert.ok(src.includes('Copy Relative Path'));
  });
  it('has "Copy as Markdown" action', () => {
    assert.ok(src.includes('Copy as Markdown'));
  });
  it('has "Reveal in File Explorer" action', () => {
    assert.ok(src.includes('Reveal in File Explorer'));
  });
});

describe('EditorContextMenu.svelte: keyboard shortcuts', () => {
  it('shows Ctrl+X shortcut', () => {
    assert.ok(src.includes('Ctrl+X'));
  });
  it('shows Ctrl+C shortcut', () => {
    assert.ok(src.includes('Ctrl+C'));
  });
  it('shows Ctrl+V shortcut', () => {
    assert.ok(src.includes('Ctrl+V'));
  });
  it('shows Ctrl+A shortcut', () => {
    assert.ok(src.includes('Ctrl+A'));
  });
  it('shows Ctrl+Click shortcut', () => {
    assert.ok(src.includes('Ctrl+Click'));
  });
});

describe('EditorContextMenu.svelte: styling and layout', () => {
  it('has disabled styling class', () => {
    assert.ok(src.includes('disabled'));
  });
  it('uses z-index 10002', () => {
    assert.ok(src.includes('z-index: 10002'));
  });
  it('uses -webkit-app-region: no-drag', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'));
  });
  it('uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'));
  });
});

describe('EditorContextMenu.svelte: accessibility', () => {
  it('has role="menu"', () => {
    assert.ok(src.includes('role="menu"'));
  });
  it('has role="menuitem"', () => {
    assert.ok(src.includes('role="menuitem"'));
  });
});

describe('EditorContextMenu.svelte: dismiss behavior', () => {
  it('has click-outside handler with capture phase mousedown', () => {
    assert.ok(src.includes('mousedown'));
    assert.ok(src.includes('capture') || src.includes('true'));
  });
  it('has Escape key handler', () => {
    assert.ok(src.includes('Escape'));
  });
  it('has viewport clamping logic', () => {
    assert.ok(
      src.includes('innerWidth') || src.includes('innerHeight') ||
      src.includes('getBoundingClientRect') || src.includes('clamp')
    );
  });
});
