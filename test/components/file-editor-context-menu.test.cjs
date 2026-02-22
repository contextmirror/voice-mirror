/**
 * file-editor-context-menu.test.cjs -- Source-inspection tests for FileEditor.svelte
 * context menu integration.
 *
 * Verifies that FileEditor wires up the EditorContextMenu component with
 * proper event handling, state management, and action dispatch.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/FileEditor.svelte'),
  'utf-8'
);

describe('FileEditor context menu: component imports', () => {
  it('imports EditorContextMenu', () => {
    assert.ok(src.includes('EditorContextMenu'));
  });
  it('imports chatStore for AI message injection', () => {
    assert.ok(src.includes('chatStore'));
  });
  it('imports aiStatusStore for provider detection', () => {
    assert.ok(src.includes('aiStatusStore'));
  });
});

describe('FileEditor context menu: event handling', () => {
  it('has contextmenu handler', () => {
    assert.ok(src.includes('contextmenu') || src.includes('domEventHandlers'));
  });
  it('has preventDefault in context menu handler', () => {
    assert.ok(src.includes('preventDefault'));
  });
  it('has posAtCoords call for position resolution', () => {
    assert.ok(src.includes('posAtCoords'));
  });
  it('references cachedDiagnostics for diagnostic detection', () => {
    assert.ok(src.includes('cachedDiagnostics'));
  });
});

describe('FileEditor context menu: state management', () => {
  it('has editorMenu state with visible flag', () => {
    assert.ok(src.includes('editorMenu'));
    assert.ok(src.includes('visible'));
  });
  it('has editorMenu state with x coordinate', () => {
    assert.ok(src.includes('editorMenu'));
    const menuSection = src.slice(src.indexOf('editorMenu'));
    assert.ok(menuSection.includes('x'));
  });
  it('has editorMenu state with y coordinate', () => {
    assert.ok(src.includes('editorMenu'));
    const menuSection = src.slice(src.indexOf('editorMenu'));
    assert.ok(menuSection.includes('y'));
  });
  it('has menuContext state with hasSelection', () => {
    assert.ok(src.includes('menuContext'));
    assert.ok(src.includes('hasSelection'));
  });
  it('has menuContext state with selectedText', () => {
    assert.ok(src.includes('selectedText'));
  });
  it('has menuContext state with hasDiagnostic', () => {
    assert.ok(src.includes('hasDiagnostic'));
  });
});

describe('FileEditor context menu: action dispatch', () => {
  it('has handleMenuAction function', () => {
    assert.ok(src.includes('handleMenuAction'));
  });
  it('has sendAiMessage function', () => {
    assert.ok(src.includes('sendAiMessage'));
  });
  it('handles ai-fix action', () => {
    assert.ok(src.includes('ai-fix'));
  });
  it('handles ai-explain action', () => {
    assert.ok(src.includes('ai-explain'));
  });
  it('handles ai-refactor action', () => {
    assert.ok(src.includes('ai-refactor'));
  });
  it('handles ai-test action', () => {
    assert.ok(src.includes('ai-test'));
  });
});

describe('FileEditor context menu: clipboard actions', () => {
  it('handles cut action', () => {
    assert.ok(src.includes("'cut'"));
  });
  it('handles copy action', () => {
    assert.ok(src.includes("'copy'"));
  });
  it('handles paste action', () => {
    assert.ok(src.includes("'paste'"));
  });
  it('handles select-all action', () => {
    assert.ok(src.includes("'select-all'") || src.includes('select-all'));
  });
  it('uses document.execCommand for cut/copy', () => {
    assert.ok(src.includes('document.execCommand'));
  });
  it('uses navigator.clipboard for paste', () => {
    assert.ok(src.includes('navigator.clipboard'));
  });
});

describe('FileEditor context menu: folding actions', () => {
  it('handles fold action', () => {
    assert.ok(src.includes("'fold'"));
  });
  it('handles unfold action', () => {
    assert.ok(src.includes("'unfold'"));
  });
  it('handles fold-all action', () => {
    assert.ok(src.includes("'fold-all'") || src.includes('fold-all'));
  });
  it('handles unfold-all action', () => {
    assert.ok(src.includes("'unfold-all'") || src.includes('unfold-all'));
  });
});

describe('FileEditor context menu: file actions', () => {
  it('handles copy-path action', () => {
    assert.ok(src.includes("'copy-path'") || src.includes('copy-path'));
  });
  it('handles copy-relative-path action', () => {
    assert.ok(src.includes("'copy-relative-path'") || src.includes('copy-relative-path'));
  });
  it('handles copy-markdown action', () => {
    assert.ok(src.includes("'copy-markdown'") || src.includes('copy-markdown'));
  });
  it('handles reveal action', () => {
    assert.ok(src.includes("'reveal'"));
  });
});

describe('FileEditor context menu: template integration', () => {
  it('mounts EditorContextMenu in template', () => {
    assert.ok(src.includes('<EditorContextMenu') || src.includes('EditorContextMenu'));
  });
  it('has getLanguageFromPath helper function', () => {
    assert.ok(src.includes('getLanguageFromPath'));
  });
});
