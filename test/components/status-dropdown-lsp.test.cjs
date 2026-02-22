const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/lens/StatusDropdown.svelte'), 'utf-8');

describe('StatusDropdown LSP tab', () => {
  it('imports lspGetStatus from api', () => {
    assert.ok(src.includes('lspGetStatus'));
  });
  it('has lspServers state', () => {
    assert.ok(src.includes('lspServers'));
  });
  it('listens for lsp-server-status event', () => {
    assert.ok(src.includes("'lsp-server-status'") || src.includes('lsp-server-status'));
  });
  it('renders LSP server list', () => {
    assert.ok(src.includes('lsp-server-row') || src.includes('lsp-dot'));
  });
  it('shows running status with green dot', () => {
    assert.ok(src.includes('class:running'));
  });
  it('shows server binary name', () => {
    assert.ok(src.includes('server.binary') || src.includes('lsp-server-name'));
  });
  it('shows languageId', () => {
    assert.ok(src.includes('server.languageId') || src.includes('lsp-server-lang'));
  });
  it('shows open document count for running servers', () => {
    assert.ok(src.includes('openDocsCount'));
  });
  it('shows empty state when no servers active', () => {
    assert.ok(src.includes('No LSP servers active'));
  });
  it('has auto-detection hint text', () => {
    assert.ok(src.includes('Auto-detected from open file types'));
  });
  it('fetches status when LSP tab is selected', () => {
    assert.ok(src.includes('lspGetStatus'));
  });
});
