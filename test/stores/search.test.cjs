/**
 * search.test.cjs -- Source-inspection tests for search.svelte.js
 *
 * Validates exports, $state usage, methods, imports, and stale-response
 * handling by reading the source file and asserting string patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/search.svelte.js'),
  'utf-8'
);

// ============ Exports ============

describe('search store: exports', () => {
  it('exports searchStore', () => {
    assert.ok(src.includes('export const searchStore'), 'Should export searchStore');
  });

  it('searchStore is created via createSearchStore()', () => {
    assert.ok(src.includes('createSearchStore()'), 'Should call createSearchStore()');
  });
});

// ============ Imports ============

describe('search store: imports', () => {
  it('imports searchContent from api.js', () => {
    assert.ok(
      src.includes("import { searchContent } from '../api.js'"),
      'Should import searchContent from api.js'
    );
  });

  it('imports projectStore from project.svelte.js', () => {
    assert.ok(
      src.includes("import { projectStore } from './project.svelte.js'"),
      'Should import projectStore'
    );
  });
});

// ============ $state reactivity ============

describe('search store: $state reactivity', () => {
  it('uses $state for query', () => {
    assert.ok(/let\s+query\s*=\s*\$state\(/.test(src), 'Should use $state for query');
  });

  it('uses $state for caseSensitive', () => {
    assert.ok(/let\s+caseSensitive\s*=\s*\$state\(/.test(src), 'Should use $state for caseSensitive');
  });

  it('uses $state for isRegex', () => {
    assert.ok(/let\s+isRegex\s*=\s*\$state\(/.test(src), 'Should use $state for isRegex');
  });

  it('uses $state for wholeWord', () => {
    assert.ok(/let\s+wholeWord\s*=\s*\$state\(/.test(src), 'Should use $state for wholeWord');
  });

  it('uses $state for includePattern', () => {
    assert.ok(/let\s+includePattern\s*=\s*\$state\(/.test(src), 'Should use $state for includePattern');
  });

  it('uses $state for excludePattern', () => {
    assert.ok(/let\s+excludePattern\s*=\s*\$state\(/.test(src), 'Should use $state for excludePattern');
  });

  it('uses $state for results', () => {
    assert.ok(/let\s+results\s*=\s*\$state\(/.test(src), 'Should use $state for results');
  });

  it('uses $state for totalMatches', () => {
    assert.ok(/let\s+totalMatches\s*=\s*\$state\(/.test(src), 'Should use $state for totalMatches');
  });

  it('uses $state for truncated', () => {
    assert.ok(/let\s+truncated\s*=\s*\$state\(/.test(src), 'Should use $state for truncated');
  });

  it('uses $state for loading', () => {
    assert.ok(/let\s+loading\s*=\s*\$state\(/.test(src), 'Should use $state for loading');
  });

  it('uses $state for error', () => {
    assert.ok(/let\s+error\s*=\s*\$state\(/.test(src), 'Should use $state for error');
  });

  it('uses $state for collapsedFiles', () => {
    assert.ok(/let\s+collapsedFiles\s*=\s*\$state\(/.test(src), 'Should use $state for collapsedFiles');
  });
});

// ============ Getters ============

describe('search store: getters', () => {
  const expectedGetters = [
    'query', 'caseSensitive', 'isRegex', 'wholeWord',
    'includePattern', 'excludePattern', 'results', 'totalMatches',
    'truncated', 'loading', 'error', 'collapsedFiles',
  ];

  for (const name of expectedGetters) {
    it(`has getter for ${name}`, () => {
      assert.ok(
        src.includes(`get ${name}()`),
        `Should have getter for ${name}`
      );
    });
  }
});

// ============ Setter methods ============

describe('search store: setter methods', () => {
  const expectedSetters = [
    'setQuery', 'setCaseSensitive', 'setIsRegex',
    'setWholeWord', 'setIncludePattern', 'setExcludePattern',
  ];

  for (const name of expectedSetters) {
    it(`has ${name} method`, () => {
      assert.ok(
        src.includes(`${name}(`),
        `Should have ${name} method`
      );
    });
  }
});

// ============ search() method ============

describe('search store: search() method', () => {
  it('has async search() method', () => {
    assert.ok(src.includes('async search()'), 'Should have async search method');
  });

  it('calls searchContent from api', () => {
    assert.ok(
      src.includes('await searchContent('),
      'search() should call searchContent'
    );
  });

  it('passes query to searchContent', () => {
    assert.ok(
      src.includes('searchContent(query'),
      'search() should pass query to searchContent'
    );
  });

  it('passes search options (caseSensitive, isRegex, wholeWord)', () => {
    assert.ok(src.includes('caseSensitive:'), 'Should pass caseSensitive option');
    assert.ok(src.includes('isRegex:'), 'Should pass isRegex option');
    assert.ok(src.includes('wholeWord:'), 'Should pass wholeWord option');
  });

  it('passes include/exclude patterns', () => {
    assert.ok(src.includes('includePattern:'), 'Should pass includePattern option');
    assert.ok(src.includes('excludePattern:'), 'Should pass excludePattern option');
  });

  it('reads project root from projectStore', () => {
    assert.ok(
      src.includes('projectStore.activeProject'),
      'search() should read project root from projectStore'
    );
  });

  it('clears if query is empty', () => {
    assert.ok(
      src.includes('!query.trim()'),
      'search() should guard against empty query'
    );
    assert.ok(
      src.includes('this.clear()'),
      'search() should call clear() for empty query'
    );
  });

  it('sets loading to true at start', () => {
    assert.ok(
      src.includes('loading = true'),
      'search() should set loading to true'
    );
  });

  it('sets loading to false in finally block', () => {
    assert.ok(
      src.includes('loading = false'),
      'search() should set loading to false in finally'
    );
  });

  it('handles error responses', () => {
    assert.ok(
      src.includes('error = String(err)'),
      'search() should convert caught errors to strings'
    );
  });
});

// ============ Stale response handling ============

describe('search store: stale response handling', () => {
  it('has searchId counter', () => {
    assert.ok(src.includes('let searchId'), 'Should have searchId counter');
  });

  it('increments searchId on each search', () => {
    assert.ok(src.includes('++searchId'), 'Should increment searchId');
  });

  it('checks for stale response after async call', () => {
    assert.ok(
      src.includes('id !== searchId'),
      'Should check if response is stale by comparing id to searchId'
    );
  });
});

// ============ clear() method ============

describe('search store: clear() method', () => {
  it('has clear() method', () => {
    assert.ok(src.includes('clear()'), 'Should have clear method');
  });

  it('resets query to empty string', () => {
    // clear() contains: query = '';
    assert.ok(
      src.includes("query = ''"),
      'clear() should reset query'
    );
  });

  it('resets results to empty array', () => {
    assert.ok(
      src.includes('results = []'),
      'clear() should reset results'
    );
  });

  it('resets collapsedFiles to new Set', () => {
    assert.ok(
      src.includes('collapsedFiles = new Set()'),
      'clear() should reset collapsedFiles'
    );
  });
});

// ============ toggleFileCollapsed ============

describe('search store: toggleFileCollapsed', () => {
  it('has toggleFileCollapsed method', () => {
    assert.ok(
      src.includes('toggleFileCollapsed('),
      'Should have toggleFileCollapsed method'
    );
  });

  it('creates a new Set for immutable update', () => {
    assert.ok(
      src.includes('new Set(collapsedFiles)'),
      'toggleFileCollapsed should create new Set for reactivity'
    );
  });

  it('toggles: adds if not present, deletes if present', () => {
    assert.ok(src.includes('next.has(path)'), 'Should check if path is in set');
    assert.ok(src.includes('next.delete(path)'), 'Should delete if present');
    assert.ok(src.includes('next.add(path)'), 'Should add if not present');
  });
});

// ============ Response data mapping ============

describe('search store: response data mapping', () => {
  it('reads matches from resp.data.matches', () => {
    assert.ok(
      src.includes('resp.data.matches'),
      'Should read matches from response data'
    );
  });

  it('reads totalMatches from resp.data.totalMatches', () => {
    assert.ok(
      src.includes('resp.data.totalMatches'),
      'Should read totalMatches from response data'
    );
  });

  it('reads truncated from resp.data.truncated', () => {
    assert.ok(
      src.includes('resp.data.truncated'),
      'Should read truncated flag from response data'
    );
  });
});
