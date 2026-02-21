const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LensWorkspace.svelte'),
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
  it('imports TabBar component', () => {
    assert.ok(src.includes("import TabBar from"), 'Should import TabBar');
  });
  it('imports FileEditor component', () => {
    assert.ok(src.includes("import FileEditor from"), 'Should import FileEditor');
  });
  it('imports DiffViewer component', () => {
    assert.ok(src.includes("import DiffViewer from"), 'Should import DiffViewer');
  });
  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });
  it('renders TabBar component', () => {
    assert.ok(src.includes('<TabBar'), 'Should render TabBar');
  });
  it('renders FileEditor conditionally', () => {
    assert.ok(src.includes('<FileEditor'), 'Should render FileEditor');
  });
  it('switches between browser and file views', () => {
    assert.ok(
      src.includes("activeTab?.type === 'browser'"),
      'Should conditionally show browser or file editor'
    );
  });
  it('renders DiffViewer for diff tabs', () => {
    assert.ok(src.includes('<DiffViewer'), 'Should render DiffViewer');
    assert.ok(src.includes("activeTab?.type === 'diff'"), 'Should check for diff tab type');
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

  // Panel toggles via layoutStore
  it('imports layoutStore', () => {
    assert.ok(src.includes('layoutStore'), 'Should import layoutStore');
  });
  it('conditionally renders chat panel', () => {
    assert.ok(src.includes('layoutStore.showChat'), 'Should use layoutStore for chat toggle');
  });
  it('conditionally renders terminal panel', () => {
    assert.ok(src.includes('layoutStore.showTerminal'), 'Should use layoutStore for terminal toggle');
  });
  it('conditionally renders file tree panel', () => {
    assert.ok(src.includes('layoutStore.showFileTree'), 'Should use layoutStore for file tree toggle');
  });

  // Webview visibility
  it('imports lensSetVisible', () => {
    assert.ok(src.includes('lensSetVisible'), 'Should import lensSetVisible for webview toggle');
  });
  it('toggles webview visibility with $effect', () => {
    assert.ok(src.includes('$effect'), 'Should have effect for webview visibility');
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
