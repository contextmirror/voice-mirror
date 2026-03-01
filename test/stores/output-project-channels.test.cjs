const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, '../../src/lib/stores/output.svelte.js');
const src = fs.readFileSync(STORE_PATH, 'utf-8');

describe('output.svelte.js -- project channels', () => {
  it('has SYSTEM_CHANNELS constant', () => {
    assert.ok(src.includes('SYSTEM_CHANNELS'), 'Should have SYSTEM_CHANNELS');
  });

  it('has projectChannelEntries state', () => {
    assert.ok(src.includes('projectChannelEntries'), 'Should track project channel entries');
  });

  it('has projectChannelList state', () => {
    assert.ok(src.includes('projectChannelList'), 'Should track project channel list');
  });

  it('listens for project-output-log event', () => {
    assert.ok(src.includes("'project-output-log'"), 'Should listen for project-output-log');
  });

  it('listens for lens-console-message event', () => {
    assert.ok(src.includes("'lens-console-message'"), 'Should listen for lens-console-message');
  });

  it('exports registerProjectChannel method', () => {
    assert.ok(src.includes('registerProjectChannel'), 'Should have registerProjectChannel');
  });

  it('exports unregisterProjectChannel method', () => {
    assert.ok(src.includes('unregisterProjectChannel'), 'Should have unregisterProjectChannel');
  });

  it('exports projectChannels getter', () => {
    assert.ok(src.includes('projectChannels'), 'Should export projectChannels');
  });

  it('exports hasProjectErrors getter', () => {
    assert.ok(src.includes('hasProjectErrors'), 'Should export hasProjectErrors');
  });

  it('handles switchChannel for project channels', () => {
    assert.ok(src.includes('projectChannelEntries[ch]') || src.includes('projectChannelEntries[activeChannel]'),
      'switchChannel should accept project channels');
  });

  it('imports apiRegister and apiUnregister from api.js', () => {
    assert.ok(src.includes('registerProjectChannel as apiRegister'), 'Should import registerProjectChannel as apiRegister');
    assert.ok(src.includes('unregisterProjectChannel as apiUnregister'), 'Should import unregisterProjectChannel as apiUnregister');
  });

  it('getFilteredEntries checks project channels', () => {
    assert.ok(src.includes('projectChannelEntries[activeChannel]'), 'getFilteredEntries should fall back to project channel entries');
  });

  it('clearChannel handles project channels', () => {
    // clearChannel should check both system entries and project entries
    assert.ok(src.includes('projectChannelEntries[activeChannel]'), 'clearChannel should handle project channel entries');
  });

  it('unregister switches to app channel if viewing removed channel', () => {
    assert.ok(src.includes("activeChannel = 'app'"), 'Should switch to app when active project channel is removed');
  });

  it('caps project channel entries at MAX_ENTRIES', () => {
    // Both project-output-log and lens-console-message handlers should cap entries
    const matches = src.match(/arr\.length > MAX_ENTRIES/g);
    assert.ok(matches && matches.length >= 3, 'Should cap entries in at least 3 places (system + 2 project listeners)');
  });
});
