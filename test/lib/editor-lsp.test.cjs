/**
 * editor-lsp.test.cjs -- Source-inspection tests for editor-lsp.svelte.js
 *
 * Validates exports, state, handlers, extension factories, and lifecycle methods
 * by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/editor-lsp.svelte.js'),
  'utf-8'
);

describe('editor-lsp.svelte.js: exports', () => {
  it('exports createEditorLsp factory', () => {
    assert.ok(src.includes('export function createEditorLsp'), 'Should export createEditorLsp');
  });

  it('exports LSP_EXTENSIONS set', () => {
    assert.ok(src.includes('export const LSP_EXTENSIONS'), 'Should export LSP_EXTENSIONS');
  });

  it('exports uriToRelativePath', () => {
    assert.ok(src.includes('export function uriToRelativePath'), 'Should export uriToRelativePath');
  });

  it('exports lspPositionToOffset', () => {
    assert.ok(src.includes('export function lspPositionToOffset'), 'Should export lspPositionToOffset');
  });

  it('exports mapCompletionKind', () => {
    assert.ok(src.includes('export function mapCompletionKind'), 'Should export mapCompletionKind');
  });
});

describe('editor-lsp.svelte.js: reactive state', () => {
  it('uses $state for lspVersion', () => {
    assert.ok(/let\s+lspVersion\s*=\s*\$state\(/.test(src), 'Should use $state for lspVersion');
  });

  it('uses $state for hasLsp', () => {
    assert.ok(/let\s+hasLsp\s*=\s*\$state\(/.test(src), 'Should use $state for hasLsp');
  });

  it('uses $state for cachedDiagnostics', () => {
    assert.ok(/let\s+cachedDiagnostics\s*=\s*\$state\(/.test(src), 'Should use $state for cachedDiagnostics');
  });
});

describe('editor-lsp.svelte.js: handlers', () => {
  it('has openFile handler', () => {
    assert.ok(src.includes('function openFile('), 'Should have openFile handler');
  });

  it('has closeFile handler', () => {
    assert.ok(src.includes('function closeFile('), 'Should have closeFile handler');
  });

  it('has changeFile handler with debounce', () => {
    assert.ok(src.includes('function changeFile('), 'Should have changeFile handler');
    assert.ok(src.includes('lspDebounceTimer'), 'Should use debounce timer');
    assert.ok(src.includes('clearTimeout(lspDebounceTimer)'), 'Should clear debounce timer');
  });

  it('has saveFile handler', () => {
    assert.ok(src.includes('function saveFile('), 'Should have saveFile handler');
  });

  it('has handleGoToDefinition handler', () => {
    assert.ok(src.includes('handleGoToDefinition'), 'Should have handleGoToDefinition');
  });
});

describe('editor-lsp.svelte.js: extension factories', () => {
  it('has completionSource factory', () => {
    assert.ok(src.includes('function completionSource('), 'Should have completionSource factory');
  });

  it('has hoverTooltipExtension factory', () => {
    assert.ok(src.includes('function hoverTooltipExtension('), 'Should have hoverTooltipExtension factory');
  });

  it('has diagnosticListener factory', () => {
    assert.ok(src.includes('function diagnosticListener('), 'Should have diagnosticListener factory');
  });
});

describe('editor-lsp.svelte.js: lifecycle', () => {
  it('has reset method', () => {
    assert.ok(src.includes('function reset('), 'Should have reset');
  });

  it('has destroy method', () => {
    assert.ok(src.includes('function destroy('), 'Should have destroy');
  });
});

describe('editor-lsp.svelte.js: return object', () => {
  it('returns lspVersion getter', () => {
    assert.ok(src.includes('get lspVersion()'), 'Should return lspVersion getter');
  });

  it('returns hasLsp getter', () => {
    assert.ok(src.includes('get hasLsp()'), 'Should return hasLsp getter');
  });

  it('returns cachedDiagnostics getter', () => {
    assert.ok(src.includes('get cachedDiagnostics()'), 'Should return cachedDiagnostics getter');
  });

  it('returns setHasLsp setter', () => {
    assert.ok(src.includes('setHasLsp('), 'Should return setHasLsp setter');
  });
});

describe('editor-lsp.svelte.js: imports', () => {
  it('imports LSP API functions', () => {
    assert.ok(src.includes('lspOpenFile'), 'Should import lspOpenFile');
    assert.ok(src.includes('lspCloseFile'), 'Should import lspCloseFile');
    assert.ok(src.includes('lspChangeFile'), 'Should import lspChangeFile');
    assert.ok(src.includes('lspSaveFile'), 'Should import lspSaveFile');
    assert.ok(src.includes('lspRequestCompletion'), 'Should import lspRequestCompletion');
    assert.ok(src.includes('lspRequestHover'), 'Should import lspRequestHover');
    assert.ok(src.includes('lspRequestDefinition'), 'Should import lspRequestDefinition');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });
});

describe('editor-lsp.svelte.js: LSP_EXTENSIONS content', () => {
  it('includes JavaScript extensions', () => {
    assert.ok(src.includes("'js'"), 'Should include js');
    assert.ok(src.includes("'ts'"), 'Should include ts');
    assert.ok(src.includes("'tsx'"), 'Should include tsx');
  });

  it('includes Rust extension', () => {
    assert.ok(src.includes("'rs'"), 'Should include rs');
  });

  it('includes Python extension', () => {
    assert.ok(src.includes("'py'"), 'Should include py');
  });

  it('includes CSS extension', () => {
    assert.ok(src.includes("'css'"), 'Should include css');
  });

  it('includes HTML extension', () => {
    assert.ok(src.includes("'html'"), 'Should include html');
  });

  it('includes Svelte extension', () => {
    assert.ok(src.includes("'svelte'"), 'Should include svelte');
  });
});

describe('editor-lsp.svelte.js: uriToRelativePath', () => {
  it('handles file:// protocol', () => {
    assert.ok(src.includes("file:"), 'Should check file: protocol');
  });

  it('handles Windows drive letters', () => {
    assert.ok(src.includes('[A-Za-z]'), 'Should handle Windows drive letters');
  });

  it('returns external flag for paths outside project root', () => {
    assert.ok(src.includes('external: true'), 'Should mark external paths');
    assert.ok(src.includes('external: false'), 'Should mark internal paths');
  });

  it('normalizes slashes', () => {
    assert.ok(src.includes("replace(/\\\\/g, '/')"), 'Should normalize backslashes');
  });

  it('does case-insensitive path comparison', () => {
    assert.ok(src.includes('toLowerCase()'), 'Should use case-insensitive comparison');
  });
});

describe('editor-lsp.svelte.js: mapCompletionKind', () => {
  it('maps LSP completion kinds to CodeMirror types', () => {
    assert.ok(src.includes("'method'"), 'Should map method');
    assert.ok(src.includes("'function'"), 'Should map function');
    assert.ok(src.includes("'variable'"), 'Should map variable');
    assert.ok(src.includes("'class'"), 'Should map class');
  });

  it('defaults to text for unknown kinds', () => {
    assert.ok(src.includes("|| 'text'"), 'Should default to text');
  });
});

describe('editor-lsp.svelte.js: new feature state', () => {
  it('has showReferences state', () => {
    assert.ok(/let\s+showReferences\s*=\s*\$state\(/.test(src), 'Should have showReferences state');
  });

  it('has referencesResult state', () => {
    assert.ok(/let\s+referencesResult\s*=\s*\$state\(/.test(src), 'Should have referencesResult state');
  });

  it('has showRename state', () => {
    assert.ok(/let\s+showRename\s*=\s*\$state\(/.test(src), 'Should have showRename state');
  });

  it('has renamePosition state', () => {
    assert.ok(/let\s+renamePosition\s*=\s*\$state\(/.test(src), 'Should have renamePosition state');
  });

  it('has renamePlaceholder state', () => {
    assert.ok(/let\s+renamePlaceholder\s*=\s*\$state\(/.test(src), 'Should have renamePlaceholder state');
  });

  it('has showCodeActions state', () => {
    assert.ok(/let\s+showCodeActions\s*=\s*\$state\(/.test(src), 'Should have showCodeActions state');
  });

  it('has codeActions state', () => {
    assert.ok(/let\s+codeActions\s*=\s*\$state\(/.test(src), 'Should have codeActions state');
  });

  it('has codeActionsPosition state', () => {
    assert.ok(/let\s+codeActionsPosition\s*=\s*\$state\(/.test(src), 'Should have codeActionsPosition state');
  });
});

describe('editor-lsp.svelte.js: new feature handlers', () => {
  it('has handleFindReferences handler', () => {
    assert.ok(src.includes('handleFindReferences'), 'Should have handleFindReferences');
  });

  it('has handleRenameSymbol handler', () => {
    assert.ok(src.includes('handleRenameSymbol'), 'Should have handleRenameSymbol');
  });

  it('has executeRename handler', () => {
    assert.ok(src.includes('executeRename'), 'Should have executeRename');
  });

  it('has handleCodeActions handler', () => {
    assert.ok(src.includes('handleCodeActions'), 'Should have handleCodeActions');
  });

  it('imports lspRequestReferences', () => {
    assert.ok(src.includes('lspRequestReferences'), 'Should import lspRequestReferences');
  });

  it('imports lspPrepareRename', () => {
    assert.ok(src.includes('lspPrepareRename'), 'Should import lspPrepareRename');
  });

  it('imports lspRename', () => {
    assert.ok(src.includes('lspRename'), 'Should import lspRename');
  });

  it('imports lspApplyWorkspaceEdit', () => {
    assert.ok(src.includes('lspApplyWorkspaceEdit'), 'Should import lspApplyWorkspaceEdit');
  });

  it('imports lspRequestCodeActions', () => {
    assert.ok(src.includes('lspRequestCodeActions'), 'Should import lspRequestCodeActions');
  });
});

describe('editor-lsp.svelte.js: new feature return object', () => {
  it('returns showReferences getter', () => {
    assert.ok(src.includes('get showReferences()'), 'Should return showReferences');
  });

  it('returns referencesResult getter', () => {
    assert.ok(src.includes('get referencesResult()'), 'Should return referencesResult');
  });

  it('returns showRename getter', () => {
    assert.ok(src.includes('get showRename()'), 'Should return showRename');
  });

  it('returns renamePosition getter', () => {
    assert.ok(src.includes('get renamePosition()'), 'Should return renamePosition');
  });

  it('returns renamePlaceholder getter', () => {
    assert.ok(src.includes('get renamePlaceholder()'), 'Should return renamePlaceholder');
  });

  it('returns showCodeActions getter', () => {
    assert.ok(src.includes('get showCodeActions()'), 'Should return showCodeActions');
  });

  it('returns codeActions getter', () => {
    assert.ok(src.includes('get codeActions()'), 'Should return codeActions');
  });

  it('returns setShowReferences setter', () => {
    assert.ok(src.includes('setShowReferences('), 'Should return setShowReferences');
  });

  it('returns setShowRename setter', () => {
    assert.ok(src.includes('setShowRename('), 'Should return setShowRename');
  });

  it('returns setShowCodeActions setter', () => {
    assert.ok(src.includes('setShowCodeActions('), 'Should return setShowCodeActions');
  });
});

describe('editor-lsp.svelte.js: formatting', () => {
  it('has formatDocument handler', () => {
    assert.ok(src.includes('formatDocument'), 'Should have formatDocument handler');
  });

  it('imports lspRequestFormatting', () => {
    assert.ok(src.includes('lspRequestFormatting'), 'Should import lspRequestFormatting');
  });

  it('sorts edits in reverse order for formatting', () => {
    assert.ok(src.includes('.sort('), 'Should sort formatting edits');
  });
});

describe('editor-lsp.svelte.js: diagnostics handling', () => {
  it('uses lspPositionToOffset for diagnostic positions', () => {
    assert.ok(src.includes('lspPositionToOffset'), 'Should use lspPositionToOffset');
  });

  it('clamps positions to document bounds', () => {
    assert.ok(src.includes('Math.max') && src.includes('Math.min'), 'Should clamp positions');
  });

  it('caches diagnostics per file', () => {
    assert.ok(src.includes('cachedDiagnostics.set('), 'Should cache diagnostics');
  });

  it('calls setDiagnostics on CM view', () => {
    assert.ok(src.includes('setDiagnostics'), 'Should call setDiagnostics');
  });
});
