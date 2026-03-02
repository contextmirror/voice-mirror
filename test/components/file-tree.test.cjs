/**
 * file-tree.test.js -- Source-inspection tests for FileTree.svelte
 *
 * Validates imports, state, UI structure, behavior, and styles of the
 * FileTree component by reading source text and asserting patterns.
 *
 * Tree node rendering is now in FileTreeNode.svelte.
 * Git changes rendering is now in GitChangesPanel.svelte.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../src/components/lens/FileTree.svelte');
const src = fs.readFileSync(filePath, 'utf-8');

describe('FileTree.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0);
  });

  // ── Imports ──

  it('imports listDirectory from api', () => {
    assert.ok(src.includes('listDirectory'), 'Should import listDirectory');
    assert.ok(src.includes("from '../../lib/api.js'"), 'Should import from api.js');
  });

  it('imports getGitChanges from api', () => {
    assert.ok(src.includes('getGitChanges'), 'Should import getGitChanges');
  });

  it('imports FileTreeNode sub-component', () => {
    assert.ok(src.includes("import FileTreeNode from './FileTreeNode.svelte'"), 'Should import FileTreeNode');
  });

  it('imports GitChangesPanel sub-component', () => {
    assert.ok(src.includes("import GitChangesPanel from './GitChangesPanel.svelte'"), 'Should import GitChangesPanel');
  });

  // ── Props ──

  it('accepts onFileClick prop via $props()', () => {
    assert.ok(src.includes('onFileClick'), 'Should have onFileClick');
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });

  it('accepts onFileDblClick prop', () => {
    assert.ok(src.includes('onFileDblClick'), 'Should have onFileDblClick prop');
  });

  it('accepts onChangeClick prop', () => {
    assert.ok(src.includes('onChangeClick'), 'Should have onChangeClick prop');
  });

  // ── State management ──

  it('uses $state for activeTab', () => {
    assert.ok(src.includes("activeTab = $state("), 'Should have activeTab state');
  });

  it('uses $state for rootEntries', () => {
    assert.ok(src.includes("rootEntries = $state("), 'Should have rootEntries state');
  });

  it('uses $state for expandedDirs', () => {
    assert.ok(src.includes("expandedDirs = $state("), 'Should have expandedDirs state');
  });

  it('uses $state for dirChildren', () => {
    assert.ok(src.includes("dirChildren = $state("), 'Should have dirChildren state');
  });

  it('uses $state for loadingDirs', () => {
    assert.ok(src.includes("loadingDirs = $state("), 'Should have loadingDirs state');
  });

  it('uses $state for gitChanges', () => {
    assert.ok(src.includes("gitChanges = $state("), 'Should have gitChanges state');
  });

  // ── Lifecycle ──

  it('uses $effect for lifecycle', () => {
    assert.ok(src.includes('$effect('), 'Should use $effect for mount');
  });

  it('loads root directory on mount', () => {
    assert.ok(src.includes('loadRoot'), 'Should have loadRoot function');
  });

  it('loads git changes on mount', () => {
    assert.ok(src.includes('loadGitChanges'), 'Should have loadGitChanges function');
  });

  // ── UI: Tabs ──

  it('has All files tab', () => {
    assert.ok(src.includes('All files'), 'Should have All files tab text');
  });

  it('has Changes tab', () => {
    assert.ok(src.includes('Changes'), 'Should have Changes tab text');
  });

  it('tracks active tab with class:active', () => {
    assert.ok(src.includes("class:active={activeTab === 'files'}"), 'files tab has active class');
    assert.ok(src.includes("class:active={activeTab === 'changes'}"), 'changes tab has active class');
  });

  it('imports and renders StatusDropdown in header', () => {
    assert.ok(src.includes("import StatusDropdown from"), 'Should import StatusDropdown');
    assert.ok(src.includes('<StatusDropdown'), 'Should render StatusDropdown in header');
  });

  // ── UI: Tree structure (delegated to FileTreeNode) ──

  it('renders FileTreeNode for file tree', () => {
    assert.ok(src.includes('<FileTreeNode'), 'Should render FileTreeNode component');
  });

  it('passes tree state to FileTreeNode', () => {
    assert.ok(src.includes('entries={rootEntries}'), 'Should pass rootEntries to FileTreeNode');
    assert.ok(src.includes('{expandedDirs}'), 'Should pass expandedDirs to FileTreeNode');
    assert.ok(src.includes('{dirChildren}'), 'Should pass dirChildren to FileTreeNode');
    assert.ok(src.includes('{loadingDirs}'), 'Should pass loadingDirs to FileTreeNode');
  });

  // ── Behavior ──

  it('has toggle directory function', () => {
    assert.ok(src.includes('toggleDir'), 'Should have toggleDir function');
  });

  it('toggle expands and collapses via expandedDirs set', () => {
    assert.ok(src.includes('expandedDirs.has('), 'Should check expandedDirs membership');
    assert.ok(src.includes('.delete(path)'), 'Should delete from set to collapse');
    assert.ok(src.includes('.add(path)'), 'Should add to set to expand');
  });

  it('always fetches fresh data on expand', () => {
    assert.ok(src.includes('listDirectory(path, root)'), 'Should load children via API with project root');
    assert.ok(src.includes('Always fetch fresh data on expand'), 'Should always fetch, not use stale cache');
  });

  it('handles file click by calling onFileClick', () => {
    assert.ok(src.includes('handleFileClick'), 'Should have handleFileClick function');
    assert.ok(src.includes('onFileClick(entry)'), 'Should delegate to onFileClick prop');
  });

  // ── Error handling ──

  it('has error handling for API calls', () => {
    const catchCount = (src.match(/catch\s*\(/g) || []).length;
    assert.ok(catchCount >= 2, `Should have at least 2 catch blocks, found ${catchCount}`);
  });

  it('logs errors to console', () => {
    assert.ok(src.includes('console.error'), 'Should log errors');
  });

  // ── Git changes display (delegated to GitChangesPanel) ──

  it('renders GitChangesPanel in changes tab', () => {
    assert.ok(src.includes('<GitChangesPanel'), 'Should render GitChangesPanel component');
  });

  it('passes git change data to GitChangesPanel', () => {
    assert.ok(src.includes('{stagedChanges}'), 'Should pass stagedChanges to GitChangesPanel');
    assert.ok(src.includes('{unstagedChanges}'), 'Should pass unstagedChanges to GitChangesPanel');
    assert.ok(src.includes('{activeDiffPath}'), 'Should pass activeDiffPath to GitChangesPanel');
  });

  it('handles empty changes state', () => {
    // The "No changes" text is now in GitChangesPanel, but FileTree still derives changes
    assert.ok(src.includes('stagedChanges'), 'Should derive stagedChanges');
    assert.ok(src.includes('unstagedChanges'), 'Should derive unstagedChanges');
  });

  // ── Styles ──

  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped style block');
  });

  it('uses CSS variables for theming', () => {
    assert.ok(src.includes('var(--bg)'), 'Should use --bg variable');
    assert.ok(src.includes('var(--text)'), 'Should use --text variable');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted variable');
    assert.ok(src.includes('var(--accent)'), 'Should use --accent variable');
  });

  it('uses monospace font for tree items', () => {
    assert.ok(src.includes('var(--font-mono)'), 'Should use monospace font');
  });

  it('uses no-drag for frameless window compatibility', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag for interactivity');
  });

  it('has files-area as root container', () => {
    assert.ok(src.includes('.files-area'), 'Should have files-area class');
    assert.ok(src.includes("class=\"files-area\""), 'Should use files-area on root element');
  });

  it('has scrollable tree container', () => {
    assert.ok(src.includes('tree-scroll'), 'Should have tree-scroll class');
    assert.ok(src.includes('overflow-y: auto'), 'Should be scrollable');
  });

  // ── Project store integration ──

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('passes root to listDirectory calls', () => {
    assert.ok(
      src.includes('listDirectory(null, root') || src.includes('listDirectory(path, root'),
      'Should pass root parameter to listDirectory'
    );
  });

  it('passes root to getGitChanges calls', () => {
    assert.ok(
      src.includes('getGitChanges(root') || src.includes('getGitChanges(projectRoot'),
      'Should pass root parameter to getGitChanges'
    );
  });
});

describe('FileTree.svelte -- context menu', () => {
  it('imports FileContextMenu component', () => {
    assert.ok(src.includes("import FileContextMenu from"), 'Should import FileContextMenu');
  });

  it('renders FileContextMenu component', () => {
    assert.ok(src.includes('<FileContextMenu'), 'Should render FileContextMenu');
  });

  it('has contextMenu state', () => {
    assert.ok(src.includes('contextMenu = $state('), 'Should have contextMenu state');
  });

  it('has handleContextMenu function', () => {
    assert.ok(src.includes('handleContextMenu'), 'Should have handleContextMenu');
  });

  it('prevents default context menu', () => {
    assert.ok(src.includes('e.preventDefault()'), 'Should prevent default');
  });

  it('has closeContextMenu function', () => {
    assert.ok(src.includes('closeContextMenu'), 'Should have closeContextMenu');
  });

  it('passes context menu props to FileContextMenu', () => {
    assert.ok(src.includes('x={contextMenu.x}'), 'Should pass x');
    assert.ok(src.includes('y={contextMenu.y}'), 'Should pass y');
    assert.ok(src.includes('visible={contextMenu.visible}'), 'Should pass visible');
  });

  it('has separate context for files, folders, and changes', () => {
    assert.ok(src.includes('isFolder'), 'Should distinguish folders');
    assert.ok(src.includes('isChange'), 'Should distinguish changes');
  });

  it('has handleEmptyContextMenu for blank space', () => {
    assert.ok(src.includes('handleEmptyContextMenu'), 'Should have empty space context handler');
  });

  it('attaches empty context menu to tree-scroll', () => {
    assert.ok(src.includes('oncontextmenu={handleEmptyContextMenu}'), 'Should handle right-click on empty space');
  });
});

describe('FileTree.svelte -- inline rename', () => {
  it('has editingEntry state', () => {
    assert.ok(src.includes('editingEntry = $state('), 'Should have editingEntry state');
  });

  it('has startRename function', () => {
    assert.ok(src.includes('startRename'), 'Should have startRename');
  });

  it('has saveRename function', () => {
    assert.ok(src.includes('saveRename'), 'Should have saveRename');
  });

  it('has cancelRename function', () => {
    assert.ok(src.includes('cancelRename'), 'Should have cancelRename');
  });

  it('has rename input class', () => {
    assert.ok(src.includes('tree-rename-input'), 'Should have rename input class');
  });

  it('calls renameEntry API', () => {
    assert.ok(src.includes('renameEntry('), 'Should call renameEntry');
  });

  it('imports renameEntry from api', () => {
    assert.ok(src.includes('renameEntry'), 'Should import renameEntry');
  });

  it('handles Enter key for save', () => {
    assert.ok(src.includes("e.key === 'Enter'"), 'Should save on Enter');
  });

  it('handles Escape key for cancel', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should cancel on Escape');
  });

  it('uses autofocus action', () => {
    assert.ok(src.includes('use:autofocus'), 'Should autofocus rename input');
  });

  it('selects filename without extension', () => {
    assert.ok(src.includes('setSelectionRange'), 'Should select filename part');
  });
});

describe('FileTree.svelte -- inline create', () => {
  it('has creatingIn state', () => {
    assert.ok(src.includes('creatingIn = $state('), 'Should have creatingIn state');
  });

  it('has startNewFile function', () => {
    assert.ok(src.includes('startNewFile'), 'Should have startNewFile');
  });

  it('has startNewFolder function', () => {
    assert.ok(src.includes('startNewFolder'), 'Should have startNewFolder');
  });

  it('has saveCreate function', () => {
    assert.ok(src.includes('saveCreate'), 'Should have saveCreate');
  });

  it('has cancelCreate function', () => {
    assert.ok(src.includes('cancelCreate'), 'Should have cancelCreate');
  });

  it('imports createFile from api', () => {
    assert.ok(src.includes('createFile'), 'Should import createFile');
  });

  it('imports createDirectory from api', () => {
    assert.ok(src.includes('createDirectory'), 'Should import createDirectory');
  });

  it('has getParentPath helper for file vs folder', () => {
    assert.ok(src.includes('getParentPath'), 'Should have getParentPath helper');
  });
});

describe('FileTree.svelte -- F2 keyboard shortcut', () => {
  it('has selectedEntry state', () => {
    assert.ok(src.includes('selectedEntry = $state('), 'Should have selectedEntry state');
  });

  it('listens for F2 key', () => {
    assert.ok(src.includes("e.key === 'F2'"), 'Should listen for F2');
  });

  it('has handleKeydown function', () => {
    assert.ok(src.includes('handleKeydown'), 'Should have handleKeydown');
  });

  it('uses svelte:window for keyboard', () => {
    assert.ok(src.includes('svelte:window'), 'Should use svelte:window');
  });
});

describe('FileTree.svelte -- file watcher integration', () => {
  it('imports listen from @tauri-apps/api/event', () => {
    assert.ok(src.includes("import { listen }") || src.includes("{ listen }"), 'Should import listen');
    assert.ok(src.includes("@tauri-apps/api/event"), 'Should import from @tauri-apps/api/event');
  });

  it('listens for fs-tree-changed event', () => {
    assert.ok(
      src.includes("'fs-tree-changed'"),
      'Should listen for fs-tree-changed event'
    );
  });

  it('listens for fs-git-changed event', () => {
    assert.ok(
      src.includes("'fs-git-changed'"),
      'Should listen for fs-git-changed event'
    );
  });

  it('has handleTreeChanged function', () => {
    assert.ok(
      src.includes('handleTreeChanged'),
      'Should have handleTreeChanged function'
    );
  });

  it('has handleGitChanged function', () => {
    assert.ok(
      src.includes('handleGitChanged'),
      'Should have handleGitChanged function'
    );
  });

  it('refreshes all expanded directories on any tree change', () => {
    assert.ok(
      src.includes('for (const dir of expandedDirs)'),
      'Should iterate all expandedDirs to refresh on filesystem change'
    );
  });

  it('cleans up event listeners on unmount', () => {
    assert.ok(src.includes('unlistenTree'), 'Should store tree unlisten function');
    assert.ok(src.includes('unlistenGit'), 'Should store git unlisten function');
    assert.ok(
      src.includes('unlistenTree?.()') || src.includes('unlistenTree()'),
      'Should call unlistenTree on cleanup'
    );
    assert.ok(
      src.includes('unlistenGit?.()') || src.includes('unlistenGit()'),
      'Should call unlistenGit on cleanup'
    );
  });

  it('uses $effect with cleanup return for listener lifecycle', () => {
    assert.ok(src.includes('return () =>'), 'Should return cleanup function from $effect');
  });

  it('reloads root when rootChanged flag is true', () => {
    const handlerStart = src.indexOf('async function handleTreeChanged');
    const handlerEnd = src.indexOf('function handleGitChanged');
    const handlerBody = src.slice(handlerStart, handlerEnd);
    assert.ok(handlerBody.includes('loadRoot'), 'Should call loadRoot when root changed');
  });

  it('handleGitChanged calls loadGitChanges', () => {
    const handlerStart = src.indexOf('function handleGitChanged');
    const handlerEnd = src.indexOf('}', handlerStart + 10);
    const handlerBody = src.slice(handlerStart, handlerEnd);
    assert.ok(handlerBody.includes('loadGitChanges'), 'Should call loadGitChanges');
  });
});

describe('FileTree.svelte -- tree refresh', () => {
  it('has refreshParent function', () => {
    assert.ok(src.includes('refreshParent'), 'Should have refreshParent');
  });

  it('refreshes git changes after mutations', () => {
    const refreshStart = src.indexOf('async function refreshParent');
    const refreshEnd = src.indexOf('}', src.indexOf('loadGitChanges', refreshStart));
    const refreshBody = src.slice(refreshStart, refreshEnd);
    assert.ok(refreshBody.includes('loadGitChanges'), 'Should refresh git changes');
  });
});

describe('FileTree.svelte -- LSP diagnostic decorations', () => {
  it('imports lspDiagnosticsStore', () => {
    assert.ok(src.includes('lspDiagnosticsStore'), 'Should import lspDiagnosticsStore');
    assert.ok(src.includes('lsp-diagnostics.svelte.js'), 'Should import from lsp-diagnostics.svelte.js');
  });
});

describe('FileTree.svelte -- Changes tab parity with All Files', () => {
  it('accepts onChangeDblClick prop', () => {
    assert.ok(src.includes('onChangeDblClick'), 'Should have onChangeDblClick prop');
  });

  it('accepts activeDiffPath prop', () => {
    assert.ok(src.includes('activeDiffPath'), 'Should have activeDiffPath prop');
  });
});

describe('FileTree.svelte -- Outline tab', () => {
  it('imports OutlinePanel', () => {
    assert.ok(src.includes("import OutlinePanel from"), 'Should import OutlinePanel');
  });

  it('has Outline tab button', () => {
    assert.ok(src.includes('Outline'), 'Should have Outline tab text');
  });

  it('tracks active tab with class:active for outline', () => {
    assert.ok(src.includes("activeTab === 'outline'"), 'outline tab has active class check');
  });

  it('accepts activeFilePath prop', () => {
    assert.ok(src.includes('activeFilePath'), 'Should accept activeFilePath prop');
  });

  it('accepts activeFileHasLsp prop', () => {
    assert.ok(src.includes('activeFileHasLsp'), 'Should accept activeFileHasLsp prop');
  });

  it('accepts onSymbolClick prop', () => {
    assert.ok(src.includes('onSymbolClick'), 'Should accept onSymbolClick prop');
  });

  it('renders OutlinePanel when outline tab is active', () => {
    assert.ok(src.includes('<OutlinePanel'), 'Should render OutlinePanel component');
  });

  it('passes filePath to OutlinePanel', () => {
    assert.ok(src.includes('filePath={activeFilePath}'), 'Should pass activeFilePath as filePath');
  });

  it('passes hasLsp to OutlinePanel', () => {
    assert.ok(src.includes('hasLsp={activeFileHasLsp}'), 'Should pass activeFileHasLsp as hasLsp');
  });
});

describe('FileTree.svelte -- keyboard navigation', () => {
  it('imports flattenVisibleEntries from file-tree-nav', () => {
    assert.ok(src.includes('flattenVisibleEntries'), 'Should import flattenVisibleEntries');
    assert.ok(src.includes('file-tree-nav.js'), 'Should import from file-tree-nav.js');
  });

  it('has focusedPath state', () => {
    assert.ok(src.includes('focusedPath = $state('), 'Should have focusedPath state');
  });

  it('has visibleEntries derived from flattenVisibleEntries', () => {
    assert.ok(src.includes('visibleEntries'), 'Should have visibleEntries derived');
    assert.ok(src.includes('flattenVisibleEntries('), 'Should call flattenVisibleEntries');
  });

  it('has handleTreeKeydown function', () => {
    assert.ok(src.includes('handleTreeKeydown'), 'Should have handleTreeKeydown');
  });

  it('handles ArrowDown key', () => {
    assert.ok(src.includes("'ArrowDown'"), 'Should handle ArrowDown');
  });

  it('handles ArrowUp key', () => {
    assert.ok(src.includes("'ArrowUp'"), 'Should handle ArrowUp');
  });

  it('handles ArrowRight key', () => {
    assert.ok(src.includes("'ArrowRight'"), 'Should handle ArrowRight');
  });

  it('handles ArrowLeft key', () => {
    assert.ok(src.includes("'ArrowLeft'"), 'Should handle ArrowLeft');
  });

  it('handles Enter key for opening files / toggling dirs', () => {
    // handleTreeKeydown has its own Enter case
    const keydownStart = src.indexOf('function handleTreeKeydown');
    const keydownEnd = src.indexOf('function scrollFocusedIntoView') > keydownStart
      ? src.indexOf('function scrollFocusedIntoView')
      : src.indexOf('// ── Git', keydownStart);
    const body = src.slice(keydownStart, keydownEnd);
    assert.ok(body.includes("'Enter'"), 'handleTreeKeydown should handle Enter');
  });

  it('handles Home and End keys', () => {
    assert.ok(src.includes("'Home'"), 'Should handle Home key');
    assert.ok(src.includes("'End'"), 'Should handle End key');
  });

  it('has scrollFocusedIntoView function', () => {
    assert.ok(src.includes('scrollFocusedIntoView'), 'Should have scrollFocusedIntoView');
    assert.ok(src.includes('scrollIntoView'), 'Should call scrollIntoView');
  });

  it('tree-scroll has tabindex="0"', () => {
    assert.ok(src.includes('tabindex="0"'), 'tree-scroll should have tabindex');
  });

  it('tree-scroll has role="tree"', () => {
    assert.ok(src.includes('role="tree"'), 'tree-scroll should have tree role');
  });

  it('attaches handleTreeKeydown to tree-scroll', () => {
    assert.ok(src.includes('onkeydown={handleTreeKeydown}'), 'Should attach keydown to tree-scroll');
  });

  it('passes focusedPath to FileTreeNode', () => {
    assert.ok(src.includes('{focusedPath}'), 'Should pass focusedPath to FileTreeNode');
  });

  it('sets focusedPath on file click', () => {
    const clickStart = src.indexOf('function handleFileClick');
    const clickEnd = src.indexOf('}', clickStart + 30);
    const body = src.slice(clickStart, clickEnd);
    assert.ok(body.includes('focusedPath'), 'handleFileClick should set focusedPath');
  });

  it('has focus-visible style for tree-scroll', () => {
    assert.ok(src.includes('.tree-scroll:focus-visible'), 'Should style tree-scroll focus');
  });
});

describe('FileTree.svelte -- drag-to-move files', () => {
  it('imports isDescendantOf from file-tree-nav', () => {
    assert.ok(src.includes('isDescendantOf'), 'Should import isDescendantOf');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes('toastStore'), 'Should import toastStore');
    assert.ok(src.includes('toast.svelte.js'), 'Should import from toast.svelte.js');
  });

  it('has dragOverPath state', () => {
    assert.ok(src.includes('dragOverPath = $state('), 'Should have dragOverPath state');
  });

  it('has handleTreeDragOver function', () => {
    assert.ok(src.includes('handleTreeDragOver'), 'Should have handleTreeDragOver');
  });

  it('has handleTreeDragLeave function', () => {
    assert.ok(src.includes('handleTreeDragLeave'), 'Should have handleTreeDragLeave');
  });

  it('has handleTreeDrop function', () => {
    assert.ok(src.includes('handleTreeDrop'), 'Should have handleTreeDrop');
  });

  it('calls renameEntry in handleTreeDrop', () => {
    const dropStart = src.indexOf('async function handleTreeDrop');
    const dropEnd = src.indexOf('function handleEmptyDragOver');
    const body = src.slice(dropStart, dropEnd);
    assert.ok(body.includes('renameEntry('), 'handleTreeDrop should call renameEntry');
  });

  it('checks isDescendantOf to prevent circular moves', () => {
    const dropStart = src.indexOf('async function handleTreeDrop');
    const dropEnd = src.indexOf('function handleEmptyDragOver');
    const body = src.slice(dropStart, dropEnd);
    assert.ok(body.includes('isDescendantOf('), 'Should check isDescendantOf');
  });

  it('shows toast on move errors', () => {
    const dropStart = src.indexOf('async function handleTreeDrop');
    const dropEnd = src.indexOf('function handleEmptyDragOver');
    const body = src.slice(dropStart, dropEnd);
    assert.ok(body.includes('toastStore.addToast'), 'Should show toast on error');
  });

  it('passes drag props to FileTreeNode', () => {
    assert.ok(src.includes('{dragOverPath}'), 'Should pass dragOverPath');
    assert.ok(src.includes('onTreeDragOver={handleTreeDragOver}'), 'Should pass onTreeDragOver');
    assert.ok(src.includes('onTreeDragLeave={handleTreeDragLeave}'), 'Should pass onTreeDragLeave');
    assert.ok(src.includes('onTreeDrop={handleTreeDrop}'), 'Should pass onTreeDrop');
  });

  it('has handleEmptyDragOver for root-level drops', () => {
    assert.ok(src.includes('handleEmptyDragOver'), 'Should have handleEmptyDragOver');
  });

  it('has handleEmptyDrop for root-level drops', () => {
    assert.ok(src.includes('handleEmptyDrop'), 'Should have handleEmptyDrop');
  });

  it('attaches drag handlers to tree-scroll', () => {
    assert.ok(src.includes('ondragover={handleEmptyDragOver}'), 'tree-scroll should have dragover');
    assert.ok(src.includes('ondrop={handleEmptyDrop}'), 'tree-scroll should have drop');
  });
});
