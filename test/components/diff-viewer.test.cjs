/**
 * diff-viewer.test.cjs -- Source-inspection tests for DiffViewer.svelte
 *
 * Validates the diff viewer component that shows unified + split diffs using CodeMirror merge.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DiffViewer.svelte'),
  'utf-8'
);

describe('DiffViewer.svelte: imports', () => {
  it('imports readFile from api.js', () => {
    assert.ok(src.includes('readFile'), 'Should import readFile');
    assert.ok(src.includes('api.js'), 'Should import from api.js');
  });

  it('imports getFileGitContent from api.js', () => {
    assert.ok(src.includes('getFileGitContent'), 'Should import getFileGitContent');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports onDestroy from svelte', () => {
    assert.ok(src.includes('onDestroy'), 'Should import onDestroy');
  });

  it('imports tick from svelte', () => {
    assert.ok(src.includes('tick'), 'Should import tick');
  });

  it('imports voiceMirrorEditorTheme from editor-theme.js', () => {
    assert.ok(src.includes("import { voiceMirrorEditorTheme }"), 'Should import voiceMirrorEditorTheme');
    assert.ok(src.includes('editor-theme.js'), 'Should import from editor-theme.js');
  });

  it('does NOT import oneDark', () => {
    assert.ok(!src.includes('oneDark'), 'Should not reference oneDark');
    assert.ok(!src.includes('@codemirror/theme-one-dark'), 'Should not import @codemirror/theme-one-dark');
  });
});

describe('DiffViewer.svelte: props and state', () => {
  it('uses $props() for tab prop', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
    assert.ok(src.includes('tab'), 'Should destructure tab from props');
  });

  it('has loading state', () => {
    assert.ok(src.includes('loading'), 'Should have loading state');
    assert.ok(src.includes('$state(true)'), 'loading should default to true');
  });

  it('has error state', () => {
    assert.ok(src.includes('error'), 'Should have error state');
  });

  it('has isBinary state', () => {
    assert.ok(src.includes('isBinary'), 'Should have isBinary state');
  });

  it('has stats state for additions/deletions', () => {
    assert.ok(src.includes('stats'), 'Should have stats state');
    assert.ok(src.includes('additions'), 'Should track additions');
    assert.ok(src.includes('deletions'), 'Should track deletions');
  });

  it('has viewMode state defaulting to unified', () => {
    assert.ok(src.includes("let viewMode = $state('unified')"), 'Should have viewMode state defaulting to unified');
  });

  it('has wordWrap state', () => {
    assert.ok(src.includes('let wordWrap = $state(false)'), 'Should have wordWrap state');
  });

  it('has showWhitespace state', () => {
    assert.ok(src.includes('let showWhitespace = $state(false)'), 'Should have showWhitespace state');
  });

  it('has chunkCount and currentChunkIndex state', () => {
    assert.ok(src.includes('let chunkCount = $state(0)'), 'Should have chunkCount state');
    assert.ok(src.includes('let currentChunkIndex = $state(-1)'), 'Should have currentChunkIndex state');
  });

  it('has component-scope oldContent and newContent', () => {
    assert.ok(src.includes("let oldContent = $state('')"), 'Should have oldContent at component scope');
    assert.ok(src.includes("let newContent = $state('')"), 'Should have newContent at component scope');
  });
});

describe('DiffViewer.svelte: CM module cache (loadCM pattern)', () => {
  it('has cmCache variable', () => {
    assert.ok(src.includes('let cmCache = null'), 'Should have cmCache variable');
  });

  it('has loadCM function that caches modules', () => {
    assert.ok(src.includes('async function loadCM()'), 'Should have async loadCM function');
    assert.ok(src.includes('if (cmCache) return cmCache'), 'Should return cache on repeat calls');
  });

  it('loads codemirror, state, view, and merge modules', () => {
    assert.ok(src.includes("import('codemirror')"), 'Should dynamically import codemirror');
    assert.ok(src.includes("import('@codemirror/state')"), 'Should import @codemirror/state');
    assert.ok(src.includes("import('@codemirror/view')"), 'Should import @codemirror/view');
    assert.ok(src.includes("import('@codemirror/merge')"), 'Should import @codemirror/merge');
  });

  it('caches MergeView from @codemirror/merge', () => {
    assert.ok(src.includes('MergeView'), 'Should cache MergeView');
  });

  it('caches unifiedMergeView from @codemirror/merge', () => {
    assert.ok(src.includes('unifiedMergeView'), 'Should cache unifiedMergeView');
  });

  it('caches getChunks from @codemirror/merge', () => {
    assert.ok(src.includes('getChunks'), 'Should cache getChunks');
  });

  it('caches goToNextChunk and goToPreviousChunk', () => {
    assert.ok(src.includes('goToNextChunk'), 'Should cache goToNextChunk');
    assert.ok(src.includes('goToPreviousChunk'), 'Should cache goToPreviousChunk');
  });

  it('caches keymap from @codemirror/view', () => {
    assert.ok(src.includes('keymap'), 'Should cache keymap');
  });
});

describe('DiffViewer.svelte: buildSharedExtensions', () => {
  it('has buildSharedExtensions function', () => {
    assert.ok(src.includes('function buildSharedExtensions'), 'Should have buildSharedExtensions');
  });

  it('includes voiceMirrorEditorTheme', () => {
    assert.ok(src.includes('...voiceMirrorEditorTheme'), 'Should spread voiceMirrorEditorTheme into extensions');
  });

  it('sets editor as read-only', () => {
    assert.ok(src.includes('EditorView.editable.of(false)'), 'Should set editable to false');
    assert.ok(src.includes('EditorState.readOnly.of(true)'), 'Should set readOnly to true');
  });

  it('includes context menu handler', () => {
    assert.ok(src.includes('contextMenuHandler'), 'Should include contextMenuHandler');
  });

  it('includes word wrap when enabled', () => {
    assert.ok(src.includes('EditorView.lineWrapping'), 'Should reference lineWrapping');
  });

  it('inserts language support at correct position', () => {
    // Check that language support is spliced in at position 1
    assert.ok(src.includes('exts.splice(1, 0, langSupport)'), 'Should splice language support at index 1');
  });
});

describe('DiffViewer.svelte: createUnifiedView', () => {
  it('has createUnifiedView function', () => {
    assert.ok(src.includes('async function createUnifiedView'), 'Should have createUnifiedView');
  });

  it('configures unifiedMergeView with collapseUnchanged', () => {
    assert.ok(src.includes('collapseUnchanged: { margin: 3, minSize: 4 }'), 'Should configure collapseUnchanged');
  });

  it('configures mergeControls: false', () => {
    assert.ok(src.includes('mergeControls: false'), 'Should disable merge controls');
  });

  it('configures highlightChanges: true', () => {
    assert.ok(src.includes('highlightChanges: true'), 'Should enable change highlighting');
  });

  it('configures gutter: true', () => {
    assert.ok(src.includes('gutter: true'), 'Should enable gutter');
  });

  it('includes navigation keybindings (Alt+Arrow)', () => {
    assert.ok(src.includes("key: 'Alt-ArrowDown'"), 'Should bind Alt+ArrowDown');
    assert.ok(src.includes("key: 'Alt-ArrowUp'"), 'Should bind Alt+ArrowUp');
    assert.ok(src.includes('goToNextChunk'), 'Should use goToNextChunk for navigation');
    assert.ok(src.includes('goToPreviousChunk'), 'Should use goToPreviousChunk for navigation');
  });

  it('includes chunk tracker updateListener', () => {
    assert.ok(src.includes('chunkTracker'), 'Should have chunkTracker');
    assert.ok(src.includes('updateChunkInfo'), 'Should call updateChunkInfo');
  });

  it('applies whitespace normalization when enabled', () => {
    assert.ok(src.includes('showWhitespace ? normalizeWhitespace(oldContent) : oldContent'), 'Should normalize old content when whitespace toggle is on');
    assert.ok(src.includes('showWhitespace ? normalizeWhitespace(newContent) : newContent'), 'Should normalize new content when whitespace toggle is on');
  });
});

describe('DiffViewer.svelte: createSplitView', () => {
  it('has createSplitView function', () => {
    assert.ok(src.includes('async function createSplitView'), 'Should have createSplitView');
  });

  it('creates MergeView with a and b configs', () => {
    assert.ok(src.includes('new cm.MergeView('), 'Should create new MergeView');
    assert.ok(src.includes('a: { doc:'), 'Should configure side A');
    assert.ok(src.includes('b: { doc:'), 'Should configure side B');
  });

  it('passes parent to MergeView', () => {
    assert.ok(src.includes('parent: editorEl'), 'Should pass editorEl as parent');
  });

  it('uses collapseUnchanged in split mode', () => {
    // Both unified and split use collapseUnchanged
    const matches = src.match(/collapseUnchanged/g);
    assert.ok(matches && matches.length >= 2, 'Should use collapseUnchanged in both modes');
  });

  it('builds separate extensions for side A and side B', () => {
    assert.ok(src.includes('sharedA'), 'Should build sharedA extensions');
    assert.ok(src.includes('sharedB'), 'Should build sharedB extensions');
  });

  it('adds chunk tracker to side B', () => {
    assert.ok(src.includes('sharedB.push(chunkTracker, navKeymap)'), 'Should add chunkTracker and navKeymap to side B');
  });
});

describe('DiffViewer.svelte: destroyView and toggleMode', () => {
  it('has destroyView function', () => {
    assert.ok(src.includes('function destroyView()'), 'Should have destroyView');
  });

  it('destroys both unified and split views', () => {
    assert.ok(src.includes('unifiedView.destroy()'), 'Should destroy unifiedView');
    assert.ok(src.includes('splitView.destroy()'), 'Should destroy splitView');
  });

  it('clears editorEl innerHTML on destroy', () => {
    assert.ok(src.includes("editorEl.innerHTML = ''"), 'Should clear editorEl innerHTML');
  });

  it('resets chunk state on destroy', () => {
    assert.ok(src.includes('chunkCount = 0'), 'Should reset chunkCount');
    assert.ok(src.includes('currentChunkIndex = -1'), 'Should reset currentChunkIndex');
  });

  it('has toggleMode function', () => {
    assert.ok(src.includes('async function toggleMode()'), 'Should have toggleMode function');
  });

  it('toggleMode switches between unified and split', () => {
    assert.ok(src.includes("viewMode = 'split'"), 'Should set mode to split');
    assert.ok(src.includes("viewMode = 'unified'"), 'Should set mode to unified');
  });

  it('toggleMode destroys and recreates view', () => {
    // toggleMode calls destroyView() then creates new view
    assert.ok(src.includes('destroyView()'), 'toggleMode should call destroyView');
  });
});

describe('DiffViewer.svelte: chunk navigation', () => {
  it('has updateChunkInfo function', () => {
    assert.ok(src.includes('function updateChunkInfo'), 'Should have updateChunkInfo');
  });

  it('uses getChunks to read chunk data', () => {
    assert.ok(src.includes('cm.getChunks('), 'Should call getChunks');
  });

  it('tracks chunkCount from chunks array', () => {
    assert.ok(src.includes('chunkCount = info.chunks.length'), 'Should set chunkCount from chunks');
  });

  it('finds currentChunkIndex based on cursor position', () => {
    assert.ok(src.includes('v.state.selection.main.head'), 'Should use cursor position');
    assert.ok(src.includes('currentChunkIndex = idx'), 'Should set currentChunkIndex');
  });

  it('has navigateChunk function', () => {
    assert.ok(src.includes('function navigateChunk(direction)'), 'Should have navigateChunk function');
  });

  it('navigateChunk dispatches goToNextChunk/goToPreviousChunk', () => {
    assert.ok(src.includes("direction === 'next'"), 'Should check for next direction');
    assert.ok(src.includes('cm.goToNextChunk(v)'), 'Should call goToNextChunk');
    assert.ok(src.includes('cm.goToPreviousChunk(v)'), 'Should call goToPreviousChunk');
  });

  it('has getActiveView helper', () => {
    assert.ok(src.includes('function getActiveView()'), 'Should have getActiveView');
  });

  it('getActiveView returns correct view per mode', () => {
    assert.ok(src.includes("viewMode === 'unified'"), 'Should check for unified mode');
    assert.ok(src.includes('return unifiedView'), 'Should return unifiedView in unified mode');
    assert.ok(src.includes('return splitView.b'), 'Should return splitView.b in split mode');
  });
});

describe('DiffViewer.svelte: whitespace toggle', () => {
  it('has normalizeWhitespace function', () => {
    assert.ok(src.includes('function normalizeWhitespace'), 'Should have normalizeWhitespace');
  });

  it('normalizeWhitespace trims trailing whitespace', () => {
    assert.ok(src.includes('trimEnd()'), 'Should call trimEnd on lines');
  });

  it('has toggleWhitespace function', () => {
    assert.ok(src.includes('async function toggleWhitespace()'), 'Should have toggleWhitespace');
  });

  it('toggleWhitespace flips showWhitespace and recreates view', () => {
    assert.ok(src.includes('showWhitespace = !showWhitespace'), 'Should flip showWhitespace');
  });
});

describe('DiffViewer.svelte: word wrap toggle', () => {
  it('has toggleWrap function', () => {
    assert.ok(src.includes('async function toggleWrap()'), 'Should have toggleWrap');
  });

  it('toggleWrap flips wordWrap and recreates view', () => {
    assert.ok(src.includes('wordWrap = !wordWrap'), 'Should flip wordWrap');
  });
});

describe('DiffViewer.svelte: loadLanguage', () => {
  it('has loadLanguage via shared codemirror-languages.js', () => {
    assert.ok(src.includes('loadLanguage'), 'Should have loadLanguage reference');
    assert.ok(
      src.includes("import { loadLanguageExtension } from '../../lib/codemirror-languages.js'"),
      'Should import loadLanguageExtension from codemirror-languages.js'
    );
  });

  it('delegates language loading to shared module', () => {
    assert.ok(
      src.includes('loadLanguageExtension'),
      'Should use loadLanguageExtension from shared module'
    );
  });
});

describe('DiffViewer.svelte: countChanges', () => {
  it('has countChanges function', () => {
    assert.ok(src.includes('function countChanges'), 'Should have countChanges function');
  });

  it('counts additions and deletions', () => {
    assert.ok(src.includes('additions'), 'Should count additions');
    assert.ok(src.includes('deletions'), 'Should count deletions');
  });

  it('splits content by newlines', () => {
    assert.ok(src.includes(".split('\\n')"), 'Should split content into lines');
  });
});

describe('DiffViewer.svelte: binary file handling', () => {
  it('checks for binary files', () => {
    assert.ok(src.includes('binary'), 'Should check for binary content');
    assert.ok(src.includes('isBinary'), 'Should set isBinary state');
  });

  it('shows binary file placeholder', () => {
    assert.ok(src.includes('Binary file'), 'Should display binary file message');
    assert.ok(
      src.includes('Cannot show diff for binary files'),
      'Should explain binary limitation'
    );
  });
});

describe('DiffViewer.svelte: lifecycle', () => {
  it('loads diff reactively when tab changes', () => {
    assert.ok(src.includes('$effect('), 'Should use $effect for reactive loading');
    assert.ok(src.includes('tab?.path'), 'Should watch tab.path for changes');
  });

  it('destroys views on cleanup', () => {
    assert.ok(src.includes('onDestroy('), 'Should use onDestroy for cleanup');
    assert.ok(src.includes('destroyView()'), 'Should call destroyView on cleanup');
  });

  it('stores content at component scope during mount', () => {
    assert.ok(src.includes("oldContent = oldData?.content ?? ''"), 'Should store oldContent');
    assert.ok(src.includes("newContent = newData?.content ?? ''"), 'Should store newContent');
  });

  it('creates unified view by default on mount', () => {
    assert.ok(src.includes('await createUnifiedView(cm, langSupport)'), 'Should create unified view on mount');
  });
});

describe('DiffViewer.svelte: context menu', () => {
  it('has context menu state', () => {
    assert.ok(src.includes('contextMenu'), 'Should have contextMenu state');
  });

  it('suppresses default browser context menu', () => {
    assert.ok(src.includes('e.preventDefault()'), 'Should prevent default context menu');
  });

  it('has Copy action', () => {
    assert.ok(src.includes('menuCopy'), 'Should have menuCopy handler');
    assert.ok(src.includes('navigator.clipboard.writeText'), 'Should use clipboard API');
  });

  it('has Select All action', () => {
    assert.ok(src.includes('menuSelectAll'), 'Should have menuSelectAll handler');
  });

  it('has Open File action', () => {
    assert.ok(src.includes('menuOpenFile'), 'Should have menuOpenFile handler');
    assert.ok(src.includes('tabsStore.openFile'), 'Should open file via tabsStore');
  });

  it('has Copy Path action', () => {
    assert.ok(src.includes('menuCopyPath'), 'Should have menuCopyPath handler');
  });

  it('has Reveal in File Explorer action', () => {
    assert.ok(src.includes('menuReveal'), 'Should have menuReveal handler');
    assert.ok(src.includes('revealInExplorer'), 'Should call revealInExplorer');
  });

  it('closes on Escape key', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should handle Escape key');
  });

  it('closes on click outside', () => {
    assert.ok(src.includes('handleMenuClickOutside'), 'Should handle click outside');
  });

  it('registers contextmenu handler on CodeMirror via domEventHandlers', () => {
    assert.ok(src.includes('EditorView.domEventHandlers'), 'Should register domEventHandlers');
    assert.ok(src.includes('contextmenu'), 'Should handle contextmenu event');
  });

  it('has context menu CSS', () => {
    assert.ok(src.includes('.diff-context-menu'), 'Should have diff-context-menu class');
    assert.ok(src.includes('.diff-context-item'), 'Should have diff-context-item class');
  });

  it('uses getActiveView for menu actions in both modes', () => {
    assert.ok(src.includes('getActiveView()'), 'Should use getActiveView in menu handlers');
  });
});

describe('DiffViewer.svelte: CSS classes', () => {
  it('has diff-viewer class', () => {
    assert.ok(src.includes('.diff-viewer'), 'Should have diff-viewer CSS class');
  });

  it('has diff-loading class', () => {
    assert.ok(src.includes('.diff-loading'), 'Should have diff-loading CSS class');
  });

  it('has diff-placeholder class', () => {
    assert.ok(src.includes('.diff-placeholder'), 'Should have diff-placeholder CSS class');
  });
});

describe('DiffViewer.svelte: enhanced diff CSS', () => {
  it('uses stronger addition colors (16% background)', () => {
    assert.ok(src.includes('var(--ok) 16%'), 'Should use 16% opacity for addition backgrounds');
  });

  it('uses stronger inline change colors (32% opacity)', () => {
    assert.ok(src.includes('var(--ok) 32%'), 'Should use 32% for inline addition highlights');
    assert.ok(src.includes('var(--danger) 32%'), 'Should use 32% for inline deletion highlights');
  });

  it('has colored left borders on changed lines', () => {
    assert.ok(src.includes('border-left: 3px solid var(--ok)'), 'Should have green left border on additions');
    assert.ok(src.includes('border-left: 3px solid var(--danger)'), 'Should have red left border on deletions');
  });

  it('has .cm-collapsedLines styling', () => {
    assert.ok(src.includes('.cm-collapsedLines'), 'Should have cm-collapsedLines class');
    assert.ok(src.includes('border-top: 1px dashed'), 'Should have dashed top border on collapsed');
    assert.ok(src.includes('border-bottom: 1px dashed'), 'Should have dashed bottom border on collapsed');
  });

  it('has .cm-mergeView height and overflow', () => {
    assert.ok(src.includes('.cm-mergeView'), 'Should style cm-mergeView');
  });

  it('has split-mode .cm-merge-a colors (danger)', () => {
    assert.ok(src.includes('.cm-merge-a .cm-changedLine'), 'Should style side A changed lines');
    assert.ok(src.includes('.cm-merge-a .cm-changedText'), 'Should style side A changed text');
  });

  it('has split-mode .cm-merge-b colors (ok)', () => {
    assert.ok(src.includes('.cm-merge-b .cm-changedLine'), 'Should style side B changed lines');
    assert.ok(src.includes('.cm-merge-b .cm-changedText'), 'Should style side B changed text');
  });
});

describe('DiffViewer.svelte: scrollbar styling', () => {
  it('inherits scrollbar styling from global base.css', () => {
    // Scrollbar CSS was moved to base.css for consistency — DiffViewer should NOT duplicate it
    assert.ok(!src.includes('.cm-scroller::-webkit-scrollbar'), 'Should not have per-component scrollbar CSS (inherited from base.css)');
  });
});

describe('DiffViewer.svelte: scrollbar behavior', () => {
  it('relies on global scrollbar jump-to-click from main.js', () => {
    // Scrollbar jump-to-click was moved to a global handler in main.js.
    // DiffViewer no longer has its own attachScrollbarJump function.
    assert.ok(!src.includes('attachScrollbarJump'), 'Should NOT have local scrollbar jump handler');
  });
});

describe('DiffViewer.svelte: component integration', () => {
  it('imports DiffToolbar', () => {
    assert.ok(src.includes("import DiffToolbar from './DiffToolbar.svelte'"), 'Should import DiffToolbar');
  });

  it('imports DiffMinimap', () => {
    assert.ok(src.includes("import DiffMinimap from './DiffMinimap.svelte'"), 'Should import DiffMinimap');
  });

  it('renders DiffToolbar with all props', () => {
    assert.ok(src.includes('<DiffToolbar'), 'Should render DiffToolbar component');
    assert.ok(src.includes('onToggleMode={toggleMode}'), 'Should pass toggleMode to toolbar');
    assert.ok(src.includes('onToggleWrap={toggleWrap}'), 'Should pass toggleWrap to toolbar');
    assert.ok(src.includes('onToggleWhitespace={toggleWhitespace}'), 'Should pass toggleWhitespace to toolbar');
  });

  it('renders DiffMinimap with chunk data', () => {
    assert.ok(src.includes('<DiffMinimap'), 'Should render DiffMinimap component');
    assert.ok(src.includes('chunks={minimapChunks}'), 'Should pass minimapChunks to minimap');
    assert.ok(src.includes('{totalLines}'), 'Should pass totalLines to minimap');
  });

  it('has minimapChunks state', () => {
    assert.ok(src.includes('minimapChunks'), 'Should have minimapChunks state');
  });

  it('calls tabsStore.setDiffStats after computing stats', () => {
    assert.ok(src.includes('tabsStore.setDiffStats(tab.id, stats)'), 'Should call setDiffStats');
  });
});

describe('DiffViewer.svelte: diff file navigation', () => {
  it('imports getGitChanges from api.js', () => {
    assert.ok(src.includes('getGitChanges'), 'Should import getGitChanges');
  });

  it('has changedFiles state', () => {
    assert.ok(src.includes('changedFiles'), 'Should have changedFiles state');
  });

  it('has loadChangedFiles function', () => {
    assert.ok(src.includes('async function loadChangedFiles'), 'Should have loadChangedFiles function');
  });

  it('computes currentFileIndex from changedFiles', () => {
    assert.ok(src.includes('currentFileIndex'), 'Should have currentFileIndex derived');
    assert.ok(src.includes('changedFiles.findIndex'), 'Should find current file in changedFiles');
  });

  it('computes hasPrevFile and hasNextFile', () => {
    assert.ok(src.includes('hasPrevFile'), 'Should have hasPrevFile derived');
    assert.ok(src.includes('hasNextFile'), 'Should have hasNextFile derived');
  });

  it('has navigateToPrevFile function', () => {
    assert.ok(src.includes('function navigateToPrevFile'), 'Should have navigateToPrevFile');
  });

  it('has navigateToNextFile function', () => {
    assert.ok(src.includes('function navigateToNextFile'), 'Should have navigateToNextFile');
  });

  it('navigateToPrevFile opens diff via tabsStore', () => {
    assert.ok(src.includes('tabsStore.openDiff(prev)'), 'Should open prev diff via tabsStore');
  });

  it('navigateToNextFile opens diff via tabsStore', () => {
    assert.ok(src.includes('tabsStore.openDiff(next)'), 'Should open next diff via tabsStore');
  });

  it('passes file navigation props to DiffToolbar', () => {
    assert.ok(src.includes('onPrevFile={navigateToPrevFile}'), 'Should pass navigateToPrevFile to toolbar');
    assert.ok(src.includes('onNextFile={navigateToNextFile}'), 'Should pass navigateToNextFile to toolbar');
    assert.ok(src.includes('{hasPrevFile}'), 'Should pass hasPrevFile to toolbar');
    assert.ok(src.includes('{hasNextFile}'), 'Should pass hasNextFile to toolbar');
  });

  it('listens for command:next-diff-file and command:prev-diff-file events', () => {
    assert.ok(src.includes("'command:next-diff-file'"), 'Should listen for next-diff-file event');
    assert.ok(src.includes("'command:prev-diff-file'"), 'Should listen for prev-diff-file event');
  });

  it('loads changed files when tab loads', () => {
    // loadChangedFiles is called in the effect that loads diff content
    assert.ok(src.includes('loadChangedFiles()'), 'Should call loadChangedFiles when tab loads');
  });
});

describe('DiffViewer.svelte: exported state and callbacks', () => {
  it('has viewMode state', () => {
    assert.ok(src.includes('let viewMode'), 'Should have viewMode');
  });

  it('has toggleMode function', () => {
    assert.ok(src.includes('async function toggleMode'), 'Should have toggleMode function');
  });

  it('has navigateChunk function', () => {
    assert.ok(src.includes('function navigateChunk'), 'Should have navigateChunk function');
  });

  it('has toggleWrap function', () => {
    assert.ok(src.includes('async function toggleWrap'), 'Should have toggleWrap function');
  });

  it('has toggleWhitespace function', () => {
    assert.ok(src.includes('async function toggleWhitespace'), 'Should have toggleWhitespace function');
  });
});
