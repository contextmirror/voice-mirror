const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/output.svelte.js'),
  'utf-8'
);

describe('output.svelte.js store', () => {
  it('exports outputStore', () => {
    assert.ok(src.includes('export const outputStore'));
  });

  it('defines all 6 system channels', () => {
    assert.ok(src.includes("'app'"));
    assert.ok(src.includes("'cli'"));
    assert.ok(src.includes("'voice'"));
    assert.ok(src.includes("'mcp'"));
    assert.ok(src.includes("'browser'"));
    assert.ok(src.includes("'frontend'"));
  });

  it('listens to output-log Tauri event', () => {
    assert.ok(src.includes("'output-log'"));
    assert.ok(src.includes('listen'));
  });

  it('has MAX_ENTRIES cap', () => {
    assert.ok(src.includes('MAX_ENTRIES'));
    assert.ok(src.includes('2000'));
  });

  it('exports switchChannel function', () => {
    assert.ok(src.includes('switchChannel'));
  });

  it('exports setLevelFilter function', () => {
    assert.ok(src.includes('setLevelFilter'));
  });

  it('models level filter per-channel (not a single global)', () => {
    assert.ok(src.includes('levelFilterByChannel'), 'Should store level filter per channel');
    // setLevelFilter must take (channel, level)
    assert.ok(
      /function setLevelFilter\(channel, level\)/.test(src),
      'setLevelFilter should accept (channel, level)'
    );
  });

  it('exports getLevelFilter and countsByLevel helpers', () => {
    assert.ok(src.includes('getLevelFilter'), 'Should export getLevelFilter');
    assert.ok(src.includes('countsByLevel'), 'Should export countsByLevel');
  });

  it('filters active channel by its own level', () => {
    // getFilteredEntries reads the per-channel level via getLevelFilter(activeChannel)
    assert.ok(
      src.includes('getLevelFilter(activeChannel)'),
      'getFilteredEntries should use the active channel level'
    );
  });

  it('exports clearChannel function', () => {
    assert.ok(src.includes('clearChannel'));
  });

  it('imports getOutputLogs from api', () => {
    assert.ok(src.includes("from '../api.js'"));
    assert.ok(src.includes('getOutputLogs'));
  });

  it('has level priority function', () => {
    assert.ok(src.includes('levelPriority'));
  });

  it('has auto-scroll state', () => {
    assert.ok(src.includes('autoScroll'));
  });

  it('has text filter with include/exclude support', () => {
    assert.ok(src.includes('filterText'));
    assert.ok(src.includes('setFilterText'));
    assert.ok(src.includes("startsWith('!')"));
  });

  it('has word wrap toggle', () => {
    assert.ok(src.includes('wordWrap'));
    assert.ok(src.includes('toggleWordWrap'));
  });
});
