<script>
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { detectDevServers } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
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

  // ── Manage servers search filter ──
  let filteredServers = $derived(
    searchQuery
      ? devServers.filter(s =>
          (s.framework || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(s.port).includes(searchQuery)
        )
      : devServers
  );
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

  // ── Manage view: server state helpers ──
  let detectedPackageManager = $state(null);

  /**
   * Get the devServerManager status for a given server (same logic as ServersTab).
   * @param {Object} server
   * @returns {{ status: string, crashLoopDetected: boolean, managed: boolean }}
   */
  function getServerState(server) {
    const project = projectStore.activeProject;
    if (!project?.path) return { status: server.running ? 'running' : 'stopped', crashLoopDetected: false, managed: false };
    const managed = devServerManager.getServerStatus(project.path);
    if (managed && managed.port === server.port) {
      return { status: managed.status, crashLoopDetected: managed.crashLoopDetected, managed: true };
    }
    return { status: server.running ? 'running' : 'stopped', crashLoopDetected: false, managed: false };
  }

  /** Start a dev server via the lifecycle manager (spawns terminal + runs command) */
  function handleStart(server) {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    devServerManager.startServer(server, project.path, detectedPackageManager);
  }

  /** Stop a managed server (one we started) via the lifecycle manager */
  function handleStop() {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    devServerManager.stopServer(project.path);
  }

  /** Stop an external server by killing its port process */
  function handleStopExternal(server) {
    devServerManager.stopExternalServer(server.port);
  }

  /** Restart a dev server via the lifecycle manager */
  function handleRestart() {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    devServerManager.restartServer(project.path);
  }

  /** Re-run detection to refresh server list */
  async function refreshServers() {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    lensStore.setDevServerLoading(true);
    try {
      const result = await detectDevServers(project.path);
      /** @type {{ servers?: unknown[], packageManager?: string }} */
      const data = unwrapResult(result) || {};
      const list = data.servers || (Array.isArray(data) ? data : []);
      if (Array.isArray(list)) {
        lensStore.setDevServers(list);
      }
      if (data.packageManager) {
        detectedPackageManager = data.packageManager;
      }
    } catch (err) {
      console.warn('[status-dropdown] Detection failed:', err);
    } finally {
      lensStore.setDevServerLoading(false);
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
          <!-- Provider row (informational) -->
          <div class="manage-row">
            <div class="row-dot" class:ok={healthy} class:stopped={!healthy && !aiStatusStore.starting} class:starting={aiStatusStore.starting}></div>
            <div class="manage-row-info">
              <span class="manage-row-name">{providerName}</span>
              <span class="manage-row-type">{providerType}</span>
            </div>
            {#if healthy}
              <span class="manage-row-badge">Active</span>
            {/if}
          </div>

          <!-- Dev servers with full controls -->
          {#each filteredServers as server}
            {@const state = getServerState(server)}
            {@const hiddenTab = server.shellId ? terminalTabsStore.hiddenTabs.find(t => t.shellId === server.shellId) : null}
            <div class="manage-row">
              <div
                class="row-dot"
                class:ok={state.status === 'running'}
                class:starting={state.status === 'starting'}
                class:crashed={state.status === 'crashed'}
                class:stopped={state.status === 'stopped' || state.status === 'idle'}
              ></div>
              <div class="manage-row-info">
                <span class="manage-row-name">{server.framework || 'Dev Server'}</span>
                <span class="manage-row-type">localhost:{server.port}</span>
              </div>

              <div class="manage-row-actions">
                {#if state.status === 'stopped'}
                  <button class="manage-action-btn manage-start-btn" type="button" onclick={(e) => { e.stopPropagation(); handleStart(server); }}>
                    Start
                  </button>
                {:else if state.status === 'starting'}
                  <span class="manage-starting-label"><span class="starting-dot"></span> Starting</span>
                {:else if state.status === 'running'}
                  <span class="manage-status-label running">Running</span>
                  <button class="manage-action-btn manage-stop-btn" type="button" onclick={(e) => { e.stopPropagation(); state.managed ? handleStop() : handleStopExternal(server); }}>
                    Stop
                  </button>
                {:else if state.status === 'crashed'}
                  {#if state.crashLoopDetected}
                    <span class="crash-loop-text">Crash loop</span>
                  {:else}
                    <button class="manage-action-btn manage-restart-btn" type="button" onclick={(e) => { e.stopPropagation(); handleRestart(); }}>
                      Restart
                    </button>
                  {/if}
                {:else if state.status === 'idle'}
                  <span class="manage-status-label idle">Idle</span>
                  <button class="manage-action-btn manage-stop-btn" type="button" onclick={(e) => { e.stopPropagation(); handleStop(); }}>
                    Stop
                  </button>
                {/if}

                {#if hiddenTab}
                  <button class="manage-action-btn manage-show-btn" type="button" onclick={(e) => { e.stopPropagation(); terminalTabsStore.unhideTab(hiddenTab.id); }}>
                    Show
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <button class="manage-refresh" type="button" onclick={refreshServers}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh detection
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
  .row-dot.stopped { background: var(--muted); }

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
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-row:last-child {
    border-bottom: none;
  }
  .manage-row:hover {
    background: color-mix(in srgb, var(--text) 3%, transparent);
  }

  .manage-row-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .manage-row-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .manage-row-type {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }

  .manage-row-badge {
    font-size: 10px;
    color: var(--text);
    background: var(--bg-elevated);
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .manage-row-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .manage-action-btn {
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }

  .manage-start-btn {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }
  .manage-start-btn:hover {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }

  .manage-stop-btn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .manage-stop-btn:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .manage-restart-btn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, transparent);
  }
  .manage-restart-btn:hover {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  .manage-status-label {
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }
  .manage-status-label.running {
    color: var(--ok);
  }
  .manage-status-label.idle {
    color: var(--muted);
    font-style: italic;
  }

  .manage-show-btn {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .manage-show-btn:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .manage-starting-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }

  .starting-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--warn);
    animation: dot-pulse 1.2s ease-in-out infinite;
  }

  .manage-refresh {
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
    color: var(--muted);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-refresh:hover {
    background: var(--bg);
    color: var(--text);
  }

  /* ── Crash recovery UI ── */

  .row-dot.crashed { background: var(--danger); }

  .crash-loop-text {
    font-size: 10px;
    color: var(--danger);
    font-weight: 500;
    white-space: nowrap;
  }
</style>
