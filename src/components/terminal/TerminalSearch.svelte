<script>
  /**
   * TerminalSearch.svelte -- Floating search bar for find-in-terminal.
   * Positioned at top-right of terminal container.
   */

  /** @type {{
   *   visible: boolean,
   *   onClose: () => void,
   *   onSearch: (query: string) => void,
   *   onNext: () => void,
   *   onPrev: () => void,
   *   matchCount?: number,
   *   currentMatch?: number,
   *   caseSensitive?: boolean,
   *   regex?: boolean,
   *   onToggleCase?: () => void,
   *   onToggleRegex?: () => void,
   * }} */
  let {
    visible = false,
    onClose = () => {},
    onSearch = () => {},
    onNext = () => {},
    onPrev = () => {},
    matchCount = 0,
    currentMatch = 0,
    caseSensitive = false,
    regex = false,
    onToggleCase = () => {},
    onToggleRegex = () => {},
  } = $props();

  let inputEl = $state(null);
  let query = $state('');

  // Auto-focus when visible
  $effect(() => {
    if (visible && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  function handleInput(e) {
    query = e.target.value;
    onSearch(query);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onNext();
    } else if (e.key === 'c' && e.altKey) {
      e.preventDefault();
      onToggleCase();
    } else if (e.key === 'r' && e.altKey) {
      e.preventDefault();
      onToggleRegex();
    }
  }
</script>

{#if visible}
  <div class="terminal-search">
    <input
      bind:this={inputEl}
      type="text"
      class="search-input"
      placeholder="Find..."
      value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    <span class="match-count">
      {#if matchCount > 0}
        {currentMatch + 1} of {matchCount}
      {:else if query}
        No results
      {/if}
    </span>
    <button class="search-btn" title="Previous match (Shift+Enter)" onclick={onPrev} disabled={matchCount === 0}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <polyline points="12 10 8 6 4 10" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </button>
    <button class="search-btn" title="Next match (Enter)" onclick={onNext} disabled={matchCount === 0}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <polyline points="4 6 8 10 12 6" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </button>
    <button
      class="search-btn toggle"
      class:active={caseSensitive}
      title="Match case (Alt+C)"
      onclick={onToggleCase}
    >Aa</button>
    <button
      class="search-btn toggle"
      class:active={regex}
      title="Use regex (Alt+R)"
      onclick={onToggleRegex}
    >.*</button>
    <button class="search-btn" title="Close (Escape)" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/>
        <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </button>
  </div>
{/if}

<style>
  .terminal-search {
    position: absolute;
    top: 4px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 4px;
    padding: 4px 6px;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .search-input {
    background: transparent;
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 3px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    padding: 3px 6px;
    width: 160px;
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent);
  }
  .match-count {
    font-size: 11px;
    color: var(--muted);
    min-width: 60px;
    text-align: center;
    white-space: nowrap;
  }
  .search-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 4px;
    border-radius: 3px;
    font-size: 11px;
    font-family: var(--font-family);
  }
  .search-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.08);
    color: var(--text);
  }
  .search-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .search-btn.toggle.active {
    background: rgba(255,255,255,0.12);
    color: var(--accent);
  }
</style>
