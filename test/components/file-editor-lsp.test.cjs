const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/FileEditor.svelte'), 'utf-8');
const extSrc = fs.readFileSync(path.join(__dirname, '../../src/lib/editor-extensions.js'), 'utf-8');

describe('FileEditor LSP integration', () => {
  it('imports createEditorLsp from editor-lsp.svelte.js', () => {
    assert.ok(src.includes('createEditorLsp'), 'Should import createEditorLsp');
    assert.ok(src.includes('editor-lsp.svelte.js'), 'Should import from editor-lsp.svelte.js');
  });
  it('imports LSP_EXTENSIONS from editor-lsp.svelte.js', () => {
    assert.ok(src.includes('LSP_EXTENSIONS'), 'Should import LSP_EXTENSIONS');
  });
  it('imports uriToRelativePath from editor-lsp.svelte.js', () => {
    assert.ok(src.includes('uriToRelativePath'), 'Should import uriToRelativePath');
  });
  it('imports lspPositionToOffset from editor-lsp.svelte.js', () => {
    assert.ok(src.includes('lspPositionToOffset'), 'Should import lspPositionToOffset');
  });
  it('imports mapCompletionKind from editor-lsp.svelte.js', () => {
    assert.ok(src.includes('mapCompletionKind'), 'Should import mapCompletionKind');
  });
  it('creates LSP helper instance', () => {
    assert.ok(src.includes('createEditorLsp()'), 'Should call createEditorLsp');
  });
  it('imports @codemirror/lint', () => {
    assert.ok(src.includes("@codemirror/lint"));
  });
  it('uses lsp.hasLsp for LSP state', () => {
    assert.ok(src.includes('lsp.hasLsp'), 'Should use lsp.hasLsp');
  });
  it('uses lsp.cachedDiagnostics for diagnostic cache', () => {
    assert.ok(src.includes('lsp.cachedDiagnostics'), 'Should use lsp.cachedDiagnostics');
  });
  it('calls lsp.openFile for LSP open', () => {
    assert.ok(src.includes('lsp.openFile('), 'Should call lsp.openFile');
  });
  it('calls lsp.closeFile for LSP close', () => {
    assert.ok(src.includes('lsp.closeFile('), 'Should call lsp.closeFile');
  });
  it('calls lsp.changeFile for content changes', () => {
    assert.ok(src.includes('lsp.changeFile('), 'Should call lsp.changeFile');
  });
  it('calls lsp.saveFile on save', () => {
    assert.ok(src.includes('lsp.saveFile('), 'Should call lsp.saveFile');
  });
  it('calls lsp.completionSource for completion', () => {
    assert.ok(extSrc.includes('lsp.completionSource('), 'Should call lsp.completionSource in editor-extensions.js');
  });
  it('calls lsp.hoverTooltipExtension for hover', () => {
    assert.ok(extSrc.includes('lsp.hoverTooltipExtension('), 'Should call lsp.hoverTooltipExtension in editor-extensions.js');
  });
  it('calls lsp.diagnosticListener for diagnostics', () => {
    assert.ok(src.includes('lsp.diagnosticListener('), 'Should call lsp.diagnosticListener');
  });
  it('calls lsp.reset when switching files', () => {
    assert.ok(src.includes('lsp.reset()'), 'Should call lsp.reset');
  });
  it('calls lsp.destroy on component destroy', () => {
    assert.ok(src.includes('lsp.destroy()'), 'Should call lsp.destroy');
  });
  it('calls lsp.setHasLsp to set LSP state', () => {
    assert.ok(src.includes('lsp.setHasLsp('), 'Should call lsp.setHasLsp');
  });
  it('listens for lsp-diagnostics event', () => {
    assert.ok(src.includes("'lsp-diagnostics'"), 'Should listen for lsp-diagnostics');
  });
  it('has lintGutter extension', () => {
    assert.ok(src.includes('lintGutter'), 'Should have lintGutter');
  });
  it('has hover tooltip CSS styling', () => {
    assert.ok(src.includes('lsp-hover-tooltip'), 'Should have hover tooltip styling');
  });
  it('sets view._lspPath for LSP handler access', () => {
    assert.ok(src.includes('_lspPath'), 'Should set _lspPath on view');
  });

  // Phase 3-5: New feature integration (action dispatch moved to EditorContextMenu / editor-extensions.js)
  it('handles find-references via EditorContextMenu or editor-extensions', () => {
    assert.ok(extSrc.includes('lsp.handleFindReferences'), 'Should call lsp.handleFindReferences in editor-extensions.js');
  });

  it('handles rename-symbol via EditorContextMenu or editor-extensions', () => {
    assert.ok(extSrc.includes('lsp.handleRenameSymbol'), 'Should call lsp.handleRenameSymbol in editor-extensions.js');
  });

  it('handles quick-fix via EditorContextMenu or editor-extensions', () => {
    assert.ok(extSrc.includes('lsp.handleCodeActions'), 'Should call lsp.handleCodeActions in editor-extensions.js');
  });

  it('imports and mounts ReferencesPanel', () => {
    assert.ok(src.includes('ReferencesPanel'), 'Should import ReferencesPanel');
    assert.ok(src.includes('<ReferencesPanel'), 'Should mount ReferencesPanel');
  });

  it('imports and mounts CodeActionsMenu', () => {
    assert.ok(src.includes('CodeActionsMenu'), 'Should import CodeActionsMenu');
    assert.ok(src.includes('<CodeActionsMenu'), 'Should mount CodeActionsMenu');
  });

  it('imports and mounts RenameInput', () => {
    assert.ok(src.includes('RenameInput'), 'Should import RenameInput');
    assert.ok(src.includes('<RenameInput'), 'Should mount RenameInput');
  });

  it('uses lsp.showReferences for references visibility', () => {
    assert.ok(src.includes('lsp.showReferences'), 'Should use lsp.showReferences');
  });

  it('uses lsp.referencesResult for references data', () => {
    assert.ok(src.includes('lsp.referencesResult'), 'Should use lsp.referencesResult');
  });

  it('uses lsp.showRename for rename visibility', () => {
    assert.ok(src.includes('lsp.showRename'), 'Should use lsp.showRename');
  });

  it('uses lsp.showCodeActions for code actions visibility', () => {
    assert.ok(src.includes('lsp.showCodeActions'), 'Should use lsp.showCodeActions');
  });

  it('calls lsp.executeRename on rename confirm', () => {
    assert.ok(src.includes('lsp.executeRename'), 'Should call lsp.executeRename');
  });

  it('imports lspDiagnosticsStore for pre-existing diagnostics', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should import lspDiagnosticsStore');
    assert.ok(src.includes('lsp-diagnostics.svelte.js'), 'Should import from diagnostics store');
  });

  it('applies pre-existing diagnostics from store on file open', () => {
    assert.ok(src.includes('getRawForFile'), 'Should check store for raw diagnostics when opening file');
  });

  // LSP formatting integration
  it('has handleFormat function', () => {
    assert.ok(src.includes('handleFormat'), 'Should have handleFormat function');
  });

  it('supports formatOnSave in save function', () => {
    assert.ok(src.includes('formatOnSave'), 'Should support formatOnSave');
  });

  it('has Shift+Alt+F keybinding for format', () => {
    assert.ok(extSrc.includes('Shift-Alt-f'), 'Should have Shift-Alt-f keybinding in editor-extensions.js');
  });
});
