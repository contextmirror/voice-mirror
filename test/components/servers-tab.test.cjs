const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/ServersTab.svelte'), 'utf-8');

describe('ServersTab', () => {
  // ── Imports ──

  it('imports from lens.svelte.js store', () => {
    assert.ok(src.includes('lens.svelte.js'));
  });

  it('imports from project.svelte.js store', () => {
    assert.ok(src.includes('project.svelte.js'));
  });

  it('imports from ai-status.svelte.js store', () => {
    assert.ok(src.includes('ai-status.svelte.js'));
  });

  it('imports detectDevServers from api', () => {
    assert.ok(src.includes('detectDevServers'));
  });

  it('imports probePort from api', () => {
    assert.ok(src.includes('probePort'));
  });

  it('imports lensNavigate from api', () => {
    assert.ok(src.includes('lensNavigate'));
  });

  it('imports onMount from svelte', () => {
    assert.ok(src.includes("from 'svelte'") || src.includes('from "svelte"'));
    assert.ok(src.includes('onMount'));
  });

  // ── Reactive state ──

  it('derives servers from lensStore.devServers', () => {
    assert.ok(src.includes('lensStore.devServers'));
  });

  it('derives loading from lensStore.devServerLoading', () => {
    assert.ok(src.includes('lensStore.devServerLoading'));
  });

  it('accepts onManage prop', () => {
    assert.ok(src.includes('onManage'));
  });

  // ── Provider row ──

  it('shows provider name from aiStatusStore', () => {
    assert.ok(src.includes('providerName'));
    assert.ok(src.includes('aiStatusStore.displayName'));
  });

  it('shows provider type (CLI/API/Dictation)', () => {
    assert.ok(src.includes('providerType'));
    assert.ok(src.includes('CLI / PTY'));
  });

  it('shows provider status dot with ok/stopped/starting classes', () => {
    assert.ok(src.includes('class:ok={healthy}'));
    assert.ok(src.includes('class:starting={aiStatusStore.starting}'));
  });

  // ── Server list rendering ──

  it('shows loading state while detecting', () => {
    assert.ok(src.includes('Detecting dev servers'));
    assert.ok(src.includes('status-loading'));
  });

  it('shows empty state when no servers detected', () => {
    assert.ok(src.includes('No dev servers detected'));
    assert.ok(src.includes('status-empty'));
  });

  it('iterates servers with each block', () => {
    assert.ok(src.includes('{#each servers as server}'));
  });

  it('shows server framework name', () => {
    assert.ok(src.includes('server.framework'));
  });

  it('shows server port', () => {
    assert.ok(src.includes('server.port'));
  });

  it('shows detection source', () => {
    assert.ok(src.includes('server.source'));
    assert.ok(src.includes('server-source'));
  });

  it('shows status dot with state-based classes', () => {
    assert.ok(src.includes("class:ok={state.status === 'running'}"));
    assert.ok(src.includes("class:starting={state.status === 'starting'}"));
    assert.ok(src.includes("class:danger={state.status === 'crashed'}"));
  });

  it('has Open in Browser button for running servers', () => {
    assert.ok(src.includes('Open in Browser'));
    assert.ok(src.includes('open-btn'));
  });

  it('shows Open in Browser when server is running', () => {
    assert.ok(src.includes("state.status === 'running'"));
  });

  // ── Detection + polling ──

  it('runs detection on mount', () => {
    assert.ok(src.includes('onMount'));
    assert.ok(src.includes('runDetection'));
  });

  it('polls port status every 5 seconds', () => {
    assert.ok(src.includes('setInterval'));
    assert.ok(src.includes('5000'));
  });

  it('guards port polling with server count check', () => {
    assert.ok(src.includes('lensStore.devServers.length > 0'), 'Should only poll when servers exist');
  });

  it('clears poll interval on unmount', () => {
    assert.ok(src.includes('clearInterval'));
  });

  it('calls probePort for each server during poll', () => {
    assert.ok(src.includes('probePort(server.port)') || src.includes('probePort'));
  });

  it('calls detectDevServers with project path', () => {
    assert.ok(src.includes('detectDevServers(project.path)') || src.includes('detectDevServers'));
  });

  // ── Navigate action ──

  it('calls lensNavigate when Open in Browser is clicked', () => {
    assert.ok(src.includes('openInBrowser'));
    assert.ok(src.includes('lensNavigate'));
  });

  // ── Manage button ──

  it('has manage servers button', () => {
    assert.ok(src.includes('Manage servers'));
    assert.ok(src.includes('manage-btn'));
  });

  // ── Styles ──

  it('uses design token --ok for running dots', () => {
    assert.ok(src.includes('var(--ok)'));
  });

  it('uses design token --muted for stopped dots', () => {
    assert.ok(src.includes('var(--muted)'));
  });

  it('uses design token --warn for starting dots', () => {
    assert.ok(src.includes('var(--warn)'));
  });

  it('has -webkit-app-region: no-drag on interactive elements', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'));
  });

  it('uses design token --danger for crashed dots', () => {
    assert.ok(src.includes('var(--danger)'));
  });
});

// ── devServerManager integration ──

describe('ServersTab devServerManager integration', () => {
  it('imports devServerManager from dev-server-manager store', () => {
    assert.ok(src.includes('devServerManager'));
    assert.ok(src.includes('dev-server-manager.svelte.js'));
  });

  it('has getServerState helper function', () => {
    assert.ok(src.includes('function getServerState(server)'));
  });

  it('calls devServerManager.getServerStatus for status', () => {
    assert.ok(src.includes('devServerManager.getServerStatus'));
  });

  it('has Start button for stopped servers', () => {
    assert.ok(src.includes('start-btn'));
    assert.ok(src.includes('handleStart'));
  });

  it('has Stop button for running servers', () => {
    assert.ok(src.includes('stop-btn'));
    assert.ok(src.includes('handleStop'));
  });

  it('has Restart button for crashed servers', () => {
    assert.ok(src.includes('restart-btn'));
    assert.ok(src.includes('handleRestart'));
  });

  it('has Starting... button with disabled state', () => {
    assert.ok(src.includes('starting-btn'));
    assert.ok(src.includes('Starting...'));
    assert.ok(src.includes('disabled'));
  });

  it('has idle badge for idle servers', () => {
    assert.ok(src.includes('idle-badge'));
    assert.ok(src.includes('(idle)'));
  });

  it('has idle stop button for idle servers', () => {
    assert.ok(src.includes('idle-stop-btn'));
  });

  it('shows crash loop warning when crashLoopDetected', () => {
    assert.ok(src.includes('crash-loop-warning'));
    assert.ok(src.includes('Crash loop'));
    assert.ok(src.includes('crashLoopDetected'));
  });

  it('calls devServerManager.startServer in handleStart', () => {
    assert.ok(src.includes('devServerManager.startServer(server, project.path'));
  });

  it('calls devServerManager.stopServer in handleStop', () => {
    assert.ok(src.includes('devServerManager.stopServer(project.path)'));
  });

  it('calls devServerManager.restartServer in handleRestart', () => {
    assert.ok(src.includes('devServerManager.restartServer(project.path)'));
  });

  it('stores detected package manager from detection result', () => {
    assert.ok(src.includes('detectedPackageManager'));
    assert.ok(src.includes('data.packageManager'));
  });

  it('uses @const for server state in template', () => {
    assert.ok(src.includes('{@const state = getServerState(server)}'));
  });

  it('checks status values: stopped, starting, running, crashed, idle', () => {
    assert.ok(src.includes("state.status === 'stopped'"));
    assert.ok(src.includes("state.status === 'starting'"));
    assert.ok(src.includes("state.status === 'running'"));
    assert.ok(src.includes("state.status === 'crashed'"));
    assert.ok(src.includes("state.status === 'idle'"));
  });

  it('has starting dot animation element', () => {
    assert.ok(src.includes('starting-dot'));
  });
});

// ── StatusDropdown integration ──

const dropdownSrc = fs.readFileSync(path.join(__dirname, '../../src/components/lens/StatusDropdown.svelte'), 'utf-8');

describe('StatusDropdown dev server integration', () => {
  it('imports lensStore for dev server data', () => {
    assert.ok(dropdownSrc.includes('lensStore'));
  });

  it('derives devServers from lensStore', () => {
    assert.ok(dropdownSrc.includes('lensStore.devServers'));
  });

  it('computes serverCount from provider + devServers.length', () => {
    assert.ok(dropdownSrc.includes('devServers.length'));
  });

  it('iterates filteredServers in manage view (search-filtered)', () => {
    assert.ok(dropdownSrc.includes('{#each filteredServers as server}'));
  });

  it('shows server.framework in manage row', () => {
    assert.ok(dropdownSrc.includes('server.framework'));
  });

  it('shows server.port in manage row', () => {
    assert.ok(dropdownSrc.includes('server.port'));
  });

  it('shows server running status in manage row', () => {
    assert.ok(dropdownSrc.includes('class:ok={server.running}'));
  });
});
