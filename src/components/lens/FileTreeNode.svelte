<script>
  import { chooseIconName } from '../../lib/file-icons.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import spriteUrl from '../../assets/icons/file-icons-sprite.svg';
  import Self from './FileTreeNode.svelte';

  let {
    entries = [],
    depth = 0,
    expandedDirs,
    dirChildren,
    loadingDirs,
    activeFilePath = null,
    editingEntry = null,
    editingValue = $bindable(''),
    creatingIn = null,
    creatingValue = $bindable(''),
    gitStatusMap = new Map(),
    focusedPath = null,
    dragOverPath = null,
    onToggle = () => {},
    onFileClick = () => {},
    onFileDblClick = () => {},
    onContextMenu = () => {},
    onRenameKeydown = () => {},
    onRenameSave = () => {},
    onCreateKeydown = () => {},
    onCreateSave = () => {},
    autofocus = () => {},
    onTreeDragOver = () => {},
    onTreeDragLeave = () => {},
    onTreeDrop = () => {},
  } = $props();

  function handleFileDragStart(e, entry) {
    const data = { type: 'file-tree', entry: { name: entry.name, path: entry.path } };
    e.dataTransfer.effectAllowed = 'all';
    e.dataTransfer.setData('application/x-voice-mirror-file', JSON.stringify(data));
    e.dataTransfer.setData('text/plain', JSON.stringify(data));

    const ghost = document.createElement('div');
    ghost.textContent = entry.name;
    ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;padding:4px 10px;background:var(--bg-elevated,#14161c);color:var(--text,#e4e4e7);font-size:12px;font-family:var(--font-mono,monospace);border:1px solid var(--accent,#56b4e9);border-radius:4px;white-space:nowrap;pointer-events:none;z-index:99999;opacity:0.9;';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(ghost));

    window.dispatchEvent(new CustomEvent('file-tree-drag-start', { detail: data }));
  }

  function handleFileDragEnd() {
    window.dispatchEvent(new CustomEvent('file-tree-drag-end'));
  }
</script>

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
          onkeydown={onRenameKeydown}
          onblur={onRenameSave}
          use:autofocus
        />
      </div>
    {:else}
      {@const dirDiag = lspDiagnosticsStore.getForDirectory(entry.path)}
      {@const dirGit = gitStatusMap.get(entry.path)}
      <button
        class="tree-item folder"
        class:focused={focusedPath === entry.path}
        class:drop-target={dragOverPath === entry.path}
        data-path={entry.path}
        style="padding-left: {8 + depth * 16}px"
        draggable="true"
        onclick={() => onToggle(entry)}
        oncontextmenu={(e) => onContextMenu(e, entry, true, false)}
        ondragstart={(e) => handleFileDragStart(e, entry)}
        ondragend={handleFileDragEnd}
        ondragover={(e) => onTreeDragOver(e, entry)}
        ondragleave={(e) => onTreeDragLeave(e)}
        ondrop={(e) => onTreeDrop(e, entry)}
      >
        <span class="tree-chevron">{isExpanded ? 'v' : '>'}</span>
        <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(entry.path, 'directory', isExpanded)}" /></svg>
        <span class="tree-name" class:has-error={dirDiag?.errors > 0} class:has-warning={dirDiag && dirDiag.errors === 0 && dirDiag.warnings > 0} class:git-added={!dirDiag?.errors && !dirDiag?.warnings && dirGit === 'added'} class:git-modified={!dirDiag?.errors && !dirDiag?.warnings && dirGit === 'modified'}>{entry.name}</span>
        {#if dirDiag}
          {#if dirDiag.errors > 0}
            <span class="diag-badge error">{dirDiag.errors}</span>
          {/if}
          {#if dirDiag.warnings > 0}
            <span class="diag-badge warning">{dirDiag.warnings}</span>
          {/if}
        {/if}
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
            onkeydown={onCreateKeydown}
            onblur={onCreateSave}
            use:autofocus
          />
        </div>
      {/if}
      {#if loadingDirs.has(entry.path)}
        <div class="tree-loading" style="padding-left: {8 + (depth + 1) * 16}px">...</div>
      {:else if dirChildren.has(entry.path)}
        <Self
          entries={dirChildren.get(entry.path)}
          depth={depth + 1}
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
          {onToggle}
          {onFileClick}
          {onFileDblClick}
          {onContextMenu}
          {onRenameKeydown}
          {onRenameSave}
          {onCreateKeydown}
          {onCreateSave}
          {autofocus}
          {onTreeDragOver}
          {onTreeDragLeave}
          {onTreeDrop}
        />
      {/if}
    {/if}
  {:else}
    {#if editingEntry?.path === entry.path}
      <div class="tree-item file" style="padding-left: {8 + depth * 16 + 18}px">
        <input
          class="tree-rename-input"
          type="text"
          bind:value={editingValue}
          onkeydown={onRenameKeydown}
          onblur={onRenameSave}
          use:autofocus
        />
      </div>
    {:else}
      {@const fileDiag = lspDiagnosticsStore.getForFile(entry.path)}
      {@const fileGit = gitStatusMap.get(entry.path)}
      <button
        class="tree-item file"
        class:focused={focusedPath === entry.path}
        data-path={entry.path}
        style="padding-left: {8 + depth * 16 + 18}px"
        draggable="true"
        onclick={() => onFileClick(entry)}
        ondblclick={() => onFileDblClick(entry)}
        oncontextmenu={(e) => onContextMenu(e, entry, false, false)}
        ondragstart={(e) => handleFileDragStart(e, entry)}
        ondragend={handleFileDragEnd}
        ondragover={(e) => onTreeDragOver(e, entry)}
        ondragleave={(e) => onTreeDragLeave(e)}
        ondrop={(e) => onTreeDrop(e, entry)}
      >
        <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(entry.path, 'file')}" /></svg>
        <span class="tree-name" class:ignored={entry.ignored} class:has-error={fileDiag?.errors > 0} class:has-warning={fileDiag && fileDiag.errors === 0 && fileDiag.warnings > 0} class:git-added={!entry.ignored && !fileDiag?.errors && !fileDiag?.warnings && fileGit === 'added'} class:git-modified={!entry.ignored && !fileDiag?.errors && !fileDiag?.warnings && fileGit === 'modified'} class:git-deleted={!entry.ignored && !fileDiag?.errors && !fileDiag?.warnings && fileGit === 'deleted'}>{entry.name}</span>
        {#if fileDiag}
          {#if fileDiag.errors > 0}
            <span class="diag-badge error">{fileDiag.errors}</span>
          {/if}
          {#if fileDiag.warnings > 0}
            <span class="diag-badge warning">{fileDiag.warnings}</span>
          {/if}
        {/if}
      </button>
    {/if}
  {/if}
{/each}

<style>
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
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .tree-item.focused {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .tree-item.drop-target {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    outline: 1px dashed var(--accent);
    outline-offset: -1px;
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

  /* Git status decorations */

  .tree-name.git-added {
    color: var(--ok);
  }

  .tree-name.git-modified {
    color: var(--warn);
  }

  .tree-name.git-deleted {
    color: var(--danger);
    text-decoration: line-through;
    opacity: 0.7;
  }

  /* Diagnostic decorations (override git status when present) */

  .tree-name.has-error {
    color: var(--danger);
    text-decoration: none;
    opacity: 1;
  }

  .tree-name.has-warning {
    color: var(--warn);
  }

  .diag-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    font-size: 10px;
    font-weight: 600;
    border-radius: 8px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .diag-badge.error {
    background: var(--danger);
    color: var(--bg);
  }

  .diag-badge.warning {
    background: var(--warn);
    color: var(--bg);
  }
</style>
