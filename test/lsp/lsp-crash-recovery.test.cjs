const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);
const clientSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/client.rs'), 'utf-8'
);
const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);

describe('client.rs: crash recovery in reader loop', () => {
  it('accesses LspManagerState from reader loop', () => {
    assert.ok(
      clientSrc.includes('LspManagerState'),
      'Reader loop should access LspManagerState via app_handle.state()'
    );
  });

  it('removes crashed server from HashMap', () => {
    assert.ok(
      clientSrc.includes('servers.remove'),
      'Should remove crashed server entry'
    );
  });

  it('implements exponential backoff', () => {
    assert.ok(
      clientSrc.includes('backoff') || (clientSrc.includes('crash_count') && clientSrc.includes('sleep')),
      'Should implement exponential backoff before restart'
    );
  });

  it('caps at max crashes before giving up', () => {
    assert.ok(
      clientSrc.includes('>= 5') || clientSrc.includes('MAX_CRASHES') || clientSrc.includes('giving up'),
      'Should stop restarting after max crashes'
    );
  });

  it('resets crash count after stable period', () => {
    assert.ok(
      clientSrc.includes('60') && clientSrc.includes('crash_count'),
      'Should reset crash_count after 60s stable period'
    );
  });

  it('replays open documents after restart', () => {
    assert.ok(
      clientSrc.includes('open_docs') && clientSrc.includes('open_document'),
      'Should replay open_docs after successful restart'
    );
  });

  it('receives server_key parameter', () => {
    assert.ok(
      clientSrc.includes('server_key'),
      'spawn_reader_loop should receive server_key for crash recovery'
    );
  });

  it('emits lsp-server-failed event when giving up', () => {
    assert.ok(
      clientSrc.includes('lsp-server-failed'),
      'Should emit lsp-server-failed event after max crashes'
    );
  });

  it('uses uri_to_file_path to read document content for replay', () => {
    assert.ok(
      clientSrc.includes('uri_to_file_path'),
      'Should use uri_to_file_path to convert URIs back to file paths'
    );
  });

  it('transfers crash tracking to the restarted server', () => {
    assert.ok(
      clientSrc.includes('server.crash_count = crash_count') &&
      clientSrc.includes('server.last_crash'),
      'Should transfer crash_count and last_crash to the new server instance'
    );
  });
});

describe('mod.rs: passes server_key to reader loop', () => {
  it('passes server_key to spawn_reader_loop', () => {
    assert.ok(
      modSrc.includes('server_key') && modSrc.includes('spawn_reader_loop'),
      'ensure_server should pass server_key to reader loop'
    );
  });

  it('server_key function is accessible from client.rs', () => {
    assert.ok(
      modSrc.includes('pub(crate) fn server_key'),
      'server_key should be pub(crate) for cross-module access'
    );
  });
});

describe('types.rs: URI to file path helper', () => {
  it('has uri_to_file_path function', () => {
    assert.ok(
      typesSrc.includes('uri_to_file_path'),
      'Should have uri_to_file_path helper'
    );
  });

  it('uri_to_file_path is a public function', () => {
    assert.ok(
      typesSrc.includes('pub fn uri_to_file_path'),
      'uri_to_file_path should be public'
    );
  });

  it('uses url::Url for parsing', () => {
    assert.ok(
      typesSrc.includes('Url::parse') && typesSrc.includes('to_file_path'),
      'Should use url::Url for robust URI parsing'
    );
  });
});
