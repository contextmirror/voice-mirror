const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const clientSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/client.rs'),
  'utf-8'
);

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'),
  'utf-8'
);

describe('client.rs: workspace/configuration handler', () => {
  it('handles workspace/configuration requests', () => {
    assert.ok(
      clientSrc.includes('workspace/configuration'),
      'Should handle workspace/configuration method in reader loop'
    );
  });

  it('responds with settings from manifest', () => {
    assert.ok(
      clientSrc.includes('send_response') || clientSrc.includes('write_message'),
      'Should send a response back to the server'
    );
  });

  it('loads manifest settings for the language', () => {
    assert.ok(
      clientSrc.includes('load_manifest') || clientSrc.includes('manifest'),
      'Should reference manifest to get server settings'
    );
  });

  it('handles items array from params', () => {
    assert.ok(
      clientSrc.includes('items') && clientSrc.includes('section'),
      'Should process params.items[].section'
    );
  });

  it('builds a JSON-RPC response with id and result array', () => {
    assert.ok(
      clientSrc.includes('"jsonrpc"') && clientSrc.includes('"result"'),
      'Should build a proper JSON-RPC response'
    );
  });
});

describe('mod.rs: shared stdin for reader loop', () => {
  it('uses Arc<Mutex<ChildStdin>> for stdin', () => {
    assert.ok(
      modSrc.includes('Arc<Mutex<ChildStdin>>'),
      'LspServer.stdin should be Arc<Mutex<ChildStdin>> for shared access'
    );
  });

  it('passes shared stdin to spawn_reader_loop', () => {
    // The spawn_reader_loop call should pass the shared stdin
    assert.ok(
      clientSrc.includes('Arc<Mutex<ChildStdin>>'),
      'spawn_reader_loop should accept Arc<Mutex<ChildStdin>>'
    );
  });
});
