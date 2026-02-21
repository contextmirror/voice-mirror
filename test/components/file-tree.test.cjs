/**
 * file-tree.test.js -- Source-inspection tests for FileTree.svelte
 *
 * Validates imports, state, UI structure, behavior, and styles of the
 * FileTree component by reading source text and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../src/components/lens/FileTree.svelte');
const src = fs.readFileSync(filePath, 'utf-8');

describe('FileTree.svelte', () => {
  it('exists and has content', () => {
    assert.ok(src.length > 0);
  });

  // ── Imports ──

  it('imports listDirectory from api', () => {
    assert.ok(src.includes('listDirectory'), 'Should import listDirectory');
    assert.ok(src.includes("from '../../lib/api.js'"), 'Should import from api.js');
  });

  it('imports getGitChanges from api', () => {
    assert.ok(src.includes('getGitChanges'), 'Should import getGitChanges');
  });

  // ── Props ──

  it('accepts onFileClick prop via $props()', () => {
    assert.ok(src.includes('onFileClick'), 'Should have onFileClick');
    assert.ok(src.includes('$props()'), 'Should use $props()');
  });

  // ── State management ──

  it('uses $state for activeTab', () => {
    assert.ok(src.includes("activeTab = $state("), 'Should have activeTab state');
  });

  it('uses $state for rootEntries', () => {
    assert.ok(src.includes("rootEntries = $state("), 'Should have rootEntries state');
  });

  it('uses $state for expandedDirs', () => {
    assert.ok(src.includes("expandedDirs = $state("), 'Should have expandedDirs state');
  });

  it('uses $state for dirChildren', () => {
    assert.ok(src.includes("dirChildren = $state("), 'Should have dirChildren state');
  });

  it('uses $state for loadingDirs', () => {
    assert.ok(src.includes("loadingDirs = $state("), 'Should have loadingDirs state');
  });

  it('uses $state for gitChanges', () => {
    assert.ok(src.includes("gitChanges = $state("), 'Should have gitChanges state');
  });

  // ── Lifecycle ──

  it('uses $effect for lifecycle', () => {
    assert.ok(src.includes('$effect('), 'Should use $effect for mount');
  });

  it('loads root directory on mount', () => {
    assert.ok(src.includes('loadRoot'), 'Should have loadRoot function');
  });

  it('loads git changes on mount', () => {
    assert.ok(src.includes('loadGitChanges'), 'Should have loadGitChanges function');
  });

  // ── UI: Tabs ──

  it('has All files tab', () => {
    assert.ok(src.includes('All files'), 'Should have All files tab text');
  });

  it('has Changes tab', () => {
    assert.ok(src.includes('Changes'), 'Should have Changes tab text');
  });

  it('tracks active tab with class:active', () => {
    assert.ok(src.includes("class:active={activeTab === 'files'}"), 'files tab has active class');
    assert.ok(src.includes("class:active={activeTab === 'changes'}"), 'changes tab has active class');
  });

  // ── UI: Tree structure ──

  it('has chevron icons for expand/collapse', () => {
    assert.ok(src.includes('tree-chevron'), 'Should have tree chevron class');
  });

  it('renders tree items with folder and file types', () => {
    assert.ok(src.includes('tree-item folder'), 'Should have folder tree items');
    assert.ok(src.includes('tree-item file'), 'Should have file tree items');
  });

  it('renders recursively with depth via snippet', () => {
    assert.ok(src.includes('treeNode'), 'Should have treeNode snippet');
    assert.ok(src.includes('depth + 1'), 'Should recurse with incremented depth');
    assert.ok(src.includes('depth * 16'), 'Should indent based on depth');
  });

  it('shows loading state for expanding directories', () => {
    assert.ok(src.includes('tree-loading'), 'Should have loading class');
    assert.ok(src.includes('loadingDirs'), 'Should track loading directories');
  });

  // ── Behavior ──

  it('has toggle directory function', () => {
    assert.ok(src.includes('toggleDir'), 'Should have toggleDir function');
  });

  it('toggle expands and collapses via expandedDirs set', () => {
    assert.ok(src.includes('expandedDirs.has('), 'Should check expandedDirs membership');
    assert.ok(src.includes('.delete(path)'), 'Should delete from set to collapse');
    assert.ok(src.includes('.add(path)'), 'Should add to set to expand');
  });

  it('lazy-loads directory children on first expand', () => {
    assert.ok(src.includes('dirChildren.has(path)'), 'Should check if children are cached');
    assert.ok(src.includes('listDirectory(path, root)'), 'Should load children via API with project root');
  });

  it('handles file click by calling onFileClick', () => {
    assert.ok(src.includes('handleFileClick'), 'Should have handleFileClick function');
    assert.ok(src.includes('onFileClick(entry)'), 'Should delegate to onFileClick prop');
  });

  // ── Error handling ──

  it('has error handling for API calls', () => {
    const catchCount = (src.match(/catch\s*\(/g) || []).length;
    assert.ok(catchCount >= 2, `Should have at least 2 catch blocks, found ${catchCount}`);
  });

  it('logs errors to console', () => {
    assert.ok(src.includes('console.error'), 'Should log errors');
  });

  // ── Git changes display ──

  it('shows status badges for changes (A/M/D)', () => {
    assert.ok(src.includes('change-badge'), 'Should have change badge class');
    assert.ok(src.includes("'A'"), 'Should show A for added');
    assert.ok(src.includes("'D'"), 'Should show D for deleted');
    assert.ok(src.includes("'M'"), 'Should show M for modified');
  });

  it('has styled badges for added/modified/deleted', () => {
    assert.ok(src.includes('class:added'), 'Should have added class');
    assert.ok(src.includes('class:modified'), 'Should have modified class');
    assert.ok(src.includes('class:deleted'), 'Should have deleted class');
  });

  it('handles empty changes state', () => {
    assert.ok(src.includes('No changes'), 'Should show empty state for no changes');
    assert.ok(src.includes('changes-empty'), 'Should have empty state class');
  });

  it('shows change file path', () => {
    assert.ok(src.includes('change-path'), 'Should have change-path class');
    assert.ok(src.includes('change.path'), 'Should render change path');
  });

  // ── Ignored files ──

  it('handles ignored files with dimmed style', () => {
    assert.ok(src.includes('class:ignored'), 'Should have ignored class toggle');
    assert.ok(src.includes('.tree-name.ignored'), 'Should style ignored files');
    assert.ok(src.includes('opacity'), 'Should dim ignored files');
  });

  // ── Styles ──

  it('has scoped styles', () => {
    assert.ok(src.includes('<style>'), 'Should have scoped style block');
  });

  it('uses CSS variables for theming', () => {
    assert.ok(src.includes('var(--bg)'), 'Should use --bg variable');
    assert.ok(src.includes('var(--text)'), 'Should use --text variable');
    assert.ok(src.includes('var(--muted)'), 'Should use --muted variable');
    assert.ok(src.includes('var(--accent)'), 'Should use --accent variable');
  });

  it('uses monospace font for tree items', () => {
    assert.ok(src.includes('var(--font-mono)'), 'Should use monospace font');
  });

  it('has hover styling for tree items', () => {
    assert.ok(src.includes('.tree-item:hover'), 'Should style tree item hover');
    assert.ok(src.includes('var(--bg-elevated)'), 'Should use elevated bg on hover');
  });

  it('uses no-drag for frameless window compatibility', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'), 'Should have no-drag for interactivity');
  });

  it('has files-area as root container', () => {
    assert.ok(src.includes('.files-area'), 'Should have files-area class');
    assert.ok(src.includes("class=\"files-area\""), 'Should use files-area on root element');
  });

  it('has scrollable tree container', () => {
    assert.ok(src.includes('tree-scroll'), 'Should have tree-scroll class');
    assert.ok(src.includes('overflow-y: auto'), 'Should be scrollable');
  });

  it('has git change color coding', () => {
    assert.ok(src.includes('var(--ok)'), 'Should use ok color for added');
    assert.ok(src.includes('var(--danger)'), 'Should use danger color for deleted');
  });

  // ── Project store integration ──

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('passes root to listDirectory calls', () => {
    assert.ok(
      src.includes('listDirectory(null, root') || src.includes('listDirectory(path, root'),
      'Should pass root parameter to listDirectory'
    );
  });

  it('passes root to getGitChanges calls', () => {
    assert.ok(
      src.includes('getGitChanges(root') || src.includes('getGitChanges(projectRoot'),
      'Should pass root parameter to getGitChanges'
    );
  });
});
