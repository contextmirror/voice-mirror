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
  it('emits lsp-install-status events', () => {
    assert.ok(
      src.includes('lsp-install-status'),
      'Should emit install status events'
    );
  });
});

describe('installer.rs: github-release support', () => {
  it('has install_github_release function', () => {
    assert.ok(
      src.includes('fn install_github_release'),
      'Should have install_github_release function'
    );
  });

  it('downloads from GitHub releases URL', () => {
    assert.ok(
      src.includes('github.com') && src.includes('releases'),
      'Should construct GitHub releases download URL'
    );
  });

  it('handles platform detection', () => {
    assert.ok(
      src.includes('pc-windows-msvc') || src.includes('target_os'),
      'Should detect Windows platform'
    );
    assert.ok(
      src.includes('apple-darwin'),
      'Should detect macOS platform'
    );
    assert.ok(
      src.includes('unknown-linux-gnu'),
      'Should detect Linux platform'
    );
  });

  it('handles architecture detection', () => {
    assert.ok(
      src.includes('x86_64'),
      'Should detect x86_64 architecture'
    );
    assert.ok(
      src.includes('aarch64'),
      'Should detect aarch64 architecture'
    );
  });

  it('replaces asset pattern placeholders', () => {
    assert.ok(
      src.includes('{arch}') && src.includes('{os}'),
      'Should replace {arch} and {os} placeholders in asset pattern'
    );
  });

  it('stores binaries in bin directory', () => {
    assert.ok(
      src.includes('"bin"') && src.includes('bin_dir'),
      'Should store native binaries in lsp-servers/bin/'
    );
  });

  it('handles gzip decompression', () => {
    assert.ok(
      src.includes('.gz') && (src.includes('GzDecoder') || src.includes('flate2')),
      'Should handle .gz compressed assets'
    );
  });

  it('handles latest version', () => {
    assert.ok(
      src.includes('latest') && src.includes('releases/latest/download'),
      'Should handle "latest" version via GitHub latest redirect'
    );
  });

  it('emits download progress events', () => {
    assert.ok(
      src.includes('downloading'),
      'Should emit downloading status event'
    );
  });

  it('uses User-Agent header', () => {
    assert.ok(
      src.includes('User-Agent') && src.includes('voice-mirror'),
      'Should set User-Agent header for GitHub API'
    );
  });
});
