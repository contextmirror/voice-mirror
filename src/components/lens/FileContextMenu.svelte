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
      <button class="context-item" onclick={handleNewFile} role="menuitem">New File...</button>
      <button class="context-item" onclick={handleNewFolder} role="menuitem">New Folder...</button>
    {:else if isChange}
      <!-- Changes tab context menu -->
      <button class="context-item" onclick={handleOpenDiff} role="menuitem">Open Diff</button>
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
    {:else if isFolder}
      <!-- Folder context menu -->
      <button class="context-item" onclick={handleNewFile} role="menuitem">New File...</button>
      <button class="context-item" onclick={handleNewFolder} role="menuitem">New Folder...</button>
      <div class="context-separator"></div>
      <button class="context-item" onclick={handleRenameAction} role="menuitem">
        Rename
        <span class="context-shortcut">F2</span>
      </button>
      <button class="context-item context-danger" onclick={handleDelete} role="menuitem">Delete</button>
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
    {:else}
      <!-- File context menu -->
      <button class="context-item" onclick={handleOpen} role="menuitem">Open</button>
      {#if hasGitChange}
        <button class="context-item" onclick={handleOpenDiff} role="menuitem">Open Diff</button>
      {/if}
      <div class="context-separator"></div>
      <button class="context-item" onclick={handleNewFile} role="menuitem">New File...</button>
      <button class="context-item" onclick={handleNewFolder} role="menuitem">New Folder...</button>
      <div class="context-separator"></div>
      <button class="context-item" onclick={handleRenameAction} role="menuitem">
        Rename
        <span class="context-shortcut">F2</span>
      </button>
      <button class="context-item context-danger" onclick={handleDelete} role="menuitem">Delete</button>
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

  .context-item:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .context-item.context-danger:hover {
    background: var(--danger);
    color: var(--bg);
  }

  .context-shortcut {
    color: var(--muted);
    font-size: 11px;
    margin-left: 24px;
  }

  .context-item:hover .context-shortcut {
    color: inherit;
    opacity: 0.7;
  }

  .context-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
</style>
