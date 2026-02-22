<script>
  import { onMount } from 'svelte';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { detectDevServers, probePort, lensNavigate } from '../../lib/api.js';

  let { onManage = () => {} } = $props();

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

  /** Detect dev servers for the active project */
  async function runDetection() {
    const project = projectStore.activeProject;
    if (!project?.path) return;

    lensStore.setDevServerLoading(true);
    try {
      const result = await detectDevServers(project.path);
      const list = result?.data || result || [];
      if (Array.isArray(list)) {
        lensStore.setDevServers(list);
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
        const running = result?.data?.open ?? result?.open ?? false;
        return { ...server, running };
      } catch {
        return { ...server, running: false };
      }
    }));
    lensStore.setDevServers(updated);
  }

  /** Open a server URL in the Lens browser */
  async function openInBrowser(server) {
    const url = server.url || `http://localhost:${server.port}`;
    try {
      await lensNavigate(url);
    } catch (err) {
      console.warn('[servers-tab] Navigate failed:', err);
    }
  }

  // Run detection on mount + poll every 5s
  onMount(() => {
    runDetection();

    const interval = setInterval(pollPorts, 5000);
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
      <div class="status-row">
        <div
          class="row-dot"
          class:ok={server.running}
          class:stopped={!server.running}
        ></div>
        <div class="server-info">
          <span class="row-name">{server.framework || 'Dev Server'}</span>
          <span class="server-source">from {server.source || 'config'}</span>
        </div>
        <span class="row-version">:{server.port}</span>
        {#if server.running}
          <button class="open-btn" type="button" onclick={() => openInBrowser(server)}>
            Open in Browser
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<button class="manage-btn" type="button" onclick={onManage}>Manage servers</button>

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

  .open-btn {
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
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .open-btn:hover {
    background: var(--bg-elevated);
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
</style>
