<script>
  import { discoverMcpServers } from '../../lib/api.js';
  import { mcpTestConnection, mcpDeleteServer } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import McpServerModal from './McpServerModal.svelte';

  let servers = $state([]);
  let loading = $state(true);
  let showModal = $state(false);
  let modalMode = $state('add');
  let modalServer = $state(null);
  let confirmDelete = $state(null); // { name, scope }
  let testingServer = $state(null); // server name being tested
  let testResult = $state(null);

  // Overflow menu state
  let openMenu = $state(null); // server name

  async function loadServers() {
    loading = true;
    try {
      const project = projectStore.activeProject;
      const path = project?.path || '';
      // Skip discovery if no valid workspace path (will error on empty string)
      if (!path) {
        // Still discover global servers by reading ~/.claude/settings.json
        // The Rust command needs a valid path — use the app's own directory as fallback
        const result = await discoverMcpServers('.', null);
        const all = unwrapResult(result) || [];
        servers = all.filter(s => !s.isOwn);
      } else {
        const prefs = project?.mcpServers || null;
        const result = await discoverMcpServers(path, prefs);
        const all = unwrapResult(result) || [];
        servers = all.filter(s => !s.isOwn);
      }
    } catch (err) {
      console.error('[mcp-settings] Discovery failed:', err);
      servers = [];
    } finally {
      loading = false;
    }
  }

  // Load on mount and re-load when active project changes
  $effect(() => {
    // Track reactive dependency on activeProject
    const _project = projectStore.activeProject;
    loadServers();
  });

  function openAdd() {
    modalMode = 'add';
    modalServer = null;
    showModal = true;
  }

  function openEdit(server) {
    modalMode = 'edit';
    // Attach project path for scope resolution in modal
    modalServer = { ...server, _projectPath: server.source === 'project' ? (projectStore.activeProject?.path || '') : 'global' };
    showModal = true;
    openMenu = null;
  }

  async function handleTest(server) {
    openMenu = null;
    testingServer = server.name;
    testResult = null;
    try {
      const cmd = server.config?.command || '';
      const args = server.config?.args || [];
      const env = server.config?.env || null;
      const result = await mcpTestConnection(cmd, args, env);
      const data = unwrapResult(result);
      testResult = { name: server.name, ...data };
    } catch (err) {
      testResult = { name: server.name, success: false, error: String(err) };
    } finally {
      testingServer = null;
    }
  }

  function promptDelete(server) {
    openMenu = null;
    const scope = server.source === 'project' ? (projectStore.activeProject?.path || '') : 'global';
    confirmDelete = { name: server.name, scope, label: server.source === 'global' ? 'global config' : `project config` };
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await mcpDeleteServer(confirmDelete.name, confirmDelete.scope);
      await loadServers();
    } catch (err) {
      console.error('[mcp-settings] Delete failed:', err);
    }
    confirmDelete = null;
  }

  function toggleMenu(name) {
    openMenu = openMenu === name ? null : name;
  }

  function truncate(str, len = 40) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  function commandPreview(server) {
    const cmd = server.config?.command || '';
    const args = (server.config?.args || []).join(' ');
    return truncate(`${cmd} ${args}`.trim());
  }
</script>

<div class="settings-section">
  <div class="mcp-header">
    <h3>MCP Servers</h3>
    <button class="mcp-add-btn" onclick={openAdd}>+ Add Server</button>
  </div>

  {#if loading}
    <div class="mcp-loading">Discovering servers...</div>
  {:else if servers.length === 0}
    <div class="mcp-empty">No MCP servers configured. Click + Add Server to get started.</div>
  {:else}
    <div class="mcp-list">
      {#each servers as server}
        <div class="mcp-card">
          <div class="mcp-card-info">
            <span class="mcp-card-name">{server.name}</span>
            <span class="mcp-card-cmd">{commandPreview(server)}</span>
          </div>
          <span class="mcp-card-scope">{server.source}</span>
          {#if testingServer === server.name}
            <span class="mcp-card-testing">Testing...</span>
          {/if}
          <div class="mcp-card-menu-wrap">
            <button class="mcp-card-menu-btn" onclick={(e) => { e.stopPropagation(); toggleMenu(server.name); }} title="Actions">&#x22EE;</button>
            {#if openMenu === server.name}
              <div class="mcp-card-dropdown">
                <button onclick={() => openEdit(server)}>Edit</button>
                <button onclick={() => handleTest(server)}>Test Connection</button>
                <button class="danger" onclick={() => promptDelete(server)}>Delete</button>
              </div>
            {/if}
          </div>
        </div>
        {#if testResult?.name === server.name}
          <div class="mcp-test-inline" class:success={testResult.success} class:failure={!testResult.success}>
            {#if testResult.success}
              Connected{testResult.serverName ? ` to ${testResult.serverName}` : ''} — {testResult.toolCount ?? '?'} tools
            {:else}
              {testResult.error || 'Connection failed'}
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<!-- Delete confirmation -->
{#if confirmDelete}
  <div class="modal-overlay" onclick={() => confirmDelete = null} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <p>Delete <strong>{confirmDelete.name}</strong> from {confirmDelete.label}?</p>
      <div class="confirm-actions">
        <button class="btn-cancel" onclick={() => confirmDelete = null}>Cancel</button>
        <button class="btn-delete" onclick={handleDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add/Edit modal -->
{#if showModal}
  <McpServerModal
    mode={modalMode}
    server={modalServer}
    onClose={() => showModal = false}
    onSave={loadServers}
  />
{/if}

<!-- Click-outside handler for overflow menu -->
<svelte:window onclick={() => { openMenu = null; }} />

<style>
  .mcp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .mcp-header h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .mcp-add-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    padding: 4px 12px;
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
  }

  .mcp-add-btn:hover { filter: brightness(1.1); }

  .mcp-loading, .mcp-empty {
    font-size: 13px;
    color: var(--muted);
    padding: 16px 0;
  }

  .mcp-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mcp-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--card-highlight);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 10px 14px;
  }

  .mcp-card-info {
    flex: 1;
    min-width: 0;
  }

  .mcp-card-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    display: block;
  }

  .mcp-card-cmd {
    font-size: 11px;
    color: var(--muted);
    font-family: var(--font-mono, monospace);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mcp-card-scope {
    font-size: 10px;
    color: var(--muted);
    padding: 2px 6px;
    background: var(--bg);
    border-radius: 3px;
    white-space: nowrap;
  }

  .mcp-card-testing {
    font-size: 11px;
    color: var(--accent);
  }

  .mcp-card-menu-wrap {
    position: relative;
  }

  .mcp-card-menu-btn {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 18px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    line-height: 1;
  }

  .mcp-card-menu-btn:hover { background: var(--bg-hover); color: var(--text); }

  .mcp-card-dropdown {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 100;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 140px;
    padding: 4px 0;
  }

  .mcp-card-dropdown button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: none;
    border: none;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-family);
  }

  .mcp-card-dropdown button:hover { background: var(--bg-hover); }
  .mcp-card-dropdown button.danger { color: var(--danger, #ef4444); }
  .mcp-card-dropdown button.danger:hover { background: rgba(239, 68, 68, 0.1); }

  .mcp-test-inline {
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    margin-top: -5px;
    border: 1px solid var(--border);
    border-top: none;
  }

  .mcp-test-inline.success {
    color: var(--ok, #22c55e);
    background: rgba(34, 197, 94, 0.05);
  }

  .mcp-test-inline.failure {
    color: var(--danger, #ef4444);
    background: rgba(239, 68, 68, 0.05);
  }

  /* Confirmation dialog */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .confirm-dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 360px;
    max-width: 90vw;
  }

  .confirm-dialog p {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--text);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-cancel, .btn-delete {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    cursor: pointer;
    border: none;
    font-family: var(--font-family);
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-delete {
    background: var(--danger, #ef4444);
    color: #fff;
  }

  .btn-delete:hover { filter: brightness(1.1); }
</style>
