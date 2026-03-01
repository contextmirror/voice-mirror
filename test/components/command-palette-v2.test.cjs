const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, '../../src/lib');
const STORES_DIR = path.join(__dirname, '../../src/lib/stores');
const LENS_DIR = path.join(__dirname, '../../src/components/lens');
const APP_FILE = path.join(__dirname, '../../src/App.svelte');

function readFile(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf-8');
}

// ── commands.svelte.js ──────────────────────────────────────────────────────

describe('commands.svelte.js', () => {
  it('file exists', () => {
    // Should not throw
    const src = readFile(LIB_DIR, 'commands.svelte.js');
    assert.ok(src.length > 0, 'File should not be empty');
  });

  const commandsSrc = readFile(LIB_DIR, 'commands.svelte.js');

  it('exports commandRegistry', () => {
    assert.ok(commandsSrc.includes('commandRegistry'), 'Should export commandRegistry');
  });

  it('has register method', () => {
    assert.ok(commandsSrc.includes('register'), 'Should have register method/function');
  });

  it('has registerMany method', () => {
    assert.ok(commandsSrc.includes('registerMany'), 'Should have registerMany method/function for bulk registration');
  });

  it('has unregister method', () => {
    assert.ok(commandsSrc.includes('unregister'), 'Should have unregister method/function');
  });

  it('has execute method', () => {
    assert.ok(commandsSrc.includes('execute'), 'Should have execute method/function');
  });

  it('has search method', () => {
    assert.ok(commandsSrc.includes('search'), 'Should have search method/function');
  });

  it('has getAll method', () => {
    assert.ok(commandsSrc.includes('getAll'), 'Should have getAll method/function');
  });

  it('uses localStorage key voice-mirror-command-history', () => {
    assert.ok(commandsSrc.includes('voice-mirror-command-history'), 'Should use localStorage key for MRU history');
  });

  it('imports getActionHandler from shortcuts', () => {
    assert.ok(commandsSrc.includes('getActionHandler'), 'Should import getActionHandler from shortcuts store');
  });

  it('imports layoutStore', () => {
    assert.ok(commandsSrc.includes('layoutStore'), 'Should import layoutStore for view toggle commands');
  });

  it('imports navigationStore', () => {
    assert.ok(commandsSrc.includes('navigationStore'), 'Should import navigationStore for view navigation commands');
  });

  it('imports tabsStore', () => {
    assert.ok(commandsSrc.includes('tabsStore'), 'Should import tabsStore for file tab commands');
  });

  it('has required command IDs registered', () => {
    const requiredIds = [
      'view.toggleChat',
      'view.toggleTerminal',
      'view.toggleFileTree',
      'editor.splitRight',
      'file.save',
      'lsp.formatDocument',
      'git.push',
      'terminal.newTerminal',
      'chat.newChat',
      'voice.toggle',
      'system.reloadWindow',
    ];
    for (const id of requiredIds) {
      assert.ok(commandsSrc.includes(id), `Should register command '${id}'`);
    }
  });

  it('has all category strings', () => {
    const categories = ['View', 'Editor', 'File', 'Search', 'LSP', 'Git', 'Terminal', 'Chat', 'Voice', 'System'];
    for (const cat of categories) {
      assert.ok(commandsSrc.includes(cat), `Should have category '${cat}'`);
    }
  });

  it('has git.nextChangedFile command', () => {
    assert.ok(commandsSrc.includes('git.nextChangedFile'), 'Should register git.nextChangedFile command');
  });

  it('has git.prevChangedFile command', () => {
    assert.ok(commandsSrc.includes('git.prevChangedFile'), 'Should register git.prevChangedFile command');
  });

  it('git.nextChangedFile has Alt+F5 keybinding', () => {
    assert.ok(commandsSrc.includes("'Alt+F5'"), 'git.nextChangedFile should have Alt+F5 keybinding');
  });

  it('git.prevChangedFile has Shift+Alt+F5 keybinding', () => {
    assert.ok(commandsSrc.includes("'Shift+Alt+F5'"), 'git.prevChangedFile should have Shift+Alt+F5 keybinding');
  });

  it('git.nextChangedFile dispatches command:next-diff-file event', () => {
    assert.ok(commandsSrc.includes("'command:next-diff-file'"), 'git.nextChangedFile should dispatch command:next-diff-file');
  });

  it('git.prevChangedFile dispatches command:prev-diff-file event', () => {
    assert.ok(commandsSrc.includes("'command:prev-diff-file'"), 'git.prevChangedFile should dispatch command:prev-diff-file');
  });
});

// ── CommandPalette.svelte ───────────────────────────────────────────────────

describe('CommandPalette.svelte', () => {
  const paletteSrc = readFile(LENS_DIR, 'CommandPalette.svelte');

  it('imports commandRegistry from commands.svelte.js', () => {
    assert.ok(paletteSrc.includes('commandRegistry'), 'Should import commandRegistry');
    assert.ok(paletteSrc.includes('commands.svelte.js') || paletteSrc.includes('commands.svelte'), 'Should import from commands.svelte.js');
  });

  it('has initialMode prop', () => {
    assert.ok(paletteSrc.includes('initialMode'), 'Should have initialMode prop for opening mode');
  });

  it('detects > prefix for command mode', () => {
    assert.ok(paletteSrc.includes('>'), 'Should contain > prefix detection for command mode');
  });

  it('detects : prefix for go-to-line mode', () => {
    // Look for colon prefix detection logic
    assert.match(paletteSrc, /['"]:['"]|startsWith\s*\(\s*['"]:['"]|=== ?['"]:/, 'Should detect : prefix for go-to-line mode');
  });

  it('detects @ prefix for go-to-symbol mode', () => {
    assert.ok(paletteSrc.includes('@'), 'Should contain @ prefix detection for go-to-symbol mode');
  });

  it('imports lspRequestDocumentSymbols from api.js', () => {
    assert.ok(paletteSrc.includes('lspRequestDocumentSymbols'), 'Should import lspRequestDocumentSymbols for symbol mode');
  });

  it('dispatches lens-goto-position for go-to-line and symbol modes', () => {
    assert.ok(paletteSrc.includes('lens-goto-position'), 'Should dispatch lens-goto-position event for line/symbol jumps');
  });

  it('has MRU / recently used rendering via command registry', () => {
    // "recently used" category string lives in commands.svelte.js (the registry's getAll()),
    // and the palette renders it dynamically via {item.label} in category headers.
    const cmdsSrc = readFile(LIB_DIR, 'commands.svelte.js');
    assert.ok(
      cmdsSrc.includes('recently used'),
      'Command registry should have "recently used" category for MRU group'
    );
    assert.ok(
      paletteSrc.includes('category-header') && paletteSrc.includes('{item.label}'),
      'Palette should render category headers with item.label (which includes MRU)'
    );
  });

  it('has category header rendering', () => {
    assert.ok(
      paletteSrc.includes('category') || paletteSrc.includes('Category'),
      'Should have category header rendering for grouped commands'
    );
  });

  it('imports editorGroupsStore for focused group ID', () => {
    assert.ok(paletteSrc.includes('editorGroupsStore') || paletteSrc.includes('editorGroups'), 'Should import editorGroupsStore for focused group context');
  });
});

// ── shortcuts.svelte.js ─────────────────────────────────────────────────────

describe('shortcuts.svelte.js — new palette shortcuts', () => {
  const shortcutsSrc = readFile(STORES_DIR, 'shortcuts.svelte.js');

  it('has go-to-file in IN_APP_SHORTCUTS', () => {
    assert.ok(shortcutsSrc.includes('go-to-file'), 'Should have go-to-file shortcut');
  });

  it('has go-to-line in IN_APP_SHORTCUTS', () => {
    assert.ok(shortcutsSrc.includes('go-to-line'), 'Should have go-to-line shortcut');
  });

  it('has go-to-symbol in IN_APP_SHORTCUTS', () => {
    assert.ok(shortcutsSrc.includes('go-to-symbol'), 'Should have go-to-symbol shortcut');
  });

  it('go-to-file has keys Ctrl+P', () => {
    // The shortcut definition should associate go-to-file with Ctrl+P
    const goToFileIdx = shortcutsSrc.indexOf('go-to-file');
    assert.ok(goToFileIdx !== -1, 'Should have go-to-file');
    // Check nearby context for Ctrl+P
    const nearbyChunk = shortcutsSrc.substring(goToFileIdx, goToFileIdx + 200);
    assert.ok(nearbyChunk.includes('Ctrl+P'), 'go-to-file should have keys Ctrl+P');
  });

  it('go-to-line has keys Ctrl+G', () => {
    const goToLineIdx = shortcutsSrc.indexOf('go-to-line');
    assert.ok(goToLineIdx !== -1, 'Should have go-to-line');
    const nearbyChunk = shortcutsSrc.substring(goToLineIdx, goToLineIdx + 200);
    assert.ok(nearbyChunk.includes('Ctrl+G'), 'go-to-line should have keys Ctrl+G');
  });

  it('go-to-symbol has keys Ctrl+Shift+O', () => {
    const goToSymbolIdx = shortcutsSrc.indexOf('go-to-symbol');
    assert.ok(goToSymbolIdx !== -1, 'Should have go-to-symbol');
    const nearbyChunk = shortcutsSrc.substring(goToSymbolIdx, goToSymbolIdx + 200);
    assert.ok(nearbyChunk.includes('Ctrl+Shift+O'), 'go-to-symbol should have keys Ctrl+Shift+O');
  });
});

// ── App.svelte ──────────────────────────────────────────────────────────────

describe('App.svelte — command palette wiring', () => {
  const appSrc = fs.readFileSync(APP_FILE, 'utf-8');

  it('has commandPaletteMode state', () => {
    assert.ok(appSrc.includes('commandPaletteMode'), 'Should have commandPaletteMode state variable');
  });

  it('passes initialMode to CommandPalette', () => {
    assert.ok(appSrc.includes('initialMode'), 'Should pass initialMode prop to CommandPalette');
  });

  it('sets action handler for go-to-file', () => {
    assert.ok(appSrc.includes('go-to-file'), 'Should set action handler for go-to-file');
  });

  it('sets action handler for go-to-line', () => {
    assert.ok(appSrc.includes('go-to-line'), 'Should set action handler for go-to-line');
  });

  it('sets action handler for go-to-symbol', () => {
    assert.ok(appSrc.includes('go-to-symbol'), 'Should set action handler for go-to-symbol');
  });
});

// ── FileEditor.svelte ───────────────────────────────────────────────────────

describe('FileEditor.svelte — command event listeners', () => {
  const editorSrc = readFile(LENS_DIR, 'FileEditor.svelte');

  it('listens for command:save event', () => {
    assert.ok(editorSrc.includes('command:save'), 'Should listen for command:save event from command registry');
  });

  it('listens for command:format event', () => {
    assert.ok(editorSrc.includes('command:format'), 'Should listen for command:format event from command registry');
  });

  it('has removeEventListener for command:save', () => {
    // Cleanup is important — count occurrences to ensure both add and remove
    const matches = editorSrc.match(/command:save/g);
    assert.ok(matches && matches.length >= 2, 'Should have at least 2 occurrences of command:save (addEventListener + removeEventListener)');
  });

  it('has removeEventListener for command:format', () => {
    const matches = editorSrc.match(/command:format/g);
    assert.ok(matches && matches.length >= 2, 'Should have at least 2 occurrences of command:format (addEventListener + removeEventListener)');
  });
});
