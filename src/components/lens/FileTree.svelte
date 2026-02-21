<script>
  import { listDirectory, getGitChanges, createFile, createDirectory, renameEntry } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';
  import { chooseIconName } from '../../lib/file-icons.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import spriteUrl from '../../assets/icons/file-icons-sprite.svg';
  import FileContextMenu from './FileContextMenu.svelte';
  import StatusDropdown from './StatusDropdown.svelte';

  let { onFileClick = () => {}, onFileDblClick = () => {}, onChangeClick = () => {} } = $props();

  // State
  let activeTab = $state('files');
  let rootEntries = $state([]);
  let expandedDirs = $state(new Set());
  let dirChildren = $state(new Map());
  let loadingDirs = $state(new Set());
  let gitChanges = $state([]);

  // Context menu state
  let contextMenu = $state({ visible: false, x: 0, y: 0, entry: null, isFolder: false, isChange: false });

  // Inline editing state
  let editingEntry = $state(null);   // { path, name } for rename-in-place
  let editingValue = $state('');
  let creatingIn = $state(null);     // { parentPath, type: 'file' | 'directory' }
  let creatingValue = $state('');

  // Selected entry for F2 rename shortcut
  let selectedEntry = $state(null);

  // Reload when active project changes
  $effect(() => {
    const _ = projectStore.activeIndex;  // track dependency
    expandedDirs = new Set();
    dirChildren = new Map();
    loadRoot();
    loadGitChanges();
  });

  // Listen for file-system watcher events from the Rust backend
  $effect(() => {
    let unlistenTree;
    let unlistenGit;

    (async () => {
      unlistenTree = await listen('fs-tree-changed', handleTreeChanged);
      unlistenGit = await listen('fs-git-changed', handleGitChanged);
    })();

    return () => {
      unlistenTree?.();
      unlistenGit?.();
    };
  });

  async function handleTreeChanged(event) {
    const { directories, root: rootChanged } = event.payload;
    const currentRoot = projectStore.activeProject?.path || null;

    // Reload root listing if the root directory itself was affected
    if (rootChanged) {
      await loadRoot();
    }

    // Re-fetch any expanded directories that were affected
    if (directories && directories.length > 0) {
      const updated = new Map(dirChildren);
      let changed = false;
      for (const dir of directories) {
        if (expandedDirs.has(dir)) {
          try {
            const resp = await listDirectory(dir, currentRoot);
            if (resp && resp.data) {
              updated.set(dir, resp.data);
              changed = true;
            }
          } catch (err) {
            console.error('FileTree: watcher refresh failed for', dir, err);
          }
        }
      }
      if (changed) {
        dirChildren = updated;
      }
    }
  }

  function handleGitChanged() {
    loadGitChanges();
  }

  async function loadRoot() {
    const root = projectStore.activeProject?.path || null;
    try {
      const resp = await listDirectory(null, root);
      if (resp && resp.data) {
        rootEntries = resp.data;
      }
    } catch (err) {
      console.error('FileTree: failed to load root directory', err);
    }
  }

  async function loadGitChanges() {
    const root = projectStore.activeProject?.path || null;
    try {
      const resp = await getGitChanges(root);
      if (resp && resp.data && Array.isArray(resp.data.changes)) {
        gitChanges = resp.data.changes;
      }
    } catch (err) {
      console.error('FileTree: failed to load git changes', err);
      gitChanges = [];
    }
  }

  async function toggleDir(entry) {
    const path = entry.path;
    if (expandedDirs.has(path)) {
      // Collapse
      const next = new Set(expandedDirs);
      next.delete(path);
      expandedDirs = next;
    } else {
      // Expand
      const next = new Set(expandedDirs);
      next.add(path);
      expandedDirs = next;

      // Lazy-load children if not cached
      if (!dirChildren.has(path)) {
        const loading = new Set(loadingDirs);
        loading.add(path);
        loadingDirs = loading;

        try {
          const root = projectStore.activeProject?.path || null;
          const resp = await listDirectory(path, root);
          if (resp && resp.data) {
            const updated = new Map(dirChildren);
            updated.set(path, resp.data);
            dirChildren = updated;
          }
        } catch (err) {
          console.error('FileTree: failed to load directory', path, err);
        } finally {
          const done = new Set(loadingDirs);
          done.delete(path);
          loadingDirs = done;
        }
      }
    }
  }

  function handleFileClick(entry) {
    selectedEntry = entry;
    onFileClick(entry);
  }

  // ── Refresh helpers ──

  async function refreshParent(path) {
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : null;
    const root = projectStore.activeProject?.path || null;
    try {
      if (parentPath) {
        const resp = await listDirectory(parentPath, root);
        if (resp && resp.data) {
          const updated = new Map(dirChildren);
          updated.set(parentPath, resp.data);
          dirChildren = updated;
        }
      } else {
        await loadRoot();
      }
    } catch (err) {
      console.error('FileTree: refresh failed', err);
    }
    await loadGitChanges();
  }

  // ── Context menu handlers ──

  function handleContextMenu(e, entry, isFolder, isChange) {
    e.preventDefault();
    e.stopPropagation();
    selectedEntry = entry;
    contextMenu = { visible: true, x: e.clientX, y: e.clientY, entry, isFolder, isChange };
  }

  function handleEmptyContextMenu(e) {
    // Only fire if clicking on the scroll container itself (empty space), not a child
    if (e.target === e.currentTarget || e.target.classList.contains('tree-scroll')) {
      e.preventDefault();
      contextMenu = { visible: true, x: e.clientX, y: e.clientY, entry: null, isFolder: false, isChange: false };
    }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false };
  }

  function handleContextAction(action, entry) {
    if (action === 'delete') {
      refreshParent(entry.path);
    }
  }

  // ── Inline rename ──

  function startRename(entry) {
    editingEntry = entry;
    editingValue = entry.name || entry.path.split(/[/\\]/).pop();
  }

  async function saveRename() {
    if (!editingEntry || !editingValue.trim()) {
      cancelRename();
      return;
    }
    const oldPath = editingEntry.path;
    const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentPath ? `${parentPath}/${editingValue.trim()}` : editingValue.trim();
    if (newPath === oldPath) {
      cancelRename();
      return;
    }
    try {
      const root = projectStore.activeProject?.path || null;
      await renameEntry(oldPath, newPath, root);
      cancelRename();
      await refreshParent(oldPath);
    } catch (err) {
      console.error('FileTree: rename failed', err);
      cancelRename();
    }
  }

  function cancelRename() {
    editingEntry = null;
    editingValue = '';
  }

  function handleRenameKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  // ── Inline create (new file / new folder) ──

  function getParentPath(entry) {
    if (!entry) return '';
    // If it's a folder, create inside it; if it's a file, create in its parent directory
    if (entry.type === 'directory') return entry.path;
    return entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/')) : '';
  }

  function startNewFile(parentEntry) {
    const parentPath = getParentPath(parentEntry);
    // Ensure the folder is expanded
    if (parentPath && !expandedDirs.has(parentPath) && parentEntry?.type === 'directory') {
      toggleDir(parentEntry);
    }
    creatingIn = { parentPath, type: 'file' };
    creatingValue = '';
  }

  function startNewFolder(parentEntry) {
    const parentPath = getParentPath(parentEntry);
    if (parentPath && !expandedDirs.has(parentPath) && parentEntry?.type === 'directory') {
      toggleDir(parentEntry);
    }
    creatingIn = { parentPath, type: 'directory' };
    creatingValue = '';
  }

  async function saveCreate() {
    if (!creatingIn || !creatingValue.trim()) {
      cancelCreate();
      return;
    }
    const fullPath = creatingIn.parentPath
      ? `${creatingIn.parentPath}/${creatingValue.trim()}`
      : creatingValue.trim();
    try {
      const root = projectStore.activeProject?.path || null;
      if (creatingIn.type === 'file') {
        await createFile(fullPath, '', root);
      } else {
        await createDirectory(fullPath, root);
      }
      cancelCreate();
      await refreshParent(fullPath);
    } catch (err) {
      console.error('FileTree: create failed', err);
      cancelCreate();
    }
  }

  function cancelCreate() {
    creatingIn = null;
    creatingValue = '';
  }

  function handleCreateKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCreate();
    }
  }

  // ── Keyboard shortcut (F2 rename) ──

  function handleKeydown(e) {
    if (e.key === 'F2' && selectedEntry && !editingEntry && !creatingIn) {
      e.preventDefault();
      startRename(selectedEntry);
    }
  }

  // ── Autofocus action ──

  function autofocus(node) {
    node.focus();
    // Select filename without extension for rename
    const dotIdx = node.value.lastIndexOf('.');
    if (dotIdx > 0) {
      node.setSelectionRange(0, dotIdx);
    } else {
      node.select();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="files-area">
  <div class="files-header">
    <button
      class="files-tab"
      class:active={activeTab === 'files'}
      onclick={() => { activeTab = 'files'; }}
    >All files</button>
    <button
      class="files-tab"
      class:active={activeTab === 'changes'}
      onclick={() => { activeTab = 'changes'; }}
    >{gitChanges.length} Changes</button>
    <StatusDropdown />
  </div>

  {#if activeTab === 'files'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tree-scroll" oncontextmenu={handleEmptyContextMenu}>
      {#snippet treeNode(entries, depth)}
        {#each entries as entry}
          {#if entry.type === 'directory'}
            {@const isExpanded = expandedDirs.has(entry.path)}
            {#if editingEntry?.path === entry.path}
              <div class="tree-item folder" style="padding-left: {8 + depth * 16}px">
                <span class="tree-chevron">{isExpanded ? 'v' : '>'}</span>
                <input
                  class="tree-rename-input"
                  type="text"
                  bind:value={editingValue}
                  onkeydown={handleRenameKeydown}
                  onblur={saveRename}
                  use:autofocus
                />
              </div>
            {:else}
              <button
                class="tree-item folder"
                style="padding-left: {8 + depth * 16}px"
                onclick={() => toggleDir(entry)}
                oncontextmenu={(e) => handleContextMenu(e, entry, true, false)}
              >
                <span class="tree-chevron">{isExpanded ? 'v' : '>'}</span>
                <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(entry.path, 'directory', isExpanded)}" /></svg>
                <span class="tree-name">{entry.name}</span>
              </button>
            {/if}
            {#if isExpanded}
              {#if creatingIn?.parentPath === entry.path}
                <div class="tree-item file" style="padding-left: {8 + (depth + 1) * 16 + 18}px">
                  <input
                    class="tree-rename-input"
                    type="text"
                    placeholder={creatingIn.type === 'file' ? 'filename...' : 'folder name...'}
                    bind:value={creatingValue}
                    onkeydown={handleCreateKeydown}
                    onblur={saveCreate}
                    use:autofocus
                  />
                </div>
              {/if}
              {#if loadingDirs.has(entry.path)}
                <div class="tree-loading" style="padding-left: {8 + (depth + 1) * 16}px">...</div>
              {:else if dirChildren.has(entry.path)}
                {@render treeNode(dirChildren.get(entry.path), depth + 1)}
              {/if}
            {/if}
          {:else}
            {#if editingEntry?.path === entry.path}
              <div class="tree-item file" style="padding-left: {8 + depth * 16 + 18}px">
                <input
                  class="tree-rename-input"
                  type="text"
                  bind:value={editingValue}
                  onkeydown={handleRenameKeydown}
                  onblur={saveRename}
                  use:autofocus
                />
              </div>
            {:else}
              <button
                class="tree-item file"
                style="padding-left: {8 + depth * 16 + 18}px"
                onclick={() => handleFileClick(entry)}
                ondblclick={() => onFileDblClick(entry)}
                oncontextmenu={(e) => handleContextMenu(e, entry, false, false)}
              >
                <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(entry.path, 'file')}" /></svg>
                <span class="tree-name" class:ignored={entry.ignored}>{entry.name}</span>
              </button>
            {/if}
          {/if}
        {/each}
      {/snippet}

      {#if creatingIn?.parentPath === ''}
        <div class="tree-item file" style="padding-left: {8 + 18}px">
          <input
            class="tree-rename-input"
            type="text"
            placeholder={creatingIn.type === 'file' ? 'filename...' : 'folder name...'}
            bind:value={creatingValue}
            onkeydown={handleCreateKeydown}
            onblur={saveCreate}
            use:autofocus
          />
        </div>
      {/if}

      {@render treeNode(rootEntries, 0)}
    </div>
  {/if}

  {#if activeTab === 'changes'}
    <div class="tree-scroll">
      {#if gitChanges.length === 0}
        <div class="changes-empty">No changes</div>
      {:else}
        {#each gitChanges as change}
          <button
            class="change-item"
            onclick={() => onChangeClick(change)}
            oncontextmenu={(e) => handleContextMenu(e, change, false, true)}
          >
            <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(change.path, 'file')}" /></svg>
            <span class="change-path">{change.path}</span>
            <span
              class="change-badge"
              class:added={change.status === 'added'}
              class:modified={change.status === 'modified'}
              class:deleted={change.status === 'deleted'}
            >
              {change.status === 'added' ? 'A' : change.status === 'deleted' ? 'D' : 'M'}
            </span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<FileContextMenu
  x={contextMenu.x}
  y={contextMenu.y}
  entry={contextMenu.entry}
  visible={contextMenu.visible}
  isFolder={contextMenu.isFolder}
  isChange={contextMenu.isChange}
  {gitChanges}
  onClose={closeContextMenu}
  onAction={handleContextAction}
  onOpenFile={(entry) => onFileClick(entry)}
  onOpenDiff={(change) => onChangeClick(change)}
  onRename={(entry) => startRename(entry)}
  onNewFile={(entry) => startNewFile(entry)}
  onNewFolder={(entry) => startNewFolder(entry)}
/>

<style>
  .files-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    border-left: 1px solid var(--border);
  }

  .files-header {
    display: flex;
    gap: 0;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .files-tab {
    padding: 6px 10px;
    font-size: 12px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    -webkit-app-region: no-drag;
  }
  .files-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .files-tab:hover:not(.active) {
    color: var(--text);
  }

  .tree-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 3px 8px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
    -webkit-app-region: no-drag;
  }
  .tree-item:hover {
    background: var(--bg-elevated);
  }

  .tree-chevron {
    width: 14px;
    text-align: center;
    color: var(--muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .tree-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .tree-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-name.ignored {
    color: var(--muted);
    opacity: 0.6;
  }

  .tree-item.file {
    color: var(--muted);
  }

  .tree-loading {
    font-size: 12px;
    color: var(--muted);
    font-style: italic;
    font-family: var(--font-mono);
    padding: 3px 8px;
  }

  .tree-rename-input {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    font-size: 12px;
    font-family: var(--font-mono);
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--accent);
    border-radius: 3px;
    outline: none;
  }

  .change-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 3px 12px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    -webkit-app-region: no-drag;
  }
  .change-item:hover {
    background: var(--bg-elevated);
  }

  .change-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-size: 10px;
    font-weight: 600;
    border-radius: 3px;
    flex-shrink: 0;
    color: var(--bg);
  }
  .change-badge.added {
    background: var(--ok);
  }
  .change-badge.modified {
    background: var(--accent);
  }
  .change-badge.deleted {
    background: var(--danger);
  }

  .change-path {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .changes-empty {
    color: var(--muted);
    text-align: center;
    padding: 24px 12px;
    font-size: 12px;
  }
</style>
