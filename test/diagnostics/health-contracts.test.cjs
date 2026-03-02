const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/health-contracts.js'), 'utf-8'
);
const appSrc = fs.readFileSync(
  path.join(__dirname, '../../src/App.svelte'), 'utf-8'
);

describe('health-contracts.js -- contract definitions', () => {
  it('exports registerAllContracts function', () => {
    assert.ok(src.includes('registerAllContracts'), 'Should export registerAllContracts');
  });

  it('defines LSP health contract', () => {
    assert.ok(src.includes("'lsp'") && src.includes('check'), 'Should have LSP contract');
  });

  it('defines terminal health contract', () => {
    assert.ok(src.includes("'terminal'") && src.includes('check'), 'Should have terminal contract');
  });

  it('defines file-watcher health contract', () => {
    assert.ok(src.includes("'file-watcher'") && src.includes('check'), 'Should have file-watcher contract');
  });

  it('defines dev-server health contract', () => {
    assert.ok(src.includes("'dev-server'") && src.includes('check'), 'Should have dev-server contract');
  });

  it('defines editor health contract', () => {
    assert.ok(src.includes("'editor'") && src.includes('check'), 'Should have editor contract');
  });

  it('imports diagnosticsStore for registration', () => {
    assert.ok(src.includes('diagnosticsStore'), 'Should import diagnosticsStore');
  });

  it('accepts deps parameter with getter functions', () => {
    assert.ok(src.includes('deps.getProjectPath'), 'Should use getProjectPath dep');
    assert.ok(src.includes('deps.getOpenTabs'), 'Should use getOpenTabs dep');
    assert.ok(src.includes('deps.getTerminalGroups'), 'Should use getTerminalGroups dep');
    assert.ok(src.includes('deps.getLspStatus'), 'Should use getLspStatus dep');
    assert.ok(src.includes('deps.getDevServers'), 'Should use getDevServers dep');
  });

  it('checks terminal instance running state', () => {
    assert.ok(src.includes('inst.running'), 'Should check instance running flag');
  });

  it('checks editor tab dirty state', () => {
    assert.ok(src.includes('t.dirty'), 'Should check tab dirty flag');
  });

  it('checks dev server crashed servers', () => {
    assert.ok(src.includes('crashedServers'), 'Should check for crashed servers');
  });
});

describe('App.svelte -- diagnostics wiring', () => {
  it('imports diagnosticsStore', () => {
    assert.ok(appSrc.includes('diagnosticsStore'), 'Should import diagnosticsStore');
  });

  it('imports registerAllContracts', () => {
    assert.ok(appSrc.includes('registerAllContracts'), 'Should import registerAllContracts');
  });

  it('calls startMonitoring', () => {
    assert.ok(appSrc.includes('startMonitoring'), 'Should call startMonitoring');
  });

  it('calls registerAllContracts with deps object', () => {
    assert.ok(appSrc.includes('registerAllContracts('), 'Should call registerAllContracts');
  });

  it('imports tabsStore for editor contract', () => {
    assert.ok(appSrc.includes("tabsStore"), 'Should import tabsStore');
  });

  it('imports terminalTabsStore for terminal contract', () => {
    assert.ok(appSrc.includes("terminalTabsStore"), 'Should import terminalTabsStore');
  });

  it('imports devServerManager for dev-server contract', () => {
    assert.ok(appSrc.includes("devServerManager"), 'Should import devServerManager');
  });

  it('passes projectStore root for project path', () => {
    assert.ok(appSrc.includes('projectStore.root'), 'Should read root from projectStore');
  });
});
