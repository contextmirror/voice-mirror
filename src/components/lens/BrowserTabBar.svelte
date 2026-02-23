<script>
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';

  let { onNewTab } = $props();

  function handleClose(e, tabId) {
    e.stopPropagation();
    browserTabsStore.closeTab(tabId);
  }

  function truncate(text, max = 20) {
    if (!text) return 'New Tab';
    return text.length > max ? text.slice(0, max) + '...' : text;
  }
</script>

<div class="browser-tab-bar">
  {#each browserTabsStore.tabs as tab (tab.id)}
    <button
      class="browser-tab"
      class:active={tab.id === browserTabsStore.activeTabId}
      class:loading={tab.loading}
      onclick={() => browserTabsStore.switchTab(tab.id)}
      title={tab.url || tab.title}
    >
      <svg class="browser-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span class="browser-tab-title">{truncate(tab.title)}</span>
      {#if browserTabsStore.tabs.length > 1}
        <button
          class="browser-tab-close"
          onclick={(e) => handleClose(e, tab.id)}
          aria-label="Close tab"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </button>
  {/each}
  {#if browserTabsStore.canAddTab}
    <button
      class="browser-tab-add"
      onclick={() => onNewTab?.()}
      aria-label="New browser tab"
      title="New browser tab"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .browser-tab-bar {
    display: flex;
    align-items: center;
    height: 28px;
    flex-shrink: 0;
    padding: 0 4px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 1px;
  }

  .browser-tab-bar::-webkit-scrollbar {
    display: none;
  }

  .browser-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    transition: color 0.15s ease;
  }

  .browser-tab:hover {
    color: var(--text);
    background: var(--bg);
  }

  .browser-tab.active {
    color: var(--text);
    border-bottom: 2px solid var(--accent);
  }

  .browser-tab.loading .browser-tab-title {
    opacity: 0.6;
  }

  .browser-tab-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .browser-tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .browser-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    visibility: hidden;
  }

  .browser-tab:hover .browser-tab-close,
  .browser-tab.active .browser-tab-close {
    visibility: visible;
  }

  .browser-tab-close:hover {
    background: var(--bg-elevated);
    color: var(--text);
  }

  .browser-tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .browser-tab-add:hover {
    background: var(--bg);
    color: var(--text);
  }
</style>
