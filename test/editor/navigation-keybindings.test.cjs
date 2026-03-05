/**
 * navigation-keybindings.test.cjs -- Verify navigation keybindings and context menu items
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');
const CTX_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/lens/EditorContextMenu.svelte'), 'utf-8');

describe('Navigation keybindings', () => {
  it('has Ctrl-F12 for Go to Implementation', () => {
    assert.ok(EXT_SRC.includes("key: 'Ctrl-F12'"), 'Should have Ctrl-F12 keybinding');
    assert.ok(EXT_SRC.includes('handleGoToImplementation'), 'Should call handleGoToImplementation');
  });

  it('has Shift-Alt-F for Format Selection', () => {
    assert.ok(EXT_SRC.includes("key: 'Shift-Alt-F'"), 'Should have Shift-Alt-F keybinding');
    assert.ok(EXT_SRC.includes('formatSelection'), 'Should call formatSelection');
  });
});

describe('EditorContextMenu — LSP navigation items', () => {
  it('has Go to Type Definition', () => {
    assert.ok(CTX_SRC.includes('Go to Type Definition'), 'Should show Go to Type Definition');
    assert.ok(CTX_SRC.includes('handleGotoTypeDefinition'), 'Should have handler');
  });

  it('has Go to Implementation', () => {
    assert.ok(CTX_SRC.includes('Go to Implementation'), 'Should show Go to Implementation');
    assert.ok(CTX_SRC.includes('handleGotoImplementation'), 'Should have handler');
  });

  it('has Format Selection', () => {
    assert.ok(CTX_SRC.includes('Format Selection'), 'Should show Format Selection');
    assert.ok(CTX_SRC.includes('handleFormatSelection'), 'Should have handler');
  });
});
