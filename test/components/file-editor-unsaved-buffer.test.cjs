/**
 * file-editor-unsaved-buffer.test.cjs -- guards the fix for the tab-switch
 * data-loss bug (launch BL3): switching the active tab destroys + recreates the
 * single CodeMirror view, so unsaved edits must be cached per-tab and restored.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/FileEditor.svelte'),
  'utf-8'
);

describe('FileEditor: unsaved-buffer preservation across tab switches', () => {
  it('maintains a per-tab unsaved-buffer cache', () => {
    assert.ok(src.includes('unsavedBuffers'), 'should keep an unsavedBuffers cache');
    assert.ok(/const unsavedBuffers = new Map\(\)/.test(src), 'cache is a Map');
  });

  it('snapshots the outgoing tab buffer only when it is still dirty', () => {
    assert.ok(src.includes('unsavedBuffers.set(loadedTab.id'), 'caches the leaving tab content');
    assert.ok(/prev\?\.dirty/.test(src), 'only caches when the tab is dirty (clean tabs re-read disk)');
  });

  it('re-seeds the cached buffer as the new editor doc on return', () => {
    assert.ok(src.includes('unsavedBuffers.has(tab.id)'), 'checks cache on load');
    assert.ok(src.includes('doc: initialDoc'), 'editor state uses the (possibly restored) initialDoc');
  });

  it('clears the cache entry once the tab is saved', () => {
    assert.ok(src.includes('unsavedBuffers.delete(tab.id)'), 'save() drops the stale cache entry');
  });
});
