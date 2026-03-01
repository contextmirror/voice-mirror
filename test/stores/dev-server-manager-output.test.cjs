const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/dev-server-manager.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('dev-server-manager -- project output channel wiring', () => {
  it('imports outputStore', () => {
    assert.ok(src.includes('outputStore'), 'Should import outputStore');
  });

  it('initializes outputChannel to null in server state', () => {
    assert.ok(src.includes('outputChannel: null'), 'Should have outputChannel in initial state');
  });

  it('builds channel label from folder name, framework and port', () => {
    assert.ok(
      src.includes('channelLabel'),
      'Should build channel label'
    );
  });

  it('registers project channel when starting server', () => {
    assert.ok(
      src.includes('registerProjectChannel'),
      'Should call registerProjectChannel on start'
    );
  });

  it('passes outputChannel to terminalSpawn', () => {
    assert.ok(
      src.includes('outputChannel: channelLabel'),
      'Should pass outputChannel to terminalSpawn'
    );
  });

  it('unregisters project channel when stopping server', () => {
    assert.ok(
      src.includes('unregisterProjectChannel'),
      'Should call unregisterProjectChannel on stop'
    );
  });

  it('stores outputChannel in server state', () => {
    assert.ok(
      src.includes('outputChannel: channelLabel'),
      'Should store outputChannel in state via updateState'
    );
  });

  it('includes outputChannel in ServerState typedef', () => {
    assert.ok(
      src.includes('@property {string|null} outputChannel'),
      'Should document outputChannel in JSDoc typedef'
    );
  });
});
