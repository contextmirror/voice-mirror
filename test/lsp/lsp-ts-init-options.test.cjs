/**
 * lsp-ts-init-options.test.cjs -- Source-inspection tests for TypeScript server init options.
 *
 * Validates VS Code-compatible initialization options in the manifest.
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
  it('has non-empty initializationOptions', () => {
    assert.ok(tsEntry.initializationOptions && Object.keys(tsEntry.initializationOptions).length > 0,
      'TypeScript should have non-empty initializationOptions');
  });

  it('has preferences object', () => {
    assert.ok(tsEntry.initializationOptions.preferences, 'Should have preferences');
  });

  it('has includeInlayParameterNameHints preference', () => {
    assert.ok('includeInlayParameterNameHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayParameterNameHints');
  });

  it('has includeInlayVariableTypeHints preference', () => {
    assert.ok('includeInlayVariableTypeHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayVariableTypeHints');
  });

  it('has includeInlayFunctionLikeReturnTypeHints preference', () => {
    assert.ok('includeInlayFunctionLikeReturnTypeHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayFunctionLikeReturnTypeHints');
  });

  it('has includeInlayPropertyDeclarationTypeHints preference', () => {
    assert.ok('includeInlayPropertyDeclarationTypeHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayPropertyDeclarationTypeHints');
  });

  it('has includeInlayEnumMemberValueHints preference', () => {
    assert.ok('includeInlayEnumMemberValueHints' in tsEntry.initializationOptions.preferences,
      'Should have includeInlayEnumMemberValueHints');
  });

  it('has hostInfo set to voice-mirror', () => {
    assert.ok(tsEntry.initializationOptions.hostInfo === 'voice-mirror',
      'hostInfo should be voice-mirror');
  });
});
