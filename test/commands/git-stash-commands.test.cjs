/**
 * git-stash-commands.test.cjs -- Source-inspection tests for git stash Rust commands
 *
 * Validates that the Rust commands exist in git.rs and are registered in lib.rs.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GIT_RS_PATH = path.join(__dirname, '../../src-tauri/src/commands/files/git.rs');
const LIB_RS_PATH = path.join(__dirname, '../../src-tauri/src/lib.rs');
const gitSrc = fs.readFileSync(GIT_RS_PATH, 'utf-8');
const libSrc = fs.readFileSync(LIB_RS_PATH, 'utf-8');

// ============ Rust command functions ============

describe('git.rs -- stash command functions', () => {
  it('defines git_stash_save command', () => {
    assert.ok(
      gitSrc.includes('pub fn git_stash_save('),
      'Should define pub fn git_stash_save'
    );
  });

  it('defines git_stash_list command', () => {
    assert.ok(
      gitSrc.includes('pub fn git_stash_list('),
      'Should define pub fn git_stash_list'
    );
  });

  it('defines git_stash_pop command', () => {
    assert.ok(
      gitSrc.includes('pub fn git_stash_pop('),
      'Should define pub fn git_stash_pop'
    );
  });

  it('defines git_stash_apply command', () => {
    assert.ok(
      gitSrc.includes('pub fn git_stash_apply('),
      'Should define pub fn git_stash_apply'
    );
  });

  it('defines git_stash_drop command', () => {
    assert.ok(
      gitSrc.includes('pub fn git_stash_drop('),
      'Should define pub fn git_stash_drop'
    );
  });

  it('all stash commands have #[tauri::command] attribute', () => {
    // Each fn should be preceded by #[tauri::command]
    const fns = ['git_stash_save', 'git_stash_list', 'git_stash_pop', 'git_stash_apply', 'git_stash_drop'];
    for (const fn of fns) {
      const idx = gitSrc.indexOf(`pub fn ${fn}(`);
      assert.ok(idx > 0, `Should find pub fn ${fn}`);
      // Look backwards from the function for #[tauri::command]
      const preceding = gitSrc.substring(Math.max(0, idx - 200), idx);
      assert.ok(
        preceding.includes('#[tauri::command]'),
        `${fn} should have #[tauri::command] attribute`
      );
    }
  });
});

// ============ Command parameters ============

describe('git.rs -- stash command parameters', () => {
  it('git_stash_save accepts optional message and root', () => {
    assert.ok(
      gitSrc.includes('git_stash_save(message: Option<String>, root: Option<String>)'),
      'git_stash_save should accept message: Option<String>, root: Option<String>'
    );
  });

  it('git_stash_list accepts root', () => {
    assert.ok(
      gitSrc.includes('git_stash_list(root: Option<String>)'),
      'git_stash_list should accept root: Option<String>'
    );
  });

  it('git_stash_pop accepts optional index and root', () => {
    assert.ok(
      gitSrc.includes('git_stash_pop(index: Option<u32>, root: Option<String>)'),
      'git_stash_pop should accept index: Option<u32>, root: Option<String>'
    );
  });

  it('git_stash_apply accepts optional index and root', () => {
    assert.ok(
      gitSrc.includes('git_stash_apply(index: Option<u32>, root: Option<String>)'),
      'git_stash_apply should accept index: Option<u32>, root: Option<String>'
    );
  });

  it('git_stash_drop accepts index and root', () => {
    assert.ok(
      gitSrc.includes('git_stash_drop(index: u32, root: Option<String>)'),
      'git_stash_drop should accept index: u32, root: Option<String>'
    );
  });
});

// ============ Git operations ============

describe('git.rs -- stash git operations', () => {
  it('git_stash_save runs git stash push', () => {
    assert.ok(
      gitSrc.includes('"stash", "push"'),
      'git_stash_save should run git stash push'
    );
  });

  it('git_stash_list runs git stash list', () => {
    assert.ok(
      gitSrc.includes('"stash", "list"'),
      'git_stash_list should run git stash list'
    );
  });

  it('git_stash_pop runs git stash pop', () => {
    assert.ok(
      gitSrc.includes('"stash", "pop"'),
      'git_stash_pop should run git stash pop'
    );
  });

  it('git_stash_apply runs git stash apply', () => {
    assert.ok(
      gitSrc.includes('"stash", "apply"'),
      'git_stash_apply should run git stash apply'
    );
  });

  it('git_stash_drop runs git stash drop', () => {
    assert.ok(
      gitSrc.includes('"stash", "drop"'),
      'git_stash_drop should run git stash drop'
    );
  });
});

// ============ lib.rs registration ============

describe('lib.rs -- stash command registration', () => {
  it('registers git_stash_save', () => {
    assert.ok(
      libSrc.includes('files_cmds::git_stash_save'),
      'lib.rs should register git_stash_save'
    );
  });

  it('registers git_stash_list', () => {
    assert.ok(
      libSrc.includes('files_cmds::git_stash_list'),
      'lib.rs should register git_stash_list'
    );
  });

  it('registers git_stash_pop', () => {
    assert.ok(
      libSrc.includes('files_cmds::git_stash_pop'),
      'lib.rs should register git_stash_pop'
    );
  });

  it('registers git_stash_apply', () => {
    assert.ok(
      libSrc.includes('files_cmds::git_stash_apply'),
      'lib.rs should register git_stash_apply'
    );
  });

  it('registers git_stash_drop', () => {
    assert.ok(
      libSrc.includes('files_cmds::git_stash_drop'),
      'lib.rs should register git_stash_drop'
    );
  });
});

// ============ Return types ============

describe('git.rs -- stash return types', () => {
  it('git_stash_save returns IpcResponse', () => {
    assert.ok(
      gitSrc.includes('fn git_stash_save(') && gitSrc.includes('-> IpcResponse'),
      'git_stash_save should return IpcResponse'
    );
  });

  it('git_stash_list returns stashes array', () => {
    assert.ok(
      gitSrc.includes('"stashes"'),
      'git_stash_list should return a stashes field'
    );
  });

  it('git_stash_list parses index, branch, and message', () => {
    assert.ok(gitSrc.includes('"index"'), 'Should parse stash index');
    assert.ok(gitSrc.includes('"branch"'), 'Should parse stash branch');
    assert.ok(gitSrc.includes('"message"'), 'Should parse stash message');
  });
});
