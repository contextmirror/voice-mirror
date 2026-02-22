<script>
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { lspGetStatus } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';

  let open = $state(false);
  let activeTab = $state('servers');
  let badgeEl = $state(null);
  let panelEl = $state(null);

  // ── Manage servers dialog ──
  let dialogOpen = $state(false);
  let dialogRef = $state(null);
  let searchQuery = $state('');

  // LSP state
  let lspServers = $state([]);

  // Overall health
  let healthy = $derived(aiStatusStore.running);

  // Server count (provider + dev server)
  let serverCount = $derived((healthy || aiStatusStore.starting ? 1 : 0) + 1);

  // MCP status
  let mcpConnected = $derived(
    aiStatusStore.isCliProvider && aiStatusStore.running
  );

  // Provider info
  let providerName = $derived(aiStatusStore.displayName || 'No provider');
  let providerType = $derived(
    aiStatusStore.isCliProvider ? 'CLI / PTY'
    : aiStatusStore.isApiProvider ? 'HTTP API'
    : aiStatusStore.isDictationProvider ? 'Dictation'
    : ''
  );

  function toggle() { open = !open; }
  function close() { open = false; }

  function openDialog() {
    close();
    dialogOpen = true;
    searchQuery = '';
  }

  function closeDialog() {
    dialogOpen = false;
  }

  // Freeze webview when dialog is open (same pattern as ScreenshotPicker)
  $effect(() => {
    if (dialogOpen) {
      lensStore.freeze();
      return () => lensStore.unfreeze();
    }
  });

  // Show/hide the native <dialog> when dialogOpen changes
  $effect(() => {
    if (!dialogRef) return;
    if (dialogOpen && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!dialogOpen && dialogRef.open) {
      dialogRef.close();
    }
  });

  // Close on click outside popover
  function handleWindowClick(e) {
    // Don't interfere when dialog is open — dialog handles its own clicks
    if (dialogOpen) return;
    if (!open) return;
    if (badgeEl?.contains(e.target)) return;
    if (panelEl?.contains(e.target)) return;
    close();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && open) {
      close();
    }
    // Dialog Escape is handled natively by <dialog>
  }

  // Handle click on dialog backdrop (outside the panel content)
  function handleDialogClick(e) {
    if (e.target === dialogRef) {
      closeDialog();
    }
  }

  // Handle native <dialog> cancel event (Escape key)
  function handleDialogCancel(e) {
    e.preventDefault();
    closeDialog();
  }

  // Fetch LSP status when tab is selected
  $effect(() => {
    if (activeTab === 'lsp' && open) {
      lspGetStatus().then(result => {
        if (result?.data?.servers) {
          lspServers = result.data.servers;
        }
      }).catch(() => {});
    }
  });

  // Listen for LSP server status updates
  $effect(() => {
    let unlisten;
    (async () => {
      unlisten = await listen('lsp-server-status', (event) => {
        if (event.payload?.servers) {
          lspServers = event.payload.servers;
        }
      });
    })();
    return () => { unlisten?.(); };
  });
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
    <div bind:this={panelEl} class="status-popover" role="dialog" aria-label="Status panel">
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
            <div class="status-list">
              <button class="status-row" type="button">
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
              </button>

              <button class="status-row" type="button">
                <div class="row-dot ok"></div>
                <span class="row-name">Dev Server</span>
                <span class="row-version">Vite</span>
                <svg class="row-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>

            <button class="manage-btn" type="button" onclick={openDialog}>Manage servers</button>

          {:else if activeTab === 'mcp'}
            <div class="status-list">
              {#if aiStatusStore.isCliProvider}
                <button class="status-row" type="button">
                  <div
                    class="row-dot"
                    class:ok={mcpConnected}
                    class:stopped={!mcpConnected && !aiStatusStore.starting}
                    class:starting={aiStatusStore.starting}
                  ></div>
                  <span class="row-name">voice-mirror</span>
                  <span class="row-version">55 tools</span>
                  <div class="row-toggle" class:on={mcpConnected}>
                    <div class="toggle-track">
                      <div class="toggle-thumb"></div>
                    </div>
                  </div>
                </button>
              {:else}
                <div class="status-empty">No MCP tools configured</div>
              {/if}
            </div>

          {:else if activeTab === 'lsp'}
            <div class="status-list">
              {#if lspServers.length > 0}
                {#each lspServers as server}
                  <div class="dialog-row lsp-server-row">
                    <span class="lsp-dot" class:running={server.running} class:error={server.error}></span>
                    <div class="lsp-server-info">
                      <span class="lsp-server-name">{server.binary}</span>
                      <span class="lsp-server-lang">{server.languageId}</span>
                    </div>
                    <span class="lsp-server-status">
                      {#if server.running}
                        {server.openDocsCount} file{server.openDocsCount !== 1 ? 's' : ''}
                      {:else if server.error}
                        Error
                      {:else}
                        Not found
                      {/if}
                    </span>
                  </div>
                {/each}
              {:else}
                <div class="status-empty">No LSP servers active</div>
              {/if}
              <div class="lsp-hint">Auto-detected from open file types</div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- ── Manage Servers Dialog (native <dialog> — renders in top layer) ── -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogRef}
  class="server-dialog"
  aria-label="Manage servers"
  onclick={handleDialogClick}
  oncancel={handleDialogCancel}
>
  <div class="dialog-inner" onclick={(e) => e.stopPropagation()}>
    <div class="dialog-header">
      <h2 class="dialog-title">Servers</h2>
      <button class="dialog-close" type="button" onclick={closeDialog} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="dialog-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Search servers" bind:value={searchQuery} />
    </div>

    <div class="dialog-list">
      <button class="dialog-row" type="button">
        <div class="row-dot" class:ok={healthy} class:stopped={!healthy && !aiStatusStore.starting} class:starting={aiStatusStore.starting}></div>
        <span class="dialog-row-name">{providerName}</span>
        <span class="dialog-row-version">{providerType}</span>
        {#if healthy}
          <span class="dialog-row-badge">Current Server</span>
        {/if}
      </button>
      <div class="dialog-row" role="button" tabindex="0">
        <div class="row-dot ok"></div>
        <span class="dialog-row-name">Dev Server (Vite)</span>
        <span class="dialog-row-version">localhost:1420</span>
        <button class="dialog-row-menu" type="button" aria-label="Server options" onclick={(e) => e.stopPropagation()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
      </div>
    </div>

    <button class="dialog-add" type="button">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add server
    </button>
  </div>
</dialog>

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
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 320px;
    max-width: calc(100vw - 40px);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--border);
    overflow: hidden;
    z-index: 10002;
    -webkit-app-region: no-drag;
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

  /* ── Status rows ── */

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
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .status-row:hover {
    background: var(--bg-elevated);
  }

  .row-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .row-dot.ok { background: var(--ok); }
  .row-dot.starting { background: var(--warn); animation: dot-pulse 1.2s ease-in-out infinite; }
  .row-dot.stopped { background: var(--danger); }

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

  /* ── Manage servers button ── */

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

  /* ── Toggle switch ── */

  .row-toggle {
    flex-shrink: 0;
    margin-left: auto;
  }

  .toggle-track {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    background: var(--border-strong);
    position: relative;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .row-toggle.on .toggle-track {
    background: var(--ok);
  }

  .toggle-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .row-toggle.on .toggle-thumb {
    transform: translateX(14px);
  }

  /* ── Empty state ── */

  .status-empty {
    font-size: 14px;
    color: var(--muted);
    text-align: center;
    padding: 12px 0;
  }

  /* ── Native <dialog> (Manage Servers) ── */

  .server-dialog {
    border: none;
    border-radius: 12px;
    padding: 0;
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    background: var(--bg-elevated);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    color: inherit;
    -webkit-app-region: no-drag;
  }

  .server-dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
  }

  .dialog-inner {
    display: flex;
    flex-direction: column;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
  }

  .dialog-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
    margin: 0;
  }

  .dialog-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .dialog-close:hover {
    background: var(--bg);
    color: var(--text);
  }

  .dialog-search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 20px 12px;
    padding: 8px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted);
  }
  .dialog-search input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 14px;
    outline: none;
    font-family: inherit;
  }
  .dialog-search input::placeholder {
    color: var(--muted);
  }

  .dialog-list {
    margin: 0 20px;
    background: var(--bg);
    border-radius: 8px;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .dialog-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .dialog-row:last-child {
    border-bottom: none;
  }
  .dialog-row:hover {
    background: var(--bg-elevated);
  }

  .dialog-row-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dialog-row-version {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }

  .dialog-row-badge {
    font-size: 11px;
    color: var(--text);
    background: var(--bg-elevated);
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: auto;
    white-space: nowrap;
  }

  .dialog-row-menu {
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
    margin-left: auto;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .dialog-row-menu:hover {
    background: var(--bg);
    color: var(--text);
  }

  .dialog-add {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 20px 16px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-app-region: no-drag;
  }
  .dialog-add:hover {
    background: var(--bg);
  }

  /* ── LSP tab ── */

  .lsp-server-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
  }

  .lsp-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
  }

  .lsp-dot.running {
    background: var(--ok, #22c55e);
  }

  .lsp-dot.error {
    background: var(--danger, #ef4444);
  }

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

  .lsp-server-status {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }

  .lsp-hint {
    padding: 8px 12px 4px;
    font-size: 10px;
    color: var(--muted);
    opacity: 0.7;
  }
</style>
