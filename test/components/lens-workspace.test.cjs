const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
  'utf-8'
);

const editorPaneSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/EditorPane.svelte'),
  'utf-8'
);

describe('LensWorkspace.svelte', () => {
  // Imports
  it('imports SplitPanel', () => {
    assert.ok(src.includes("import SplitPanel from"));
  });
  it('imports LensToolbar', () => {
    assert.ok(src.includes("import LensToolbar from"));
  });
  it('imports LensPreview', () => {
    assert.ok(src.includes("import LensPreview from"));
  });
  it('imports ChatPanel', () => {
    assert.ok(src.includes("import ChatPanel from"));
  });
  it('imports TerminalTabs', () => {
    assert.ok(src.includes("import TerminalTabs from"));
  });
  it('imports TerminalTabs from terminal-tabs path', () => {
    assert.ok(src.includes("terminal/TerminalTabs.svelte"), 'Should import from terminal/TerminalTabs.svelte');
  });

  // Props
  it('accepts onSend prop', () => {
    assert.ok(src.includes('onSend'));
    assert.ok(src.includes('$props()'));
  });

  // Layout structure
  it('has vertical split for main area vs terminal', () => {
    assert.ok(src.includes('direction="vertical"'));
  });
  it('has horizontal splits for chat | preview | files', () => {
    const count = (src.match(/direction="horizontal"/g) || []).length;
    assert.ok(count >= 2, 'Should have at least 2 horizontal splits');
  });
  it('has split ratio state variables', () => {
    assert.ok(src.includes('verticalRatio'));
    assert.ok(src.includes('chatRatio'));
    assert.ok(src.includes('previewRatio'));
  });

  // Tab system
  it('imports GroupTabBar component (replaces TabBar)', () => {
    assert.ok(src.includes("import GroupTabBar from"), 'Should import GroupTabBar');
  });
  it('imports FileEditor component', () => {
    assert.ok(src.includes("import FileEditor from"), 'Should import FileEditor');
  });
  it('imports DiffViewer component', () => {
    assert.ok(src.includes("import DiffViewer from"), 'Should import DiffViewer');
  });
  it('imports BrowserTabBar component', () => {
    assert.ok(src.includes("import BrowserTabBar from"), 'Should import BrowserTabBar');
  });
  it('renders BrowserTabBar in preview layer', () => {
    assert.ok(src.includes('<BrowserTabBar'), 'Should render BrowserTabBar');
  });
  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });
  it('renders GroupTabBar component', () => {
    assert.ok(editorPaneSrc.includes('<GroupTabBar'), 'Should render GroupTabBar in EditorPane');
  });
  it('renders FileEditor conditionally', () => {
    assert.ok(editorPaneSrc.includes('<FileEditor'), 'Should render FileEditor in EditorPane');
  });
  it('uses CSS visibility for browser layer (no destroy/recreate)', () => {
    assert.ok(src.includes('preview-layer'), 'Should have preview-layer wrapper');
    assert.ok(
      src.includes('class:visible={showBrowser}') || src.includes('class:visible={isBrowser}'),
      'Should toggle visibility with CSS'
    );
  });
  it('renders DiffViewer for diff tabs', () => {
    assert.ok(editorPaneSrc.includes('<DiffViewer'), 'Should render DiffViewer in EditorPane');
    assert.ok(editorPaneSrc.includes('diff'), 'Should check for diff tab type');
  });
  it('passes onChangeClick to FileTree', () => {
    assert.ok(src.includes('onChangeClick'), 'Should wire onChangeClick to FileTree');
  });

  // Chat panel (real component)
  it('has chat area wrapper with ChatPanel', () => {
    assert.ok(src.includes('chat-area'));
    assert.ok(src.includes('<ChatPanel'));
  });
  it('passes onSend to ChatPanel', () => {
    assert.ok(src.includes('{onSend}'));
  });

  // Terminal panel (tabbed container)
  it('has terminal area wrapper with TerminalTabs', () => {
    assert.ok(src.includes('terminal-area'));
    assert.ok(src.includes('<TerminalTabs'));
  });

  // Files panel (FileTree component)
  it('imports FileTree component', () => {
    assert.ok(src.includes("import FileTree from"));
  });
  it('renders FileTree in the right panel', () => {
    assert.ok(src.includes('<FileTree'));
  });

  // Preview area
  it('renders LensToolbar and LensPreview for browser tab', () => {
    assert.ok(src.includes('<LensToolbar'));
    assert.ok(src.includes('<LensPreview'));
  });

  // FileTree wiring
  it('passes onFileClick to FileTree', () => {
    assert.ok(src.includes('onFileClick'), 'Should wire onFileClick to FileTree');
  });
  it('passes onFileDblClick to FileTree for pinning', () => {
    assert.ok(src.includes('onFileDblClick'), 'Should wire onFileDblClick to FileTree');
    assert.ok(src.includes('pinTab'), 'Should call pinTab on double-click');
  });

  // Panel toggles via layoutStore (collapse props, not conditional rendering)
  it('imports layoutStore', () => {
    assert.ok(src.includes('layoutStore'), 'Should import layoutStore');
  });
  it('collapses chat via SplitPanel collapseA', () => {
    assert.ok(src.includes('collapseA={!layoutStore.showChat}'), 'Should collapse chat panel');
  });
  it('collapses terminal via SplitPanel collapseB', () => {
    assert.ok(src.includes('collapseB={!layoutStore.showTerminal}'), 'Should collapse terminal panel');
  });
  it('collapses file tree via SplitPanel collapseB', () => {
    assert.ok(src.includes('collapseB={!layoutStore.showFileTree}'), 'Should collapse file tree panel');
  });

  // Webview visibility
  it('imports lensSetVisible', () => {
    assert.ok(src.includes('lensSetVisible'), 'Should import lensSetVisible for webview toggle');
  });
  it('imports lensStore for webviewReady guard', () => {
    assert.ok(src.includes('lensStore'), 'Should import lensStore');
    assert.ok(src.includes("stores/lens.svelte.js"), 'Should import from lens store path');
  });
  it('guards lensSetVisible with webviewReady check', () => {
    assert.ok(src.includes('lensStore.webviewReady'), 'Should check webviewReady before calling lensSetVisible');
  });
  it('toggles webview visibility with $effect', () => {
    assert.ok(src.includes('$effect'), 'Should have effect for webview visibility');
  });

  // File watcher lifecycle
  it('imports startFileWatching and stopFileWatching from api', () => {
    assert.ok(src.includes('startFileWatching'), 'Should import startFileWatching');
    assert.ok(src.includes('stopFileWatching'), 'Should import stopFileWatching');
    assert.ok(src.includes("from '../../lib/api.js'"), 'Should import from api.js');
  });

  it('imports projectStore for active project path', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('starts file watcher via $effect when project path is available', () => {
    assert.ok(src.includes('startFileWatching(path)') || src.includes('startFileWatching('),
      'Should call startFileWatching');
    assert.ok(src.includes('activeProject?.path'), 'Should read activeProject path');
  });

  it('stops file watcher on cleanup (project change or unmount)', () => {
    assert.ok(src.includes('stopFileWatching()'), 'Should call stopFileWatching on cleanup');
  });

  it('guards file watcher start on valid path', () => {
    assert.ok(src.includes('if (!path) return'), 'Should guard against null/undefined path');
  });

  it('handles file watcher errors gracefully', () => {
    assert.ok(src.includes('.catch('), 'Should catch file watcher errors');
  });

  // Split editor
  it('imports editorGroupsStore', () => {
    assert.ok(
      src.includes('editorGroupsStore') || src.includes('editor-groups.svelte.js'),
      'Should import editorGroupsStore'
    );
  });

  it('imports GroupTabBar', () => {
    assert.ok(
      src.includes('GroupTabBar') || src.includes("import GroupTabBar from"),
      'Should import GroupTabBar component'
    );
  });

  it('has renderNode snippet', () => {
    assert.ok(
      src.includes('renderNode') || src.includes('{#snippet renderNode'),
      'Should have renderNode snippet for recursive grid rendering'
    );
  });

  it('renderNode handles leaf nodes', () => {
    assert.ok(
      src.includes("type === 'leaf'") || src.includes("node.type === 'leaf'"),
      'renderNode should handle leaf nodes'
    );
  });

  it('renderNode handles branch nodes with SplitPanel', () => {
    // Branch nodes are rendered as nested SplitPanel instances
    assert.ok(
      src.includes("type === 'branch'") || src.includes("node.type"),
      'renderNode should handle branch nodes'
    );
    assert.ok(src.includes('SplitPanel'), 'Branch nodes should use SplitPanel');
  });

  it('uses EditorPane component', () => {
    assert.ok(
      src.includes('EditorPane') || src.includes('import EditorPane'),
      'Should use EditorPane component'
    );
  });

  it('EditorPane accepts groupId parameter', () => {
    assert.ok(
      editorPaneSrc.includes('groupId') && editorPaneSrc.includes('$props'),
      'EditorPane should accept groupId prop'
    );
  });

  it('has showBrowser local state', () => {
    assert.ok(src.includes('showBrowser'), 'Should have showBrowser local state');
  });

  it('passes browser props to GroupTabBar', () => {
    assert.ok(
      src.includes('onBrowserClick') && src.includes('showBrowser'),
      'Should pass browser toggle props to GroupTabBar'
    );
  });

  it('has editor-grid container', () => {
    assert.ok(src.includes('editor-grid'), 'Should have editor-grid container');
  });

  it('pane-content hidden when browser showing', () => {
    assert.ok(
      editorPaneSrc.includes('class:hidden={showBrowser}'),
      'pane-content should be hidden when browser is showing'
    );
  });

  // Action handlers for split
  it('wires split-editor action handler', () => {
    assert.ok(
      src.includes('split-editor') || src.includes('splitGroup'),
      'Should wire split-editor action handler'
    );
  });

  it('wires focus-group-1 action handler', () => {
    assert.ok(
      src.includes('focus-group-1') || src.includes('setFocusedGroup'),
      'Should wire focus-group-1 action handler'
    );
  });

  it('wires focus-group-2 action handler', () => {
    assert.ok(
      src.includes('focus-group-2') || src.includes('setFocusedGroup'),
      'Should wire focus-group-2 action handler'
    );
  });

  it('uses setActionHandler from shortcuts store', () => {
    assert.ok(
      src.includes('setActionHandler'),
      'Should use setActionHandler from shortcuts store'
    );
  });

  // Browser decoupling
  it('showBrowser controls browser visibility (not tab type)', () => {
    assert.ok(
      src.includes('showBrowser') && !src.includes("type === 'browser'"),
      'showBrowser state should control browser, not tab type'
    );
  });

  it('lensSetVisible uses showBrowser state', () => {
    assert.ok(
      src.includes('lensSetVisible') && src.includes('showBrowser'),
      'lensSetVisible should use showBrowser state'
    );
  });

  it('file click sets showBrowser to false', () => {
    assert.ok(
      src.includes('showBrowser = false') || src.includes('showBrowser=false'),
      'Clicking a file should hide the browser'
    );
  });

  // CSS
  it('has workspace-content with flex and margins', () => {
    assert.ok(src.includes('.workspace-content'));
    assert.ok(src.includes('margin-right'));
    assert.ok(src.includes('margin-bottom'));
  });
  it('uses flex column layout', () => {
    assert.ok(src.includes('flex-direction: column'));
  });
  it('has chat-area with border-right', () => {
    assert.ok(src.includes('border-right'));
  });
  it('has terminal-area with border-top', () => {
    assert.ok(src.includes('border-top'));
  });

});
