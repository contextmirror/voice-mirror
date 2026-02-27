const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storeSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/stores/terminal-tabs.svelte.js'),
  'utf-8'
);

describe('terminal-tabs store - split tree integration', () => {
  it('imports split-tree module', () => {
    assert.ok(storeSrc.includes("from '../split-tree.js'") || storeSrc.includes("from '../split-tree'"),
      'should import split-tree');
  });

  it('groups have splitTree property', () => {
    assert.ok(storeSrc.includes('splitTree'), 'groups should use splitTree');
  });

  it('addGroup creates initial leaf splitTree', () => {
    assert.ok(storeSrc.includes('createLeaf'), 'addGroup should create a leaf');
  });

  it('splitInstance uses splitLeaf with direction parameter', () => {
    assert.ok(storeSrc.includes('splitLeaf'), 'splitInstance should use splitLeaf');
  });

  it('supports split direction parameter', () => {
    assert.ok(
      storeSrc.includes("direction") && (storeSrc.includes("'horizontal'") || storeSrc.includes("'vertical'")),
      'should support direction parameter'
    );
  });

  it('killInstance uses removeLeaf', () => {
    assert.ok(storeSrc.includes('removeLeaf'), 'killInstance should use removeLeaf');
  });

  it('maintains backward-compat instanceIds getter from splitTree', () => {
    assert.ok(storeSrc.includes('getAllInstanceIds'), 'should derive instanceIds from splitTree');
  });
});

const panelSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalPanel.svelte'),
  'utf-8'
);

describe('TerminalPanel - recursive split rendering', () => {
  it('imports SplitPanel', () => {
    assert.ok(panelSrc.includes('SplitPanel'), 'should import SplitPanel');
  });

  it('handles both leaf and split node types', () => {
    assert.ok(panelSrc.includes("type === 'leaf'") || panelSrc.includes("'leaf'"),
      'should check node type for rendering');
  });

  it('renders Terminal for leaf nodes', () => {
    assert.ok(panelSrc.includes('Terminal') && panelSrc.includes('shellId'),
      'should render Terminal component for leaves');
  });

  it('handles both horizontal and vertical splits', () => {
    assert.ok(panelSrc.includes('direction'), 'should pass direction to SplitPanel');
  });

  it('uses recursive snippet or component for split nodes', () => {
    assert.ok(
      panelSrc.includes('#snippet') || panelSrc.includes('svelte:self'),
      'should use recursive rendering'
    );
  });
});

const ctxSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalContextMenu.svelte'),
  'utf-8'
);

describe('TerminalContextMenu - split direction', () => {
  it('offers Split Right option', () => {
    assert.ok(ctxSrc.includes('Split Right') || ctxSrc.includes('split-right'),
      'should have Split Right option');
  });

  it('offers Split Down option', () => {
    assert.ok(ctxSrc.includes('Split Down') || ctxSrc.includes('split-down'),
      'should have Split Down option');
  });
});

const actionBarSrc = fs.readFileSync(
  path.join(__dirname, '../../src/components/terminal/TerminalActionBar.svelte'),
  'utf-8'
);

describe('TerminalActionBar - split direction', () => {
  it('has Split Right option in dropdown', () => {
    assert.ok(actionBarSrc.includes('Split Right') || actionBarSrc.includes('split right'),
      'should have Split Right option');
  });

  it('has Split Down option in dropdown', () => {
    assert.ok(actionBarSrc.includes('Split Down') || actionBarSrc.includes('split down'),
      'should have Split Down option');
  });
});
