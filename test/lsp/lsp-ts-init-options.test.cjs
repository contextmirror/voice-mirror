/**
 * lsp-ts-init-options.test.cjs -- Source-inspection tests for TypeScript server config.
 *
 * Validates initialization options and settings in the manifest for typescript-language-server.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/lsp-servers.json'), 'utf-8'
));

const tsEntry = manifest.servers.typescript;

describe('lsp-servers.json: TypeScript initializationOptions', () => {
  it('has hostInfo set to voice-mirror', () => {
    assert.equal(tsEntry.initializationOptions.hostInfo, 'voice-mirror',
      'hostInfo should be voice-mirror');
  });

  it('has inlay hint preferences', () => {
    const prefs = tsEntry.initializationOptions.preferences;
    assert.ok(prefs, 'Should have preferences');
    assert.equal(prefs.includeInlayParameterNameHints, 'none');
    assert.equal(prefs.includeInlayVariableTypeHints, false);
    assert.equal(prefs.includeInlayFunctionLikeReturnTypeHints, false);
  });
});

describe('lsp-servers.json: TypeScript server uses typescript-language-server', () => {
  it('installs typescript-language-server', () => {
    assert.ok(tsEntry.install.packages.includes('typescript-language-server'),
      'Should install typescript-language-server');
  });

  it('installs typescript', () => {
    assert.ok(tsEntry.install.packages.includes('typescript'),
      'Should install typescript');
  });

  it('uses typescript-language-server command', () => {
    assert.equal(tsEntry.command, 'typescript-language-server',
      'Should use typescript-language-server command');
  });
});
