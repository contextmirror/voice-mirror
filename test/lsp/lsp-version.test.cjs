const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);
const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('types.rs: version field', () => {
  it('LspServerStatus has version field', () => {
    assert.ok(typesSrc.includes('version'), 'Should have version field in LspServerStatus');
  });

  it('LspServerStatus has server_name field', () => {
    assert.ok(typesSrc.includes('server_name'), 'Should have server_name field in LspServerStatus');
  });

  it('version is Option<String>', () => {
    assert.ok(
      /pub\s+version:\s+Option<String>/.test(typesSrc),
      'version should be Option<String>'
    );
  });

  it('server_name is Option<String>', () => {
    assert.ok(
      /pub\s+server_name:\s+Option<String>/.test(typesSrc),
      'server_name should be Option<String>'
    );
  });
});

describe('mod.rs: version detection', () => {
  it('reads server version from initialize response', () => {
    assert.ok(
      modSrc.includes('serverInfo'),
      'Should read serverInfo from initialize response'
    );
  });

  it('extracts version string from serverInfo', () => {
    assert.ok(
      modSrc.includes('"version"') && modSrc.includes('serverInfo'),
      'Should extract version from serverInfo.version'
    );
  });

  it('extracts server name from serverInfo', () => {
    assert.ok(
      modSrc.includes('"name"') && modSrc.includes('serverInfo'),
      'Should extract name from serverInfo.name'
    );
  });

  it('stores version on LspServer', () => {
    assert.ok(
      /pub\s+version:\s+Option<String>/.test(modSrc),
      'LspServer should have version: Option<String>'
    );
  });

  it('stores server_name on LspServer', () => {
    assert.ok(
      /pub\s+server_name:\s+Option<String>/.test(modSrc),
      'LspServer should have server_name: Option<String>'
    );
  });

  it('populates version in get_status()', () => {
    assert.ok(
      modSrc.includes('version: s.version.clone()'),
      'get_status() should populate version from server'
    );
  });

  it('populates server_name in get_status()', () => {
    assert.ok(
      modSrc.includes('server_name: s.server_name.clone()'),
      'get_status() should populate server_name from server'
    );
  });

  it('logs server info after extraction', () => {
    assert.ok(
      modSrc.includes('LSP serverInfo'),
      'Should log server info after extracting from initialize response'
    );
  });
});
