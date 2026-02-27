<script>
  /**
   * TerminalTabStrip.svelte -- Group tab strip for the terminal panel.
   *
   * Renders one tab per terminal group. Shows the first instance's title,
   * a split badge when the group has multiple instances, and highlights
   * the active group. Clicking a tab switches the active group.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  /** @type {{ oncontextmenu?: (e: MouseEvent, groupId: string) => void }} */
  let { oncontextmenu } = $props();

  function handleClose(e, group) {
    e.stopPropagation();
    const firstInst = terminalTabsStore.getInstance(group.instanceIds[0]);
    if (firstInst?.type === 'dev-server' && devServerManager.isDevServerShell(firstInst.id)) {
      toastStore.addToast({
        message: `Stop ${firstInst.title || 'Dev server'}?`,
        severity: 'warning',
        duration: 8000,
        actions: [
          { label: 'Stop', callback: () => terminalTabsStore.killGroup(group.id) },
          { label: 'Cancel', callback: () => {} },
        ],
      });
    } else {
      terminalTabsStore.killGroup(group.id);
    }
  }

  function handleAuxClick(e, group) {
    if (e.button === 1) {
      e.preventDefault();
      handleClose(e, group);
    }
  }
</script>

<div class="tab-strip" role="tablist">
  {#each terminalTabsStore.groups as group}
    {@const firstInstance = terminalTabsStore.getInstance(group.instanceIds[0])}
    <div
      class="group-tab"
      class:active={group.id === terminalTabsStore.activeGroupId}
      onclick={() => terminalTabsStore.setActiveGroup(group.id)}
      oncontextmenu={(e) => oncontextmenu?.(e, group.id)}
      onauxclick={(e) => handleAuxClick(e, group)}
      role="tab"
      tabindex="0"
      aria-selected={group.id === terminalTabsStore.activeGroupId}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') terminalTabsStore.setActiveGroup(group.id); }}
    >
      {firstInstance?.title || 'Terminal'}
      {#if group.instanceIds.length > 1}
        <span class="split-badge">{group.instanceIds.length}</span>
      {/if}
      <button
        class="tab-close"
        onclick={(e) => handleClose(e, group)}
        aria-label="Close terminal group"
        tabindex="-1"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/>
          <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
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

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    border-radius: 3px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s, background 0.1s;
  }

  .group-tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text);
  }
</style>
