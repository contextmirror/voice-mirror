<script>
  import { createFile, createDirectory, renameEntry, deleteEntry, revealInExplorer } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { basename, copyFullPath, copyRelativePath } from '../../lib/utils.js';
  import { clampToViewport } from '$lib/clamp-to-viewport.js';
  import { setupClickOutside } from '$lib/popup-utils.js';

  let {
    x = 0,
    y = 0,
    entry = null,
    visible = false,
    isFolder = false,
    isChange = false,
    gitChanges = [],
    onClose = () => {},
    onAction = () => {},
    onOpenFile = () => {},
    onOpenDiff = () => {},
    onRename = () => {},
    onNewFile = () => {},
    onNewFolder = () => {},
  } = $props();

  // Clamp position to viewport (initial placement, refined after render)
  let menuEl = $state(null);
  let menuStyle = $derived.by(() => {
    return `left: ${x}px; top: ${y}px;`;
  });

  // Post-render: measure actual menu size and reposition if it overflows
  $effect(() => {
    if (visible && menuEl) clampToViewport(menuEl);
  });

  // Check if this file has git changes (for showing "Open Diff")
  let hasGitChange = $derived(
    !isFolder && !isChange && gitChanges.some(c => c.path === entry?.path)
  );

  function close() {
    onClose();
  }

  $effect(() => {
    if (visible) return setupClickOutside(menuEl, close);
  });

  // ── Actions ──

  async function handleOpen() {
    close();
    if (entry) onOpenFile(entry);
  }

  async function handleOpenDiff() {
    close();
    if (entry) {
      // Find the change entry for this file
      const change = isChange ? entry : gitChanges.find(c => c.path === entry.path);
      if (change) onOpenDiff(change);
    }
  }

  async function handleRenameAction() {
    close();
    onRename(entry);
  }

  async function handleNewFile() {
    close();
    onNewFile(entry);
  }

  async function handleNewFolder() {
    close();
    onNewFolder(entry);
  }

  async function handleDelete() {
    close();
    if (!entry) return;
    const name = entry.name || basename(entry.path);
    const kind = isFolder ? 'Folder' : 'File';
    try {
      const root = projectStore.root;
      await deleteEntry(entry.path, root);
      onAction('delete', entry);
      toastStore.addToast({
        message: `${kind} "${name}" moved to trash`,
        severity: 'info',
        duration: 5000,
      });
    } catch (err) {
      console.error('FileContextMenu: delete failed', err);
      toastStore.addToast({
        message: `Failed to delete ${kind.toLowerCase()} "${name}"`,
        severity: 'error',
      });
    }
  }

  function handleCopyPath() {
    close();
    if (!entry) return;
    copyFullPath(entry.path, projectStore.root);
  }

  function handleCopyRelativePath() {
    close();
    if (!entry) return;
    copyRelativePath(entry.path);
  }

  async function handleReveal() {
    close();
    if (!entry) return;
    try {
      const root = projectStore.root;
      await revealInExplorer(entry.path, root);
    } catch (err) {
      console.error('FileContextMenu: reveal failed', err);
    }
  }
</script>

{#if visible}
  <div class="context-menu" style={menuStyle} bind:this={menuEl} role="menu">
    {#if !entry}
      <!-- Empty space context menu (project root) -->
      <button class="context-menu-item" onclick={handleNewFile} role="menuitem">New File...</button>
      <button class="context-menu-item" onclick={handleNewFolder} role="menuitem">New Folder...</button>
    {:else if isChange}
      <!-- Changes tab context menu -->
      <button class="context-menu-item" onclick={handleOpenDiff} role="menuitem">Open Diff</button>
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
    {:else if isFolder}
      <!-- Folder context menu -->
      <button class="context-menu-item" onclick={handleNewFile} role="menuitem">New File...</button>
      <button class="context-menu-item" onclick={handleNewFolder} role="menuitem">New Folder...</button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" onclick={handleRenameAction} role="menuitem">
        Rename
        <span class="context-menu-shortcut">F2</span>
      </button>
      <button class="context-menu-item danger" onclick={handleDelete} role="menuitem">Delete</button>
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
    {:else}
      <!-- File context menu -->
      <button class="context-menu-item" onclick={handleOpen} role="menuitem">Open</button>
      {#if hasGitChange}
        <button class="context-menu-item" onclick={handleOpenDiff} role="menuitem">Open Diff</button>
      {/if}
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" onclick={handleNewFile} role="menuitem">New File...</button>
      <button class="context-menu-item" onclick={handleNewFolder} role="menuitem">New Folder...</button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" onclick={handleRenameAction} role="menuitem">
        Rename
        <span class="context-menu-shortcut">F2</span>
      </button>
      <button class="context-menu-item danger" onclick={handleDelete} role="menuitem">Delete</button>
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

  /* FileContextMenu overrides */
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
