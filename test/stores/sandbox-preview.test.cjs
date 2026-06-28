/**
 * sandbox-preview.test.cjs -- Source-inspection tests for sandbox-preview.svelte.js
 *
 * Validates the live-preview store that drives the SandboxPreview panel: exports,
 * factory, $state shape, open/close lifecycle, and that it backs onto the
 * sandbox_stream MJPEG screencast via the api wrappers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'sandbox-preview.svelte.js'),
  'utf-8'
);

describe('sandbox-preview: exports', () => {
  it('exports sandboxPreviewStore', () => {
    assert.ok(src.includes('export const sandboxPreviewStore'), 'Should export sandboxPreviewStore');
  });

  it('creates the store via a factory', () => {
    assert.ok(src.includes('function createSandboxPreviewStore()'), 'Should define the factory');
  });
});

describe('sandbox-preview: integration', () => {
  it('starts/stops the screencast via the api wrappers', () => {
    assert.ok(src.includes('sandboxStreamStart'), 'Should call sandboxStreamStart');
    assert.ok(src.includes('sandboxStreamStop'), 'Should call sandboxStreamStop');
  });

  it('lists app windows for the switcher / auto-follow', () => {
    assert.ok(src.includes('sandboxListWindows'), 'Should call sandboxListWindows');
  });

  it('unwraps the IpcResponse to get the stream url', () => {
    assert.ok(src.includes('unwrapResult'), 'Should unwrap the response');
    assert.ok(src.includes('data?.url') || src.includes('data.url'), 'Should read the stream url');
  });
});

describe('sandbox-preview: state', () => {
  for (const field of ['active', 'visible', 'maximized', 'cdpPort', 'streamUrl', 'loading', 'error']) {
    it(`uses $state for ${field}`, () => {
      assert.ok(
        new RegExp(`let\\s+${field}\\s*=\\s*\\$state\\(`).test(src),
        `Should use $state for ${field}`
      );
    });
  }

  for (const getter of ['active', 'visible', 'maximized', 'cdpPort', 'streamUrl', 'loading', 'error']) {
    it(`has getter ${getter}`, () => {
      assert.ok(src.includes(`get ${getter}()`), `Should expose getter ${getter}`);
    });
  }
});

describe('sandbox-preview: maximize layout', () => {
  it('defaults maximized to true so the preview opens big, not crammed', () => {
    assert.ok(
      /let\s+maximized\s*=\s*\$state\(true\)/.test(src),
      'maximized should default to true'
    );
  });

  it('exposes a toggleMaximize() method', () => {
    assert.ok(/toggleMaximize\(\)\s*\{/.test(src), 'Should expose toggleMaximize()');
    const block = src.split('toggleMaximize()')[1]?.split('},')[0] || '';
    assert.ok(block.includes('maximized = !maximized'), 'toggleMaximize should flip maximized');
  });

  it('exposes a setMaximized(value) setter', () => {
    assert.ok(/setMaximized\(value\)\s*\{/.test(src), 'Should expose setMaximized(value)');
  });

  it('opening a new session resets to maximized', () => {
    const block = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(block.includes('maximized = true'), 'open() should set maximized = true for a new session');
  });
});

describe('sandbox-preview: lifecycle', () => {
  it('has open/show/hide/close methods', () => {
    assert.ok(/async open\(port/.test(src), 'Should have async open(port, ...)');
    assert.ok(/show\(\)/.test(src), 'Should have show()');
    assert.ok(/hide\(\)/.test(src), 'Should have hide()');
    assert.ok(/close\(\)\s*\{/.test(src), 'Should have close()');
  });

  it('open is idempotent per port', () => {
    const block = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(
      block.includes('cdpPort === port'),
      'open should no-op when already active on the same port'
    );
  });

  it('hide keeps the session (does not stop the screencast)', () => {
    const block = src.split('hide()')[1]?.split('switchTo(')[0] || '';
    assert.ok(!block.includes('sandboxStreamStop'), 'hide should NOT stop the screencast');
    assert.ok(block.includes('visible = false'), 'hide should just clear visibility');
  });

  it('close stops the screencast for the current port', () => {
    // Inspect the close() METHOD body (the last `close()` — syncAuto also calls
    // `this.close()`), which must stop the screencast.
    const block = src.slice(src.lastIndexOf('close()'));
    assert.ok(block.includes('sandboxStreamStop'), 'close should stop the screencast');
  });
});

describe('sandbox-preview: auto-open guard (remount-proof)', () => {
  it('keeps the auto-open dedupe guard in the store (not the component)', () => {
    assert.ok(src.includes('lastAutoPort'), 'Should track lastAutoPort in the store');
    assert.ok(/syncAuto\(port\)/.test(src), 'Should expose syncAuto(port)');
  });

  it('respects an explicit user-hide', () => {
    assert.ok(src.includes('userHidden'), 'Should track userHidden');
  });

  it('does not tear down an attached external app on auto-sync', () => {
    assert.ok(src.includes('attached'), 'Should track attached sessions');
  });
});

describe('sandbox-preview: closed-window recovery', () => {
  it('tracks a noWindow empty-state flag in $state with a getter', () => {
    assert.ok(
      /let\s+noWindow\s*=\s*\$state\(false\)/.test(src),
      'Should hold noWindow in $state(false)'
    );
    assert.ok(src.includes('get noWindow()'), 'Should expose a noWindow getter');
  });

  it('prefers re-targeting to a VISIBLE window when the followed one closes', () => {
    // The retarget block filters the live window list by the backend `visible`
    // flag and starts the stream on a surviving window.
    assert.ok(src.includes('w.visible'), 'Should filter windows by the visible flag');
    assert.ok(
      /startStream\(visible\[0\]\.hwnd\)/.test(src),
      'Should re-target to the first visible window'
    );
  });

  it('sets noWindow (not an endless spinner) when nothing is mirrorable', () => {
    assert.ok(/noWindow\s*=\s*true/.test(src), 'Should set noWindow = true when no visible window');
  });

  it('clears noWindow when a window is shown / on open / on show', () => {
    assert.ok(/noWindow\s*=\s*false/.test(src), 'Should reset noWindow = false somewhere');
    const openBlock = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(openBlock.includes('noWindow = false'), 'open() should clear noWindow');
  });

  it('exposes an async openApp() that re-launches via sandbox-start-request', () => {
    assert.ok(/async openApp\(\)/.test(src), 'Should expose async openApp()');
    assert.ok(
      src.includes("emit('sandbox-start-request'") || src.includes('emit("sandbox-start-request"'),
      'openApp should emit sandbox-start-request'
    );
    assert.ok(
      src.includes("from '@tauri-apps/api/event'"),
      'Should import emit from @tauri-apps/api/event'
    );
  });
});

describe('sandbox-preview: multi-window', () => {
  it('tracks the window list and current window', () => {
    assert.ok(/let\s+windows\s*=\s*\$state\(/.test(src), 'Should hold a windows list in $state');
    assert.ok(/let\s+currentHwnd\s*=\s*\$state\(/.test(src), 'Should track currentHwnd in $state');
    assert.ok(src.includes('get windows()'), 'Should expose a windows getter');
    assert.ok(src.includes('get currentHwnd()'), 'Should expose a currentHwnd getter');
  });

  it('has a switchTo(hwnd) method', () => {
    assert.ok(/switchTo\(hwnd\)/.test(src), 'Should expose switchTo(hwnd)');
  });

  it('follows the window Claude is driving (active-window model)', () => {
    assert.ok(src.includes('setInterval'), 'Should poll on an interval');
    assert.ok(src.includes('refreshWindows'), 'Should have a refreshWindows loop');
    // Unified model: mirror whatever window Claude's snapshot published as active.
    assert.ok(
      src.includes('sandboxActiveHwnd') && src.includes('startStream('),
      'Should follow the active window (sandbox_active_hwnd) by re-targeting the stream',
    );
    // Manual switcher choice pins the view so it stops auto-following.
    assert.ok(src.includes('userPinned'), 'Switcher choice should pin via userPinned');
  });
});
