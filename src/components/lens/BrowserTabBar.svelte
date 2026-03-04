<script>
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';

  let { onNewTab } = $props();

  let contextMenu = $state({ visible: false, x: 0, y: 0, tabId: null });

  function handleClose(e, tabId) {
    e.stopPropagation();
    browserTabsStore.closeTab(tabId);
  }

  function handleContextMenu(e, tabId) {
    e.preventDefault();
    contextMenu = { visible: true, x: e.clientX, y: e.clientY, tabId };
  }

  function closeContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, tabId: null };
  }

  function handleContextClose() {
    const id = contextMenu.tabId;
    closeContextMenu();
    if (!id) return;
    if (browserTabsStore.tabs.length > 1) {
      browserTabsStore.closeTab(id);
    } else {
      browserTabsStore.resetTab(id);
    }
  }

  function truncate(text, max = 24) {
    if (!text || text === 'New Tab') return 'New Tab';
    return text.length > max ? text.slice(0, max) + '\u2026' : text;
  }
</script>

<div class="browser-tab-bar">
  {#each browserTabsStore.tabs as tab (tab.id)}
    <button
      class="browser-tab"
      class:active={tab.id === browserTabsStore.activeTabId}
      class:loading={tab.loading}
      onclick={() => browserTabsStore.switchTab(tab.id)}
      oncontextmenu={(e) => handleContextMenu(e, tab.id)}
      title={tab.url || tab.title}
    >
      <span class="browser-tab-title">{truncate(tab.title)}</span>
      {#if browserTabsStore.tabs.length > 1}
        <button
          class="browser-tab-close"
          onclick={(e) => handleClose(e, tab.id)}
          aria-label="Close tab"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
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
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  {/if}
</div>

{#if contextMenu.visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="context-backdrop" onclick={closeContextMenu} oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}></div>
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    <button class="context-menu-item" onclick={handleContextClose}>
      Close Tab
    </button>
  </div>
{/if}

<style>
  @import '../../styles/context-menu.css';

  /* ── Zed-style underline indicator ── */
  .browser-tab-bar {
    display: flex;
    align-items: center;
    height: 30px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 4px;
  }

  .browser-tab-bar::-webkit-scrollbar {
    display: none;
  }

  .browser-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
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
    max-width: 180px;
    position: relative;
    transition: color 0.15s ease;
  }

  /* Accent underline indicator */
  .browser-tab::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 8px;
    right: 8px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: transparent;
    transition: background 0.2s ease, box-shadow 0.2s ease;
  }

  .browser-tab:hover {
    color: var(--text);
  }

  .browser-tab.active {
    color: var(--text-strong);
  }

  .browser-tab.active::after {
    background: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .browser-tab.loading .browser-tab-title {
    opacity: 0.5;
  }

  .browser-tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .browser-tab-close {
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
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s ease, background 0.1s ease;
  }

  .browser-tab:hover .browser-tab-close,
  .browser-tab.active .browser-tab-close {
    opacity: 1;
  }

  .browser-tab-close:hover {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }

  .browser-tab-add {
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
    transition: background 0.12s ease, color 0.12s ease;
  }

  .browser-tab-add:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  /* ── Context menu ── */
  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }
</style>
