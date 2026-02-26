<script>
  /**
   * TerminalTabStrip.svelte -- Group tab strip for the terminal panel.
   *
   * Renders one tab per terminal group. Shows the first instance's title,
   * a split badge when the group has multiple instances, and highlights
   * the active group. Clicking a tab switches the active group.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  /** @type {{ oncontextmenu?: (e: MouseEvent, groupId: string) => void }} */
  let { oncontextmenu } = $props();
</script>

<div class="tab-strip" role="tablist">
  {#each terminalTabsStore.groups as group}
    {@const firstInstance = terminalTabsStore.getInstance(group.instanceIds[0])}
    <div
      class="group-tab"
      class:active={group.id === terminalTabsStore.activeGroupId}
      onclick={() => terminalTabsStore.setActiveGroup(group.id)}
      oncontextmenu={(e) => oncontextmenu?.(e, group.id)}
      role="tab"
      tabindex="0"
      aria-selected={group.id === terminalTabsStore.activeGroupId}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') terminalTabsStore.setActiveGroup(group.id); }}
    >
      {firstInstance?.title || 'Terminal'}
      {#if group.instanceIds.length > 1}
        <span class="split-badge">{group.instanceIds.length}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .tab-strip {
    display: flex;
    gap: 2px;
    flex: 1;
    overflow-x: auto;
  }

  .tab-strip::-webkit-scrollbar {
    display: none;
  }

  .group-tab {
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    border-radius: 4px 4px 0 0;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .group-tab:hover {
    background: var(--bg-elevated);
  }

  .group-tab.active {
    background: var(--bg-elevated);
    color: var(--text-strong);
  }

  .split-badge {
    font-size: 10px;
    background: var(--muted);
    color: var(--bg);
    border-radius: 4px;
    padding: 0 4px;
    line-height: 1.4;
  }
</style>
