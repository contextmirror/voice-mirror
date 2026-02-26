/**
 * search-panel.test.cjs -- Source-inspection tests for SearchPanel.svelte
 *
 * Validates imports, props, UI elements, debounce logic, keyboard handlers,
 * and match highlighting by reading the source file and asserting patterns.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/SearchPanel.svelte'),
  'utf-8'
);

// ============ Imports ============

describe('SearchPanel: imports', () => {
  it('imports searchStore', () => {
    assert.ok(
      src.includes("import { searchStore }"),
      'Should import searchStore'
    );
  });

  it('imports from search.svelte.js', () => {
    assert.ok(
      src.includes("from '../../lib/stores/search.svelte.js'"),
      'Should import from search.svelte.js'
    );
  });

  it('imports chooseIconName from file-icons.js', () => {
    assert.ok(
      src.includes("import { chooseIconName } from '../../lib/file-icons.js'"),
      'Should import chooseIconName'
    );
  });

  it('imports SVG sprite', () => {
    assert.ok(
      src.includes('file-icons-sprite.svg'),
      'Should import file-icons sprite'
    );
  });
});

// ============ Props ============

describe('SearchPanel: props', () => {
  it('has onResultClick prop', () => {
    assert.ok(
      src.includes('onResultClick'),
      'Should have onResultClick prop'
    );
  });

  it('onResultClick has default value', () => {
    assert.ok(
      src.includes('onResultClick = () => {}'),
      'onResultClick should default to no-op'
    );
  });

  it('uses $props()', () => {
    assert.ok(
      src.includes('$props()'),
      'Should use $props()'
    );
  });
});

// ============ Search input ============

describe('SearchPanel: search input', () => {
  it('has search-input element', () => {
    assert.ok(
      src.includes('search-input'),
      'Should have search-input CSS class'
    );
  });

  it('has placeholder text', () => {
    assert.ok(
      src.includes('Search in files'),
      'Should have search placeholder'
    );
  });

  it('binds to searchStore.query via oninput', () => {
    assert.ok(
      src.includes('searchStore.setQuery'),
      'Should call setQuery on input'
    );
  });

  it('has keyboard handler on input', () => {
    assert.ok(
      src.includes('onkeydown={handleKeydown}'),
      'Should have keydown handler on input'
    );
  });
});

// ============ Toggle buttons ============

describe('SearchPanel: toggle buttons', () => {
  it('has case-sensitive toggle (Aa)', () => {
    assert.ok(
      src.includes('>Aa</button>'),
      'Should have Aa toggle for case-sensitive'
    );
  });

  it('has regex toggle (.*)', () => {
    assert.ok(
      src.includes('>.*</button>'),
      'Should have .* toggle for regex'
    );
  });

  it('has whole-word toggle (ab)', () => {
    assert.ok(
      src.includes('>ab</button>'),
      'Should have ab toggle for whole-word'
    );
  });

  it('case-sensitive toggle calls setCaseSensitive', () => {
    assert.ok(
      src.includes('searchStore.setCaseSensitive'),
      'Aa toggle should call setCaseSensitive'
    );
  });

  it('regex toggle calls setIsRegex', () => {
    assert.ok(
      src.includes('searchStore.setIsRegex'),
      'Regex toggle should call setIsRegex'
    );
  });

  it('whole-word toggle calls setWholeWord', () => {
    assert.ok(
      src.includes('searchStore.setWholeWord'),
      'Whole-word toggle should call setWholeWord'
    );
  });

  it('toggles have title attributes', () => {
    assert.ok(src.includes('title="Match case"'), 'Should have Match case title');
    assert.ok(src.includes('title="Use regex"'), 'Should have Use regex title');
    assert.ok(src.includes('title="Whole word"'), 'Should have Whole word title');
  });

  it('toggles use .active class binding', () => {
    assert.ok(
      src.includes('class:active={searchStore.caseSensitive}'),
      'caseSensitive toggle should have active binding'
    );
    assert.ok(
      src.includes('class:active={searchStore.isRegex}'),
      'isRegex toggle should have active binding'
    );
    assert.ok(
      src.includes('class:active={searchStore.wholeWord}'),
      'wholeWord toggle should have active binding'
    );
  });
});

// ============ Filter inputs ============

describe('SearchPanel: filter inputs', () => {
  it('has include filter input', () => {
    assert.ok(
      src.includes('Include'),
      'Should have include filter'
    );
  });

  it('has exclude filter input', () => {
    assert.ok(
      src.includes('Exclude'),
      'Should have exclude filter'
    );
  });

  it('include input calls setIncludePattern', () => {
    assert.ok(
      src.includes('searchStore.setIncludePattern'),
      'Include filter should call setIncludePattern'
    );
  });

  it('exclude input calls setExcludePattern', () => {
    assert.ok(
      src.includes('searchStore.setExcludePattern'),
      'Exclude filter should call setExcludePattern'
    );
  });

  it('has filter-input CSS class', () => {
    assert.ok(
      src.includes('.filter-input'),
      'Should have filter-input CSS class'
    );
  });

  it('has filter toggle button', () => {
    assert.ok(
      src.includes('filter-toggle'),
      'Should have filter toggle button'
    );
  });

  it('filters are conditionally shown', () => {
    assert.ok(
      src.includes('showFilters'),
      'Should use showFilters state'
    );
    assert.ok(
      src.includes('{#if showFilters}'),
      'Filters should be conditionally rendered'
    );
  });
});

// ============ Debounce logic ============

describe('SearchPanel: debounce logic', () => {
  it('uses setTimeout for debounce', () => {
    assert.ok(
      src.includes('setTimeout'),
      'Should use setTimeout for debounce'
    );
  });

  it('uses clearTimeout to cancel pending', () => {
    assert.ok(
      src.includes('clearTimeout'),
      'Should use clearTimeout'
    );
  });

  it('debounce delay is 300ms', () => {
    assert.ok(
      src.includes('300'),
      'Debounce should use 300ms delay'
    );
  });

  it('debounce triggers searchStore.search()', () => {
    assert.ok(
      src.includes('searchStore.search()'),
      'Debounce should trigger searchStore.search()'
    );
  });

  it('uses $effect for reactive debounce', () => {
    assert.ok(
      src.includes('$effect'),
      'Should use $effect for debounce'
    );
  });
});

// ============ Keyboard handlers ============

describe('SearchPanel: keyboard handlers', () => {
  it('Enter triggers immediate search', () => {
    assert.ok(
      src.includes("e.key === 'Enter'"),
      'Should handle Enter key'
    );
  });

  it('Escape clears search', () => {
    assert.ok(
      src.includes("e.key === 'Escape'"),
      'Should handle Escape key'
    );
  });

  it('Enter cancels debounce timer', () => {
    // handleKeydown clears the debounce and immediately searches
    assert.ok(
      src.includes('clearTimeout(debounceTimer)'),
      'Enter should clear debounce timer'
    );
  });

  it('Escape calls searchStore.clear()', () => {
    assert.ok(
      src.includes('searchStore.clear()'),
      'Escape should call searchStore.clear()'
    );
  });
});

// ============ Match highlighting ============

describe('SearchPanel: match highlighting', () => {
  it('has <mark> element for match highlighting', () => {
    assert.ok(
      src.includes('<mark>'),
      'Should use <mark> element for highlighting'
    );
  });

  it('has highlightMatch function', () => {
    assert.ok(
      src.includes('highlightMatch'),
      'Should have highlightMatch function'
    );
  });

  it('highlightMatch splits text into before/match/after', () => {
    assert.ok(src.includes('before:'), 'Should return before part');
    assert.ok(src.includes('match:'), 'Should return match part');
    assert.ok(src.includes('after:'), 'Should return after part');
  });

  it('uses colStart and colEnd for slicing', () => {
    assert.ok(src.includes('colStart'), 'Should use colStart');
    assert.ok(src.includes('colEnd'), 'Should use colEnd');
  });
});

// ============ File headers / collapse ============

describe('SearchPanel: file headers and collapse', () => {
  it('has search-file-header elements', () => {
    assert.ok(
      src.includes('search-file-header'),
      'Should have search-file-header CSS class'
    );
  });

  it('shows match count per file', () => {
    assert.ok(
      src.includes('file.matches.length'),
      'Should show file match count'
    );
  });

  it('has search-file-count element', () => {
    assert.ok(
      src.includes('search-file-count'),
      'Should have search-file-count CSS class'
    );
  });

  it('calls toggleFileCollapsed on file header click', () => {
    assert.ok(
      src.includes('searchStore.toggleFileCollapsed'),
      'Should call toggleFileCollapsed on header click'
    );
  });

  it('uses collapsedFiles.has() to check state', () => {
    assert.ok(
      src.includes('searchStore.collapsedFiles.has('),
      'Should check collapsedFiles for collapsed state'
    );
  });

  it('renders chevron indicator', () => {
    assert.ok(
      src.includes('search-chevron'),
      'Should have search-chevron element'
    );
  });

  it('conditionally renders matches when not collapsed', () => {
    assert.ok(
      src.includes('{#if !collapsed}'),
      'Should conditionally render matches based on collapsed state'
    );
  });
});

// ============ Results display ============

describe('SearchPanel: results display', () => {
  it('iterates over searchStore.results', () => {
    assert.ok(
      src.includes('{#each searchStore.results as file}'),
      'Should iterate over searchStore.results'
    );
  });

  it('shows loading state', () => {
    assert.ok(
      src.includes('searchStore.loading'),
      'Should show loading indicator'
    );
  });

  it('shows error state', () => {
    assert.ok(
      src.includes('searchStore.error'),
      'Should display errors'
    );
    assert.ok(
      src.includes('search-error'),
      'Should have search-error CSS class'
    );
  });

  it('shows truncation indicator', () => {
    assert.ok(
      src.includes('searchStore.truncated'),
      'Should check truncated flag'
    );
    assert.ok(
      src.includes('search-truncated'),
      'Should have search-truncated CSS class'
    );
  });

  it('shows result count summary', () => {
    assert.ok(
      src.includes('searchStore.totalMatches'),
      'Should display total matches'
    );
  });

  it('shows "No results" when query has no matches', () => {
    assert.ok(
      src.includes('No results'),
      'Should show "No results" message'
    );
  });
});

// ============ Result click ============

describe('SearchPanel: result click', () => {
  it('calls onResultClick with path, line, character', () => {
    assert.ok(
      src.includes('onResultClick({ path: file.path, line: match.line'),
      'Should call onResultClick with path and line'
    );
  });

  it('includes character (col_start) in click payload', () => {
    assert.ok(
      src.includes('character: match.col_start'),
      'Should include col_start as character'
    );
  });
});

// ============ File icon ============

describe('SearchPanel: file icons', () => {
  it('uses chooseIconName for file icons', () => {
    assert.ok(
      src.includes("chooseIconName(file.path, 'file')"),
      'Should use chooseIconName for file icons'
    );
  });

  it('uses svg <use> with sprite', () => {
    assert.ok(
      src.includes('<use href="{spriteUrl}#'),
      'Should use SVG sprite with <use>'
    );
  });
});

// ============ Autofocus ============

describe('SearchPanel: autofocus', () => {
  it('binds input element ref', () => {
    assert.ok(
      src.includes('bind:this={inputEl}'),
      'Should bind input element ref'
    );
  });

  it('focuses input on mount via $effect', () => {
    assert.ok(
      src.includes('inputEl.focus()'),
      'Should focus input element on mount'
    );
  });
});

// ============ CSS / Layout ============

describe('SearchPanel: CSS structure', () => {
  it('has search-panel root class', () => {
    assert.ok(
      src.includes('.search-panel'),
      'Should have .search-panel CSS class'
    );
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(
      src.includes('-webkit-app-region: no-drag'),
      'Should use no-drag region'
    );
  });

  it('has search-results scrollable container', () => {
    assert.ok(
      src.includes('.search-results'),
      'Should have .search-results CSS class'
    );
  });
});
