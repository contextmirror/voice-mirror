/**
 * menu-bar-wiring.test.cjs -- Source-inspection tests for the title-bar menu
 * being wired to the central command registry, the editor command listeners,
 * and the terminal Clear/Show wiring.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '../../', rel), 'utf-8');
}

const commands = read('src/lib/commands.svelte.js');
const fileEditor = read('src/components/lens/FileEditor.svelte');
const terminalTabs = read('src/components/terminal/TerminalTabs.svelte');
const terminalPanel = read('src/components/terminal/TerminalPanel.svelte');
const app = read('src/App.svelte');
const devServerManager = read('src/lib/stores/dev-server-manager.svelte.js');

describe('commands.svelte.js: menu-bar commands registered', () => {
  const expectedIds = [
    // Edit
    'editor.undo', 'editor.redo', 'editor.cut', 'editor.copy', 'editor.paste', 'editor.find',
    // Selection
    'editor.selectAll', 'editor.expandSelection', 'editor.shrinkSelection',
    // View / Go
    'view.toggleSidebar', 'search.goToSymbol',
    // Run
    'run.start', 'run.stop', 'run.restart',
    // Terminal
    'terminal.split', 'terminal.clear',
    // Help
    'help.documentation', 'help.keyboardShortcuts', 'help.about',
  ];

  for (const id of expectedIds) {
    it(`registers ${id}`, () => {
      assert.ok(commands.includes(`id: '${id}'`), `${id} should be registered`);
    });
  }

  it('editor commands dispatch command:editor-* window events', () => {
    assert.ok(commands.includes("new CustomEvent('command:editor-undo')"), 'undo dispatches event');
    assert.ok(commands.includes("new CustomEvent('command:editor-find')"), 'find dispatches event');
    assert.ok(commands.includes("new CustomEvent('command:editor-select-all')"), 'select-all dispatches event');
  });

  it('run commands operate on the active project via dev-server-manager', () => {
    assert.ok(commands.includes('devServerManager'), 'imports dev-server-manager');
    assert.ok(commands.includes('projectStore.root'), 'uses active project root');
    assert.ok(commands.includes('detectDevServers'), 'detects servers for start');
    assert.ok(commands.includes('restartServer'), 'restart wires to restartServer');
  });

  it('help commands open docs externally and trigger the dialogs', () => {
    assert.ok(commands.includes("openExternal('https://www.contextmirror.com')"), 'docs opens website');
    assert.ok(commands.includes("new CustomEvent('show-about-dialog')"), 'about dispatches dialog event');
    assert.ok(commands.includes("new CustomEvent('show-keyboard-shortcuts')"), 'shortcuts dispatches dialog event');
  });

  it('terminal commands reveal the panel / clear via events', () => {
    assert.ok(commands.includes("new CustomEvent('command:show-terminal-tab')"), 'show-terminal-tab event used');
    assert.ok(commands.includes("new CustomEvent('terminal-clear')"), 'terminal-clear event used');
  });
});

describe('FileEditor.svelte: editor command listeners', () => {
  it('imports editorGroupsStore to scope commands to the focused group', () => {
    assert.ok(fileEditor.includes('editorGroupsStore'), 'imports editorGroupsStore');
    assert.ok(fileEditor.includes('isFocusedGroup'), 'gates on focused group');
  });

  it('listens for each command:editor-* event', () => {
    for (const evt of [
      'command:editor-undo', 'command:editor-redo', 'command:editor-cut', 'command:editor-copy',
      'command:editor-paste', 'command:editor-find', 'command:editor-select-all',
      'command:editor-expand-selection', 'command:editor-shrink-selection',
    ]) {
      assert.ok(fileEditor.includes(`'${evt}'`), `handles ${evt}`);
    }
  });

  it('uses CodeMirror commands + search panel + clipboard', () => {
    assert.ok(fileEditor.includes("import('@codemirror/commands')"), 'lazy-loads commands');
    assert.ok(fileEditor.includes("import('@codemirror/search')"), 'lazy-loads search for Find');
    assert.ok(fileEditor.includes('openSearchPanel'), 'opens the search panel');
    assert.ok(fileEditor.includes('navigator.clipboard'), 'uses clipboard for cut/copy/paste');
    assert.ok(fileEditor.includes('selectParentSyntax'), 'expand uses selectParentSyntax');
    assert.ok(fileEditor.includes('selectionExpandStack'), 'shrink uses a selection stack');
  });
});

describe('Terminal: Clear / Show wiring', () => {
  it('TerminalTabs listens for terminal-clear (AI) and command:show-terminal-tab', () => {
    assert.ok(terminalTabs.includes("addEventListener('terminal-clear'"), 'listens for terminal-clear');
    assert.ok(terminalTabs.includes("addEventListener('command:show-terminal-tab'"), 'listens for show-terminal-tab');
    assert.ok(terminalTabs.includes("bottomPanelMode === 'ai'"), 'only clears AI terminal here');
    assert.ok(terminalTabs.includes('layoutStore.setShowTerminal(true)'), 'reveals the panel');
  });

  it('TerminalPanel clears the active user-shell instance on terminal-clear', () => {
    assert.ok(terminalPanel.includes("addEventListener('terminal-clear'"), 'listens for terminal-clear');
    assert.ok(terminalPanel.includes('instanceActions'), 'tracks per-instance actions');
    assert.ok(terminalPanel.includes('activeInstanceId'), 'targets the active instance');
    assert.ok(!terminalPanel.includes('onRegisterActions={() => {}}'), 'no longer discards terminal actions');
  });
});

describe('Dev-server notifications: deduped (one toast per action)', () => {
  it('run commands no longer emit interim Starting/Stopping/Restarting toasts', () => {
    // The dev-server-manager is the single source of truth for lifecycle toasts.
    assert.ok(!commands.includes('Starting dev server'), 'no interim Starting toast');
    assert.ok(!commands.includes('Stopping dev server'), 'no interim Stopping toast');
    assert.ok(!commands.includes('Restarting dev server'), 'no interim Restarting toast');
  });

  it('run commands keep the unique guard toasts the manager never emits', () => {
    assert.ok(commands.includes('No dev server detected'), 'keeps no-server-detected guard');
    assert.ok(commands.includes('already'), 'keeps already-running guard');
  });

  it('manager lifecycle toasts share a per-project key so they replace rather than stack', () => {
    assert.ok(devServerManager.includes('key: `dev-server-${projectPath}`'), 'lifecycle toasts keyed per project');
    assert.ok(devServerManager.includes('dev-server-crash-'), 'crash toasts use a distinct key');
  });
});

describe('App.svelte: Help dialogs mounted', () => {
  it('mounts AboutDialog and KeyboardShortcutsDialog', () => {
    assert.ok(app.includes('AboutDialog'), 'mounts AboutDialog');
    assert.ok(app.includes('KeyboardShortcutsDialog'), 'mounts KeyboardShortcutsDialog');
  });
});
