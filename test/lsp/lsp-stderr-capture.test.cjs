const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/mod.rs'), 'utf-8'
);

const typesSrc = fs.readFileSync(
  path.join(__dirname, '../../src-tauri/src/lsp/types.rs'), 'utf-8'
);

describe('mod.rs: stderr capture', () => {
  it('stores stderr lines on LspServer', () => {
    assert.ok(modSrc.includes('stderr_lines'), 'LspServer should have stderr_lines field');
  });

  it('caps stderr buffer size', () => {
    assert.ok(
      modSrc.includes('MAX_STDERR_LINES') || modSrc.includes('stderr_lines.len()'),
      'Should limit stderr buffer size'
    );
  });

  it('uses Arc<Mutex<Vec<String>>> for thread-safe sharing', () => {
    assert.ok(
      modSrc.includes('Arc<Mutex<Vec<String>>>') ||
      (modSrc.includes('stderr_lines') && modSrc.includes('Arc') && modSrc.includes('Mutex')),
      'stderr_lines should be Arc<Mutex<Vec<String>>> for sharing with stderr task'
    );
  });

  it('clones stderr buffer into stderr task', () => {
    assert.ok(
      modSrc.includes('stderr_buf_clone') || modSrc.includes('stderr_buf.clone()'),
      'Should clone the stderr buffer Arc into the stderr reading task'
    );
  });

  it('has MAX_STDERR_LINES constant', () => {
    assert.ok(
      modSrc.includes('MAX_STDERR_LINES'),
      'Should have MAX_STDERR_LINES constant'
    );
  });

  it('sets MAX_STDERR_LINES to 50', () => {
    assert.ok(
      modSrc.includes('MAX_STDERR_LINES: usize = 50'),
      'MAX_STDERR_LINES should be 50'
    );
  });

  it('pushes lines into the shared buffer inside the task', () => {
    assert.ok(
      modSrc.includes('buf.push('),
      'stderr task should push lines into the buffer'
    );
  });

  it('removes oldest line when buffer is full', () => {
    assert.ok(
      modSrc.includes('buf.remove(0)'),
      'Should remove oldest line when buffer reaches MAX_STDERR_LINES'
    );
  });

  it('uses the shared buffer (not a fresh Vec) in LspServer construction', () => {
    assert.ok(
      modSrc.includes('stderr_lines: stderr_buf'),
      'LspServer should use the shared stderr_buf, not a new Vec'
    );
  });
});

describe('types.rs: stderr_lines in LspServerStatus', () => {
  it('has stderr_lines field on LspServerStatus', () => {
    assert.ok(
      typesSrc.includes('stderr_lines'),
      'LspServerStatus should have stderr_lines field'
    );
  });

  it('stderr_lines is Vec<String>', () => {
    assert.ok(
      typesSrc.includes('stderr_lines: Vec<String>'),
      'stderr_lines should be Vec<String> in LspServerStatus'
    );
  });
});

describe('mod.rs: get_status includes stderr lines', () => {
  it('reads stderr_lines in get_status', () => {
    // get_status should access stderr_lines from the server
    assert.ok(
      modSrc.includes('recent_stderr') || modSrc.includes('stderr_lines'),
      'get_status should read stderr lines from the server'
    );
  });

  it('limits stderr lines to last 5 in status', () => {
    // Should take last 5 lines for the status response
    assert.ok(
      modSrc.includes('> 5') || modSrc.includes('- 5') || modSrc.includes('len - 5'),
      'get_status should return at most 5 stderr lines'
    );
  });
});
