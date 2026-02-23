<script>
  import { onMount } from 'svelte';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { detectDevServers, probePort } from '../../lib/api.js';

  let { /** @type {(e: MouseEvent) => void} */ onManage = () => {} } = $props();

  // Provider status
  let healthy = $derived(aiStatusStore.running);
  let providerName = $derived(aiStatusStore.displayName || 'No provider');
  let providerType = $derived(
    aiStatusStore.isCliProvider ? 'CLI / PTY'
    : aiStatusStore.isApiProvider ? 'HTTP API'
    : aiStatusStore.isDictationProvider ? 'Dictation'
    : ''
  );

  // Dev servers from lens store
  let servers = $derived(lensStore.devServers);
  let loading = $derived(lensStore.devServerLoading);

  // Store the detected package manager for use when starting servers
  let detectedPackageManager = $state(null);

  /**
   * Get the devServerManager status for a given server.
   * Falls back to the server's own running flag if manager has no state.
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
    // External server (detected but not started by us)
    return { status: server.running ? 'running' : 'stopped', crashLoopDetected: false, managed: false };
  }

  /** Detect dev servers for the active project */
  async function runDetection() {
    const project = projectStore.activeProject;
    if (!project?.path) return;

    lensStore.setDevServerLoading(true);
    try {
      const result = await detectDevServers(project.path);
      /** @type {any} */
      const data = result?.data || result || {};
      const list = data.servers || (Array.isArray(data) ? data : []);
      if (Array.isArray(list)) {
        lensStore.setDevServers(list);
      }
      if (data.packageManager) {
        detectedPackageManager = data.packageManager;
      }
    } catch (err) {
      console.warn('[servers-tab] Detection failed:', err);
    } finally {
      lensStore.setDevServerLoading(false);
    }
  }

  /** Probe all known server ports and update running status */
  async function pollPorts() {
    const current = lensStore.devServers;
    if (!current.length) return;

    const updated = await Promise.all(current.map(async (server) => {
      try {
        const result = await probePort(server.port);
        const running = result?.data?.listening ?? false;
        return { ...server, running };
      } catch {
        return { ...server, running: false };
      }
    }));
    lensStore.setDevServers(updated);
  }

  /** Stop an external server by killing its port process */
  function handleStopExternal(server) {
    devServerManager.stopExternalServer(server.port);
  }

  /** Start a dev server via the lifecycle manager */
  function handleStart(server) {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    devServerManager.startServer(server, project.path, detectedPackageManager);
  }

  /** Stop a dev server via the lifecycle manager */
  function handleStop() {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    devServerManager.stopServer(project.path);
  }

  /** Restart a dev server via the lifecycle manager */
  function handleRestart() {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    devServerManager.restartServer(project.path);
  }

  // Run detection on mount + poll every 5s
  onMount(() => {
    runDetection();

    const interval = setInterval(() => {
      if (lensStore.devServers.length > 0) pollPorts();
    }, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="status-list">
  <!-- Provider row -->
  <div class="status-row">
    <div
      class="row-dot"
      class:ok={healthy}
      class:stopped={!healthy && !aiStatusStore.starting}
      class:starting={aiStatusStore.starting}
    ></div>
    <span class="row-name">{providerName}</span>
    <span class="row-version">{providerType}</span>
    {#if healthy}
      <svg class="row-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    {/if}
  </div>

  <!-- Dev servers -->
  {#if loading}
    <div class="status-loading">Detecting dev servers...</div>
  {:else if servers.length === 0}
    <div class="status-empty">No dev servers detected</div>
  {:else}
    {#each servers as server}
      {@const state = getServerState(server)}
      <div class="status-row">
        <div
          class="row-dot"
          class:ok={state.status === 'running'}
          class:starting={state.status === 'starting'}
          class:danger={state.status === 'crashed'}
          class:stopped={state.status === 'stopped' || state.status === 'idle'}
        ></div>
        <div class="server-info">
          <span class="row-name">{server.framework || 'Dev Server'}</span>
          <span class="server-source">from {server.source || 'config'}</span>
        </div>
        <span class="row-version">:{server.port}</span>
        {#if state.status === 'idle'}
          <span class="idle-badge">(idle)</span>
        {/if}

        {#if state.status === 'stopped'}
          <button class="action-btn start-btn" type="button" onclick={() => handleStart(server)}>
            Start
          </button>
        {:else if state.status === 'starting'}
          <button class="action-btn starting-btn" type="button" disabled>
            <span class="starting-dot"></span> Starting...
          </button>
        {:else if state.status === 'running'}
          <button class="action-btn stop-btn" type="button" onclick={() => state.managed ? handleStop() : handleStopExternal(server)}>
            Stop
          </button>
        {:else if state.status === 'crashed'}
          {#if state.crashLoopDetected}
            <span class="crash-loop-warning">Crash loop — check terminal</span>
          {:else}
            <button class="action-btn restart-btn" type="button" onclick={handleRestart}>
              Restart
            </button>
          {/if}
        {:else if state.status === 'idle'}
          <button class="action-btn idle-stop-btn" type="button" onclick={handleStop}>
            Stop
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<button class="manage-btn" type="button" onclick={() => onManage()}>Manage servers</button>

<style>
  .status-list {
    display: flex;
    flex-direction: column;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 12px 0 8px;
    border: none;
    background: transparent;
    border-radius: 6px;
    text-align: left;
    -webkit-app-region: no-drag;
  }

  .row-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .row-dot.ok { background: var(--ok); }
  .row-dot.starting { background: var(--warn); animation: dot-pulse 1.2s ease-in-out infinite; }
  .row-dot.danger { background: var(--danger); }
  .row-dot.stopped { background: var(--muted); }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .row-name {
    font-size: 14px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .row-version {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }

  .row-check {
    color: var(--ok);
    flex-shrink: 0;
  }

  .server-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .server-info .row-name {
    font-size: 12px;
    font-weight: 500;
  }

  .server-source {
    font-size: 10px;
    color: var(--muted);
    opacity: 0.7;
  }

  .status-loading {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    padding: 12px 0;
  }

  .status-empty {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    padding: 12px 0;
  }

  .manage-btn {
    display: inline-flex;
    align-items: center;
    margin-top: 8px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .manage-btn:hover {
    background: var(--bg-elevated);
  }

  /* ── Server action buttons ── */

  .action-btn {
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

  .start-btn {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }
  .start-btn:hover {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }

  .stop-btn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .stop-btn:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .restart-btn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, transparent);
  }
  .restart-btn:hover {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  .starting-btn {
    color: var(--muted);
    cursor: not-allowed;
    opacity: 0.7;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .idle-stop-btn {
    color: var(--muted);
    border-color: color-mix(in srgb, var(--muted) 40%, transparent);
  }
  .idle-stop-btn:hover {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }

  .starting-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--warn);
    animation: dot-pulse 1.2s ease-in-out infinite;
  }

  .idle-badge {
    font-size: 10px;
    color: var(--muted);
    font-style: italic;
  }

  .crash-loop-warning {
    font-size: 10px;
    color: var(--danger);
    font-weight: 500;
    white-space: nowrap;
  }
</style>
