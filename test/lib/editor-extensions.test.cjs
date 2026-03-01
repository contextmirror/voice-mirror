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

describe('editor-extensions.js: VS Code keymap', () => {
  it('imports vscodeKeymap from @replit/codemirror-vscode-keymap', () => {
    assert.ok(src.includes("from '@replit/codemirror-vscode-keymap'"), 'Should import vscodeKeymap');
  });

  it('adds vscodeKeymap to extensions via keymap.of()', () => {
    assert.ok(src.includes('keymap.of(vscodeKeymap)'), 'Should add vscodeKeymap as keymap extension');
  });

  it('adds vscodeKeymap after basicSetup so it overrides defaults', () => {
    const basicSetupIndex = src.indexOf('basicSetup');
    const vscodeKeymapIndex = src.indexOf('keymap.of(vscodeKeymap)');
    assert.ok(vscodeKeymapIndex > basicSetupIndex, 'vscodeKeymap should come after basicSetup');
  });
});

describe('editor-extensions.js: indent guides', () => {
  it('imports indentationMarkers from @replit/codemirror-indentation-markers', () => {
    assert.ok(src.includes("from '@replit/codemirror-indentation-markers'"), 'Should import indentationMarkers');
  });

  it('conditionally adds indent guides based on showIndentGuides option', () => {
    assert.ok(src.includes('showIndentGuides'), 'Should check showIndentGuides option');
    assert.ok(src.includes('indentationMarkers'), 'Should use indentationMarkers extension');
  });

  it('enables highlightActiveBlock for indent guides', () => {
    assert.ok(src.includes('highlightActiveBlock: true'), 'Should highlight active block');
  });
});

describe('editor-extensions.js: cm object dependencies', () => {
  it('destructures ViewPlugin from cm parameter', () => {
    assert.ok(src.includes('ViewPlugin') && src.includes('cm'), 'Should use ViewPlugin from cm');
  });

  it('destructures Decoration from cm parameter', () => {
    assert.ok(src.includes('Decoration') && src.includes('cm'), 'Should use Decoration from cm');
  });
});

const fileEditorSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/FileEditor.svelte'),
  'utf-8'
);

describe('FileEditor.svelte: cm object includes ViewPlugin and Decoration', () => {
  it('imports ViewPlugin from @codemirror/view', () => {
    assert.ok(fileEditorSrc.includes('ViewPlugin'), 'loadCM should import ViewPlugin');
  });

  it('imports Decoration from @codemirror/view', () => {
    assert.ok(fileEditorSrc.includes('Decoration'), 'loadCM should import Decoration');
  });

  it('includes ViewPlugin in cmCache object', () => {
    assert.ok(
      fileEditorSrc.includes('ViewPlugin') && fileEditorSrc.includes('cmCache'),
      'cmCache should include ViewPlugin'
    );
  });

  it('includes Decoration in cmCache object', () => {
    assert.ok(
      fileEditorSrc.includes('Decoration') && fileEditorSrc.includes('cmCache'),
      'cmCache should include Decoration'
    );
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

// ── Lightbulb gutter (code actions) ──

describe('editor-extensions.js: code actions lightbulb gutter', () => {
  it('has createCodeActionsGutter function', () => {
    assert.ok(src.includes('createCodeActionsGutter'), 'Should have lightbulb gutter creator');
  });

  it('uses GutterMarker for lightbulb icon', () => {
    assert.ok(src.includes('GutterMarker'), 'Should use GutterMarker');
    assert.ok(src.includes('cm-lightbulb'), 'Should use cm-lightbulb CSS class');
  });

  it('uses StateField to track lightbulb markers', () => {
    assert.ok(src.includes('StateField') && src.includes('StateEffect'), 'Should use StateField + StateEffect');
  });

  it('debounces code action checks (400ms)', () => {
    assert.ok(src.includes('400'), 'Should debounce at 400ms');
    assert.ok(src.includes('debounceTimer'), 'Should have debounce timer');
  });

  it('calls lspRequestCodeActions to probe for actions', () => {
    assert.ok(src.includes('lspRequestCodeActions'), 'Should call LSP for code actions');
  });

  it('clears lightbulb when cursor moves to a different line', () => {
    assert.ok(src.includes('RangeSet.empty'), 'Should clear to empty RangeSet');
    assert.ok(src.includes('lastLineFrom'), 'Should track last line position');
  });

  it('handles gutter click to open code actions menu', () => {
    const block = src.split('cm-lightbulb-gutter')[1] || '';
    assert.ok(block.includes('mousedown'), 'Should handle mousedown on gutter');
    assert.ok(block.includes('handleCodeActions'), 'Should trigger code actions on click');
  });

  it('is only added when LSP is active', () => {
    assert.ok(src.includes('lsp.hasLsp') && src.includes('createCodeActionsGutter'), 'Should check lsp.hasLsp');
  });

  it('shows lightbulb emoji with tooltip', () => {
    assert.ok(src.includes('\\u{1F4A1}'), 'Should use lightbulb emoji');
    assert.ok(src.includes('Code Actions (Ctrl+.)'), 'Should show shortcut in tooltip');
  });
});

describe('editor-theme.js: lightbulb gutter styles', () => {
  it('styles .cm-lightbulb-gutter', () => {
    assert.ok(themeSrc.includes('cm-lightbulb-gutter'), 'Should have lightbulb gutter class');
  });

  it('styles .cm-lightbulb with cursor pointer', () => {
    assert.ok(themeSrc.includes('cm-lightbulb'), 'Should have lightbulb class');
  });

  it('has hover effect on lightbulb', () => {
    assert.ok(themeSrc.includes('.cm-lightbulb:hover'), 'Should have hover styles');
  });
});

describe('FileEditor.svelte: cmCache includes lightbulb dependencies', () => {
  it('imports gutter from @codemirror/view', () => {
    assert.ok(fileEditorSrc.includes('gutter'), 'loadCM should import gutter');
  });

  it('imports GutterMarker from @codemirror/view', () => {
    assert.ok(fileEditorSrc.includes('GutterMarker'), 'loadCM should import GutterMarker');
  });

  it('imports StateEffect from @codemirror/state', () => {
    assert.ok(fileEditorSrc.includes('StateEffect'), 'loadCM should import StateEffect');
  });

  it('imports StateField from @codemirror/state', () => {
    assert.ok(fileEditorSrc.includes('StateField'), 'loadCM should import StateField');
  });

  it('imports RangeSet from @codemirror/state', () => {
    assert.ok(fileEditorSrc.includes('RangeSet'), 'loadCM should import RangeSet');
  });
});
