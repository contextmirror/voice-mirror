<script>
  import { listDirectory, getGitChanges, createFile, createDirectory, renameEntry, revealInExplorer, gitStage, gitUnstage, gitStageAll, gitUnstageAll, gitDiscard } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { searchStore } from '../../lib/stores/search.svelte.js';
  import FileTreeNode from './FileTreeNode.svelte';
  import GitChangesPanel from './GitChangesPanel.svelte';
  import FileContextMenu from './FileContextMenu.svelte';
  import StatusDropdown from './StatusDropdown.svelte';
  import OutlinePanel from './OutlinePanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import GitCommitPanel from './GitCommitPanel.svelte';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { flattenVisibleEntries, isDescendantOf, getParentPath as navGetParentPath } from '../../lib/file-tree-nav.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  let { onFileClick = () => {}, onFileDblClick = () => {}, onChangeClick = () => {}, onChangeDblClick = () => {}, activeFilePath = null, activeDiffPath = null, activeFileHasLsp = false, onSymbolClick = () => {} } = $props();

  // State
  let activeTab = $state('files');
  let rootEntries = $state([]);
  let expandedDirs = $state(new Set());
  let dirChildren = $state(new Map());
  let loadingDirs = $state(new Set());
  let gitChanges = $state([]);
  let currentBranch = $state('');
  let stagedChanges = $derived(gitChanges.filter(c => c.staged));
  let unstagedChanges = $derived(gitChanges.filter(c => c.unstaged || (!c.staged && !c.unstaged)));

  // Git status lookup for file tree decorations (matches VS Code behavior)
  // Maps file path → status ('added' | 'modified' | 'deleted' | 'renamed')
  // and dir path → most relevant child status (for folder coloring)
  // VS Code rule: deleted files do NOT propagate to parent folders
  let gitStatusMap = $derived.by(() => {
    const map = new Map();
    for (const c of gitChanges) {
      // File status — prefer unstaged (working tree) over staged
      const raw = c.unstagedStatus || c.stagedStatus || c.status || 'modified';
      // Normalize: renamed → added (VS Code treats renamed as green like added)
      const status = raw === 'renamed' ? 'added' : raw;
      map.set(c.path, status);
      // Propagate to parent directories (skip deleted — VS Code doesn't propagate deletes)
      if (status === 'deleted') continue;
      const parts = c.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        const existing = map.get(dir);
        if (!existing) {
          map.set(dir, status);
        } else if (existing !== 'modified' && status === 'modified') {
          // Modified takes priority for folders (mixed changes = modified)
          map.set(dir, 'modified');
        }
      }
    }
    return map;
  });

  // Context menu state
  let contextMenu = $state({ visible: false, x: 0, y: 0, entry: null, isFolder: false, isChange: false });

  // Inline editing state
  let editingEntry = $state(null);   // { path, name } for rename-in-place
  let editingValue = $state('');
  let creatingIn = $state(null);     // { parentPath, type: 'file' | 'directory' }
  let creatingValue = $state('');

  // Selected entry for F2 rename shortcut
  let selectedEntry = $state(null);

  // Keyboard navigation state
  let focusedPath = $state(null);
  let treeScrollEl = $state(null);
  let visibleEntries = $derived(flattenVisibleEntries(rootEntries, expandedDirs, dirChildren));

  // Drag-to-move state
  let dragOverPath = $state(null);

  // Reload when active project changes.
  $effect(() => {
    const _idx = projectStore.activeIndex;
    const _len = projectStore.entries.length;
    const _path = projectStore.activeProject?.path;
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

  // Listen for programmatic search tab activation (from Ctrl+Shift+F)
  $effect(() => {
    function handleFocusSearch() { activeTab = 'search'; }
    window.addEventListener('lens-focus-search', handleFocusSearch);
    return () => window.removeEventListener('lens-focus-search', handleFocusSearch);
  });

  async function handleTreeChanged(event) {
    const { root: rootChanged } = event.payload;
    const currentRoot = projectStore.activeProject?.path || null;
    if (!currentRoot) return; // No project open, ignore stale watcher events

    if (rootChanged) {
      await loadRoot();
    }

    // Refresh ALL expanded directories on any filesystem change.
    // The watcher reports which directories changed, but changes can cascade
    // (e.g. moving files between dirs affects both source and destination).
    // Refreshing all expanded dirs is cheap (only visible folders) and ensures
    // the tree never shows stale data.
    if (expandedDirs.size > 0) {
      const updated = new Map(dirChildren);
      let changed = false;
      for (const dir of expandedDirs) {
        try {
          const resp = await listDirectory(dir, currentRoot);
          if (resp && resp.data) {
            updated.set(dir, resp.data);
            changed = true;
          }
        } catch (err) {
          // Directory may have been deleted — remove from cache
          if (updated.has(dir)) {
            updated.delete(dir);
            changed = true;
          }
        }
      }
      if (changed) {
        dirChildren = updated;
      }
    }

    // Always refresh root entries too — file/folder additions/deletions at
    // the project root level need to show up immediately.
    await loadRoot();
  }

  function handleGitChanged() {
    // Only reload if a project is still open (avoids stale data after project close)
    if (projectStore.activeProject?.path) {
      loadGitChanges();
    }
  }

  async function loadRoot() {
    const root = projectStore.activeProject?.path;
    if (!root) {
      rootEntries = [];
      return;
    }
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
    const root = projectStore.activeProject?.path;
    if (!root) {
      gitChanges = [];
      currentBranch = '';
      return;
    }
    try {
      const resp = await getGitChanges(root);
      if (resp && resp.data) {
        gitChanges = Array.isArray(resp.data.changes) ? resp.data.changes : [];
        currentBranch = resp.data.branch || '';
      }
    } catch (err) {
      console.error('FileTree: failed to load git changes', err);
      gitChanges = [];
      currentBranch = '';
    }
  }

  async function toggleDir(entry) {
    const path = entry.path;
    if (expandedDirs.has(path)) {
      const next = new Set(expandedDirs);
      next.delete(path);
      expandedDirs = next;
    } else {
      const next = new Set(expandedDirs);
      next.add(path);
      expandedDirs = next;

      // Always fetch fresh data on expand — never use stale cache.
      // Filesystem changes while collapsed won't update dirChildren,
      // so re-expanding must read from disk to show current state.
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

  function handleFileClick(entry) {
    selectedEntry = entry;
    focusedPath = entry.path;
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
    if (entry.type === 'directory') return entry.path;
    return entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/')) : '';
  }

  function startNewFile(parentEntry) {
    const parentPath = getParentPath(parentEntry);
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

  // ── Project name header state ──
  let projectTreeOpen = $state(true);

  function collapseAll() {
    expandedDirs = new Set();
    dirChildren = new Map();
  }

  // ── Project context menu ──
  let projectMenu = $state({ visible: false, x: 0, y: 0 });

  function handleProjectContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    projectMenu = { visible: true, x: e.clientX, y: e.clientY };
  }

  function closeProjectMenu() {
    projectMenu = { ...projectMenu, visible: false };
  }

  function copyProjectPath() {
    const path = projectStore.activeProject?.path;
    if (path) navigator.clipboard.writeText(path).catch(() => {});
    closeProjectMenu();
  }

  function revealProject() {
    const path = projectStore.activeProject?.path;
    if (path) revealInExplorer(path, path).catch(() => {});
    closeProjectMenu();
  }

  // ── Keyboard shortcut (F2 rename) ──

  function handleKeydown(e) {
    if (e.key === 'Escape' && projectMenu.visible) {
      closeProjectMenu();
      return;
    }
    if (e.key === 'F2' && selectedEntry && !editingEntry && !creatingIn) {
      e.preventDefault();
      startRename(selectedEntry);
    }
  }

  // ── Tree keyboard navigation (arrow keys) ──

  function scrollFocusedIntoView() {
    if (!focusedPath || !treeScrollEl) return;
    requestAnimationFrame(() => {
      const el = treeScrollEl.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleTreeKeydown(e) {
    if (activeTab !== 'files' || !projectTreeOpen) return;
    if (editingEntry || creatingIn) return;

    const flatList = visibleEntries;
    if (flatList.length === 0) return;

    const currentIdx = focusedPath
      ? flatList.findIndex(v => v.entry.path === focusedPath)
      : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, flatList.length - 1);
        focusedPath = flatList[Math.max(0, next)].entry.path;
        scrollFocusedIntoView();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        focusedPath = flatList[prev].entry.path;
        scrollFocusedIntoView();
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const item = flatList[currentIdx];
        if (!item) break;
        if (item.entry.type === 'directory') {
          if (!expandedDirs.has(item.entry.path)) {
            toggleDir(item.entry);
          } else if (currentIdx + 1 < flatList.length && flatList[currentIdx + 1].depth > item.depth) {
            focusedPath = flatList[currentIdx + 1].entry.path;
            scrollFocusedIntoView();
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const item = flatList[currentIdx];
        if (!item) break;
        if (item.entry.type === 'directory' && expandedDirs.has(item.entry.path)) {
          toggleDir(item.entry);
        } else if (item.parentPath) {
          focusedPath = item.parentPath;
          scrollFocusedIntoView();
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const item = flatList[currentIdx];
        if (!item) break;
        if (item.entry.type === 'directory') {
          toggleDir(item.entry);
        } else {
          handleFileClick(item.entry);
        }
        break;
      }
      case 'Home': {
        e.preventDefault();
        if (flatList.length > 0) {
          focusedPath = flatList[0].entry.path;
          scrollFocusedIntoView();
        }
        break;
      }
      case 'End': {
        e.preventDefault();
        if (flatList.length > 0) {
          focusedPath = flatList[flatList.length - 1].entry.path;
          scrollFocusedIntoView();
        }
        break;
      }
    }
  }

  // ── Drag-to-move files between folders ──

  function handleTreeDragOver(e, entry) {
    if (!e.dataTransfer.types.includes('application/x-voice-mirror-file')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const targetPath = entry.type === 'directory' ? entry.path : navGetParentPath(entry.path);
    dragOverPath = targetPath || null;
  }

  function handleTreeDragLeave(e) {
    // Only clear if actually leaving the tree item (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    dragOverPath = null;
  }

  async function handleTreeDrop(e, entry) {
    e.preventDefault();
    e.stopPropagation();
    dragOverPath = null;

    let raw = e.dataTransfer.getData('application/x-voice-mirror-file');
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data?.type !== 'file-tree' || !data.entry?.path) return;

    const sourcePath = data.entry.path;
    const destFolder = entry.type === 'directory' ? entry.path : navGetParentPath(entry.path);
    const sourceParent = navGetParentPath(sourcePath);

    // No-op: same parent
    if (destFolder === sourceParent) return;

    // Block: can't move folder into itself or its descendants
    if (destFolder && isDescendantOf(destFolder, sourcePath)) {
      toastStore.addToast({ message: 'Cannot move a folder into itself', severity: 'error' });
      return;
    }

    const fileName = sourcePath.split('/').pop();
    const newPath = destFolder ? `${destFolder}/${fileName}` : fileName;

    try {
      const root = projectStore.activeProject?.path || null;
      await renameEntry(sourcePath, newPath, root);
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes('already exists')) {
        toastStore.addToast({ message: `"${fileName}" already exists in the destination folder`, severity: 'error' });
      } else {
        toastStore.addToast({ message: `Move failed: ${msg}`, severity: 'error' });
      }
    }

    window.dispatchEvent(new CustomEvent('file-tree-drag-end'));
  }

  function handleEmptyDragOver(e) {
    if (!e.dataTransfer.types.includes('application/x-voice-mirror-file')) return;
    if (e.target === e.currentTarget || e.target.classList.contains('tree-scroll')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dragOverPath = null;
    }
  }

  function handleEmptyDrop(e) {
    if (e.target !== e.currentTarget && !e.target.classList.contains('tree-scroll')) return;
    handleTreeDrop(e, { path: '', type: 'directory' });
  }

  // ── Git stage/unstage/discard handlers ──

  async function handleStage(change) {
    const root = projectStore.activeProject?.path;
    if (!root) return;
    try { await gitStage([change.path], root); await loadGitChanges(); }
    catch (err) { console.error('git stage failed', err); }
  }

  async function handleUnstage(change) {
    const root = projectStore.activeProject?.path;
    if (!root) return;
    try { await gitUnstage([change.path], root); await loadGitChanges(); }
    catch (err) { console.error('git unstage failed', err); }
  }

  async function handleStageAll() {
    const root = projectStore.activeProject?.path;
    if (!root) return;
    try { await gitStageAll(root); await loadGitChanges(); }
    catch (err) { console.error('git stage all failed', err); }
  }

  async function handleUnstageAll() {
    const root = projectStore.activeProject?.path;
    if (!root) return;
    try { await gitUnstageAll(root); await loadGitChanges(); }
    catch (err) { console.error('git unstage all failed', err); }
  }

  async function handleDiscard(change) {
    if (!confirm(`Discard changes to ${change.path}? This cannot be undone.`)) return;
    const root = projectStore.activeProject?.path;
    if (!root) return;
    try { await gitDiscard([change.path], root); await loadGitChanges(); }
    catch (err) { console.error('git discard failed', err); }
  }

  // ── Autofocus action ──

  function autofocus(node) {
    node.focus();
    const dotIdx = node.value.lastIndexOf('.');
    if (dotIdx > 0) {
      node.setSelectionRange(0, dotIdx);
    } else {
      node.select();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={() => { if (projectMenu.visible) closeProjectMenu(); }} />

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
    <button
      class="files-tab"
      class:active={activeTab === 'outline'}
      onclick={() => { activeTab = 'outline'; }}
    >Outline</button>
    <button
      class="files-tab"
      class:active={activeTab === 'search'}
      onclick={() => { activeTab = 'search'; }}
    >Search{searchStore.totalMatches > 0 ? ` (${searchStore.totalMatches})` : ''}</button>
    <StatusDropdown />
  </div>

  {#if !projectStore.activeProject}
    <div class="tree-empty">No project open</div>
  {:else if activeTab === 'files'}
    <!-- Project name header (VS Code-style) -->
    <div class="project-name-header">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <button
        class="project-name-label"
        onclick={() => { projectTreeOpen = !projectTreeOpen; }}
        oncontextmenu={handleProjectContextMenu}
        ondblclick={revealProject}
        title={projectStore.activeProject.path}
      >
        <svg class="project-name-chevron" class:collapsed={!projectTreeOpen} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <span>{projectStore.activeProject.path.split(/[/\\]/).pop()?.toUpperCase() || 'PROJECT'}</span>
      </button>
      <div class="project-name-actions">
        <button class="project-action-btn" title="New File" onclick={() => startNewFile(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </button>
        <button class="project-action-btn" title="New Folder" onclick={() => startNewFolder(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        </button>
        <button class="project-action-btn" title="Refresh" onclick={loadRoot}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button class="project-action-btn" title="Collapse All" onclick={collapseAll}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tree-scroll" tabindex="0" role="tree" oncontextmenu={handleEmptyContextMenu} onkeydown={handleTreeKeydown} ondragover={handleEmptyDragOver} ondrop={handleEmptyDrop} bind:this={treeScrollEl} class:hidden={!projectTreeOpen}>
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

      <FileTreeNode
        entries={rootEntries}
        depth={0}
        {expandedDirs}
        {dirChildren}
        {loadingDirs}
        {activeFilePath}
        {editingEntry}
        bind:editingValue
        {creatingIn}
        bind:creatingValue
        {gitStatusMap}
        {focusedPath}
        {dragOverPath}
        onToggle={toggleDir}
        onFileClick={handleFileClick}
        onFileDblClick={(entry) => onFileDblClick(entry)}
        onContextMenu={handleContextMenu}
        onRenameKeydown={handleRenameKeydown}
        onRenameSave={saveRename}
        onCreateKeydown={handleCreateKeydown}
        onCreateSave={saveCreate}
        onTreeDragOver={handleTreeDragOver}
        onTreeDragLeave={handleTreeDragLeave}
        onTreeDrop={handleTreeDrop}
        {autofocus}
      />
    </div>
  {/if}

  {#if activeTab === 'changes'}
    <GitCommitPanel
      branch={currentBranch}
      stagedCount={stagedChanges.length}
      onCommit={loadGitChanges}
      root={projectStore.activeProject?.path}
    />
    <div class="tree-scroll">
      <GitChangesPanel
        {stagedChanges}
        {unstagedChanges}
        {activeDiffPath}
        onStageAll={handleStageAll}
        onUnstageAll={handleUnstageAll}
        onStage={handleStage}
        onUnstage={handleUnstage}
        onDiscard={handleDiscard}
        onChangeClick={(change) => onChangeClick(change)}
        onChangeDblClick={(change) => onChangeDblClick(change)}
        onContextMenu={handleContextMenu}
      />
    </div>
  {/if}

  {#if activeTab === 'outline'}
    <div class="tree-scroll">
      <OutlinePanel filePath={activeFilePath} hasLsp={activeFileHasLsp} {onSymbolClick} />
    </div>
  {/if}

  {#if activeTab === 'search'}
    <div class="tree-scroll">
      <SearchPanel onResultClick={(result) => {
        const name = result.path.split(/[/\\]/).pop() || result.path;
        onFileClick({ name, path: result.path });
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('lens-goto-position', {
            detail: { line: result.line - 1, character: result.character || 0 }
          }));
        }, 50);
      }} />
    </div>
  {/if}


  {#if projectMenu.visible}
    <div class="project-context-menu" style="top: {projectMenu.y}px; left: {projectMenu.x}px;" role="menu">
      <button class="project-menu-item" role="menuitem" onclick={copyProjectPath}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy Path
      </button>
      <button class="project-menu-item" role="menuitem" onclick={revealProject}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Reveal in File Explorer
      </button>
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
  }

  .files-header {
    display: flex;
    align-items: center;
    gap: 0;
    height: 36px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .files-tab {
    padding: 0 10px;
    font-size: 12px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    height: 100%;
    display: flex;
    align-items: center;
    -webkit-app-region: no-drag;
  }
  .files-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .files-tab:hover:not(.active) {
    color: var(--text);
  }

  /* ── Project name header (VS Code-style) ── */

  .project-name-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 4px 0 0;
    flex-shrink: 0;
    background: var(--bg);
  }

  .project-name-label {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-app-region: no-drag;
    flex: 1;
    min-width: 0;
  }
  .project-name-label:hover {
    color: var(--text-strong, var(--text));
  }
  .project-name-label span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-name-chevron {
    flex-shrink: 0;
    transition: transform var(--duration-fast, 100ms) var(--ease-out, ease-out);
    transform: rotate(90deg);
  }
  .project-name-chevron.collapsed {
    transform: rotate(0deg);
  }

  .project-name-actions {
    display: flex;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--duration-fast, 100ms) var(--ease-out, ease-out);
  }
  .project-name-header:hover .project-name-actions {
    opacity: 1;
  }

  .project-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 4px;
    -webkit-app-region: no-drag;
  }
  .project-action-btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .tree-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    outline: none;
  }
  .tree-scroll:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .tree-scroll.hidden {
    display: none;
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

  .tree-empty {
    color: var(--muted);
    text-align: center;
    padding: 24px 12px;
    font-size: 12px;
  }


  /* ── Project context menu ── */

  .project-context-menu {
    position: fixed;
    min-width: 180px;
    padding: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 10003;
    -webkit-app-region: no-drag;
  }

  .project-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
    -webkit-app-region: no-drag;
  }
  .project-menu-item:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .project-menu-item svg {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .project-menu-item:hover svg {
    opacity: 1;
  }
</style>
