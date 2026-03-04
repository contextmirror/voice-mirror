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
    <button class="context-menu-item" onclick={handleClose} role="menuitem">
      Close
      <span class="context-menu-shortcut">Ctrl+W</span>
    </button>
    <button class="context-menu-item" onclick={handleCloseOthers} role="menuitem" disabled={!hasOtherTabs}>
      Close Others
    </button>
    <button class="context-menu-item" onclick={handleCloseToRight} role="menuitem" disabled={!hasTabsToRight}>
      Close to the Right
    </button>
    <button class="context-menu-item" onclick={handleCloseAll} role="menuitem">
      Close All
    </button>
    <button class="context-menu-item" onclick={handleReopenClosed} role="menuitem" disabled={!tabsStore.canReopenTab}>
      Reopen Closed Editor
      <span class="context-menu-shortcut">Ctrl+Shift+T</span>
    </button>

    <div class="context-menu-divider"></div>
    <button class="context-menu-item" onclick={handleRename} role="menuitem">
      Rename
      <span class="context-menu-shortcut">F2</span>
    </button>

    <div class="context-menu-divider"></div>
    <button class="context-menu-item" onclick={handleSplitRight} role="menuitem">
      Split Right
      <span class="context-menu-shortcut">Ctrl+\</span>
    </button>
    <button class="context-menu-item" onclick={handleSplitDown} role="menuitem">
      Split Down
    </button>
    <button class="context-menu-item" onclick={handleOpenToSide} role="menuitem">
      Open to the Side
      <span class="context-menu-shortcut">Ctrl+Enter</span>
    </button>

    {#if hasPath}
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" onclick={handleCopyPath} role="menuitem">
        Copy Path
      </button>
      <button class="context-menu-item" onclick={handleCopyRelativePath} role="menuitem">
        Copy Relative Path
      </button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" onclick={handleReveal} role="menuitem">
        Reveal in File Explorer
      </button>
    {/if}
  </div>
{/if}

<style>
  @import '../../styles/context-menu.css';

  /* TabContextMenu overrides */
  .context-menu {
    min-width: 200px;
    max-width: 280px;
    -webkit-app-region: no-drag;
  }

  .context-menu-item {
    justify-content: space-between;
    -webkit-app-region: no-drag;
  }
</style>
