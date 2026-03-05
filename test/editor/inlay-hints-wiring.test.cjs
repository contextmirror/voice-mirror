/**
 * inlay-hints-wiring.test.cjs -- Verify inlay hints extension is wired into the editor
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EDITOR_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/lens/FileEditor.svelte'), 'utf-8');
const EXT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');
const THEME_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-theme.js'), 'utf-8');

describe('Inlay Hints — cmCache', () => {
  it('FileEditor.svelte includes WidgetType in cmCache', () => {
    assert.ok(EDITOR_SRC.includes('WidgetType'), 'Should include WidgetType in cmCache');
  });
});

describe('Inlay Hints — wiring', () => {
  it('editor-extensions.js calls inlayHintExtension', () => {
    assert.ok(EXT_SRC.includes('inlayHintExtension'), 'Should wire inlayHintExtension');
  });
});

describe('Inlay Hints — CSS', () => {
  it('has .cm-inlay-hint class', () => {
    assert.ok(THEME_SRC.includes('.cm-inlay-hint'), 'Should have .cm-inlay-hint CSS');
  });

  it('has .cm-inlay-hint-type class', () => {
    assert.ok(THEME_SRC.includes('.cm-inlay-hint-type'), 'Should have type subclass');
  });

  it('has .cm-inlay-hint-parameter class', () => {
    assert.ok(THEME_SRC.includes('.cm-inlay-hint-parameter'), 'Should have parameter subclass');
  });
});
