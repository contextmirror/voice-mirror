/**
 * api-git-stash.test.cjs -- Source-inspection tests for git stash API wrappers in api.js
 *
 * Validates all 5 git stash functions: exports, invoke names, and parameters.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

// ============ Exports ============

describe('api.js -- git stash function exports', () => {
  it('exports gitStashSave function', () => {
    assert.ok(
      src.includes('export async function gitStashSave('),
      'Should export async function gitStashSave()'
    );
  });

  it('exports gitStashList function', () => {
    assert.ok(
      src.includes('export async function gitStashList('),
      'Should export async function gitStashList()'
    );
  });

  it('exports gitStashPop function', () => {
    assert.ok(
      src.includes('export async function gitStashPop('),
      'Should export async function gitStashPop()'
    );
  });

  it('exports gitStashApply function', () => {
    assert.ok(
      src.includes('export async function gitStashApply('),
      'Should export async function gitStashApply()'
    );
  });

  it('exports gitStashDrop function', () => {
    assert.ok(
      src.includes('export async function gitStashDrop('),
      'Should export async function gitStashDrop()'
    );
  });
});

// ============ Invoke names (must match Rust snake_case) ============

describe('api.js -- git stash invoke command names', () => {
  it('gitStashSave invokes git_stash_save', () => {
    assert.ok(
      src.includes("invoke('git_stash_save'"),
      "gitStashSave should invoke 'git_stash_save'"
    );
  });

  it('gitStashList invokes git_stash_list', () => {
    assert.ok(
      src.includes("invoke('git_stash_list'"),
      "gitStashList should invoke 'git_stash_list'"
    );
  });

  it('gitStashPop invokes git_stash_pop', () => {
    assert.ok(
      src.includes("invoke('git_stash_pop'"),
      "gitStashPop should invoke 'git_stash_pop'"
    );
  });

  it('gitStashApply invokes git_stash_apply', () => {
    assert.ok(
      src.includes("invoke('git_stash_apply'"),
      "gitStashApply should invoke 'git_stash_apply'"
    );
  });

  it('gitStashDrop invokes git_stash_drop', () => {
    assert.ok(
      src.includes("invoke('git_stash_drop'"),
      "gitStashDrop should invoke 'git_stash_drop'"
    );
  });
});

// ============ Parameters ============

describe('api.js -- git stash function parameters', () => {
  it('gitStashSave accepts message and root', () => {
    assert.ok(
      src.includes('gitStashSave(message'),
      'gitStashSave should accept message parameter'
    );
  });

  it('gitStashList accepts root', () => {
    assert.ok(
      src.includes('gitStashList(root'),
      'gitStashList should accept root parameter'
    );
  });

  it('gitStashPop accepts index and root', () => {
    assert.ok(
      src.includes('gitStashPop(index'),
      'gitStashPop should accept index parameter'
    );
  });

  it('gitStashApply accepts index and root', () => {
    assert.ok(
      src.includes('gitStashApply(index'),
      'gitStashApply should accept index parameter'
    );
  });

  it('gitStashDrop accepts index and root', () => {
    assert.ok(
      src.includes('gitStashDrop(index'),
      'gitStashDrop should accept index parameter'
    );
  });

  it('stash functions pass root: root || null pattern', () => {
    // Count occurrences of the stash invoke lines with root || null
    const stashLines = src.split('\n').filter(l => l.includes('git_stash_') && l.includes('root || null'));
    assert.ok(
      stashLines.length >= 5,
      'All 5 stash functions should pass root: root || null'
    );
  });
});
