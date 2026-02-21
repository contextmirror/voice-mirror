<script>
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';

  async function handleAddFile() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ multiple: true, title: 'Open File' });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        // Extract filename from path
        const name = filePath.split(/[/\\]/).pop() || filePath;
        tabsStore.openFile({ name, path: filePath });
        tabsStore.pinTab(filePath);  // Explicitly opened files are permanent
      }
    } catch (err) {
      console.error('[TabBar] File picker failed:', err);
    }
  }

  function getTabIcon(tab) {
    if (tab.type === 'browser') return 'globe';
    if (tab.type === 'diff') return 'diff';
    const ext = tab.title?.split('.').pop()?.toLowerCase() || '';
    if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) return 'code';
    if (['rs'].includes(ext)) return 'code';
    if (['css', 'scss', 'less'].includes(ext)) return 'palette';
    if (['html', 'svelte', 'vue'].includes(ext)) return 'code';
    if (['json', 'toml', 'yaml', 'yml'].includes(ext)) return 'settings';
    if (['md', 'txt', 'log'].includes(ext)) return 'doc';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
    return 'file';
  }
</script>

<div class="tab-bar">
  {#each tabsStore.tabs as tab (tab.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active={tab.id === tabsStore.activeTabId}
      class:preview={tab.preview}
      class:dirty={tab.dirty}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === tabsStore.activeTabId}
      onclick={() => tabsStore.setActive(tab.id)}
      ondblclick={() => tabsStore.pinTab(tab.id)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') tabsStore.setActive(tab.id); }}
      title={tab.path || tab.title}
    >
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {#if getTabIcon(tab) === 'globe'}
          <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        {:else if getTabIcon(tab) === 'diff'}
          <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>
        {:else}
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        {/if}
      </svg>
      <span class="tab-title">{tab.title}</span>
      {#if tab.type === 'diff' && tab.status}
        <span
          class="tab-diff-badge"
          class:added={tab.status === 'added'}
          class:modified={tab.status === 'modified'}
          class:deleted={tab.status === 'deleted'}
        >{tab.status === 'added' ? 'A' : tab.status === 'deleted' ? 'D' : 'M'}</span>
      {/if}
      {#if tab.dirty}
        <span class="dirty-dot"></span>
      {/if}
      {#if tab.type !== 'browser'}
        <button
          class="tab-action"
          class:pinned={!tab.preview}
          onclick={(e) => { e.stopPropagation(); tabsStore.closeTab(tab.id); }}
          aria-label="Close tab"
        >
          <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          <svg class="icon-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 7h4l-8 8-1-7H5z"/></svg>
        </button>
      {/if}
    </div>
  {/each}
  <button class="tab-add" onclick={handleAddFile} aria-label="Open file" title="Open file">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  </button>
  {#if tabsStore.tabs.length > 1}
    <button class="tab-close-all" onclick={() => tabsStore.closeAll()} aria-label="Close all tabs" title="Close all tabs">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  {/if}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    height: 30px;
    flex-shrink: 0;
    padding: 0 4px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 1px;
  }

  .tab-bar::-webkit-scrollbar {
    height: 2px;
  }
  .tab-bar::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 1px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 10px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    transition: color 0.15s ease;
  }

  .tab:hover {
    color: var(--text);
    background: var(--bg);
  }

  .tab.active {
    color: var(--text-strong);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .tab.preview .tab-title {
    font-style: italic;
  }

  .tab-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .tab-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    transition: opacity 0.1s;
  }

  .tab-action svg {
    width: 12px;
    height: 12px;
  }

  /* Preview tabs: hide action button, show X on hover */
  .tab-action:not(.pinned) {
    opacity: 0;
  }
  .tab-action:not(.pinned) .icon-pin { display: none; }
  .tab:hover .tab-action:not(.pinned) { opacity: 1; }

  /* Pinned tabs: show pin, swap to X on hover */
  .tab-action.pinned { opacity: 1; color: var(--accent); }
  .tab-action.pinned .icon-close { display: none; }
  .tab-action.pinned .icon-pin { display: block; }
  .tab:hover .tab-action.pinned .icon-pin { display: none; }
  .tab:hover .tab-action.pinned .icon-close { display: block; }
  .tab:hover .tab-action.pinned { opacity: 1; }

  .tab-action:hover {
    background: var(--bg-elevated);
    color: var(--text);
  }

  .tab-add {
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

  .tab-add:hover {
    background: var(--bg);
    color: var(--text);
  }

  .tab-close-all {
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
    margin-left: 2px;
  }

  .tab-close-all:hover {
    background: var(--bg);
    color: var(--danger);
  }

  .tab-diff-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    font-size: 9px;
    font-weight: 700;
    border-radius: 2px;
    flex-shrink: 0;
    color: var(--bg);
  }
  .tab-diff-badge.added {
    background: var(--ok);
  }
  .tab-diff-badge.modified {
    background: var(--accent);
  }
  .tab-diff-badge.deleted {
    background: var(--danger);
  }
</style>
