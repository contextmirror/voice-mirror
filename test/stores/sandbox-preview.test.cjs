/**
 * sandbox-preview.test.cjs -- Source-inspection tests for sandbox-preview.svelte.js
 *
 * Validates the live-preview store that drives the SandboxPreview panel: exports,
 * factory, $state shape, open/close lifecycle, and that it backs onto the
 * sandbox_stream MJPEG screencast via the api wrappers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'sandbox-preview.svelte.js'),
  'utf-8'
);

describe('sandbox-preview: exports', () => {
  it('exports sandboxPreviewStore', () => {
    assert.ok(src.includes('export const sandboxPreviewStore'), 'Should export sandboxPreviewStore');
  });

  it('creates the store via a factory', () => {
    assert.ok(src.includes('function createSandboxPreviewStore()'), 'Should define the factory');
  });
});

describe('sandbox-preview: integration', () => {
  it('starts/stops the screencast via the api wrappers', () => {
    assert.ok(src.includes('sandboxStreamStart'), 'Should call sandboxStreamStart');
    assert.ok(src.includes('sandboxStreamStop'), 'Should call sandboxStreamStop');
  });

  it('unwraps the IpcResponse to get the stream url', () => {
    assert.ok(src.includes('unwrapResult'), 'Should unwrap the response');
    assert.ok(src.includes('data?.url') || src.includes('data.url'), 'Should read the stream url');
  });
});

describe('sandbox-preview: state', () => {
  for (const field of ['isOpen', 'cdpPort', 'streamUrl', 'loading', 'error']) {
    it(`uses $state for ${field}`, () => {
      assert.ok(
        new RegExp(`let\\s+${field}\\s*=\\s*\\$state\\(`).test(src),
        `Should use $state for ${field}`
      );
    });
  }

  for (const getter of ['isOpen', 'cdpPort', 'streamUrl', 'loading', 'error']) {
    it(`has getter ${getter}`, () => {
      assert.ok(src.includes(`get ${getter}()`), `Should expose getter ${getter}`);
    });
  }
});

describe('sandbox-preview: lifecycle', () => {
  it('has open and close methods', () => {
    assert.ok(/async open\(port\)/.test(src), 'Should have async open(port)');
    assert.ok(/close\(\)/.test(src), 'Should have close()');
  });

  it('open is idempotent per port', () => {
    const block = src.split('async open(port)')[1]?.split('close()')[0] || '';
    assert.ok(
      block.includes('cdpPort === port'),
      'open should no-op when already open on the same port'
    );
  });

  it('close stops the screencast for the current port', () => {
    const block = src.split('close()')[1] || '';
    assert.ok(block.includes('sandboxStreamStop'), 'close should stop the screencast');
  });
});
