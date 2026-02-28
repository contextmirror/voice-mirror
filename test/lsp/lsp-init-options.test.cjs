const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'),
  'utf-8'
);

describe('mod.rs: workspaceFolders', () => {
  it('sends workspaceFolders in initialize request', () => {
    assert.ok(src.includes('workspaceFolders'), 'Should include workspaceFolders in init params');
  });

  it('declares workspaceFolders capability', () => {
    assert.ok(
      src.includes('workspace_folders') || src.includes('workspaceFolders'),
      'Should declare workspace.workspaceFolders capability'
    );
  });
});

describe('mod.rs: initializationOptions', () => {
  it('passes initializationOptions in initialize request', () => {
    assert.ok(src.includes('initializationOptions'), 'Should include initializationOptions in init');
  });

  it('reads initialization_options from manifest entry', () => {
    assert.ok(
      src.includes('initialization_options'),
      'Should read options from manifest ServerEntry'
    );
  });

  it('loads manifest to get init options', () => {
    // The init options lookup should involve loading the manifest
    assert.ok(
      src.includes('load_manifest'),
      'Should load manifest for init options'
    );
  });
});
