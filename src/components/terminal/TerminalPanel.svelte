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

  const activeGroup = $derived(terminalTabsStore.activeGroup);
  const activeInstances = $derived(
    activeGroup
      ? activeGroup.instanceIds.map(id => terminalTabsStore.getInstance(id)).filter(Boolean)
      : []
  );

  // Split ratio for 2-pane splits
  let splitRatio = $state(0.5);

  // ---- Transition blanking ----
  // When instance count or active group changes, Svelte tears down and
  // recreates Terminal components. During teardown, ghostty-web disposal
  // artifacts flash as garbled text. Hide the content area during transitions.
  let transitioning = $state(false);
  let prevInstanceKey = $state('');

  $effect(() => {
    // Build a key from group ID + instance IDs so any layout change triggers blanking
    const key = (activeGroup?.id || '') + ':' + activeInstances.map(i => i.shellId).join(',');
    if (prevInstanceKey !== '' && key !== prevInstanceKey) {
      transitioning = true;
      // Reveal after terminals have had time to initialize (double-rAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          transitioning = false;
        });
      });
    }
    prevInstanceKey = key;
  });

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
    <div class="terminal-content" class:transitioning>
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
  }

  .terminal-content.transitioning {
    visibility: hidden;
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
