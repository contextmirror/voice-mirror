<script>
  /**
   * TerminalPanel.svelte -- VS Code-style terminal panel with group tabs,
   * split panes, and sidebar instance list.
   *
   * Renders inside the "Terminal" tab of the bottom panel. Consumes
   * terminalTabsStore for group/instance state management.
   *
   * Sub-components:
   * - TerminalTabStrip: group tab iteration and switching
   * - TerminalActionBar: action buttons with dropdown menus
   * - TerminalSidebar: instance list with tree characters
   * - TerminalContextMenu: right-click menu for instances
   */
  import { onMount } from 'svelte';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { setActionHandler } from '../../lib/stores/shortcuts.svelte.js';
  import Terminal from './Terminal.svelte';
  import SplitPanel from '../shared/SplitPanel.svelte';
  import TerminalSidebar from './TerminalSidebar.svelte';
  import TerminalContextMenu from './TerminalContextMenu.svelte';

  // Auto-spawn first terminal if no groups exist + register keyboard shortcuts
  onMount(() => {
    if (terminalTabsStore.groups.length === 0) {
      terminalTabsStore.addGroup();
    }

    // Register terminal shortcut handlers
    setActionHandler('new-terminal', () => terminalTabsStore.addGroup());
    setActionHandler('split-terminal', () => terminalTabsStore.splitInstance());
    setActionHandler('focus-prev-pane', () => terminalTabsStore.focusPreviousPane());
    setActionHandler('focus-next-pane', () => terminalTabsStore.focusNextPane());

    return () => {
      // Cleanup: unregister handlers
      setActionHandler('new-terminal', null);
      setActionHandler('split-terminal', null);
      setActionHandler('focus-prev-pane', null);
      setActionHandler('focus-next-pane', null);
    };
  });

  // Derived state
  let showSidebar = $derived(
    terminalTabsStore.groups.length > 1 ||
    terminalTabsStore.groups.some(g => g.instanceIds.length > 1)
  );

  const activeGroupId = $derived(terminalTabsStore.activeGroupId);

  /**
   * Get instances for a group, resolved from the store.
   * @param {{ id: string, instanceIds: string[] }} group
   */
  function getGroupInstances(group) {
    return group.instanceIds.map(id => terminalTabsStore.getInstance(id)).filter(Boolean);
  }

  // Per-group split ratios (keyed by group ID)
  /** @type {Record<string, number>} */
  let splitRatios = $state({});

  // Context menu state (triggered from sidebar or tab strip right-click)
  let ctxMenu = $state({ visible: false, x: 0, y: 0, instanceId: null });

  function showContextMenu(e, instanceId) {
    const estimatedHeight = 260;
    const maxY = window.innerHeight - estimatedHeight;
    const y = Math.min(e.clientY, Math.max(0, maxY));
    ctxMenu = { visible: true, x: e.clientX, y, instanceId };
  }

  function closeContextMenu() {
    ctxMenu = { ...ctxMenu, visible: false };
  }

  function handleSidebarContextMenu(e, instanceId) {
    showContextMenu(e, instanceId);
  }

  // Empty sidebar space context menu (just "New Terminal")
  let emptyCtx = $state({ visible: false, x: 0, y: 0 });

  function handleEmptyContextMenu(e) {
    emptyCtx = { visible: true, x: e.clientX, y: e.clientY };
  }

  function closeEmptyContextMenu() {
    emptyCtx = { ...emptyCtx, visible: false };
  }

  function handleNewTerminal() {
    terminalTabsStore.addGroup();
    closeEmptyContextMenu();
  }
</script>

<div class="terminal-panel-inner">
  <!-- Body: terminal content + optional sidebar -->
  <div class="terminal-body">
    <div class="terminal-content">
      <!-- All groups are always mounted — only the active one is visible.
           This prevents ghostty-web from losing PTY output on group switch. -->
      {#each terminalTabsStore.groups as group (group.id)}
        {@const instances = getGroupInstances(group)}
        {@const isActive = group.id === activeGroupId}
        <!-- Ensure split ratio is initialized for this group -->
        {(splitRatios[group.id] ??= 0.5, '')}
        <div class="group-container" class:active={isActive}>
          {#if instances.length === 1}
            <Terminal shellId={instances[0].shellId} visible={isActive} />
          {:else if instances.length >= 2}
            <SplitPanel direction="horizontal" bind:ratio={splitRatios[group.id]} minA={120} minB={120}>
              {#snippet panelA()}
                <Terminal shellId={instances[0].shellId} visible={isActive} />
              {/snippet}
              {#snippet panelB()}
                <Terminal shellId={instances[1].shellId} visible={isActive} />
              {/snippet}
            </SplitPanel>
          {/if}
        </div>
      {/each}
    </div>

    {#if showSidebar}
      <TerminalSidebar oncontextmenu={handleSidebarContextMenu} onEmptyContextMenu={handleEmptyContextMenu} />
    {/if}
  </div>
</div>

<!-- Empty sidebar context menu (New Terminal) -->
{#if emptyCtx.visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" onclick={closeEmptyContextMenu} oncontextmenu={(e) => { e.preventDefault(); closeEmptyContextMenu(); }}>
    <div class="ctx-menu" style="left: {emptyCtx.x}px; top: {emptyCtx.y}px;">
      <button class="ctx-item" onclick={handleNewTerminal}>New Terminal</button>
    </div>
  </div>
{/if}

<!-- Context menu (shared between tab strip and sidebar) -->
<TerminalContextMenu
  instanceId={ctxMenu.instanceId}
  x={ctxMenu.x}
  y={ctxMenu.y}
  visible={ctxMenu.visible}
  onClose={closeContextMenu}
/>

<style>
  .terminal-panel-inner {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
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
    position: relative;
  }

  /* All groups are always mounted; only the active one is visible and sized.
     Inactive groups use visibility:hidden + absolute positioning so they
     still have real dimensions (Terminal can measure for fit) but don't
     show or consume layout space in the parent. */
  .group-container {
    position: absolute;
    inset: 0;
    visibility: hidden;
  }

  .group-container.active {
    visibility: visible;
    z-index: 1;
  }

  /* Empty sidebar context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }

  .ctx-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.06));
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .ctx-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .ctx-item:hover {
    background: rgba(255,255,255,0.06);
  }
</style>
