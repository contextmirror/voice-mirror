const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/installer.rs'),
  'utf-8'
);

describe('installer.rs: Node.js detection', () => {
  it('has detect_node function', () => {
    assert.ok(src.includes('fn detect_node'), 'Should have detect_node function');
  });

  it('checks for node on PATH', () => {
    assert.ok(src.includes('which::which') || src.includes('"node"'), 'Should check for node binary');
  });

  it('checks for npm on PATH', () => {
    assert.ok(src.includes('"npm"'), 'Should check for npm binary');
  });

  it('returns NodeStatus with version info', () => {
    assert.ok(
      src.includes('NodeStatus') || src.includes('node_version'),
      'Should return version info'
    );
  });
});

describe('installer.rs: npm install', () => {
  it('has install_server function', () => {
    assert.ok(src.includes('fn install_server'), 'Should have install_server function');
  });

  it('uses --ignore-scripts flag', () => {
    assert.ok(src.includes('--ignore-scripts'), 'Should use --ignore-scripts for security');
  });

  it('uses --prefix flag for install directory', () => {
    assert.ok(src.includes('--prefix'), 'Should use --prefix for install location');
  });

  it('has install lock mechanism', () => {
    assert.ok(
      src.includes('install.lock') || src.includes('install_lock'),
      'Should have install lock file'
    );
  });

  it('has get_lsp_servers_dir function', () => {
    assert.ok(src.includes('fn get_lsp_servers_dir'), 'Should have directory helper');
  });
});

describe('installer.rs: status events', () => {
  it('emits lsp-server-status events', () => {
    assert.ok(
      src.includes('lsp-server-install-status') || src.includes('lsp-server-status'),
      'Should emit status events'
    );
  });
});
