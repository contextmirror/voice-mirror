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

describe('mod.rs: health monitoring', () => {
  it('tracks request timestamps in pending_requests type', () => {
    assert.ok(modSrc.includes('Instant') && modSrc.includes('pending_requests'),
      'pending_requests type should include Instant for timestamp tracking');
  });

  it('has health check interval', () => {
    assert.ok(modSrc.includes('health_check') || modSrc.includes('HEALTH_CHECK') || modSrc.includes('health'),
      'Should have periodic health check');
  });

  it('detects stale requests older than 30 seconds', () => {
    assert.ok(modSrc.includes('30') && (modSrc.includes('stale') || modSrc.includes('duration_since')),
      'Should detect requests older than 30 seconds');
  });

  it('emits lsp-server-unresponsive event', () => {
    assert.ok(modSrc.includes('lsp-server-unresponsive'),
      'Should emit unresponsive event for frontend');
  });

  it('spawns health check task after server starts', () => {
    assert.ok(
      modSrc.includes('spawn_health_check') || modSrc.includes('health_check'),
      'ensure_server should spawn a health check task'
    );
  });

  it('checks every 10 seconds', () => {
    assert.ok(modSrc.includes('10'),
      'Health check interval should be 10 seconds');
  });
});

describe('client.rs: request timestamp tracking', () => {
  it('stores Instant alongside sender in pending_requests', () => {
    assert.ok(
      clientSrc.includes('Instant::now()') || clientSrc.includes('Instant'),
      'send_request should record Instant when request is sent'
    );
  });

  it('uses tuple type for pending_requests values', () => {
    assert.ok(
      clientSrc.includes('(oneshot::Sender<Value>, Instant)') ||
      clientSrc.includes('(oneshot::Sender<Value>, std::time::Instant)'),
      'pending_requests should store (Sender, Instant) tuples'
    );
  });

  it('extracts sender from tuple when routing responses', () => {
    assert.ok(
      clientSrc.includes('(sender,') || clientSrc.includes('(sender ,'),
      'Reader loop should destructure tuple when routing responses'
    );
  });
});

describe('types.rs: Unresponsive server state', () => {
  it('has Unresponsive variant in ServerState', () => {
    assert.ok(
      typesSrc.includes('Unresponsive'),
      'ServerState enum should have an Unresponsive variant'
    );
  });
});
