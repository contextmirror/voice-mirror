<script>
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import ServersTab from './ServersTab.svelte';
  import McpTab from './McpTab.svelte';
  import LspTab from './LspTab.svelte';

  let open = $state(false);
  let activeTab = $state('servers');
  let badgeEl = $state(null);
  let panelEl = $state(null);

  // ── Manage servers (inline in popover) ──
  let managing = $state(false);
  let searchQuery = $state('');

  // Overall health
  let healthy = $derived(aiStatusStore.running);

  // Server count (provider + detected dev servers)
  let devServers = $derived(lensStore.devServers);
  let serverCount = $derived(
    (healthy || aiStatusStore.starting ? 1 : 0) + devServers.length
  );

  // MCP status
  let mcpConnected = $derived(
    aiStatusStore.isCliProvider && aiStatusStore.running
  );

  // Provider info (used in manage view)
  let providerName = $derived(aiStatusStore.displayName || 'No provider');
  let providerType = $derived(
    aiStatusStore.isCliProvider ? 'CLI / PTY'
    : aiStatusStore.isApiProvider ? 'HTTP API'
    : aiStatusStore.isDictationProvider ? 'Dictation'
    : ''
  );

  // Popover position (fixed, escapes overflow:hidden ancestors)
  let popoverTop = $state(0);
  let popoverRight = $state(0);

  function updatePopoverPosition() {
    if (!badgeEl) return;
    const rect = badgeEl.getBoundingClientRect();
    popoverTop = rect.bottom + 4;
    popoverRight = window.innerWidth - rect.right;
  }

  function toggle() {
    open = !open;
    if (open) updatePopoverPosition();
  }
  function close() {
    open = false;
    managing = false;
    searchQuery = '';
  }

  function openManage() {
    managing = true;
    searchQuery = '';
  }

  function closeManage() {
    managing = false;
    searchQuery = '';
  }

  // Close on click outside
  function handleWindowClick(e) {
    if (!open) return;
    if (!e.target.isConnected) return; // target removed by reactive DOM update
    if (badgeEl?.contains(e.target)) return;
    if (panelEl?.contains(e.target)) return;
    close();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if (managing) closeManage();
      else if (open) close();
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<div class="status-wrapper">
  <button
    bind:this={badgeEl}
    class="status-badge"
    class:active={open}
    onclick={toggle}
    aria-expanded={open}
    aria-haspopup="true"
  >
    <div class="status-dot-wrap">
      <div
        class="status-dot"
        class:ok={healthy}
        class:stopped={!healthy && !aiStatusStore.starting}
        class:starting={aiStatusStore.starting}
      ></div>
    </div>
    <span>Status</span>
  </button>

  {#if open}
    <div bind:this={panelEl} class="status-popover" class:wide={managing} role="dialog" aria-label="Status panel"
      style="top: {popoverTop}px; right: {popoverRight}px;"
    >

      {#if managing}
        <!-- ── Manage Servers view (inline in popover) ── -->
        <div class="manage-header">
          <button class="manage-back" type="button" onclick={closeManage} aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h3 class="manage-title">Servers</h3>
          <button class="manage-close-btn" type="button" onclick={close} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="manage-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search servers" bind:value={searchQuery} />
        </div>

        <div class="manage-list">
          <button class="manage-row" type="button">
            <div class="row-dot" class:ok={healthy} class:stopped={!healthy && !aiStatusStore.starting} class:starting={aiStatusStore.starting}></div>
            <span class="manage-row-name">{providerName}</span>
            <span class="manage-row-version">{providerType}</span>
            {#if healthy}
              <span class="manage-row-badge">Current Server</span>
            {/if}
          </button>
          {#each devServers as server}
            {@const crashed = devServerManager.crashedServers.find(c => c.port === server.port)}
            {@const isCrashLoop = crashed?.crashLoopDetected}
            {@const hiddenTab = server.shellId ? terminalTabsStore.hiddenTabs.find(t => t.shellId === server.shellId) : null}
            <div class="manage-row">
              <div class="row-dot" class:ok={server.running} class:stopped={!server.running && !crashed} class:crashed={!!crashed}></div>
              <span class="manage-row-name">{server.framework || 'Dev Server'}</span>
              <span class="manage-row-version">localhost:{server.port}</span>
              {#if crashed}
                <span class="manage-row-badge crashed-badge">Crashed</span>
                {#if isCrashLoop}
                  <span class="crash-loop-text">Crash loop — check terminal</span>
                {:else}
                  <button class="manage-restart-btn" type="button" onclick={(e) => { e.stopPropagation(); devServerManager.restartServer(crashed.projectPath); }}>
                    Restart
                  </button>
                {/if}
              {:else if hiddenTab}
                <button class="manage-show-terminal-btn" type="button" onclick={(e) => { e.stopPropagation(); terminalTabsStore.unhideTab(hiddenTab.id); }}>
                  Show Terminal
                </button>
              {:else}
                <button class="manage-row-menu" type="button" aria-label="Server options" onclick={(e) => e.stopPropagation()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                  </svg>
                </button>
              {/if}
            </div>
          {/each}
        </div>

        <button class="manage-add" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add server
        </button>

      {:else}
        <!-- ── Normal tabs view ── -->
        <div class="popover-tabs" role="tablist">
          <button
            class="popover-tab"
            class:active={activeTab === 'servers'}
            onclick={() => { activeTab = 'servers'; }}
            role="tab"
            aria-selected={activeTab === 'servers'}
          >{serverCount} Servers</button>
          <button
            class="popover-tab"
            class:active={activeTab === 'mcp'}
            onclick={() => { activeTab = 'mcp'; }}
            role="tab"
            aria-selected={activeTab === 'mcp'}
          >{mcpConnected ? '1 ' : ''}MCP</button>
          <button
            class="popover-tab"
            class:active={activeTab === 'lsp'}
            onclick={() => { activeTab = 'lsp'; }}
            role="tab"
            aria-selected={activeTab === 'lsp'}
          >LSP</button>
        </div>

        <div class="popover-body" role="tabpanel">
          <div class="popover-content">
            {#if activeTab === 'servers'}
              <ServersTab onManage={openManage} />
            {:else if activeTab === 'mcp'}
              <McpTab />
            {:else if activeTab === 'lsp'}
              <LspTab visible={activeTab === 'lsp' && open} />
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .status-wrapper {
    position: relative;
    margin-left: auto;
    -webkit-app-region: no-drag;
  }

  /* ── Badge trigger ── */

  .status-badge {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 10px 6px 4px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .status-badge:hover {
    color: var(--text);
  }
  .status-badge.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .status-dot-wrap {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .status-dot.ok { background: var(--ok); }
  .status-dot.starting { background: var(--warn); animation: dot-pulse 1.2s ease-in-out infinite; }
  .status-dot.stopped { background: var(--muted); }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ── Popover panel ── */

  .status-popover {
    position: fixed;
    width: 320px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    border-radius: 10px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--border);
    z-index: 10002;
    -webkit-app-region: no-drag;
    transition: width var(--duration-fast) var(--ease-out);
  }

  .status-popover.wide {
    width: 380px;
  }

  /* ── Tabs ── */

  .popover-tabs {
    display: flex;
    gap: 16px;
    padding: 0 16px;
    height: 36px;
    align-items: stretch;
    background: var(--bg-elevated);
    border-bottom: none;
  }

  .popover-tab {
    padding: 0;
    font-size: 12px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    display: flex;
    align-items: center;
    transition: color var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .popover-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .popover-tab:hover:not(.active) { color: var(--text); }

  /* ── Body ── */

  .popover-body {
    padding: 8px;
    background: var(--bg-elevated);
  }

  .popover-content {
    background: var(--bg);
    border-radius: 6px;
    min-height: 56px;
    padding: 8px;
  }

  /* ── Manage Servers view (inline in popover) ── */

  .row-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .row-dot.ok { background: var(--ok); }
  .row-dot.starting { background: var(--warn); animation: dot-pulse 1.2s ease-in-out infinite; }
  .row-dot.stopped { background: var(--danger); }

  .manage-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }

  .manage-back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }
  .manage-back:hover {
    color: var(--text);
    background: var(--bg);
  }

  .manage-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin: 0;
    flex: 1;
  }

  .manage-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }
  .manage-close-btn:hover {
    color: var(--text);
    background: var(--bg);
  }

  .manage-search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 8px 0;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
  }
  .manage-search input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    outline: none;
    font-family: inherit;
  }
  .manage-search input::placeholder {
    color: var(--muted);
  }

  .manage-list {
    margin: 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .manage-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-row:last-child {
    border-bottom: none;
  }
  .manage-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .manage-row:active {
    background: rgba(255, 255, 255, 0.1);
  }

  .manage-row-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .manage-row-version {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }

  .manage-row-badge {
    font-size: 10px;
    color: var(--text);
    background: var(--bg-elevated);
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: auto;
    white-space: nowrap;
  }

  .manage-row-menu {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    margin-left: auto;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-row-menu:hover {
    background: var(--bg);
    color: var(--text);
  }

  .manage-add {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 8px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-add:hover {
    background: var(--bg);
  }

  /* ── Crash recovery UI ── */

  .row-dot.crashed { background: var(--danger); }

  .crashed-badge {
    background: color-mix(in srgb, var(--danger) 15%, transparent) !important;
    color: var(--danger) !important;
    border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  }

  .crash-loop-text {
    font-size: 10px;
    color: var(--danger);
    font-weight: 500;
    white-space: nowrap;
  }

  .manage-restart-btn {
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
    border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    border-radius: 4px;
    background: transparent;
    color: var(--warn);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: auto;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-restart-btn:hover {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  .manage-show-terminal-btn {
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: auto;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-show-terminal-btn:hover {
    background: var(--bg);
  }
</style>
