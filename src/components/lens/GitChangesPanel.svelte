<script>
  import { chooseIconName } from '../../lib/file-icons.js';
  import spriteUrl from '../../assets/icons/file-icons-sprite.svg';

  let {
    stagedChanges = [],
    unstagedChanges = [],
    activeDiffPath = null,
    onStageAll = () => {},
    onUnstageAll = () => {},
    onStage = () => {},
    onUnstage = () => {},
    onDiscard = () => {},
    onChangeClick = () => {},
    onChangeDblClick = () => {},
    onContextMenu = () => {},
  } = $props();
</script>

{#if stagedChanges.length > 0}
  <div class="changes-group-header">
    <span>Staged Changes ({stagedChanges.length})</span>
    <button class="changes-group-action" title="Unstage All" onclick={() => onUnstageAll()}>&minus;</button>
  </div>
  {#each stagedChanges as change}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="change-item"
      class:active={change.path === activeDiffPath}
      role="button"
      tabindex="0"
      onclick={() => onChangeClick(change)}
      ondblclick={() => onChangeDblClick(change)}
      oncontextmenu={(e) => onContextMenu(e, change, false, true)}
    >
      <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(change.path, 'file')}" /></svg>
      <span class="change-path">{change.path}</span>
      <button class="change-action" title="Unstage" onclick={(e) => { e.stopPropagation(); onUnstage(change); }}>&minus;</button>
      <span
        class="change-badge"
        class:added={change.stagedStatus === 'added'}
        class:modified={change.stagedStatus === 'modified'}
        class:deleted={change.stagedStatus === 'deleted'}
        title={change.stagedStatus === 'added' ? 'Added — new file' : change.stagedStatus === 'deleted' ? 'Deleted' : change.stagedStatus === 'renamed' ? 'Renamed' : 'Modified'}
      >
        {change.stagedStatus === 'added' ? 'A' : change.stagedStatus === 'deleted' ? 'D' : change.stagedStatus === 'renamed' ? 'R' : 'M'}
      </span>
    </div>
  {/each}
{/if}

{#if unstagedChanges.length > 0}
  <div class="changes-group-header">
    <span>Changes ({unstagedChanges.length})</span>
    <button class="changes-group-action" title="Stage All" onclick={() => onStageAll()}>+</button>
  </div>
  {#each unstagedChanges as change}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="change-item"
      class:active={change.path === activeDiffPath}
      role="button"
      tabindex="0"
      onclick={() => onChangeClick(change)}
      ondblclick={() => onChangeDblClick(change)}
      oncontextmenu={(e) => onContextMenu(e, change, false, true)}
    >
      <svg class="tree-icon"><use href="{spriteUrl}#{chooseIconName(change.path, 'file')}" /></svg>
      <span class="change-path">{change.path}</span>
      <button class="change-action" title="Stage" onclick={(e) => { e.stopPropagation(); onStage(change); }}>+</button>
      {#if change.unstagedStatus !== 'added'}
        <button class="change-action discard" title="Discard" onclick={(e) => { e.stopPropagation(); onDiscard(change); }}>&times;</button>
      {/if}
      <span
        class="change-badge"
        class:added={change.status === 'added'}
        class:modified={change.status === 'modified'}
        class:deleted={change.status === 'deleted'}
        title={change.status === 'added' ? 'Added — new file' : change.status === 'deleted' ? 'Deleted' : change.status === 'renamed' ? 'Renamed' : 'Modified'}
      >
        {change.status === 'added' ? 'A' : change.status === 'deleted' ? 'D' : change.status === 'renamed' ? 'R' : 'M'}
      </span>
    </div>
  {/each}
{/if}

{#if stagedChanges.length === 0 && unstagedChanges.length === 0}
  <div class="changes-empty">No changes</div>
{/if}

<style>
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
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .change-item.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text-strong, var(--text));
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

  /* Git changes group headers + action buttons */

  .changes-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    -webkit-app-region: no-drag;
  }

  .changes-group-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 3px;
    font-size: 14px;
    -webkit-app-region: no-drag;
  }
  .changes-group-action:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
  }

  .change-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 3px;
    font-size: 11px;
    opacity: 0;
    transition: opacity 0.1s;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }
  .change-item:hover .change-action {
    opacity: 1;
  }
  .change-action:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
  }
  .change-action.discard:hover {
    color: var(--danger);
  }

  .tree-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
</style>
