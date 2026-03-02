<script>
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { basename } from '../../lib/utils.js';
  import { getTabIcon } from '$lib/tab-utils.js';
  import TabContextMenu from './TabContextMenu.svelte';
  import TabDiffBadge from './TabDiffBadge.svelte';

  let {} = $props();

  let tabMenu = $state({ visible: false, x: 0, y: 0, tab: null });

  function handleTabContextMenu(event, tab) {
    event.preventDefault();
    tabMenu = { visible: true, x: event.clientX, y: event.clientY, tab };
  }

  async function handleAddFile() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ multiple: true, title: 'Open File' });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        // Extract filename from path
        const name = basename(filePath);
        tabsStore.openFile({ name, path: filePath });
        tabsStore.pinTab(filePath);  // Explicitly opened files are permanent
      }
    } catch (err) {
      console.error('[TabBar] File picker failed:', err);
    }
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
      onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); tabsStore.requestClose(tab.id); } }}
      oncontextmenu={(e) => handleTabContextMenu(e, tab)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') tabsStore.setActive(tab.id); }}
      title={tab.path || tab.title}
    >
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {#if getTabIcon(tab) === 'diff'}
          <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>
        {:else}
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        {/if}
      </svg>
      <span class="tab-title">{tab.title}</span>
      {#if tab.readOnly}
        <svg class="tab-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10" aria-label="Read-only">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      {/if}
      <TabDiffBadge {tab} />
      {#if tab.dirty}
        <span class="dirty-dot"></span>
      {/if}
      <button
        class="tab-action"
        class:pinned={!tab.preview}
        onclick={(e) => { e.stopPropagation(); tabsStore.requestClose(tab.id); }}
        aria-label="Close tab"
      >
        <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        <svg class="icon-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 7h4l-8 8-1-7H5z"/></svg>
      </button>
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

<TabContextMenu
  x={tabMenu.x}
  y={tabMenu.y}
  tab={tabMenu.tab}
  visible={tabMenu.visible}
  onClose={() => { tabMenu.visible = false; }}
/>

<style>
  /* ── Linear Floating Pill style ── */
  .tab-bar {
    display: flex;
    align-items: center;
    height: 36px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    -webkit-app-region: no-drag;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 2px;
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
    height: 26px;
    padding: 0 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .tab:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .tab.active {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--text) 12%, transparent);
    font-weight: 500;
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
    border-radius: 4px;
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
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }

  .tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 2px;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .tab-add:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .tab-close-all {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 2px;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .tab-close-all:hover {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }

  .tab-lock {
    flex-shrink: 0;
    opacity: 0.5;
  }

</style>
