<script>
  /**
   * TabContextMenu -- Right-click menu for editor tabs.
   *
   * Actions: Close, Close Others, Close to the Right, Close All,
   * Copy Path, Copy Relative Path, Reveal in File Explorer.
   */
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { revealInExplorer } from '../../lib/api.js';

  let {
    x = 0,
    y = 0,
    tab = null,
    visible = false,
    onClose = () => {},
  } = $props();

  let menuEl = $state(null);

  let menuStyle = $derived.by(() => {
    const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : x;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - 200 : y;
    return `left: ${Math.min(x, maxX)}px; top: ${Math.min(y, maxY)}px;`;
  });

  let isBrowser = $derived(tab?.id === 'browser');
  let hasPath = $derived(!!tab?.path);
  let hasOtherTabs = $derived(tabsStore.tabs.filter(t => t.id !== 'browser' && t.id !== tab?.id).length > 0);
  let hasTabsToRight = $derived.by(() => {
    if (!tab) return false;
    const idx = tabsStore.tabs.findIndex(t => t.id === tab.id);
    return tabsStore.tabs.slice(idx + 1).some(t => t.id !== 'browser');
  });

  function close() { onClose(); }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function handleClickOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) close();
  }

  $effect(() => {
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('keydown', handleKeydown, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
        document.removeEventListener('keydown', handleKeydown, true);
      };
    }
  });

  function handleClose() {
    close();
    if (tab) tabsStore.closeTab(tab.id);
  }

  function handleCloseOthers() {
    close();
    if (tab) tabsStore.closeOthers(tab.id);
  }

  function handleCloseToRight() {
    close();
    if (tab) tabsStore.closeToRight(tab.id);
  }

  function handleCloseAll() {
    close();
    tabsStore.closeAll();
  }

  function handleCopyPath() {
    close();
    if (!tab?.path) return;
    const root = projectStore.activeProject?.path || '';
    const fullPath = root ? `${root}/${tab.path}` : tab.path;
    navigator.clipboard.writeText(fullPath.replace(/\//g, '\\'));
  }

  function handleCopyRelativePath() {
    close();
    if (!tab?.path) return;
    navigator.clipboard.writeText(tab.path);
  }

  async function handleReveal() {
    close();
    if (!tab?.path) return;
    try {
      const root = projectStore.activeProject?.path || null;
      await revealInExplorer(tab.path, root);
    } catch (err) {
      console.error('TabContextMenu: reveal failed', err);
    }
  }
</script>

{#if visible && tab}
  <div class="context-menu" style={menuStyle} bind:this={menuEl} role="menu">
    {#if !isBrowser}
      <button class="context-item" onclick={handleClose} role="menuitem">
        Close
        <span class="context-shortcut">Ctrl+W</span>
      </button>
    {/if}
    <button class="context-item" onclick={handleCloseOthers} role="menuitem" disabled={!hasOtherTabs}>
      Close Others
    </button>
    <button class="context-item" onclick={handleCloseToRight} role="menuitem" disabled={!hasTabsToRight}>
      Close to the Right
    </button>
    <button class="context-item" onclick={handleCloseAll} role="menuitem">
      Close All
    </button>

    {#if hasPath}
      <div class="context-separator"></div>
      <button class="context-item" onclick={handleCopyPath} role="menuitem">
        Copy Path
      </button>
      <button class="context-item" onclick={handleCopyRelativePath} role="menuitem">
        Copy Relative Path
      </button>
      <div class="context-separator"></div>
      <button class="context-item" onclick={handleReveal} role="menuitem">
        Reveal in File Explorer
      </button>
    {/if}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 10002;
    min-width: 200px;
    max-width: 280px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
  }

  .context-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    -webkit-app-region: no-drag;
  }

  .context-item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }

  .context-item:disabled {
    color: var(--muted);
    cursor: default;
    opacity: 0.5;
  }

  .context-shortcut {
    color: var(--muted);
    font-size: 11px;
    margin-left: 24px;
  }

  .context-item:hover:not(:disabled) .context-shortcut {
    color: inherit;
    opacity: 0.7;
  }

  .context-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
</style>
