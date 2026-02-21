/**
 * api-files.test.js -- Source-inspection tests for file/directory API wrappers
 *
 * Verifies the listDirectory, getGitChanges, and getProjectRoot functions
 * exist in api.js with correct invoke() calls and parameter passing.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- Files section', () => {
  it('has a Files section comment', () => {
    assert.ok(
      src.includes('// ============ Files'),
      'Should have organized Files section'
    );
  });
});

describe('api.js -- listDirectory', () => {
  it('exports async function listDirectory', () => {
    assert.ok(
      src.includes('export async function listDirectory('),
      'Should export listDirectory'
    );
  });

  it('invokes list_directory command', () => {
    assert.ok(
      src.includes("invoke('list_directory'"),
      'Should call invoke with list_directory'
    );
  });

  it('passes path parameter', () => {
    assert.ok(
      src.includes('{ path:'),
      'Should pass path to invoke'
    );
  });

  it('handles null path for root directory', () => {
    assert.ok(
      src.includes('path || null') || src.includes('path ?? null'),
      'Should default path to null for root listing'
    );
  });

  it('accepts root parameter', () => {
    assert.ok(
      src.includes('listDirectory(path, root)') || src.includes('listDirectory(path,root)'),
      'Should accept root parameter'
    );
  });

  it('passes root to invoke call', () => {
    assert.ok(
      src.includes('root: root || null') || src.includes('root: root ?? null'),
      'Should pass root to invoke as root || null'
    );
  });
});

describe('api.js -- getGitChanges', () => {
  it('exports async function getGitChanges', () => {
    assert.ok(
      src.includes('export async function getGitChanges('),
      'Should export getGitChanges'
    );
  });

  it('invokes get_git_changes command', () => {
    assert.ok(
      src.includes("invoke('get_git_changes'"),
      'Should call invoke with get_git_changes'
    );
  });

  it('accepts root parameter in function signature', () => {
    assert.ok(
      src.includes('getGitChanges(root)') || src.includes('getGitChanges(root,'),
      'Should accept root parameter'
    );
  });

  it('passes root parameter to invoke', () => {
    assert.ok(
      src.includes('root: root || null') || src.includes('root ?? null'),
      'Should pass root to invoke for get_git_changes'
    );
  });
});

describe('api.js -- getProjectRoot', () => {
  it('exports async function getProjectRoot', () => {
    assert.ok(
      src.includes('export async function getProjectRoot('),
      'Should export getProjectRoot'
    );
  });

  it('invokes get_project_root command', () => {
    assert.ok(
      src.includes("invoke('get_project_root')"),
      'Should call invoke with get_project_root'
    );
  });
});

describe('api.js -- readFile', () => {
  it('exports async function readFile', () => {
    assert.ok(
      src.includes('export async function readFile('),
      'Should export readFile'
    );
  });

  it('invokes read_file command', () => {
    assert.ok(
      src.includes("invoke('read_file'"),
      'Should call invoke with read_file'
    );
  });

  it('accepts path and root parameters', () => {
    assert.ok(
      src.includes('readFile(path, root)') || src.includes('readFile(path,root)'),
      'Should accept path and root'
    );
  });
});

describe('api.js -- writeFile', () => {
  it('exports async function writeFile', () => {
    assert.ok(
      src.includes('export async function writeFile('),
      'Should export writeFile'
    );
  });

  it('invokes write_file command', () => {
    assert.ok(
      src.includes("invoke('write_file'"),
      'Should call invoke with write_file'
    );
  });

  it('accepts path, content, and root parameters', () => {
    assert.ok(
      src.includes('writeFile(path, content, root)') || src.includes('writeFile(path,content,root)'),
      'Should accept path, content, and root'
    );
  });
});

describe('api.js -- getFileGitContent', () => {
  it('exports async function getFileGitContent', () => {
    assert.ok(
      src.includes('export async function getFileGitContent('),
      'Should export getFileGitContent'
    );
  });

  it('invokes get_file_git_content command', () => {
    assert.ok(
      src.includes("invoke('get_file_git_content'"),
      'Should call invoke with get_file_git_content'
    );
  });

  it('accepts path and root parameters', () => {
    assert.ok(
      src.includes('getFileGitContent(path, root)') || src.includes('getFileGitContent(path,root)'),
      'Should accept path and root'
    );
  });

  it('passes root || null to invoke', () => {
    assert.ok(
      src.includes('root: root || null'),
      'Should pass root || null'
    );
  });
});

describe('api.js -- startFileWatching', () => {
  it('exports async function startFileWatching', () => {
    assert.ok(
      src.includes('export async function startFileWatching('),
      'Should export startFileWatching'
    );
  });

  it('invokes start_file_watching command', () => {
    assert.ok(
      src.includes("invoke('start_file_watching'"),
      'Should call invoke with start_file_watching'
    );
  });

  it('passes projectRoot parameter', () => {
    assert.ok(
      src.includes('startFileWatching(projectRoot)'),
      'Should accept projectRoot parameter'
    );
    assert.ok(
      src.includes('{ projectRoot }') || src.includes('projectRoot'),
      'Should pass projectRoot to invoke'
    );
  });
});

describe('api.js -- stopFileWatching', () => {
  it('exports async function stopFileWatching', () => {
    assert.ok(
      src.includes('export async function stopFileWatching('),
      'Should export stopFileWatching'
    );
  });

  it('invokes stop_file_watching command', () => {
    assert.ok(
      src.includes("invoke('stop_file_watching')"),
      'Should call invoke with stop_file_watching'
    );
  });
});
