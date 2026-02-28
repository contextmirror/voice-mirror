const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-extensions.js'),
  'utf-8'
);

describe('editor-extensions.js: Ctrl+hover definition underline', () => {
  it('creates a ViewPlugin for definition hints', () => {
    assert.ok(src.includes('ViewPlugin'), 'Should use ViewPlugin for Ctrl+hover');
  });

  it('tracks Ctrl key state with keydown/keyup', () => {
    assert.ok(src.includes('keydown') && src.includes('keyup'), 'Should listen for key events');
  });

  it('uses Decoration.mark for underline styling', () => {
    assert.ok(src.includes('Decoration.mark') || src.includes('Decoration.set'), 'Should use Decoration for styling');
  });

  it('applies cm-definition-hint CSS class', () => {
    assert.ok(src.includes('cm-definition-hint'), 'Should use cm-definition-hint class');
  });

  it('uses posAtCoords to find word under cursor', () => {
    assert.ok(src.includes('posAtCoords'), 'Should use posAtCoords for mouse position');
  });
});

const themeSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-theme.js'),
  'utf-8'
);

describe('editor-theme.js: definition hint styles', () => {
  it('styles .cm-definition-hint with underline', () => {
    assert.ok(themeSrc.includes('cm-definition-hint') && themeSrc.includes('underline'), 'Should style definition hint with underline');
  });
});
