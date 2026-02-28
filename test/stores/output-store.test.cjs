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

  it('defines all 5 channels', () => {
    assert.ok(src.includes("'app'"));
    assert.ok(src.includes("'cli'"));
    assert.ok(src.includes("'voice'"));
    assert.ok(src.includes("'mcp'"));
    assert.ok(src.includes("'browser'"));
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
