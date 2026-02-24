<script>
  import { searchStore } from '../../lib/stores/search.svelte.js';
  import { chooseIconName } from '../../lib/file-icons.js';
  import spriteUrl from '../../assets/icons/file-icons-sprite.svg';

  let { onResultClick = () => {} } = $props();

  let showFilters = $state(false);
  let inputEl = $state(null);

  // Autofocus on mount
  $effect(() => {
    if (inputEl) inputEl.focus();
  });

  // Debounced search: watch query + options, fire after 300ms idle
  let debounceTimer;
  $effect(() => {
    // Track reactive deps
    const _q = searchStore.query;
    const _cs = searchStore.caseSensitive;
    const _re = searchStore.isRegex;
    const _ww = searchStore.wholeWord;
    const _inc = searchStore.includePattern;
    const _exc = searchStore.excludePattern;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchStore.search();
    }, 300);

    return () => clearTimeout(debounceTimer);
  });

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      searchStore.search();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      searchStore.clear();
    }
  }

  function highlightMatch(text, colStart, colEnd) {
    if (colStart == null || colEnd == null || colStart >= text.length) {
      return { before: text, match: '', after: '' };
    }
    return {
      before: text.slice(0, colStart),
      match: text.slice(colStart, colEnd),
      after: text.slice(colEnd),
    };
  }
</script>

<div class="search-panel">
  <div class="search-controls">
    <input
      class="search-input"
      type="text"
      placeholder="Search in files..."
      value={searchStore.query}
      oninput={(e) => searchStore.setQuery(e.target.value)}
      onkeydown={handleKeydown}
      bind:this={inputEl}
    />
    <div class="search-toggles">
      <button
        class="search-toggle"
        class:active={searchStore.caseSensitive}
        onclick={() => searchStore.setCaseSensitive(!searchStore.caseSensitive)}
        title="Match case"
      >Aa</button>
      <button
        class="search-toggle"
        class:active={searchStore.isRegex}
        onclick={() => searchStore.setIsRegex(!searchStore.isRegex)}
        title="Use regex"
      >.*</button>
      <button
        class="search-toggle"
        class:active={searchStore.wholeWord}
        onclick={() => searchStore.setWholeWord(!searchStore.wholeWord)}
        title="Whole word"
      >ab</button>
      <button
        class="search-toggle filter-toggle"
        class:active={showFilters}
        onclick={() => { showFilters = !showFilters; }}
        title="Toggle filters"
      >...</button>
    </div>

    {#if showFilters}
      <input
        class="filter-input"
        type="text"
        placeholder="Include (e.g. *.rs,*.js)"
        value={searchStore.includePattern}
        oninput={(e) => searchStore.setIncludePattern(e.target.value)}
      />
      <input
        class="filter-input"
        type="text"
        placeholder="Exclude (e.g. node_modules)"
        value={searchStore.excludePattern}
        oninput={(e) => searchStore.setExcludePattern(e.target.value)}
      />
    {/if}
  </div>

  <div class="search-summary">
    {#if searchStore.loading}
      Loading...
    {:else if searchStore.error}
      <span class="search-error">{searchStore.error}</span>
    {:else if searchStore.totalMatches > 0}
      {searchStore.totalMatches} results in {searchStore.results.length} files
      {#if searchStore.truncated}
        <span class="search-truncated">(truncated)</span>
      {/if}
    {:else if searchStore.query.trim()}
      No results
    {/if}
  </div>

  <div class="search-results">
    {#each searchStore.results as file}
      {@const collapsed = searchStore.collapsedFiles.has(file.path)}
      {@const fileName = file.path.split(/[/\\]/).pop() || file.path}
      <button
        class="search-file-header"
        onclick={() => searchStore.toggleFileCollapsed(file.path)}
      >
        <span class="search-chevron">{collapsed ? '>' : 'v'}</span>
        <svg class="search-file-icon"><use href="{spriteUrl}#{chooseIconName(file.path, 'file')}" /></svg>
        <span class="search-file-path" title={file.path}>{file.path}</span>
        <span class="search-file-count">{file.matches.length}</span>
      </button>
      {#if !collapsed}
        {#each file.matches as match}
          {@const hl = highlightMatch(match.text, match.col_start, match.col_end)}
          <button
            class="search-match"
            onclick={() => onResultClick({ path: file.path, line: match.line, character: match.col_start || 0 })}
          >
            <span class="search-line-num">{match.line}</span>
            <span class="search-line-text">{hl.before}<mark>{hl.match}</mark>{hl.after}</span>
          </button>
        {/each}
      {/if}
    {/each}
  </div>
</div>

<style>
  .search-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    -webkit-app-region: no-drag;
  }

  .search-controls {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    flex-shrink: 0;
  }

  .search-input {
    width: 100%;
    padding: 5px 8px;
    font-size: 12px;
    font-family: var(--font-mono);
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 4px;
    outline: none;
    box-sizing: border-box;
  }
  .search-input:focus {
    border-color: var(--accent);
  }

  .search-toggles {
    display: flex;
    gap: 2px;
  }

  .search-toggle {
    padding: 3px 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    background: transparent;
    color: var(--muted);
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    -webkit-app-region: no-drag;
  }
  .search-toggle:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .search-toggle.active {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .filter-toggle {
    margin-left: auto;
  }

  .filter-input {
    width: 100%;
    padding: 4px 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 4px;
    outline: none;
    box-sizing: border-box;
  }
  .filter-input:focus {
    border-color: var(--accent);
  }

  .search-summary {
    padding: 4px 8px;
    font-size: 11px;
    color: var(--muted);
    flex-shrink: 0;
  }

  .search-error {
    color: var(--danger, #ef4444);
  }

  .search-truncated {
    color: var(--warn, #f59e0b);
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
  }

  .search-file-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 8px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    -webkit-app-region: no-drag;
  }
  .search-file-header:hover {
    background: var(--bg-hover);
  }

  .search-chevron {
    width: 14px;
    text-align: center;
    color: var(--muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .search-file-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .search-file-path {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-file-count {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--muted);
    background: var(--bg-elevated);
    padding: 1px 6px;
    border-radius: 8px;
  }

  .search-match {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 2px 8px 2px 28px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--muted);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    -webkit-app-region: no-drag;
    white-space: nowrap;
    overflow: hidden;
  }
  .search-match:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .search-line-num {
    flex-shrink: 0;
    min-width: 32px;
    text-align: right;
    color: var(--muted);
    font-size: 11px;
    opacity: 0.6;
  }

  .search-line-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-line-text :global(mark) {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--text);
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
