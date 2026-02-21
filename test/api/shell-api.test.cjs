const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- shell terminal commands', () => {
  it('exports shellSpawn', () => {
    assert.ok(src.includes('export async function shellSpawn'), 'Should export shellSpawn');
  });

  it('exports shellInput', () => {
    assert.ok(src.includes('export async function shellInput'), 'Should export shellInput');
  });

  it('exports shellResize', () => {
    assert.ok(src.includes('export async function shellResize'), 'Should export shellResize');
  });

  it('exports shellKill', () => {
    assert.ok(src.includes('export async function shellKill'), 'Should export shellKill');
  });

  it('exports shellList', () => {
    assert.ok(src.includes('export async function shellList'), 'Should export shellList');
  });
});

describe('api.js -- shell invoke commands', () => {
  it('shellSpawn invokes shell_spawn', () => {
    assert.ok(src.includes("invoke('shell_spawn'"), 'Should invoke shell_spawn');
  });

  it('shellInput invokes shell_input', () => {
    assert.ok(src.includes("invoke('shell_input'"), 'Should invoke shell_input');
  });

  it('shellResize invokes shell_resize', () => {
    assert.ok(src.includes("invoke('shell_resize'"), 'Should invoke shell_resize');
  });

  it('shellKill invokes shell_kill', () => {
    assert.ok(src.includes("invoke('shell_kill'"), 'Should invoke shell_kill');
  });

  it('shellList invokes shell_list', () => {
    assert.ok(src.includes("invoke('shell_list'"), 'Should invoke shell_list');
  });
});
