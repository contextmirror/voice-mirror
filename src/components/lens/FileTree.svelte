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

  // Context menu state
  let contextMenu = $state({ visible: false, x: 0, y: 0, entry: null, isFolder: false, isChange: false });

  // Inline editing state
  let editingEntry = $state(null);   // { path, name } for rename-in-place
  let editingValue = $state('');
  let creatingIn = $state(null);     // { parentPath, type: 'file' | 'directory' }
  let creatingValue = $state('');

  // Selected entry for F2 rename shortcut
  let selectedEntry = $state(null);

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
    const { directories, root: rootChanged } = event.payload;
    const currentRoot = projectStore.activeProject?.path || null;

    if (rootChanged) {
      await loadRoot();
    }

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

  // ── Project path collapse + context menu ──
  let projectPathOpen = $state(false);
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
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tree-scroll" oncontextmenu={handleEmptyContextMenu}>
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
        onToggle={toggleDir}
        onFileClick={handleFileClick}
        onFileDblClick={(entry) => onFileDblClick(entry)}
        onContextMenu={handleContextMenu}
        onRenameKeydown={handleRenameKeydown}
        onRenameSave={saveRename}
        onCreateKeydown={handleCreateKeydown}
        onCreateSave={saveCreate}
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

  <!-- Project path (collapsible, bottom) -->
  {#if projectStore.activeProject?.path}
    <div class="project-path-section">
      <button
        class="project-path-toggle"
        onclick={() => { projectPathOpen = !projectPathOpen; }}
        oncontextmenu={handleProjectContextMenu}
        aria-expanded={projectPathOpen}
        title={projectStore.activeProject.path}
      >
        <svg class="project-path-chevron" class:open={projectPathOpen} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <svg class="project-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="project-path-label">Project</span>
      </button>
      {#if projectPathOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="project-path-value" oncontextmenu={handleProjectContextMenu}>{projectStore.activeProject.path}</div>
      {/if}
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
    border-left: 1px solid var(--border);
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

  /* ── Project path (collapsible footer) ── */

  .project-path-section {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
  }

  .project-path-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    -webkit-app-region: no-drag;
    transition: color var(--duration-fast) var(--ease-out);
  }
  .project-path-toggle:hover {
    color: var(--text);
  }

  .project-path-chevron {
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease-out);
  }
  .project-path-chevron.open {
    transform: rotate(90deg);
  }

  .project-path-icon {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .project-path-label {
    white-space: nowrap;
  }

  .project-path-value {
    padding: 0 8px 8px 30px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--muted);
    word-break: break-all;
    line-height: 1.4;
    user-select: text;
    -webkit-user-select: text;
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
