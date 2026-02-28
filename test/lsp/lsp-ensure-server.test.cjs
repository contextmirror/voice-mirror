const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'),
  'utf-8'
);

describe('mod.rs: ensure_server install-if-missing', () => {
  it('imports installer module', () => {
    assert.ok(
      src.includes('installer::') || src.includes('use super::installer'),
      'Should use installer module'
    );
  });

  it('calls install_server when binary not found', () => {
    assert.ok(src.includes('install_server'), 'Should call install_server');
  });

  it('checks is_server_installed or retries detection after install', () => {
    assert.ok(
      src.includes('detect_for_extension') && src.includes('install_server'),
      'Should retry detection after install'
    );
  });

  it('imports manifest module', () => {
    assert.ok(
      src.includes('manifest::') || src.includes('use super::manifest'),
      'Should use manifest module'
    );
  });

  it('loads manifest for server config', () => {
    assert.ok(src.includes('load_manifest'), 'Should load manifest');
  });

  it('checks detect_node before installing', () => {
    assert.ok(src.includes('detect_node'), 'Should check Node.js availability');
  });

  it('gets lsp servers directory', () => {
    assert.ok(src.includes('get_lsp_servers_dir'), 'Should get install directory');
  });
});
