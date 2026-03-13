<script>
  let { messages = [], onClose = () => {}, onClear = () => {} } = $props();

  let listEl;

  // Auto-scroll to bottom when new messages arrive
  $effect(() => {
    if (messages.length && listEl) {
      requestAnimationFrame(() => {
        listEl.scrollTop = listEl.scrollHeight;
      });
    }
  });

  function levelClass(level) {
    switch (level) {
      case 'ERROR': return 'error';
      case 'WARN': return 'warn';
      case 'DEBUG': return 'debug';
      default: return 'info';
    }
  }
</script>

<div class="console-panel" role="complementary">
  <div class="console-header">
    <span class="console-title">Console</span>
    <div class="console-actions">
      <button class="action-btn" onclick={onClear} title="Clear console" aria-label="Clear console">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </button>
      <button class="action-btn close-btn" onclick={onClose} aria-label="Close console">&times;</button>
    </div>
  </div>

  <div class="console-messages" bind:this={listEl}>
    {#each messages as msg}
      <div class="console-msg {levelClass(msg.level)}">
        <span class="msg-level">{msg.level}</span>
        <span class="msg-text">{msg.message}</span>
      </div>
    {/each}
    {#if messages.length === 0}
      <div class="console-empty">No console output</div>
    {/if}
  </div>
</div>

<style>
  .console-panel {
    width: 350px;
    min-width: 350px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-left: 1px solid var(--border);
    color: var(--text);
    font-size: 12px;
    overflow: hidden;
  }

  .console-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .console-title {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .console-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    color: var(--text);
  }

  .close-btn {
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }

  .console-messages {
    flex: 1;
    overflow-y: auto;
    font-family: monospace;
  }

  .console-msg {
    display: flex;
    gap: 8px;
    padding: 3px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    line-height: 1.5;
    align-items: flex-start;
  }

  .console-msg:hover {
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }

  .console-msg.error {
    background: color-mix(in srgb, var(--danger, #ef4444) 8%, transparent);
  }

  .console-msg.warn {
    background: color-mix(in srgb, var(--warning, #eab308) 8%, transparent);
  }

  .msg-level {
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
    min-width: 38px;
    padding: 1px 0;
  }

  .error .msg-level {
    color: var(--danger, #ef4444);
  }

  .warn .msg-level {
    color: var(--warning, #eab308);
  }

  .info .msg-level {
    color: var(--text-secondary);
  }

  .debug .msg-level {
    color: var(--muted);
  }

  .msg-text {
    font-size: 11px;
    color: var(--text);
    word-break: break-all;
    white-space: pre-wrap;
  }

  .console-empty {
    padding: 20px 10px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }
</style>
