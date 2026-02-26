/**
 * editor-theme.test.cjs -- Source-inspection tests for editor-theme.js
 *
 * Validates the custom CodeMirror theme uses CSS variables.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-theme.js'),
  'utf-8'
);

describe('editor-theme.js: exports', () => {
  it('exports voiceMirrorEditorTheme', () => {
    assert.ok(src.includes('export const voiceMirrorEditorTheme'), 'Should export voiceMirrorEditorTheme');
  });
});

describe('editor-theme.js: CodeMirror imports', () => {
  it('imports EditorView from @codemirror/view', () => {
    assert.ok(src.includes("from '@codemirror/view'"), 'Should import from @codemirror/view');
  });

  it('imports HighlightStyle and syntaxHighlighting from @codemirror/language', () => {
    assert.ok(src.includes('HighlightStyle'), 'Should import HighlightStyle');
    assert.ok(src.includes('syntaxHighlighting'), 'Should import syntaxHighlighting');
  });

  it('imports tags from @lezer/highlight', () => {
    assert.ok(src.includes("from '@lezer/highlight'"), 'Should import tags');
  });
});

describe('editor-theme.js: CSS variable usage', () => {
  it('uses --cm-background for editor background', () => {
    assert.ok(src.includes('--cm-background'), 'Should use --cm-background');
  });

  it('uses --cm-foreground for text color', () => {
    assert.ok(src.includes('--cm-foreground'), 'Should use --cm-foreground');
  });

  it('uses --cm-cursor for caret', () => {
    assert.ok(src.includes('--cm-cursor'), 'Should use --cm-cursor');
  });

  it('uses --cm-selection for selection background', () => {
    assert.ok(src.includes('--cm-selection'), 'Should use --cm-selection');
  });

  it('uses --cm-gutter-bg for gutter background', () => {
    assert.ok(src.includes('--cm-gutter-bg'), 'Should use --cm-gutter-bg');
  });

  it('uses --cm-gutter-fg for gutter text', () => {
    assert.ok(src.includes('--cm-gutter-fg'), 'Should use --cm-gutter-fg');
  });

  it('uses --cm-tooltip-bg for tooltips', () => {
    assert.ok(src.includes('--cm-tooltip-bg'), 'Should use --cm-tooltip-bg');
  });
});

describe('editor-theme.js: syntax highlighting variables', () => {
  const syntaxVars = [
    '--cm-keyword',
    '--cm-string',
    '--cm-comment',
    '--cm-function',
    '--cm-property',
    '--cm-type',
    '--cm-number',
    '--cm-constant',
    '--cm-operator',
    '--cm-variable',
    '--cm-tag',
    '--cm-attribute',
    '--cm-link',
    '--cm-invalid',
    '--cm-punctuation',
  ];

  for (const v of syntaxVars) {
    it(`uses ${v} for syntax highlighting`, () => {
      assert.ok(src.includes(v), `Should use ${v}`);
    });
  }
});

describe('editor-theme.js: theme structure', () => {
  it('creates theme with EditorView.theme()', () => {
    assert.ok(src.includes('EditorView.theme('), 'Should create editor chrome theme');
  });

  it('creates highlight style with HighlightStyle.define()', () => {
    assert.ok(src.includes('HighlightStyle.define('), 'Should create syntax highlight style');
  });

  it('marks as dark theme', () => {
    assert.ok(src.includes('dark: true'), 'Should be a dark theme');
  });

  it('handles keyword tags', () => {
    assert.ok(src.includes('tags.keyword'), 'Should style keywords');
  });

  it('handles string tags', () => {
    assert.ok(src.includes('tags.string'), 'Should style strings');
  });

  it('handles comment tags', () => {
    assert.ok(src.includes('tags.comment'), 'Should style comments');
  });

  it('styles comments as italic', () => {
    assert.ok(src.includes("fontStyle: 'italic'"), 'Should italicize comments');
  });

  it('handles function tags', () => {
    assert.ok(src.includes('tags.function(tags.variableName)'), 'Should style function names');
  });

  it('handles type tags', () => {
    assert.ok(src.includes('tags.typeName'), 'Should style type names');
  });
});

describe('editor-theme.js: minimap styling', () => {
  it('styles .cm-minimap with theme background', () => {
    assert.ok(src.includes("'.cm-minimap'"), 'Should style .cm-minimap');
    assert.ok(src.includes('--cm-background'), 'Minimap should use --cm-background');
  });

  it('styles minimap container with border', () => {
    assert.ok(src.includes("'.cm-minimap-container'"), 'Should style .cm-minimap-container');
  });

  it('styles minimap overlay with theme-aware colors', () => {
    assert.ok(src.includes("'.cm-minimap .cm-minimap-overlay'"), 'Should style minimap overlay');
    assert.ok(src.includes('--cm-selection'), 'Overlay should use --cm-selection');
  });
});
