<script>
  import { lspGetStatus } from '../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';

  let { visible = false } = $props();

  let lspServers = $state([]);

  // Fetch LSP status when tab becomes visible
  $effect(() => {
    if (visible) {
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

<div class="status-list">
  {#if lspServers.length > 0}
    {#each lspServers as server}
      <div class="lsp-server-row">
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

<style>
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
