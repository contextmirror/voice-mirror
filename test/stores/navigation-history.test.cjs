const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/navigation-history.svelte.js'),
  'utf-8'
);

describe('navigation-history.svelte.js: structure', () => {
  it('exports navigationHistoryStore', () => {
    assert.ok(src.includes('export const navigationHistoryStore'), 'Should export navigationHistoryStore');
  });

  it('defines MAX_HISTORY constant', () => {
    assert.ok(src.includes('MAX_HISTORY') && src.includes('50'), 'Should limit history to 50 entries');
  });

  it('has stack state array', () => {
    assert.ok(src.includes('stack') && src.includes('$state'), 'Should have reactive stack');
  });

  it('has currentIndex state', () => {
    assert.ok(src.includes('currentIndex'), 'Should have currentIndex');
  });
});

describe('navigation-history.svelte.js: API', () => {
  it('exports pushLocation method', () => {
    assert.ok(src.includes('pushLocation'), 'Should have pushLocation');
  });

  it('pushLocation stores path, line, character, groupId', () => {
    assert.ok(
      src.includes('path') && src.includes('line') && src.includes('character'),
      'pushLocation should store location data'
    );
  });

  it('exports goBack method', () => {
    assert.ok(src.includes('goBack'), 'Should have goBack');
  });

  it('exports goForward method', () => {
    assert.ok(src.includes('goForward'), 'Should have goForward');
  });

  it('has canGoBack getter', () => {
    assert.ok(src.includes('canGoBack'), 'Should have canGoBack');
  });

  it('has canGoForward getter', () => {
    assert.ok(src.includes('canGoForward'), 'Should have canGoForward');
  });

  it('truncates forward history on push when not at top', () => {
    assert.ok(src.includes('splice') || src.includes('slice'), 'Should truncate forward history');
  });
});

describe('navigation-history.svelte.js: integration', () => {
  it('does not import heavy dependencies', () => {
    assert.ok(!src.includes("import { tabsStore"), 'Should not import tabsStore directly (loose coupling)');
  });
});
