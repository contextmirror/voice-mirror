<script>
  /**
   * TerminalPanel.svelte -- VS Code-style terminal panel with group tabs,
   * split panes, and sidebar instance list.
   *
   * Renders inside the "Terminal" tab of the bottom panel. Consumes
   * terminalTabsStore for group/instance state management.
   */
  import { onMount } from 'svelte';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import Terminal from './Terminal.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';

  // Auto-spawn first terminal if no groups exist
  onMount(() => {
    if (terminalTabsStore.groups.length === 0) {
      terminalTabsStore.addGroup();
    }
  });

  // Derived state
  let showSidebar = $derived(
    terminalTabsStore.groups.length > 1 ||
    terminalTabsStore.groups.some(g => g.instanceIds.length > 1)
  );

  const activeGroup = $derived(terminalTabsStore.activeGroup);
  const activeInstances = $derived(
    activeGroup
      ? activeGroup.instanceIds.map(id => terminalTabsStore.getInstance(id)).filter(Boolean)
      : []
  );

  // Split ratio for 2-pane splits
  let splitRatio = $state(0.5);
</script>

<div class="terminal-panel-inner">
  <!-- Header: group tabs + action bar -->
  <div class="terminal-header">
    <div class="terminal-group-tabs">
      {#each terminalTabsStore.groups as group}
        {@const firstInstance = terminalTabsStore.getInstance(group.instanceIds[0])}
        <div
          class="group-tab"
          class:active={group.id === terminalTabsStore.activeGroupId}
          onclick={() => terminalTabsStore.setActiveGroup(group.id)}
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
    <div class="terminal-actions">
      <button class="action-btn" title="Split Terminal" onclick={() => terminalTabsStore.splitInstance()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>
          <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
      <button class="action-btn" title="New Terminal" onclick={() => terminalTabsStore.addGroup()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.5"/>
          <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Body: terminal content + optional sidebar -->
  <div class="terminal-body">
    <div class="terminal-content">
      {#if activeInstances.length === 1}
        <Terminal shellId={activeInstances[0].shellId} visible={true} />
      {:else if activeInstances.length === 2}
        <SplitPanel direction="horizontal" bind:ratio={splitRatio} minA={120} minB={120}>
          {#snippet panelA()}
            <Terminal shellId={activeInstances[0].shellId} visible={true} />
          {/snippet}
          {#snippet panelB()}
            <Terminal shellId={activeInstances[1].shellId} visible={true} />
          {/snippet}
        </SplitPanel>
      {:else if activeInstances.length > 2}
        <!-- Support up to 2 splits cleanly; render first 2 and warn -->
        <SplitPanel direction="horizontal" bind:ratio={splitRatio} minA={120} minB={120}>
          {#snippet panelA()}
            <Terminal shellId={activeInstances[0].shellId} visible={true} />
          {/snippet}
          {#snippet panelB()}
            <Terminal shellId={activeInstances[1].shellId} visible={true} />
          {/snippet}
        </SplitPanel>
      {/if}
    </div>

    {#if showSidebar}
      <div class="terminal-sidebar">
        {#each terminalTabsStore.groups as group}
          {#each group.instanceIds as instId, idx}
            {@const instance = terminalTabsStore.getInstance(instId)}
            {@const prefix = group.instanceIds.length <= 1 ? '' : idx === 0 ? '┌ ' : idx === group.instanceIds.length - 1 ? '└ ' : '├ '}
            <div
              class="sidebar-instance"
              class:active={instId === terminalTabsStore.activeInstanceId}
              onclick={() => terminalTabsStore.focusInstance(instId)}
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
    {/if}
  </div>
</div>

<style>
  .terminal-panel-inner {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .terminal-header {
    display: flex;
    align-items: center;
    height: 32px;
    padding: 0 8px;
    border-bottom: 1px solid var(--muted);
    flex-shrink: 0;
  }

  .terminal-group-tabs {
    display: flex;
    gap: 2px;
    flex: 1;
    overflow-x: auto;
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

  .terminal-actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--bg-elevated);
  }

  .terminal-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  .terminal-content {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

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
