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
      src.includes("invoke('get_git_changes')"),
      'Should call invoke with get_git_changes'
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
