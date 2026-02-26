<script>
  /**
   * TerminalSidebar.svelte -- Instance list sidebar for the terminal panel.
   *
   * Shows all groups and their instances in a tree structure. Single-instance
   * groups have no tree prefix; multi-instance groups use box-drawing chars.
   * Click focuses an instance; right-click dispatches a context menu event.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  /** @type {{ oncontextmenu?: (e: MouseEvent, instanceId: string) => void }} */
  let { oncontextmenu } = $props();
</script>

<div class="terminal-sidebar">
  {#each terminalTabsStore.groups as group}
    {#each group.instanceIds as instId, idx}
      {@const instance = terminalTabsStore.getInstance(instId)}
      {@const prefix = group.instanceIds.length <= 1 ? '' : idx === 0 ? '\u250C ' : idx === group.instanceIds.length - 1 ? '\u2514 ' : '\u251C '}
      <div
        class="sidebar-instance"
        class:active={instId === terminalTabsStore.activeInstanceId}
        onclick={() => terminalTabsStore.focusInstance(instId)}
        oncontextmenu={(e) => { e.preventDefault(); oncontextmenu?.(e, instId); }}
        role="option"
        tabindex="0"
        aria-selected={instId === terminalTabsStore.activeInstanceId}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') terminalTabsStore.focusInstance(instId); }}
      >
        {#if prefix}<span class="tree-char">{prefix}</span>{/if}
        <span class="instance-title">{instance?.title || 'Terminal'}</span>
      </div>
    {/each}
  {/each}
</div>

<style>
  .terminal-sidebar {
    width: 160px;
    border-left: 1px solid var(--muted);
    overflow-y: auto;
    flex-shrink: 0;
  }

  .sidebar-instance {
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .sidebar-instance:hover {
    background: var(--bg-elevated);
  }

  .sidebar-instance.active {
    background: var(--bg-elevated);
    color: var(--text-strong);
  }

  .tree-char {
    color: var(--muted);
    font-family: var(--font-mono);
    margin-right: 4px;
  }

  .instance-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
