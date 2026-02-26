const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/ShellTerminal.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('ShellTerminal.svelte -- imports', () => {
  it('imports ghostty-web Terminal and FitAddon', () => {
    assert.ok(src.includes("import { init, Terminal, FitAddon } from 'ghostty-web'"), 'Should import ghostty-web');
  });

  it('imports shellInput from api', () => {
    assert.ok(src.includes('shellInput'), 'Should import shellInput');
  });

  it('imports shellResize from api', () => {
    assert.ok(src.includes('shellResize'), 'Should import shellResize');
  });

  it('imports listen from tauri events', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"), 'Should import tauri events');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports devServerManager for crash detection', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
    assert.ok(src.includes('dev-server-manager.svelte.js'), 'Should import from dev-server-manager store');
  });
});

describe('ShellTerminal.svelte -- crash detection wiring', () => {
  it('calls devServerManager.handleShellExit on exit event', () => {
    const exitBlock = src.split("case 'exit':")[1]?.split('break')[0] || '';
    assert.ok(exitBlock.includes('devServerManager.handleShellExit(shellId, data.code)'), 'Should call handleShellExit with shellId and exit code');
  });

  it('calls handleShellExit after markExited', () => {
    const exitBlock = src.split("case 'exit':")[1]?.split('break')[0] || '';
    const markIdx = exitBlock.indexOf('markExited');
    const handleIdx = exitBlock.indexOf('handleShellExit');
    assert.ok(markIdx > -1 && handleIdx > -1, 'Should have both calls');
    assert.ok(markIdx < handleIdx, 'markExited should be called before handleShellExit');
  });
});

describe('ShellTerminal.svelte -- props', () => {
  it('accepts shellId prop', () => {
    assert.ok(src.includes('shellId'), 'Should accept shellId prop');
  });

  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should accept visible prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });
});

describe('ShellTerminal.svelte -- event handling', () => {
  it('listens to shell-output event', () => {
    assert.ok(src.includes("'shell-output'"), 'Should listen to shell-output');
  });

  it('filters events by shellId', () => {
    assert.ok(src.includes('data.id !== shellId'), 'Should filter by shellId');
  });

  it('calls markExited on exit event', () => {
    assert.ok(src.includes('markExited'), 'Should call markExited');
  });

  it('sends input via shellInput', () => {
    assert.ok(src.includes('shellInput(shellId'), 'Should call shellInput with shellId');
  });

  it('sends resize via shellResize', () => {
    assert.ok(src.includes('shellResize(shellId'), 'Should call shellResize with shellId');
  });
});

describe('ShellTerminal.svelte -- terminal setup', () => {
  it('initializes ghostty-web with init()', () => {
    assert.ok(src.includes('await init()'), 'Should initialize WASM');
  });

  it('creates Terminal instance', () => {
    assert.ok(src.includes('new Terminal('), 'Should create Terminal');
  });

  it('creates FitAddon', () => {
    assert.ok(src.includes('new FitAddon()'), 'Should create FitAddon');
  });

  it('enables cursor blink for shell', () => {
    assert.ok(src.includes('cursorBlink: true'), 'Should enable cursor blink');
  });

  it('has ResizeObserver', () => {
    assert.ok(src.includes('ResizeObserver'), 'Should observe resize');
  });
});

describe('ShellTerminal.svelte -- toolbar', () => {
  it('has clear button', () => {
    assert.ok(src.includes('handleClear'), 'Should have clear handler');
  });

  it('has copy button', () => {
    assert.ok(src.includes('handleCopy'), 'Should have copy handler');
  });

  it('has paste button', () => {
    assert.ok(src.includes('handlePaste'), 'Should have paste handler');
  });
});

describe('ShellTerminal.svelte -- visibility', () => {
  it('re-fits on visible change', () => {
    assert.ok(src.includes('if (visible && fitAddon && term)'), 'Should re-fit when visible');
  });
});

describe('ShellTerminal.svelte -- CSS', () => {
  it('has shell-terminal-view class', () => {
    assert.ok(src.includes('shell-terminal-view'), 'Should have view class');
  });

  it('has shell-terminal-container class', () => {
    assert.ok(src.includes('shell-terminal-container'), 'Should have container class');
  });

  it('uses contain strict', () => {
    assert.ok(src.includes('contain: strict'), 'Should use contain strict');
  });
});
