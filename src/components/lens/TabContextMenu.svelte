<script>
  /**
   * TabContextMenu -- Right-click menu for editor tabs.
   *
   * Actions: Close, Close Others, Close to the Right, Close All,
   *          Split Right, Split Down, Open to the Side,
   *          Copy Path, Copy Relative Path, Reveal in File Explorer.
   */
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { revealInExplorer } from '../../lib/api.js';
  import { copyFullPath, copyRelativePath } from '../../lib/utils.js';
  import { clampToViewport } from '$lib/clamp-to-viewport.js';
  import { setupClickOutside } from '$lib/popup-utils.js';

  let {
    x = 0,
    y = 0,
    tab = null,
    visible = false,
    onClose = () => {},
    onRename = () => {},
  } = $props();

  let menuEl = $state(null);

  let menuStyle = $derived.by(() => {
    return `left: ${x}px; top: ${y}px;`;
  });

  // Post-render: measure actual menu size and reposition if it overflows
  $effect(() => {
    if (visible && menuEl) clampToViewport(menuEl);
  });

  let hasPath = $derived(!!tab?.path);
  let hasOtherTabs = $derived(tabsStore.tabs.filter(t => t.id !== tab?.id && t.groupId === tab?.groupId).length > 0);
  let hasTabsToRight = $derived.by(() => {
    if (!tab) return false;
    const groupTabs = tabsStore.tabs.filter(t => t.groupId === tab.groupId);
    const idx = groupTabs.findIndex(t => t.id === tab.id);
    return idx !== -1 && idx < groupTabs.length - 1;
  });

  function close() { onClose(); }

  $effect(() => {
    if (visible) return setupClickOutside(menuEl, close);
  });

  function handleClose() {
    close();
    if (tab) tabsStore.requestClose(tab.id);
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

  function handleReopenClosed() {
    close();
    tabsStore.reopenClosedTab();
  }

  function handleCopyPath() {
    close();
    if (!tab?.path) return;
    copyFullPath(tab.path, projectStore.root);
  }

  function handleCopyRelativePath() {
    close();
    if (!tab?.path) return;
    copyRelativePath(tab.path);
  }

  async function handleReveal() {
    close();
    if (!tab?.path) return;
    try {
      const root = projectStore.root;
      await revealInExplorer(tab.path, root);
    } catch (err) {
      console.error('TabContextMenu: reveal failed', err);
    }
  }

  function handleRename() {
    close();
    if (tab) onRename(tab);
  }

  // ── Split-editor actions ──

  function handleSplitRight() {
    close();
    if (!tab) return;
    const sourceGroup = tab.groupId || 1;
    const newGroupId = editorGroupsStore.splitGroup(sourceGroup, 'horizontal');
    // Duplicate the file into the new group (like VS Code Ctrl+\)
    tabsStore.openFile({ name: tab.title, path: tab.path, readOnly: tab.readOnly, external: tab.external }, newGroupId);
  }

  function handleSplitDown() {
    close();
    if (!tab) return;
    const sourceGroup = tab.groupId || 1;
    const newGroupId = editorGroupsStore.splitGroup(sourceGroup, 'vertical');
    // Duplicate the file into the new group (like VS Code Ctrl+\)
    tabsStore.openFile({ name: tab.title, path: tab.path, readOnly: tab.readOnly, external: tab.external }, newGroupId);
  }

  function handleOpenToSide() {
    close();
    if (!tab) return;
    const sourceGroup = tab.groupId || 1;
    const allIds = editorGroupsStore.allGroupIds;
    const otherGroup = allIds.find(id => id !== sourceGroup);
    if (otherGroup) {
      if (tabsStore.moveTab) {
        tabsStore.moveTab(tab.id, otherGroup);
      }
    } else {
      const newGroupId = editorGroupsStore.splitGroup(sourceGroup, 'horizontal');
      if (tabsStore.moveTab) {
        tabsStore.moveTab(tab.id, newGroupId);
      }
    }
  }
</script>

{#if visible && tab}
  <div class="context-menu" style={menuStyle} bind:this={menuEl} role="menu">
    <!-- File tab actions -->
    <button class="context-item" onclick={handleClose} role="menuitem">
      Close
      <span class="context-shortcut">Ctrl+W</span>
    </button>
    <button class="context-item" onclick={handleCloseOthers} role="menuitem" disabled={!hasOtherTabs}>
      Close Others
    </button>
    <button class="context-item" onclick={handleCloseToRight} role="menuitem" disabled={!hasTabsToRight}>
      Close to the Right
    </button>
    <button class="context-item" onclick={handleCloseAll} role="menuitem">
      Close All
    </button>
    <button class="context-item" onclick={handleReopenClosed} role="menuitem" disabled={!tabsStore.canReopenTab}>
      Reopen Closed Editor
      <span class="context-shortcut">Ctrl+Shift+T</span>
    </button>

    <div class="context-separator"></div>
    <button class="context-item" onclick={handleRename} role="menuitem">
      Rename
      <span class="context-shortcut">F2</span>
    </button>

    <div class="context-separator"></div>
    <button class="context-item" onclick={handleSplitRight} role="menuitem">
      Split Right
      <span class="context-shortcut">Ctrl+\</span>
    </button>
    <button class="context-item" onclick={handleSplitDown} role="menuitem">
      Split Down
    </button>
    <button class="context-item" onclick={handleOpenToSide} role="menuitem">
      Open to the Side
      <span class="context-shortcut">Ctrl+Enter</span>
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
