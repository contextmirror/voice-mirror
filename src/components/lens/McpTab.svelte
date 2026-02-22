<script>
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';

  let mcpConnected = $derived(
    aiStatusStore.isCliProvider && aiStatusStore.running
  );
</script>

<div class="status-list">
  {#if aiStatusStore.isCliProvider}
    <div class="status-row">
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
    </div>
  {:else}
    <div class="status-empty">No MCP tools configured</div>
  {/if}
</div>

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

  .status-empty {
    font-size: 14px;
    color: var(--muted);
    text-align: center;
    padding: 12px 0;
  }

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
</style>
