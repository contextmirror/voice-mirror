const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/detection.rs'),
  'utf-8'
);

describe('detection.rs: manifest-based routing', () => {
  it('uses manifest module', () => {
    assert.ok(
      src.includes('super::manifest::') || src.includes('use super::manifest'),
      'Should use manifest module'
    );
  });

  it('no longer has hardcoded LANGUAGE_SERVERS constant', () => {
    assert.ok(!src.includes('const LANGUAGE_SERVERS'), 'Should NOT have hardcoded LANGUAGE_SERVERS');
  });

  it('detect_for_extension uses manifest lookup', () => {
    assert.ok(src.includes('find_server_for_extension'), 'Should use manifest find_server_for_extension');
  });

  it('checks managed install directory for binaries', () => {
    assert.ok(src.includes('find_binary_path') || src.includes('lsp_servers_dir') || src.includes('get_lsp_servers_dir'), 'Should check managed install dir');
  });

  it('preserves resolve_node_script for Windows', () => {
    assert.ok(src.includes('resolve_node_script'), 'Should keep Windows .cmd resolution');
  });

  it('preserves detect_all function', () => {
    assert.ok(src.includes('fn detect_all'), 'Should keep detect_all for LSP status tab');
  });

  it('preserves language_id_for_extension function', () => {
    assert.ok(src.includes('fn language_id_for_extension'), 'Should keep language_id_for_extension');
  });

  it('has server_id field in ServerInfo', () => {
    assert.ok(src.includes('server_id'), 'ServerInfo should have server_id field');
  });

  it('detect_for_extension returns Option<ServerInfo>', () => {
    assert.ok(src.includes('fn detect_for_extension'), 'Should have detect_for_extension function');
    assert.ok(src.includes('Option<ServerInfo>'), 'Should return Option<ServerInfo>');
  });

  it('language_id_for_extension returns Option<String>', () => {
    assert.ok(src.includes('fn language_id_for_extension'), 'Should have language_id_for_extension function');
    assert.ok(src.includes('Option<String>'), 'Should return Option<String>');
  });

  it('uses load_manifest for detection', () => {
    assert.ok(src.includes('load_manifest'), 'Should call load_manifest');
  });

  it('detect_all iterates manifest servers', () => {
    assert.ok(src.includes('manifest.servers'), 'Should iterate manifest.servers in detect_all');
  });
});
