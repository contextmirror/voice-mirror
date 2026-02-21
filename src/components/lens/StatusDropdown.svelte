<script>
  let open = $state(false);
  let activeTab = $state('servers');

  function toggle() { open = !open; }
  function close() { open = false; }
  function selectTab(tab) { activeTab = tab; }

  // Close on click outside
  function handleWindowClick(e) {
    if (open && !e.target.closest('.status-dropdown')) {
      close();
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="status-dropdown">
  <button class="status-badge" onclick={toggle} aria-expanded={open} aria-haspopup="true">
    <span class="status-dot"></span>
    <span>Status</span>
  </button>

  {#if open}
    <div class="status-panel" role="dialog" aria-label="Status panel">
      <div class="status-tabs">
        <button
          class="status-tab"
          class:active={activeTab === 'servers'}
          onclick={() => selectTab('servers')}
        >2 Servers</button>
        <button
          class="status-tab"
          class:active={activeTab === 'mcp'}
          onclick={() => selectTab('mcp')}
        >MCP</button>
        <button
          class="status-tab"
          class:active={activeTab === 'provider'}
          onclick={() => selectTab('provider')}
        >Provider</button>
      </div>

      <div class="status-content">
        {#if activeTab === 'servers'}
          <div class="status-list">
            <div class="status-entry">
              <span class="entry-dot ok"></span>
              <span class="entry-name">Dev Server</span>
              <span class="entry-version">Vite 6.x</span>
              <svg class="entry-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="entry-detail">localhost:1420</div>

            <div class="status-entry">
              <span class="entry-dot warn"></span>
              <span class="entry-name">App Server</span>
              <span class="entry-version"></span>
            </div>
            <div class="entry-detail inactive">No server detected</div>
          </div>

        {:else if activeTab === 'mcp'}
          <div class="status-list">
            <div class="status-entry">
              <span class="entry-dot ok"></span>
              <span class="entry-name">Voice Mirror MCP</span>
              <span class="entry-version">55 tools</span>
              <svg class="entry-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="entry-detail">8 tool groups active</div>
          </div>

        {:else if activeTab === 'provider'}
          <div class="status-list">
            <div class="status-entry">
              <span class="entry-dot ok"></span>
              <span class="entry-name">Claude Code</span>
              <span class="entry-version">CLI</span>
              <svg class="entry-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="entry-detail">Connected via PTY</div>
          </div>
        {/if}
      </div>

      <div class="status-footer">
        <button class="manage-btn">Manage servers</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .status-dropdown {
    position: relative;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: none;
    border-radius: 12px;
    background: var(--ok);
    color: var(--bg);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--duration-fast) var(--ease-out);
  }
  .status-badge:hover { opacity: 0.85; }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bg);
  }

  /* ── Panel ── */

  .status-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 300px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 10002;
    overflow: hidden;
  }

  /* ── Tabs ── */

  .status-tabs {
    display: flex;
    gap: 0;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .status-tab {
    padding: 8px 10px;
    font-size: 12px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .status-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .status-tab:hover:not(.active) { color: var(--text); }

  /* ── Content ── */

  .status-content {
    padding: 8px 0;
    max-height: 200px;
    overflow-y: auto;
  }

  .status-list {
    display: flex;
    flex-direction: column;
  }

  .status-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
  }

  .entry-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .entry-dot.ok { background: var(--ok); }
  .entry-dot.warn { background: var(--warn); }
  .entry-dot.danger { background: var(--danger); }

  .entry-name {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }

  .entry-version {
    font-size: 11px;
    color: var(--muted);
    margin-left: auto;
  }

  .entry-check {
    color: var(--ok);
    flex-shrink: 0;
  }

  .entry-detail {
    padding: 0 12px 6px 27px;
    font-size: 11px;
    color: var(--muted);
    font-family: var(--font-mono);
  }
  .entry-detail.inactive {
    font-style: italic;
    font-family: inherit;
  }

  /* ── Footer ── */

  .status-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
  }

  .manage-btn {
    width: 100%;
    padding: 6px 12px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }
  .manage-btn:hover {
    background: var(--bg);
  }
</style>
