/**
 * file-tree-node.test.js -- Source-inspection tests for FileTreeNode.svelte
 *
 * Validates the recursive tree node rendering component extracted from FileTree.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../src/components/lens/FileTreeNode.svelte');
const src = fs.readFileSync(filePath, 'utf-8');

describe('FileTreeNode.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0);
  });

  // ── Imports ──

  it('imports chooseIconName from file-icons', () => {
    assert.ok(src.includes('chooseIconName'), 'Should import chooseIconName');
    assert.ok(src.includes('file-icons.js'), 'Should import from file-icons.js');
  });

  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should import lspDiagnosticsStore');
    assert.ok(src.includes('lsp-diagnostics.svelte.js'), 'Should import from lsp-diagnostics.svelte.js');
  });

  it('imports sprite URL', () => {
    assert.ok(src.includes('spriteUrl'), 'Should import spriteUrl');
    assert.ok(src.includes('file-icons-sprite.svg'), 'Should reference sprite SVG');
  });

  // ── Props ──

  it('accepts entries prop via $props()', () => {
    assert.ok(src.includes('entries'), 'Should have entries prop');
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });

  it('accepts depth prop', () => {
    assert.ok(src.includes('depth'), 'Should have depth prop');
  });

  it('accepts expandedDirs prop', () => {
    assert.ok(src.includes('expandedDirs'), 'Should have expandedDirs prop');
  });

  it('accepts dirChildren prop', () => {
    assert.ok(src.includes('dirChildren'), 'Should have dirChildren prop');
  });

  it('accepts loadingDirs prop', () => {
    assert.ok(src.includes('loadingDirs'), 'Should have loadingDirs prop');
  });

  it('accepts callback props', () => {
    assert.ok(src.includes('onToggle'), 'Should have onToggle prop');
    assert.ok(src.includes('onFileClick'), 'Should have onFileClick prop');
    assert.ok(src.includes('onFileDblClick'), 'Should have onFileDblClick prop');
    assert.ok(src.includes('onContextMenu'), 'Should have onContextMenu prop');
  });

  it('accepts editing props', () => {
    assert.ok(src.includes('editingEntry'), 'Should have editingEntry prop');
    assert.ok(src.includes('editingValue'), 'Should have editingValue prop');
    assert.ok(src.includes('creatingIn'), 'Should have creatingIn prop');
    assert.ok(src.includes('creatingValue'), 'Should have creatingValue prop');
  });

  // ── Tree rendering ──

  it('has chevron icons for expand/collapse', () => {
    assert.ok(src.includes('tree-chevron'), 'Should have tree chevron class');
  });

  it('renders tree items with folder and file types', () => {
    assert.ok(src.includes('tree-item folder'), 'Should have folder tree items');
    assert.ok(src.includes('tree-item file'), 'Should have file tree items');
  });

  it('renders recursively with self-import', () => {
    assert.ok(src.includes("import Self from './FileTreeNode.svelte'"), 'Should self-import for recursion');
    assert.ok(src.includes('<Self'), 'Should render Self component for recursion');
    assert.ok(src.includes('depth={depth + 1}'), 'Should recurse with incremented depth');
  });

  it('uses depth-based indentation', () => {
    assert.ok(src.includes('depth * 16'), 'Should indent based on depth');
  });

  it('shows loading state for expanding directories', () => {
    assert.ok(src.includes('tree-loading'), 'Should have loading class');
    assert.ok(src.includes('loadingDirs.has('), 'Should check loadingDirs');
  });

  it('renders file icons via sprite SVG', () => {
    assert.ok(src.includes('tree-icon'), 'Should have tree-icon class');
    assert.ok(src.includes('chooseIconName('), 'Should call chooseIconName');
  });

  // ── Inline editing support ──

  it('supports inline rename input', () => {
    assert.ok(src.includes('tree-rename-input'), 'Should have rename input class');
    assert.ok(src.includes('onRenameKeydown'), 'Should have rename keydown handler');
    assert.ok(src.includes('onRenameSave'), 'Should have rename save handler');
  });

  it('supports inline create input', () => {
    assert.ok(src.includes('onCreateKeydown'), 'Should have create keydown handler');
    assert.ok(src.includes('onCreateSave'), 'Should have create save handler');
  });

  it('uses autofocus action', () => {
    assert.ok(src.includes('use:autofocus'), 'Should use autofocus action');
  });

  it('has ondblclick on file items', () => {
    assert.ok(src.includes('ondblclick'), 'Should have double-click handler on files');
  });

  // ── LSP diagnostic decorations ──

  it('calls getForFile for file diagnostic lookup', () => {
    assert.ok(src.includes('lspDiagnosticsStore.getForFile('), 'Should call getForFile');
  });

  it('calls getForDirectory for folder diagnostic lookup', () => {
    assert.ok(src.includes('lspDiagnosticsStore.getForDirectory('), 'Should call getForDirectory');
  });

  it('has has-error class for error files', () => {
    assert.ok(src.includes('class:has-error'), 'Should have has-error class toggle');
  });

  it('has has-warning class for warning files', () => {
    assert.ok(src.includes('class:has-warning'), 'Should have has-warning class toggle');
  });

  it('has diag-badge element for counts', () => {
    assert.ok(src.includes('diag-badge'), 'Should have diag-badge class');
  });

  it('has error badge variant', () => {
    assert.ok(src.includes('diag-badge error'), 'Should have error badge variant');
  });

  it('has warning badge variant', () => {
    assert.ok(src.includes('diag-badge warning'), 'Should have warning badge variant');
  });

  it('shows diagnostic badges conditionally', () => {
    assert.ok(src.includes('{#if dirDiag}') || src.includes('{#if fileDiag}'), 'Should conditionally show diagnostic badges');
  });

  it('applies has-error to folder names via dirDiag', () => {
    assert.ok(src.includes('dirDiag'), 'Should use dirDiag for folder diagnostics');
    assert.ok(src.includes('getForDirectory(entry.path)'), 'Should call getForDirectory');
  });

  it('applies has-error to file names via fileDiag', () => {
    assert.ok(src.includes('fileDiag'), 'Should use fileDiag for file diagnostics');
    assert.ok(src.includes('getForFile(entry.path)'), 'Should call getForFile');
  });

  // ── Ignored files ──

  it('handles ignored files with dimmed style', () => {
    assert.ok(src.includes('class:ignored'), 'Should have ignored class toggle');
    assert.ok(src.includes('.tree-name.ignored'), 'Should style ignored files');
    assert.ok(src.includes('opacity'), 'Should dim ignored files');
  });

  // ── Styles ──

  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped style block');
  });

  it('has hover styling for tree items', () => {
    assert.ok(src.includes('.tree-item:hover'), 'Should style tree item hover');
    assert.ok(src.includes('var(--bg-hover)'), 'Should use --bg-hover on hover');
  });

  it('uses CSS variables for theming', () => {
    assert.ok(src.includes('var(--text)'), 'Should use --text variable');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted variable');
  });

  it('uses monospace font for tree items', () => {
    assert.ok(src.includes('var(--font-mono)'), 'Should use monospace font');
  });

  it('uses no-drag for frameless window compatibility', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag for interactivity');
  });

  it('uses --danger color for errors', () => {
    const styleIdx = src.indexOf('<style>');
    const styleBlock = src.slice(styleIdx);
    assert.ok(styleBlock.includes('.has-error') && styleBlock.includes('var(--danger'), 'Should use --danger for errors');
  });

  it('uses --warn color for warnings', () => {
    const styleIdx = src.indexOf('<style>');
    const styleBlock = src.slice(styleIdx);
    assert.ok(styleBlock.includes('.has-warning') && styleBlock.includes('var(--warn'), 'Should use --warn for warnings');
  });
});
