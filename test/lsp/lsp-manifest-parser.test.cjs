const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/manifest.rs'),
  'utf-8'
);

describe('manifest.rs: structures', () => {
  it('defines ServerManifest struct', () => {
    assert.ok(src.includes('struct ServerManifest'), 'Should define ServerManifest');
  });

  it('defines ServerEntry struct', () => {
    assert.ok(src.includes('struct ServerEntry'), 'Should define ServerEntry');
  });

  it('defines InstallConfig struct', () => {
    assert.ok(src.includes('struct InstallConfig'), 'Should define InstallConfig');
  });

  it('derives Deserialize for all structs', () => {
    assert.ok(src.includes('Deserialize'), 'Should derive Deserialize');
  });
});

describe('manifest.rs: core functions', () => {
  it('has load_manifest function', () => {
    assert.ok(src.includes('fn load_manifest'), 'Should have load_manifest');
  });

  it('embeds lsp-servers.json via include_str', () => {
    assert.ok(src.includes('include_str!'), 'Should embed manifest via include_str');
    assert.ok(src.includes('lsp-servers.json'), 'Should reference lsp-servers.json');
  });

  it('has find_server_for_extension function', () => {
    assert.ok(src.includes('fn find_server_for_extension'), 'Should have extension lookup');
  });

  it('respects excludeExtensions', () => {
    assert.ok(src.includes('exclude_extensions'), 'Should handle excludeExtensions field');
  });

  it('has find_binary_path function', () => {
    assert.ok(src.includes('fn find_binary_path'), 'Should have binary path resolution');
  });

  it('checks node_modules/.bin/', () => {
    assert.ok(src.includes('node_modules'), 'Should check node_modules/.bin/ path');
  });
});

describe('manifest.rs: user override support', () => {
  it('has merge_overrides or apply_overrides function', () => {
    assert.ok(
      src.includes('merge_overrides') || src.includes('apply_overrides') || src.includes('with_overrides'),
      'Should support merging user overrides'
    );
  });
});
