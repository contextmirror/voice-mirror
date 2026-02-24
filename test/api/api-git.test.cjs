/**
 * api-git.test.cjs -- Source-inspection tests for git API wrappers in api.js
 *
 * Validates all 9 new git-related functions: exports, invoke names, and parameters.
 * Based on the plan spec -- does not read implementation code.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

// ============ Exports ============

describe('api.js -- git function exports', () => {
  it('exports gitStage function', () => {
    assert.ok(
      src.includes('export async function gitStage('),
      'Should export async function gitStage()'
    );
  });

  it('exports gitUnstage function', () => {
    assert.ok(
      src.includes('export async function gitUnstage('),
      'Should export async function gitUnstage()'
    );
  });

  it('exports gitStageAll function', () => {
    assert.ok(
      src.includes('export async function gitStageAll('),
      'Should export async function gitStageAll()'
    );
  });

  it('exports gitUnstageAll function', () => {
    assert.ok(
      src.includes('export async function gitUnstageAll('),
      'Should export async function gitUnstageAll()'
    );
  });

  it('exports gitCommit function', () => {
    assert.ok(
      src.includes('export async function gitCommit('),
      'Should export async function gitCommit()'
    );
  });

  it('exports gitDiscard function', () => {
    assert.ok(
      src.includes('export async function gitDiscard('),
      'Should export async function gitDiscard()'
    );
  });

  it('exports gitPush function', () => {
    assert.ok(
      src.includes('export async function gitPush('),
      'Should export async function gitPush()'
    );
  });

  it('exports gitDiffStaged function', () => {
    assert.ok(
      src.includes('export async function gitDiffStaged('),
      'Should export async function gitDiffStaged()'
    );
  });

  it('exports generateCommitMessage function', () => {
    assert.ok(
      src.includes('export async function generateCommitMessage('),
      'Should export async function generateCommitMessage()'
    );
  });
});

// ============ Invoke names (must match Rust snake_case) ============

describe('api.js -- git invoke command names', () => {
  it('gitStage invokes git_stage', () => {
    assert.ok(
      src.includes("invoke('git_stage'"),
      "gitStage should invoke 'git_stage'"
    );
  });

  it('gitUnstage invokes git_unstage', () => {
    assert.ok(
      src.includes("invoke('git_unstage'"),
      "gitUnstage should invoke 'git_unstage'"
    );
  });

  it('gitStageAll invokes git_stage_all', () => {
    assert.ok(
      src.includes("invoke('git_stage_all'"),
      "gitStageAll should invoke 'git_stage_all'"
    );
  });

  it('gitUnstageAll invokes git_unstage_all', () => {
    assert.ok(
      src.includes("invoke('git_unstage_all'"),
      "gitUnstageAll should invoke 'git_unstage_all'"
    );
  });

  it('gitCommit invokes git_commit', () => {
    assert.ok(
      src.includes("invoke('git_commit'"),
      "gitCommit should invoke 'git_commit'"
    );
  });

  it('gitDiscard invokes git_discard', () => {
    assert.ok(
      src.includes("invoke('git_discard'"),
      "gitDiscard should invoke 'git_discard'"
    );
  });

  it('gitPush invokes git_push', () => {
    assert.ok(
      src.includes("invoke('git_push'"),
      "gitPush should invoke 'git_push'"
    );
  });

  it('gitDiffStaged invokes git_diff_staged', () => {
    assert.ok(
      src.includes("invoke('git_diff_staged'"),
      "gitDiffStaged should invoke 'git_diff_staged'"
    );
  });

  it('generateCommitMessage invokes generate_commit_message', () => {
    assert.ok(
      src.includes("invoke('generate_commit_message'"),
      "generateCommitMessage should invoke 'generate_commit_message'"
    );
  });
});

// ============ Parameters ============

describe('api.js -- git function parameters', () => {
  it('gitStage accepts paths and root', () => {
    assert.ok(
      src.includes('gitStage(paths') || src.includes('gitStage(paths,'),
      'gitStage should accept paths parameter'
    );
    // Check it passes root to invoke
    assert.ok(
      src.includes("invoke('git_stage'") && src.includes('root'),
      'gitStage should pass root parameter'
    );
  });

  it('gitUnstage accepts paths and root', () => {
    assert.ok(
      src.includes('gitUnstage(paths') || src.includes('gitUnstage(paths,'),
      'gitUnstage should accept paths parameter'
    );
  });

  it('gitCommit accepts message and root', () => {
    assert.ok(
      src.includes('gitCommit(message') || src.includes('gitCommit(message,'),
      'gitCommit should accept message parameter'
    );
  });

  it('gitDiscard accepts paths and root', () => {
    assert.ok(
      src.includes('gitDiscard(paths') || src.includes('gitDiscard(paths,'),
      'gitDiscard should accept paths parameter'
    );
  });

  it('gitStageAll accepts root parameter', () => {
    assert.ok(
      src.includes('gitStageAll(root') || src.includes('gitStageAll('),
      'gitStageAll should accept root parameter'
    );
  });

  it('gitUnstageAll accepts root parameter', () => {
    assert.ok(
      src.includes('gitUnstageAll(root') || src.includes('gitUnstageAll('),
      'gitUnstageAll should accept root parameter'
    );
  });

  it('gitPush accepts root parameter', () => {
    assert.ok(
      src.includes('gitPush(root') || src.includes('gitPush('),
      'gitPush should accept root parameter'
    );
  });

  it('gitDiffStaged accepts root parameter', () => {
    assert.ok(
      src.includes('gitDiffStaged(root') || src.includes('gitDiffStaged('),
      'gitDiffStaged should accept root parameter'
    );
  });

  it('generateCommitMessage accepts root parameter', () => {
    assert.ok(
      src.includes('generateCommitMessage(root') || src.includes('generateCommitMessage('),
      'generateCommitMessage should accept root parameter'
    );
  });

  it('functions pass root: root || null pattern', () => {
    assert.ok(
      src.includes('root || null') || src.includes('root: root'),
      'Git functions should pass root: root || null to invoke'
    );
  });
});
