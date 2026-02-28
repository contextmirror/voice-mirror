const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/LspTab.svelte'), 'utf-8'
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/api.js'), 'utf-8'
);
const cmdSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/commands/lsp.rs'), 'utf-8'
);

describe('LspTab.svelte: management panel', () => {
  it('shows server state (not just running bool)', () => {
    assert.ok(src.includes('server.state'), 'Should display server.state');
  });
  it('has restart button', () => {
    assert.ok(src.includes('Restart'), 'Should have Restart button');
  });
  it('has stop button', () => {
    assert.ok(src.includes('Stop'), 'Should have Stop button');
  });
  it('shows crash count when > 0', () => {
    assert.ok(src.includes('crashCount') || src.includes('crash_count'),
      'Should display crash count');
  });
  it('shows server version', () => {
    assert.ok(src.includes('version'), 'Should display server version');
  });
  it('shows project root', () => {
    assert.ok(src.includes('projectRoot') || src.includes('project'),
      'Should display project root');
  });
  it('has install button for uninstalled servers', () => {
    assert.ok(src.includes('Install'), 'Should have Install button');
  });
  it('has expandable detail section', () => {
    assert.ok(src.includes('detail') || src.includes('expand'),
      'Should have expandable detail section');
  });
  it('has restart all button', () => {
    assert.ok(src.includes('Restart All') || src.includes('restartAll'),
      'Should have Restart All button');
  });
  it('imports lspRestartServer', () => {
    assert.ok(src.includes('lspRestartServer'), 'Should import lspRestartServer');
  });
  it('imports lspGetServerList', () => {
    assert.ok(src.includes('lspGetServerList'), 'Should import lspGetServerList');
  });
  it('imports lspInstallServer', () => {
    assert.ok(src.includes('lspInstallServer'), 'Should import lspInstallServer');
  });
  it('listens to lsp-server-status event', () => {
    assert.ok(src.includes('lsp-server-status'), 'Should listen to lsp-server-status');
  });
  it('listens to lsp-install-status event', () => {
    assert.ok(src.includes('lsp-install-status'), 'Should listen to lsp-install-status');
  });
  it('shows stderr lines in detail', () => {
    assert.ok(src.includes('stderrLines'), 'Should display stderr lines');
  });
  it('shows PID in detail', () => {
    assert.ok(src.includes('server.pid'), 'Should display server PID');
  });
  it('color-codes dot by state', () => {
    assert.ok(src.includes('dotClass'), 'Should have dotClass function for state-to-color mapping');
  });
});

describe('api.js: LSP management wrappers', () => {
  it('has lspRestartServer function', () => {
    assert.ok(apiSrc.includes('lspRestartServer'));
  });
  it('has lspGetServerDetail function', () => {
    assert.ok(apiSrc.includes('lspGetServerDetail'));
  });
  it('lspRestartServer invokes correct command', () => {
    assert.ok(apiSrc.includes("invoke('lsp_restart_server'"), 'Should invoke lsp_restart_server');
  });
  it('lspGetServerDetail invokes correct command', () => {
    assert.ok(apiSrc.includes("invoke('lsp_get_server_detail'"), 'Should invoke lsp_get_server_detail');
  });
});

describe('commands/lsp.rs: management commands', () => {
  it('has lsp_restart_server command', () => {
    assert.ok(cmdSrc.includes('lsp_restart_server'));
  });
  it('has lsp_get_server_detail command', () => {
    assert.ok(cmdSrc.includes('lsp_get_server_detail'));
  });
  it('lsp_restart_server calls shutdown_server then ensure_server', () => {
    assert.ok(cmdSrc.includes('shutdown_server'), 'Should call shutdown_server');
    assert.ok(cmdSrc.includes('ensure_server'), 'Should call ensure_server');
  });
  it('lsp_get_server_detail returns stderr_lines', () => {
    assert.ok(cmdSrc.includes('stderrLines') || cmdSrc.includes('stderr_lines'),
      'Should return stderr lines');
  });
  it('lsp_get_server_detail returns crash_count', () => {
    assert.ok(cmdSrc.includes('crashCount') || cmdSrc.includes('crash_count'),
      'Should return crash count');
  });
  it('lsp_get_server_detail returns open docs', () => {
    assert.ok(cmdSrc.includes('openDocs') || cmdSrc.includes('open_docs'),
      'Should return open docs');
  });
});
