<script>
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';

  let { onManage = () => {} } = $props();

  let healthy = $derived(aiStatusStore.running);

  let providerName = $derived(aiStatusStore.displayName || 'No provider');
  let providerType = $derived(
    aiStatusStore.isCliProvider ? 'CLI / PTY'
    : aiStatusStore.isApiProvider ? 'HTTP API'
    : aiStatusStore.isDictationProvider ? 'Dictation'
    : ''
  );
</script>

<div class="status-list">
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

  <div class="status-row">
    <div class="row-dot ok"></div>
    <span class="row-name">Dev Server</span>
    <span class="row-version">Vite</span>
    <svg class="row-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
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
  .row-dot.stopped { background: var(--danger); }

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
