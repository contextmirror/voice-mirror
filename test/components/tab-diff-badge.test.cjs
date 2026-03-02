/**
 * tab-diff-badge.test.cjs -- Source-inspection tests for TabDiffBadge.svelte
 *
 * Validates the shared diff badge component extracted from TabBar and GroupTabBar.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/TabDiffBadge.svelte'),
  'utf-8'
);

describe('TabDiffBadge.svelte: structure', () => {
  it('uses $props for component inputs', () => {
    assert.ok(src.includes('$props()'), 'Should use $props rune');
  });

  it('accepts tab prop', () => {
    assert.ok(src.includes('tab'), 'Should destructure tab from props');
  });
});

describe('TabDiffBadge.svelte: diff stats display', () => {
  it('conditionally renders diff stats when tab has diffStats', () => {
    assert.ok(src.includes("tab.type === 'diff' && tab.diffStats"), 'Should check for diff type with diffStats');
  });

  it('shows additions count', () => {
    assert.ok(src.includes('tab.diffStats.additions'), 'Should display additions');
    assert.ok(src.includes('tab-diff-stats-add'), 'Should have additions CSS class');
  });

  it('shows deletions count', () => {
    assert.ok(src.includes('tab.diffStats.deletions'), 'Should display deletions');
    assert.ok(src.includes('tab-diff-stats-del'), 'Should have deletions CSS class');
  });
});

describe('TabDiffBadge.svelte: status badge display', () => {
  it('conditionally renders status badge when tab has status', () => {
    assert.ok(src.includes("tab.type === 'diff' && tab.status"), 'Should check for diff type with status');
  });

  it('has added/modified/deleted class bindings', () => {
    assert.ok(src.includes("tab.status === 'added'"), 'Should check added status');
    assert.ok(src.includes("tab.status === 'modified'"), 'Should check modified status');
    assert.ok(src.includes("tab.status === 'deleted'"), 'Should check deleted status');
  });

  it('renders A/M/D letter badges', () => {
    assert.ok(src.includes("'A'"), 'Should render A for added');
    assert.ok(src.includes("'D'"), 'Should render D for deleted');
    assert.ok(src.includes("'M'"), 'Should render M for modified');
  });
});

describe('TabDiffBadge.svelte: CSS styles', () => {
  it('has tab-diff-badge styles', () => {
    assert.ok(src.includes('.tab-diff-badge'), 'Should have .tab-diff-badge CSS');
  });

  it('has color styles for added/modified/deleted', () => {
    assert.ok(src.includes('.tab-diff-badge.added'), 'Should style .added');
    assert.ok(src.includes('.tab-diff-badge.modified'), 'Should style .modified');
    assert.ok(src.includes('.tab-diff-badge.deleted'), 'Should style .deleted');
  });

  it('has tab-diff-stats styles', () => {
    assert.ok(src.includes('.tab-diff-stats'), 'Should have .tab-diff-stats CSS');
  });

  it('uses monospace font for stats', () => {
    assert.ok(src.includes('var(--font-mono)'), 'Should use monospace font for stats');
  });
});

describe('TabDiffBadge integration: TabBar.svelte', () => {
  const tabBarSrc = fs.readFileSync(
    path.join(__dirname, '../../src/components/lens/TabBar.svelte'),
    'utf-8'
  );

  it('imports TabDiffBadge', () => {
    assert.ok(tabBarSrc.includes("import TabDiffBadge from './TabDiffBadge.svelte'"), 'TabBar should import TabDiffBadge');
  });

  it('uses <TabDiffBadge> component', () => {
    assert.ok(tabBarSrc.includes('<TabDiffBadge'), 'TabBar should render TabDiffBadge');
  });

  it('no longer has inline tab-diff-badge CSS', () => {
    assert.ok(!tabBarSrc.includes('.tab-diff-badge'), 'TabBar should not have .tab-diff-badge CSS (moved to component)');
  });

  it('no longer has inline tab-diff-stats CSS', () => {
    assert.ok(!tabBarSrc.includes('.tab-diff-stats'), 'TabBar should not have .tab-diff-stats CSS (moved to component)');
  });
});

describe('TabDiffBadge integration: GroupTabBar.svelte', () => {
  const groupTabBarSrc = fs.readFileSync(
    path.join(__dirname, '../../src/components/lens/GroupTabBar.svelte'),
    'utf-8'
  );

  it('imports TabDiffBadge', () => {
    assert.ok(groupTabBarSrc.includes("import TabDiffBadge from './TabDiffBadge.svelte'"), 'GroupTabBar should import TabDiffBadge');
  });

  it('uses <TabDiffBadge> component', () => {
    assert.ok(groupTabBarSrc.includes('<TabDiffBadge'), 'GroupTabBar should render TabDiffBadge');
  });

  it('no longer has inline tab-diff-badge CSS', () => {
    assert.ok(!groupTabBarSrc.includes('.tab-diff-badge'), 'GroupTabBar should not have .tab-diff-badge CSS (moved to component)');
  });

  it('no longer has inline tab-diff-stats CSS', () => {
    assert.ok(!groupTabBarSrc.includes('.tab-diff-stats'), 'GroupTabBar should not have .tab-diff-stats CSS (moved to component)');
  });
});
