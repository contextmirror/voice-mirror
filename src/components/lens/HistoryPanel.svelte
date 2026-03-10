<script>
  import { browserHistoryStore } from '../../lib/stores/browser-history.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';

  let { onClose = () => {} } = $props();

  let searchQuery = $state('');

  // Filtered or all entries depending on search
  let filtered = $derived(browserHistoryStore.filter(searchQuery));
  let grouped = $derived(() => {
    if (searchQuery) {
      return { today: filtered, yesterday: [], older: [] };
    }
    return browserHistoryStore.getGrouped();
  });

  function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function handleEntryClick(url) {
    lensStore.navigate(url);
    onClose();
  }

  async function handleDeleteEntry(e, timestamp) {
    e.stopPropagation();
    await browserHistoryStore.deleteEntry(timestamp);
  }

  async function handleClearAll() {
    await browserHistoryStore.clearAll();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="history-panel"
  onkeydown={handleKeydown}
  role="region"
  aria-label="Browser History"
>
  <div class="history-header">
    <button class="back-btn" onclick={onClose} title="Close history" aria-label="Close history">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <span class="history-title">History</span>
    <button class="clear-btn" onclick={handleClearAll} title="Clear all history">
      Clear all
    </button>
  </div>

  <div class="history-search">
    <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input
      class="search-input"
      type="text"
      bind:value={searchQuery}
      placeholder="Search history..."
      spellcheck="false"
      autocomplete="off"
    />
    {#if searchQuery}
      <button class="clear-search-btn" onclick={() => searchQuery = ''} title="Clear search" aria-label="Clear search">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    {/if}
  </div>

  <div class="history-list">
    {#if browserHistoryStore.entries.length === 0}
      <div class="empty-state">No history yet</div>
    {:else if searchQuery && filtered.length === 0}
      <div class="empty-state">No results for "{searchQuery}"</div>
    {:else if searchQuery}
      {#each filtered as entry (entry.timestamp)}
        {@render historyEntry(entry)}
      {/each}
    {:else}
      {@const grp = grouped()}
      {#if grp.today.length > 0}
        <div class="group-header">Today</div>
        {#each grp.today as entry (entry.timestamp)}
          {@render historyEntry(entry)}
        {/each}
      {/if}
      {#if grp.yesterday.length > 0}
        <div class="group-header">Yesterday</div>
        {#each grp.yesterday as entry (entry.timestamp)}
          {@render historyEntry(entry)}
        {/each}
      {/if}
      {#if grp.older.length > 0}
        <div class="group-header">Older</div>
        {#each grp.older as entry (entry.timestamp)}
          {@render historyEntry(entry)}
        {/each}
      {/if}
    {/if}
  </div>
</div>

{#snippet historyEntry(entry)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="history-entry"
    role="button"
    tabindex="0"
    onclick={() => handleEntryClick(entry.url)}
    onkeydown={(e) => e.key === 'Enter' && handleEntryClick(entry.url)}
    title={entry.url}
  >
    <span class="entry-time">{formatTime(entry.timestamp)}</span>
    <div class="entry-content">
      <span class="entry-title">{entry.title || entry.url}</span>
      <span class="entry-url">{entry.url}</span>
    </div>
    <button
      class="delete-btn"
      onclick={(e) => handleDeleteEntry(e, entry.timestamp)}
      title="Remove from history"
      aria-label="Remove from history"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
{/snippet}

<style>
  .history-panel {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .history-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .back-btn:hover {
    background: var(--bg);
  }

  .history-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    flex: 1;
  }

  .clear-btn {
    font-size: 11px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
  }

  .clear-btn:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }

  .history-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-icon {
    color: var(--muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    outline: none;
  }

  .search-input::placeholder {
    color: var(--muted);
  }

  .clear-search-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .clear-search-btn:hover {
    color: var(--text);
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }

  .group-header {
    padding: 8px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .history-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 0;
    transition: background var(--duration-fast) var(--ease-out);
    position: relative;
  }

  .history-entry:hover {
    background: var(--bg-elevated);
  }

  .entry-time {
    font-size: 11px;
    color: var(--muted);
    flex-shrink: 0;
    width: 42px;
    text-align: right;
  }

  .entry-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .entry-title {
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entry-url {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
  }

  .delete-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
  }

  .history-entry:hover .delete-btn {
    display: flex;
  }

  .delete-btn:hover {
    color: var(--text);
    background: var(--bg);
  }
</style>
