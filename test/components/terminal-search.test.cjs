const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---- TerminalSearch.svelte ----

const SEARCH_PATH = path.join(__dirname, '../../src/components/terminal/TerminalSearch.svelte');
const searchSrc = fs.readFileSync(SEARCH_PATH, 'utf-8');

describe('TerminalSearch.svelte -- props', () => {
  it('uses $props()', () => {
    assert.ok(searchSrc.includes('$props()'), 'Should use $props');
  });

  it('accepts visible prop', () => {
    assert.ok(searchSrc.includes('visible'), 'Should accept visible prop');
  });

  it('accepts onClose callback', () => {
    assert.ok(searchSrc.includes('onClose'), 'Should accept onClose');
  });

  it('accepts onSearch callback', () => {
    assert.ok(searchSrc.includes('onSearch'), 'Should accept onSearch');
  });

  it('accepts onNext callback', () => {
    assert.ok(searchSrc.includes('onNext'), 'Should accept onNext');
  });

  it('accepts onPrev callback', () => {
    assert.ok(searchSrc.includes('onPrev'), 'Should accept onPrev');
  });

  it('accepts matchCount prop', () => {
    assert.ok(searchSrc.includes('matchCount'), 'Should accept matchCount');
  });

  it('accepts currentMatch prop', () => {
    assert.ok(searchSrc.includes('currentMatch'), 'Should accept currentMatch');
  });

  it('accepts caseSensitive prop', () => {
    assert.ok(searchSrc.includes('caseSensitive'), 'Should accept caseSensitive');
  });

  it('accepts regex prop', () => {
    assert.ok(searchSrc.includes('regex'), 'Should accept regex');
  });

  it('accepts onToggleCase callback', () => {
    assert.ok(searchSrc.includes('onToggleCase'), 'Should accept onToggleCase');
  });

  it('accepts onToggleRegex callback', () => {
    assert.ok(searchSrc.includes('onToggleRegex'), 'Should accept onToggleRegex');
  });
});

describe('TerminalSearch.svelte -- keyboard handling', () => {
  it('handles Escape to close', () => {
    assert.ok(searchSrc.includes("e.key === 'Escape'"), 'Should handle Escape');
    assert.ok(searchSrc.includes('onClose()'), 'Should call onClose on Escape');
  });

  it('handles Enter for next match', () => {
    assert.ok(searchSrc.includes("e.key === 'Enter'"), 'Should handle Enter');
    assert.ok(searchSrc.includes('onNext()'), 'Should call onNext on Enter');
  });

  it('handles Shift+Enter for previous match', () => {
    assert.ok(searchSrc.includes('e.shiftKey'), 'Should check shiftKey');
    assert.ok(searchSrc.includes('onPrev()'), 'Should call onPrev on Shift+Enter');
  });

  it('handles Alt+C for case toggle', () => {
    assert.ok(searchSrc.includes("e.key === 'c' && e.altKey"), 'Should handle Alt+C');
    assert.ok(searchSrc.includes('onToggleCase()'), 'Should call onToggleCase');
  });

  it('handles Alt+R for regex toggle', () => {
    assert.ok(searchSrc.includes("e.key === 'r' && e.altKey"), 'Should handle Alt+R');
    assert.ok(searchSrc.includes('onToggleRegex()'), 'Should call onToggleRegex');
  });
});

describe('TerminalSearch.svelte -- UI elements', () => {
  it('has search input', () => {
    assert.ok(searchSrc.includes('class="search-input"'), 'Should have search input');
    assert.ok(searchSrc.includes('placeholder="Find..."'), 'Should have placeholder');
  });

  it('has match count display', () => {
    assert.ok(searchSrc.includes('class="match-count"'), 'Should have match count');
    assert.ok(searchSrc.includes('No results'), 'Should show "No results" when no matches');
  });

  it('shows match position as "N of M"', () => {
    assert.ok(searchSrc.includes('{currentMatch + 1} of {matchCount}'), 'Should show currentMatch+1 of matchCount');
  });

  it('has previous match button', () => {
    assert.ok(searchSrc.includes('Previous match'), 'Should have prev match button');
  });

  it('has next match button', () => {
    assert.ok(searchSrc.includes('Next match'), 'Should have next match button');
  });

  it('has case sensitivity toggle button', () => {
    assert.ok(searchSrc.includes('Match case'), 'Should have case toggle');
    assert.ok(searchSrc.includes('>Aa<'), 'Should show Aa label');
  });

  it('has regex toggle button', () => {
    assert.ok(searchSrc.includes('Use regex'), 'Should have regex toggle');
    assert.ok(searchSrc.includes('>.*<'), 'Should show .* label');
  });

  it('has close button', () => {
    assert.ok(searchSrc.includes('Close (Escape)'), 'Should have close button');
  });

  it('conditionally renders with {#if visible}', () => {
    assert.ok(searchSrc.includes('{#if visible}'), 'Should conditionally render');
  });

  it('disables nav buttons when no matches', () => {
    assert.ok(searchSrc.includes('disabled={matchCount === 0}'), 'Should disable when no matches');
  });
});

describe('TerminalSearch.svelte -- auto-focus', () => {
  it('binds input element ref', () => {
    assert.ok(searchSrc.includes('bind:this={inputEl}'), 'Should bind input ref');
  });

  it('auto-focuses input when visible', () => {
    assert.ok(searchSrc.includes('if (visible && inputEl)'), 'Should check visible and inputEl');
    assert.ok(searchSrc.includes('inputEl.focus()'), 'Should call focus');
  });
});

describe('TerminalSearch.svelte -- CSS', () => {
  it('has terminal-search class', () => {
    assert.ok(searchSrc.includes('.terminal-search'), 'Should have terminal-search class');
  });

  it('is positioned absolute', () => {
    assert.ok(searchSrc.includes('position: absolute'), 'Should be absolute positioned');
  });

  it('has z-index for layering', () => {
    assert.ok(searchSrc.includes('z-index: 100'), 'Should have z-index');
  });

  it('uses theme variables', () => {
    assert.ok(searchSrc.includes('var(--bg-elevated)'), 'Should use --bg-elevated');
    assert.ok(searchSrc.includes('var(--text)'), 'Should use --text');
    assert.ok(searchSrc.includes('var(--muted)'), 'Should use --muted');
    assert.ok(searchSrc.includes('var(--accent)'), 'Should use --accent');
  });

  it('has active state for toggle buttons', () => {
    assert.ok(searchSrc.includes('.search-btn.toggle.active'), 'Should style active toggle');
  });
});

// ---- Terminal.svelte search integration ----

const TERMINAL_PATH = path.join(__dirname, '../../src/components/terminal/Terminal.svelte');
const termSrc = fs.readFileSync(TERMINAL_PATH, 'utf-8');

describe('Terminal.svelte -- search integration imports', () => {
  it('imports searchBuffer from terminal-search.js', () => {
    assert.ok(termSrc.includes('searchBuffer'), 'Should import searchBuffer');
    assert.ok(termSrc.includes('terminal-search.js'), 'Should import from terminal-search.js');
  });

  it('imports nextMatch and prevMatch', () => {
    assert.ok(termSrc.includes('nextMatch'), 'Should import nextMatch');
    assert.ok(termSrc.includes('prevMatch'), 'Should import prevMatch');
  });

  it('imports TerminalSearch component', () => {
    assert.ok(termSrc.includes("import TerminalSearch from './TerminalSearch.svelte'"), 'Should import TerminalSearch');
  });
});

describe('Terminal.svelte -- search state', () => {
  it('has searchVisible state', () => {
    assert.ok(termSrc.includes('searchVisible'), 'Should have searchVisible state');
  });

  it('has searchQuery state', () => {
    assert.ok(termSrc.includes('searchQuery'), 'Should have searchQuery state');
  });

  it('has searchMatches state', () => {
    assert.ok(termSrc.includes('searchMatches'), 'Should have searchMatches state');
  });

  it('has searchMatchCount state', () => {
    assert.ok(termSrc.includes('searchMatchCount'), 'Should have searchMatchCount state');
  });

  it('has currentMatchIndex state', () => {
    assert.ok(termSrc.includes('currentMatchIndex'), 'Should have currentMatchIndex state');
  });

  it('has searchCaseSensitive state', () => {
    assert.ok(termSrc.includes('searchCaseSensitive'), 'Should have searchCaseSensitive state');
  });

  it('has searchRegex state', () => {
    assert.ok(termSrc.includes('searchRegex'), 'Should have searchRegex state');
  });
});

describe('Terminal.svelte -- Ctrl+F handler', () => {
  it('handles Ctrl+F keydown', () => {
    assert.ok(termSrc.includes("event.key === 'f'"), 'Should check for f key');
    assert.ok(termSrc.includes('event.ctrlKey'), 'Should check ctrlKey');
  });

  it('toggles search visibility on Ctrl+F', () => {
    assert.ok(termSrc.includes('searchVisible = !searchVisible'), 'Should toggle searchVisible');
  });

  it('calls handleSearchClose when hiding', () => {
    assert.ok(termSrc.includes('if (!searchVisible) handleSearchClose()'), 'Should close search when toggling off');
  });
});

describe('Terminal.svelte -- search functions', () => {
  it('has runSearch function that calls searchBuffer', () => {
    assert.ok(termSrc.includes('function runSearch'), 'Should have runSearch function');
    assert.ok(termSrc.includes('searchBuffer(getLine, lineCount, query'), 'Should call searchBuffer');
  });

  it('accesses terminal buffer for search', () => {
    assert.ok(termSrc.includes('term.buffer?.active'), 'Should access terminal buffer');
    assert.ok(termSrc.includes('translateToString'), 'Should use translateToString for line text');
  });

  it('has handleSearchNext that uses nextMatch', () => {
    assert.ok(termSrc.includes('function handleSearchNext'), 'Should have handleSearchNext');
    assert.ok(termSrc.includes('nextMatch(searchMatchCount, currentMatchIndex)'), 'Should call nextMatch');
  });

  it('has handleSearchPrev that uses prevMatch', () => {
    assert.ok(termSrc.includes('function handleSearchPrev'), 'Should have handleSearchPrev');
    assert.ok(termSrc.includes('prevMatch(searchMatchCount, currentMatchIndex)'), 'Should call prevMatch');
  });

  it('has scrollToMatch function', () => {
    assert.ok(termSrc.includes('function scrollToMatch'), 'Should have scrollToMatch');
    assert.ok(termSrc.includes('scrollToLine'), 'Should scroll terminal to match');
  });

  it('has handleSearchClose that resets state', () => {
    assert.ok(termSrc.includes('function handleSearchClose'), 'Should have handleSearchClose');
    assert.ok(
      termSrc.includes("searchVisible = false") && termSrc.includes("searchQuery = ''"),
      'Should reset search state'
    );
  });

  it('re-focuses terminal on search close', () => {
    const closeBlock = termSrc.split('function handleSearchClose')[1]?.split('function ')[0] || '';
    assert.ok(closeBlock.includes('term.focus()'), 'Should re-focus terminal on close');
  });

  it('has handleToggleCase that re-runs search', () => {
    assert.ok(termSrc.includes('function handleToggleCase'), 'Should have handleToggleCase');
    assert.ok(termSrc.includes('searchCaseSensitive = !searchCaseSensitive'), 'Should toggle case sensitivity');
  });

  it('has handleToggleRegex that re-runs search', () => {
    assert.ok(termSrc.includes('function handleToggleRegex'), 'Should have handleToggleRegex');
    assert.ok(termSrc.includes('searchRegex = !searchRegex'), 'Should toggle regex mode');
  });
});

describe('Terminal.svelte -- TerminalSearch mount', () => {
  it('renders TerminalSearch component', () => {
    assert.ok(termSrc.includes('<TerminalSearch'), 'Should render TerminalSearch');
  });

  it('passes visible prop', () => {
    assert.ok(termSrc.includes('visible={searchVisible}'), 'Should pass searchVisible as visible');
  });

  it('passes onClose handler', () => {
    assert.ok(termSrc.includes('onClose={handleSearchClose}'), 'Should pass handleSearchClose');
  });

  it('passes onSearch handler', () => {
    assert.ok(termSrc.includes('onSearch={runSearch}'), 'Should pass runSearch');
  });

  it('passes onNext and onPrev handlers', () => {
    assert.ok(termSrc.includes('onNext={handleSearchNext}'), 'Should pass handleSearchNext');
    assert.ok(termSrc.includes('onPrev={handleSearchPrev}'), 'Should pass handleSearchPrev');
  });

  it('passes match count and current index', () => {
    assert.ok(termSrc.includes('matchCount={searchMatchCount}'), 'Should pass matchCount');
    assert.ok(termSrc.includes('currentMatch={currentMatchIndex}'), 'Should pass currentMatch');
  });

  it('passes toggle handlers', () => {
    assert.ok(termSrc.includes('onToggleCase={handleToggleCase}'), 'Should pass onToggleCase');
    assert.ok(termSrc.includes('onToggleRegex={handleToggleRegex}'), 'Should pass onToggleRegex');
  });
});

describe('Terminal.svelte -- CSS for search overlay', () => {
  it('has position relative on terminal-view for absolute overlay', () => {
    assert.ok(termSrc.includes('position: relative'), 'Should have position relative on terminal-view');
  });
});
