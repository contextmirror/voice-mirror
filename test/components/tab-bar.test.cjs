/**
 * tab-bar.test.cjs -- Source-inspection tests for TabBar.svelte
 *
 * Validates the tab strip UI component for Lens mode.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/TabBar.svelte'),
  'utf-8'
);

describe('TabBar.svelte', () => {
  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });

  it('has tab-bar CSS class', () => {
    assert.ok(src.includes('tab-bar'), 'Should have tab-bar class');
  });

  it('has tab buttons for each tab', () => {
    assert.ok(src.includes('class="tab"') || src.includes("class='tab'"), 'Should have tab class');
  });

  it('has class:active directive', () => {
    assert.ok(src.includes('class:active'), 'Should use class:active');
  });

  it('has class:preview directive', () => {
    assert.ok(src.includes('class:preview'), 'Should use class:preview');
  });

  it('has class:dirty directive', () => {
    assert.ok(src.includes('class:dirty'), 'Should use class:dirty');
  });

  it('has tab-action button with pin indicator', () => {
    assert.ok(src.includes('tab-action'), 'Should have tab-action class');
    assert.ok(src.includes('icon-pin'), 'Should have pin icon');
    assert.ok(src.includes('icon-close'), 'Should have close icon');
  });

  it('has add button with tab-add class', () => {
    assert.ok(src.includes('tab-add'), 'Should have tab-add class');
  });

  it('has dirty-dot indicator', () => {
    assert.ok(src.includes('dirty-dot'), 'Should have dirty-dot class');
  });

  it('has aria-label on add button', () => {
    assert.ok(src.includes('aria-label="Open file"'), 'Should have aria-label on add');
  });

  it('uses @tauri-apps/plugin-dialog for file picker', () => {
    assert.ok(src.includes('@tauri-apps/plugin-dialog'), 'Should import dialog plugin');
  });

  it('has ondblclick for pinning tabs', () => {
    assert.ok(src.includes('ondblclick'), 'Should have ondblclick handler');
  });

  it('has stopPropagation on close button', () => {
    assert.ok(src.includes('stopPropagation'), 'Should prevent event bubbling on close');
  });

  it('has title attribute for full path', () => {
    assert.ok(src.includes('title={tab.path'), 'Should show full path on hover');
  });

  it('renders tab title', () => {
    assert.ok(src.includes('tab-title'), 'Should have tab-title element');
  });

  it('has tab icon SVG', () => {
    assert.ok(src.includes('tab-icon'), 'Should have tab-icon class');
  });

  it('preview tabs have italic title', () => {
    assert.ok(src.includes('font-style: italic'), 'Should italicize preview tab titles');
  });

  it('active tabs have visual distinction', () => {
    assert.ok(
      src.includes('.tab.active'),
      'Should have .tab.active CSS rule'
    );
  });

  it('has horizontal scrolling for overflow', () => {
    assert.ok(src.includes('overflow-x'), 'Should handle tab overflow');
  });
});

describe('TabBar.svelte: file picker', () => {
  it('has handleAddFile function', () => {
    assert.ok(src.includes('handleAddFile'), 'Should have add file handler');
  });

  it('opens dialog with multiple selection', () => {
    assert.ok(src.includes('multiple: true'), 'Should allow multiple file selection');
  });

  it('pins explicitly opened files', () => {
    assert.ok(src.includes('pinTab'), 'Should pin files opened via picker');
  });
});

describe('TabBar.svelte: icon mapping', () => {
  it('has getTabIcon function', () => {
    assert.ok(src.includes('getTabIcon'), 'Should have icon mapping function');
  });

  it('does not have globe icon (browser decoupled)', () => {
    // Browser is no longer a tab type — it's a fixed UI element
    assert.ok(!src.includes("'globe'"), 'Should not have globe icon for browser');
  });

  it('returns diff icon for diff tabs', () => {
    assert.ok(src.includes("'diff'"), 'Should return diff for diff tab type');
  });

  it('imports getTabIcon from shared tab-utils', () => {
    assert.ok(src.includes("import { getTabIcon } from '$lib/tab-utils.js'"), 'Should import getTabIcon from shared utility');
  });
});

describe('TabBar.svelte: close all tabs', () => {
  it('has close-all button', () => {
    assert.ok(src.includes('tab-close-all'), 'Should have tab-close-all class');
  });

  it('calls closeAll on click', () => {
    assert.ok(src.includes('closeAll()'), 'Should call closeAll');
  });

  it('only shows when file tabs are open', () => {
    assert.ok(src.includes('tabs.length > 1'), 'Should conditionally show close-all');
  });

  it('has aria-label on close-all button', () => {
    assert.ok(src.includes('aria-label="Close all tabs"'), 'Should have aria-label');
  });

  it('highlights danger color on hover', () => {
    assert.ok(src.includes('.tab-close-all:hover'), 'Should have hover style');
    assert.ok(src.includes('var(--danger)'), 'Should use danger color on hover');
  });
});

describe('TabBar.svelte: read-only tab indicator', () => {
  it('shows lock icon for readOnly tabs', () => {
    assert.ok(src.includes('tab.readOnly'), 'Should check tab.readOnly');
    assert.ok(src.includes('tab-lock'), 'Should have tab-lock class');
  });

  it('has lock SVG with correct path', () => {
    assert.ok(
      src.includes('M7 11V7a5 5 0 0 1 10 0v4'),
      'Should render lock icon SVG'
    );
  });

  it('has aria-label on lock icon', () => {
    assert.ok(
      src.includes('aria-label="Read-only"'),
      'Should have accessible label on lock icon'
    );
  });
});

describe('TabBar.svelte: diff tab support', () => {
  it('uses TabDiffBadge component for diff badges', () => {
    assert.ok(src.includes("import TabDiffBadge from './TabDiffBadge.svelte'"), 'Should import TabDiffBadge');
    assert.ok(src.includes('<TabDiffBadge'), 'Should render TabDiffBadge component');
  });

  it('has diff icon SVG path', () => {
    // git-compare icon: two circles with connecting path
    assert.ok(
      src.includes("getTabIcon(tab) === 'diff'"),
      'Should render diff-specific icon'
    );
  });
});

