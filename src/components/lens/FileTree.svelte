<script>
  import { listDirectory, getGitChanges } from '../../lib/api.js';
  import { chooseIconName } from '../../lib/file-icons.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import spriteUrl from '../../assets/icons/file-icons-sprite.svg';

  let { onFileClick = () => {} } = $props();

  // State
  let activeTab = $state('files');
  let rootEntries = $state([]);
  let expandedDirs = $state(new Set());
  let dirChildren = $state(new Map());
  let loadingDirs = $state(new Set());
  let gitChanges = $state([]);

  // Reload when active project changes
  $effect(() => {
    const _ = projectStore.activeIndex;  // track dependency
    expandedDirs = new Set();
    dirChildren = new Map();
    loadRoot();
    loadGitChanges();
  });

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
    onFileClick(entry);
  }
</script>

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
  </div>

  {#if activeTab === 'files'}
    <div class="tree-scroll">
      {#snippet treeNode(entries, depth)}
        {#each entries as entry}
          {#if entry.type === 'directory'}
            {@const isExpanded = expandedDirs.has(entry.path)}
            <button
              class="tree-item folder"
              style="padding-left: {8 + depth * 16}px"
              onclick={() => toggleDir(entry)}
            >
              <span class="tree-chevron">{isExpanded ? 'v' : '>'}</span>
              <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(entry.path, 'directory', isExpanded)}" /></svg>
              <span class="tree-name">{entry.name}</span>
            </button>
            {#if isExpanded}
              {#if loadingDirs.has(entry.path)}
                <div class="tree-loading" style="padding-left: {8 + (depth + 1) * 16}px">...</div>
              {:else if dirChildren.has(entry.path)}
                {@render treeNode(dirChildren.get(entry.path), depth + 1)}
              {/if}
            {/if}
          {:else}
            <button
              class="tree-item file"
              style="padding-left: {8 + depth * 16 + 18}px"
              onclick={() => handleFileClick(entry)}
            >
              <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(entry.path, 'file')}" /></svg>
              <span class="tree-name" class:ignored={entry.ignored}>{entry.name}</span>
            </button>
          {/if}
        {/each}
      {/snippet}

      {@render treeNode(rootEntries, 0)}
    </div>
  {/if}

  {#if activeTab === 'changes'}
    <div class="tree-scroll">
      {#if gitChanges.length === 0}
        <div class="changes-empty">No changes</div>
      {:else}
        {#each gitChanges as change}
          <div class="change-item">
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
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

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

  .change-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text);
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
