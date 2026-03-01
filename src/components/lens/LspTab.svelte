<script>
  import { lspGetStatus, lspRestartServer, lspShutdown, lspGetServerList, lspInstallServer } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';

  let { visible = false } = $props();

  /** @type {Array<any>} Active/running LSP servers from lsp_get_status */
  let lspServers = $state([]);
  /** @type {Array<any>} All known servers from manifest (for install buttons) */
  let knownServers = $state([]);
  /** @type {string|null} Currently expanded server key (languageId::projectRoot) */
  let expandedKey = $state(null);
  /** @type {Set<string>} Server IDs currently being installed */
  let installing = $state(new Set());
  /** @type {boolean} Whether a restart-all is in progress */
  let restartingAll = $state(false);

  /**
   * Map ServerState enum to a status dot CSS class.
   * @param {string} state - ServerState value from backend
   * @returns {string} CSS class name for the dot
   */
  function dotClass(state) {
    switch (state) {
      case 'Running': return 'ok';
      case 'Starting':
      case 'Restarting': return 'starting';
      case 'Failed': return 'danger';
      case 'Unresponsive': return 'unresponsive';
      case 'Stopped':
      case 'Stopping': return 'stopped';
      default: return 'stopped';
    }
  }

  /**
   * Get a display name for a server.
   * @param {any} server
   * @returns {string}
   */
  function displayName(server) {
    let name = server.serverName || server.binary || server.languageId;
    // Strip version suffix if present (e.g. "rust-analyzer 1.93.1 (01f6ddf7 ...)" → "rust-analyzer")
    // since version is shown in a separate column
    if (server.version && name.includes(server.version)) {
      name = name.substring(0, name.indexOf(server.version)).trim();
    }
    return name || server.binary || server.languageId;
  }

  /**
   * Get basename from a full path.
   * @param {string} p
   * @returns {string}
   */
  function basename(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').split('/').pop() || p;
  }

  /**
   * Build a unique key for a server row.
   * @param {any} server
   * @returns {string}
   */
  function serverKey(server) {
    return `${server.languageId}::${server.projectRoot}`;
  }

  /**
   * Toggle detail panel for a server.
   * @param {any} server
   */
  function toggleDetail(server) {
    const key = serverKey(server);
    expandedKey = expandedKey === key ? null : key;
  }

  /**
   * Restart a single server.
   * @param {any} server
   */
  async function handleRestart(server) {
    try {
      await lspRestartServer(server.languageId, server.projectRoot);
    } catch (err) {
      console.warn('[lsp-tab] Restart failed:', err);
    }
  }

  /**
   * Stop (shut down) a single server.
   * @param {any} server
   */
  async function handleStop(server) {
    try {
      // lspShutdown shuts down all servers; use restart with just shutdown for single
      await lspRestartServer(server.languageId, server.projectRoot);
    } catch (err) {
      console.warn('[lsp-tab] Stop failed:', err);
    }
  }

  /**
   * Restart all running servers.
   */
  async function handleRestartAll() {
    restartingAll = true;
    try {
      const restarts = lspServers.map(s => lspRestartServer(s.languageId, s.projectRoot));
      await Promise.allSettled(restarts);
    } finally {
      restartingAll = false;
    }
  }

  /**
   * Install a server by ID.
   * @param {string} serverId
   */
  async function handleInstall(serverId) {
    installing = new Set([...installing, serverId]);
    try {
      await lspInstallServer(serverId);
      // Refresh the known server list after install
      await fetchKnownServers();
    } catch (err) {
      console.warn('[lsp-tab] Install failed:', err);
    } finally {
      const next = new Set(installing);
      next.delete(serverId);
      installing = next;
    }
  }

  /** Fetch the known server list (manifest + install status). */
  async function fetchKnownServers() {
    try {
      const result = await lspGetServerList();
      const data = result?.data || result;
      if (Array.isArray(data)) {
        knownServers = data;
      }
    } catch {
      // ignore
    }
  }

  /** Servers from the manifest that are not installed. */
  let uninstalledServers = $derived(
    knownServers.filter(s => !s.installed)
  );

  // Fetch LSP status + known servers when tab becomes visible
  $effect(() => {
    if (visible) {
      lspGetStatus().then(result => {
        if (result?.data?.servers) {
          lspServers = result.data.servers;
        }
      }).catch(() => {});
      fetchKnownServers();
    }
  });

  // Listen for LSP server status updates
  $effect(() => {
    let cancelled = false;
    let unlisten;
    listen('lsp-server-status', (event) => {
      if (!cancelled && event.payload?.servers) {
        lspServers = event.payload.servers;
      }
    }).then(fn => { unlisten = fn; if (cancelled) fn(); });
    return () => { cancelled = true; unlisten?.(); };
  });

  // Listen for install status updates
  $effect(() => {
    let cancelled = false;
    let unlisten;
    listen('lsp-install-status', (event) => {
      if (!cancelled && event.payload) {
        // Refresh known servers when install completes
        if (event.payload.status === 'complete' || event.payload.status === 'error') {
          fetchKnownServers();
        }
      }
    }).then(fn => { unlisten = fn; if (cancelled) fn(); });
    return () => { cancelled = true; unlisten?.(); };
  });
</script>

<div class="lsp-panel">
  <!-- Top actions -->
  {#if lspServers.length > 0}
    <div class="panel-actions">
      <button
        class="action-btn restart-all-btn"
        type="button"
        onclick={handleRestartAll}
        disabled={restartingAll}
      >
        {restartingAll ? 'Restarting...' : 'Restart All'}
      </button>
    </div>
  {/if}

  <!-- Running servers -->
  <div class="status-list">
    {#if lspServers.length > 0}
      {#each lspServers as server}
        {@const key = serverKey(server)}
        {@const expanded = expandedKey === key}
        <button
          class="lsp-server-row"
          class:expanded
          type="button"
          onclick={() => toggleDetail(server)}
        >
          <span class="lsp-dot {dotClass(server.state)}"></span>
          <div class="lsp-server-info">
            <span class="lsp-server-name">{displayName(server)}</span>
            <span class="lsp-server-lang">{server.languageId}</span>
          </div>
          <span class="lsp-server-files">
            {server.openDocsCount} file{server.openDocsCount !== 1 ? 's' : ''}
          </span>
          <span class="lsp-server-project">{basename(server.projectRoot)}</span>
          <div class="lsp-server-actions" onclick={(e) => e.stopPropagation()}>
            {#if server.state === 'Running' || server.state === 'Failed' || server.state === 'Unresponsive'}
              <button
                class="action-btn restart-btn"
                type="button"
                onclick={() => handleRestart(server)}
                title="Restart server"
              >Restart</button>
            {/if}
            {#if server.state === 'Running' || server.state === 'Unresponsive'}
              <button
                class="action-btn stop-btn"
                type="button"
                onclick={() => handleStop(server)}
                title="Stop server"
              >Stop</button>
            {/if}
          </div>
          <svg
            class="expand-chevron"
            class:rotated={expanded}
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
          ><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        {#if expanded}
          <div class="detail-section">
            <div class="detail-row">
              <span class="detail-label">Binary</span>
              <span class="detail-value">{server.binary}</span>
            </div>
            {#if server.version}
              <div class="detail-row">
                <span class="detail-label">Version</span>
                <span class="detail-value">{server.version}</span>
              </div>
            {/if}
            <div class="detail-row">
              <span class="detail-label">State</span>
              <span class="detail-value">{server.state}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Project</span>
              <span class="detail-value">{server.projectRoot}</span>
            </div>
            {#if server.pid}
              <div class="detail-row">
                <span class="detail-label">PID</span>
                <span class="detail-value">{server.pid}</span>
              </div>
            {/if}
            {#if server.crashCount > 0}
              <div class="detail-row">
                <span class="detail-label">Crashes</span>
                <span class="detail-value crash-count">{server.crashCount}</span>
              </div>
            {/if}
            {#if server.lastError}
              <div class="detail-row">
                <span class="detail-label">Last error</span>
                <span class="detail-value error-text">{server.lastError}</span>
              </div>
            {/if}
            {#if server.stderrLines?.length > 0}
              <div class="detail-row stderr-section">
                <span class="detail-label">stderr</span>
                <pre class="stderr-lines">{server.stderrLines.join('\n')}</pre>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {:else}
      <div class="status-empty">No LSP servers active</div>
    {/if}
  </div>

  <!-- Uninstalled servers -->
  {#if uninstalledServers.length > 0}
    <div class="install-section">
      <div class="install-header">Available to Install</div>
      {#each uninstalledServers as server}
        <div class="install-row">
          <span class="install-name">{server.binary}</span>
          <span class="install-lang">{server.languageId}</span>
          <button
            class="action-btn install-btn"
            type="button"
            onclick={() => handleInstall(server.id)}
            disabled={installing.has(server.id)}
          >
            {installing.has(server.id) ? 'Installing...' : 'Install'}
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="lsp-hint">Auto-detected from open file types</div>
</div>

<style>
  .lsp-panel {
    display: flex;
    flex-direction: column;
  }

  .panel-actions {
    display: flex;
    justify-content: flex-end;
    padding: 4px 12px 2px;
    gap: 6px;
  }

  .status-list {
    display: flex;
    flex-direction: column;
  }

  .status-empty {
    font-size: 14px;
    color: var(--muted);
    text-align: center;
    padding: 12px 0;
  }

  .lsp-server-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 8px;
    border: none;
    background: transparent;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
    width: 100%;
    font-family: inherit;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out);
    -webkit-app-region: no-drag;
  }

  .lsp-server-row:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .lsp-server-row.expanded {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  /* ── Status dot ── */

  .lsp-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .lsp-dot.ok { background: var(--ok); }
  .lsp-dot.starting { background: var(--warn); animation: dot-pulse 1.2s ease-in-out infinite; }
  .lsp-dot.danger { background: var(--danger); }
  .lsp-dot.unresponsive { background: var(--warn); }
  .lsp-dot.stopped { background: var(--muted); }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ── Server info ── */

  .lsp-server-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .lsp-server-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lsp-server-lang {
    font-size: 10px;
    color: var(--muted);
  }

  .lsp-server-files {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .lsp-server-project {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
    flex-shrink: 0;
  }

  .lsp-server-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .expand-chevron {
    color: var(--muted);
    flex-shrink: 0;
    transition: transform var(--duration-fast, 100ms) var(--ease-out, ease-out);
  }

  .expand-chevron.rotated {
    transform: rotate(180deg);
  }

  /* ── Action buttons ── */

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
    font-family: inherit;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out);
    -webkit-app-region: no-drag;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .restart-btn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, transparent);
  }
  .restart-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  .stop-btn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .stop-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .restart-all-btn {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .restart-all-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .install-btn {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }
  .install-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }

  /* ── Detail section ── */

  .detail-section {
    padding: 4px 12px 8px 24px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    margin-bottom: 2px;
  }

  .detail-row {
    display: flex;
    gap: 8px;
    font-size: 11px;
    line-height: 1.4;
  }

  .detail-label {
    color: var(--muted);
    min-width: 60px;
    flex-shrink: 0;
  }

  .detail-value {
    color: var(--text);
    word-break: break-all;
    min-width: 0;
  }

  .crash-count {
    color: var(--danger);
    font-weight: 600;
  }

  .error-text {
    color: var(--danger);
  }

  .stderr-section {
    flex-direction: column;
    gap: 4px;
  }

  .stderr-lines {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--muted);
    background: color-mix(in srgb, var(--bg) 60%, var(--bgElevated));
    padding: 6px 8px;
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 120px;
    overflow-y: auto;
    margin: 0;
  }

  /* ── Install section ── */

  .install-section {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .install-header {
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 12px 4px;
  }

  .install-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 8px;
  }

  .install-name {
    font-size: 12px;
    color: var(--text);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .install-lang {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }

  /* ── Footer hint ── */

  .lsp-hint {
    padding: 8px 12px 4px;
    font-size: 10px;
    color: var(--muted);
    opacity: 0.7;
  }
</style>
