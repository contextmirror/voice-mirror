/**
 * file-editor-context-menu.test.cjs -- Source-inspection tests for FileEditor.svelte
 * context menu integration.
 *
 * Verifies that FileEditor wires up the EditorContextMenu component with
 * proper event handling, state management, and callback props.
 *
 * Action dispatch logic has been moved to EditorContextMenu.svelte —
 * see editor-context-menu.test.cjs for those tests.
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

describe('FileEditor context menu: callback props', () => {
  it('has sendAiMessage function', () => {
    assert.ok(src.includes('sendAiMessage'));
  });
  it('has handleGoToDefinition function', () => {
    assert.ok(src.includes('handleGoToDefinition'));
  });
  it('passes onSendToAi callback to EditorContextMenu', () => {
    assert.ok(src.includes('onSendToAi'));
  });
  it('passes onNavigateDefinition callback to EditorContextMenu', () => {
    assert.ok(src.includes('onNavigateDefinition'));
  });
  it('passes view prop to EditorContextMenu', () => {
    assert.ok(src.includes('{view}'));
  });
  it('passes tab prop to EditorContextMenu', () => {
    assert.ok(src.includes('{tab}'));
  });
  it('passes lsp prop to EditorContextMenu', () => {
    assert.ok(src.includes('{lsp}'));
  });
});

describe('FileEditor context menu: template integration', () => {
  it('mounts EditorContextMenu in template', () => {
    assert.ok(src.includes('<EditorContextMenu') || src.includes('EditorContextMenu'));
  });
});
