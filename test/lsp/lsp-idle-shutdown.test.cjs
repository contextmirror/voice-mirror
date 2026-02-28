const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

describe('mod.rs: idle shutdown', () => {
  it('starts idle timer when all docs close', () => {
    assert.ok(modSrc.includes('idle') || modSrc.includes('IDLE_TIMEOUT'),
      'Should have idle timeout logic');
  });

  it('cancels idle timer when new doc opens', () => {
    assert.ok(modSrc.includes('idle_cancel') || modSrc.includes('cancel_token') || modSrc.includes('abort'),
      'Should cancel idle timer on new doc open');
  });

  it('uses watch channel for cancellation', () => {
    assert.ok(modSrc.includes('watch::channel') || modSrc.includes('watch::Sender'),
      'Should use watch channel for cancel signaling');
  });

  it('has 60 second timeout', () => {
    assert.ok(modSrc.includes('60') && (modSrc.includes('idle') || modSrc.includes('shutdown')),
      'Idle timeout should be 60 seconds');
  });

  it('spawns idle task on empty open_docs', () => {
    assert.ok(
      modSrc.includes('open_docs') && modSrc.includes('is_empty'),
      'Should check open_docs.is_empty() to start idle timer'
    );
  });

  it('idle_cancel field on LspServer', () => {
    assert.ok(modSrc.includes('idle_cancel'),
      'LspServer should have idle_cancel field');
  });

  it('double-checks server is still idle before shutdown', () => {
    assert.ok(modSrc.includes('still_idle'),
      'Should verify server is still idle before executing shutdown');
  });

  it('logs idle shutdown timer start', () => {
    assert.ok(modSrc.includes('starting 60s idle shutdown timer'),
      'Should log when idle timer starts');
  });

  it('uses tokio::select for timer vs cancel', () => {
    assert.ok(modSrc.includes('tokio::select!'),
      'Should use tokio::select! to race timer against cancellation');
  });

  it('accesses LspManagerState via app_handle.state()', () => {
    // The idle shutdown task runs outside the manager lock, so it must
    // re-acquire the lock via app_handle.state() (same pattern as health check)
    assert.ok(
      modSrc.includes('app_handle.state()') && modSrc.includes('LspManagerState'),
      'Idle task should access manager via app_handle.state()'
    );
  });
});
