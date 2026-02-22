/**
 * lens-components.test.js -- Source-inspection tests for Lens components
 *
 * Validates imports, structure, and key elements of LensPanel, LensToolbar,
 * and LensPreview by reading source files and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LENS_DIR = path.join(__dirname, '../../src/components/lens');

function readComponent(name) {
  return fs.readFileSync(path.join(LENS_DIR, name), 'utf-8');
}

// ============ LensPanel ============

describe('LensPanel.svelte', () => {
  const src = readComponent('LensPanel.svelte');

  it('imports LensToolbar', () => {
    assert.ok(src.includes("import LensToolbar from './LensToolbar.svelte'"));
  });

  it('imports LensPreview', () => {
    assert.ok(src.includes("import LensPreview from './LensPreview.svelte'"));
  });

  it('has lens-panel CSS class', () => {
    assert.ok(src.includes('.lens-panel'));
  });

  it('renders LensToolbar', () => {
    assert.ok(src.includes('<LensToolbar'));
  });

  it('renders LensPreview', () => {
    assert.ok(src.includes('<LensPreview'));
  });

  it('uses flex column layout', () => {
    assert.ok(src.includes('flex-direction: column'));
  });

  it('has height 100%', () => {
    assert.ok(src.includes('height: 100%'));
  });
});

// ============ LensToolbar ============

describe('LensToolbar.svelte', () => {
  const src = readComponent('LensToolbar.svelte');

  it('imports lensStore', () => {
    assert.ok(src.includes('import { lensStore }'));
  });

  it('has url-input element', () => {
    assert.ok(src.includes('url-input'));
  });

  it('has back button with aria-label', () => {
    assert.ok(src.includes('Go back'));
  });

  it('has forward button with aria-label', () => {
    assert.ok(src.includes('Go forward'));
  });

  it('has reload button with aria-label', () => {
    assert.ok(src.includes('Reload'));
  });

  it('has lens-toolbar CSS class', () => {
    assert.ok(src.includes('.lens-toolbar'));
  });

  it('has form with onsubmit', () => {
    assert.ok(src.includes('onsubmit'));
  });

  it('disables back when canGoBack is false', () => {
    assert.ok(src.includes('lensStore.canGoBack'));
  });

  it('disables forward when canGoForward is false', () => {
    assert.ok(src.includes('lensStore.canGoForward'));
  });

  it('binds url input value', () => {
    assert.ok(src.includes('bind:value'));
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'));
  });

  it('is a browser-only toolbar (no toggle props)', () => {
    assert.ok(!src.includes('showChat'), 'LensToolbar should not have showChat prop');
    assert.ok(!src.includes('showTerminal'), 'LensToolbar should not have showTerminal prop');
  });

  it('imports lensHardRefresh from api', () => {
    assert.ok(src.includes('lensHardRefresh'));
  });

  it('imports listen from tauri event', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"));
  });

  it('supports shift+click for hard refresh', () => {
    assert.ok(src.includes('event.shiftKey'));
  });

  it('listens for lens-hard-refresh event', () => {
    assert.ok(src.includes('lens-hard-refresh'));
  });

  it('has tooltip mentioning shift+click', () => {
    assert.ok(src.includes('Shift+click'));
  });
});

// ============ LensPreview ============

describe('LensPreview.svelte', () => {
  const src = readComponent('LensPreview.svelte');

  it('imports lensCreateWebview from api', () => {
    assert.ok(src.includes('lensCreateWebview'));
  });

  it('imports lensResizeWebview from api', () => {
    assert.ok(src.includes('lensResizeWebview'));
  });

  it('imports lensCloseWebview from api', () => {
    assert.ok(src.includes('lensCloseWebview'));
  });

  it('imports listen from tauri event', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"));
  });

  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'));
  });

  it('uses bind:this for container', () => {
    assert.ok(src.includes('bind:this={containerEl}'));
  });

  it('uses ResizeObserver for bounds syncing', () => {
    assert.ok(src.includes('ResizeObserver'));
  });

  it('uses getBoundingClientRect for position', () => {
    assert.ok(src.includes('getBoundingClientRect'));
  });

  it('has lens-preview CSS class', () => {
    assert.ok(src.includes('.lens-preview'));
  });

  it('has loading state display', () => {
    assert.ok(src.includes('webviewReady'));
  });

  it('listens for lens-url-changed event', () => {
    assert.ok(src.includes('lens-url-changed'));
  });

  it('cleans up webview on unmount', () => {
    // The cleanup function should call lensCloseWebview in onDestroy
    assert.ok(src.includes('lensCloseWebview'), 'Should close webview on cleanup');
    assert.ok(src.includes('onDestroy'), 'Should use onDestroy for cleanup');
  });

  it('uses onMount for lifecycle', () => {
    assert.ok(src.includes('onMount'), 'Should use onMount for setup');
  });

  it('retries webview creation on failure', () => {
    assert.ok(src.includes('MAX_RETRIES'), 'Should have retry limit');
    assert.ok(src.includes('scheduleRetry'), 'Should have retry scheduler');
    assert.ok(src.includes('RETRY_DELAY_MS'), 'Should have retry delay');
  });

  it('has loading timeout safety net', () => {
    assert.ok(src.includes('LOADING_TIMEOUT_MS'), 'Should have loading timeout');
    assert.ok(src.includes('startLoadingTimeout'), 'Should have timeout function');
  });

  it('throttles resize observer with rAF', () => {
    assert.ok(src.includes('requestAnimationFrame'), 'Should throttle resize with rAF');
  });

  // ---- Project-switch → browser navigation integration ----

  it('imports projectStore', () => {
    assert.ok(src.includes("import { projectStore }"), 'Should import projectStore');
    assert.ok(src.includes("project.svelte.js"), 'Should import from project.svelte.js');
  });

  it('imports detectDevServers from api', () => {
    assert.ok(src.includes('detectDevServers'), 'Should import detectDevServers');
  });

  it('watches projectStore.activeProject via $effect', () => {
    assert.ok(src.includes('projectStore.activeProject'), 'Should watch activeProject');
  });

  it('debounces project detection with 300ms timeout', () => {
    assert.ok(src.includes('300'), 'Should use 300ms debounce delay');
    assert.ok(src.includes('clearTimeout'), 'Should clear timeout on re-trigger');
  });

  it('has detectAndNavigate function', () => {
    assert.ok(src.includes('async function detectAndNavigate'), 'Should have detectAndNavigate');
  });

  it('sets devServerLoading during detection', () => {
    assert.ok(src.includes('setDevServerLoading(true)'), 'Should set loading true at start');
    assert.ok(src.includes('setDevServerLoading(false)'), 'Should set loading false in finally');
  });

  it('uses URL priority: preferred > running server > lastBrowserUrl', () => {
    assert.ok(src.includes('preferredServerUrl'), 'Should check preferredServerUrl first');
    assert.ok(src.includes('servers.find(s => s.running)'), 'Should check running servers');
    assert.ok(src.includes('lastBrowserUrl'), 'Should fall back to lastBrowserUrl');
  });

  it('saves lastBrowserUrl for outgoing project on switch', () => {
    assert.ok(src.includes('updateProjectField'), 'Should save URL for outgoing project');
    assert.ok(src.includes("'lastBrowserUrl'"), 'Should update lastBrowserUrl field');
  });

  it('guards detectAndNavigate on webviewReady', () => {
    const fnBlock = src.split('async function detectAndNavigate')[1]?.split('async function')[0] || '';
    assert.ok(fnBlock.includes('webviewReady'), 'Should check webviewReady before detection');
  });

  it('tracks lastDetectedProject to prevent re-runs', () => {
    assert.ok(src.includes('lastDetectedProject'), 'Should track last detected project path');
  });

  it('re-runs detection when switching back to a previously-visited project', () => {
    // The guard should compare path+index, not just path, so revisiting triggers detection
    assert.ok(
      src.includes('project.path === oldPath && currentIndex === oldIndex'),
      'Should only skip when both path AND index are unchanged'
    );
  });

  // ---- Auto-start dev server integration ----

  it('imports devServerManager from dev-server-manager store', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
    assert.ok(src.includes('dev-server-manager.svelte.js'), 'Should import from dev-server-manager.svelte.js');
  });

  it('imports toastStore for consent toast', () => {
    assert.ok(src.includes('toastStore'), 'Should import toastStore');
    assert.ok(src.includes('toast.svelte.js'), 'Should import from toast.svelte.js');
  });

  it('checks autoStartServer preference', () => {
    assert.ok(src.includes('autoStartServer'), 'Should check autoStartServer');
  });

  it('shows consent toast with multi-action when autoStartServer is null', () => {
    assert.ok(src.includes('actions:'), 'Should use actions array for toast');
    assert.ok(src.includes('Always start'), 'Should have Always start action');
    assert.ok(src.includes('Start once'), 'Should have Start once action');
    assert.ok(src.includes('Not now'), 'Should have Not now action');
  });

  it('calls updateActiveField to persist auto-start preference', () => {
    assert.ok(src.includes("updateActiveField('autoStartServer'"), 'Should persist autoStartServer');
  });

  it('calls devServerManager.startServer for auto-start', () => {
    assert.ok(src.includes('devServerManager.startServer'), 'Should call startServer');
  });

  it('auto-starts silently when autoStartServer is true', () => {
    assert.ok(src.includes('autoStart === true'), 'Should check for true preference');
  });

  it('stores packageManager from detection result', () => {
    assert.ok(src.includes('data.packageManager'), 'Should extract packageManager from detection');
  });

  it('finds first stopped server for auto-start logic', () => {
    assert.ok(src.includes('servers.find(s => !s.running)'), 'Should find stopped server');
  });
});
