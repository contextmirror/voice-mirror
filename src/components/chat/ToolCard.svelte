<script>
  /**
   * ToolCard -- Inline tool activity card displayed inside chat bubbles.
   *
   * Shows tool name, status badge, and optional arguments.
   * Status: 'running' (pulse), 'success' (green check), 'failed' (red x).
   */
  import { fly } from 'svelte/transition';

  let { tool } = $props();

  const statusLabel = $derived(
    tool.status === 'running' ? 'Running'
      : tool.status === 'success' ? 'Done'
        : tool.status === 'failed' ? 'Failed'
          : tool.status
  );

  const statusIcon = $derived(
    tool.status === 'running' ? '\u26A1'
      : tool.status === 'success' ? '\u2714'
        : tool.status === 'failed' ? '\u2718'
          : '\u26A1'
  );

  /** Format tool name: memory_search -> Searching memory */
  const displayName = $derived(tool.displayName || tool.name || 'Tool');

  /** Compact display of args (first arg value, truncated) */
  const argsPreview = $derived.by(() => {
    if (!tool.args || typeof tool.args !== 'object') return '';
    const entries = Object.entries(tool.args);
    if (entries.length === 0) return '';
    const [key, val] = entries[0];
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    const truncated = str.length > 60 ? str.slice(0, 57) + '...' : str;
    return `${key}: ${truncated}`;
  });
</script>

<div
  class="tool-card"
  class:running={tool.status === 'running'}
  class:success={tool.status === 'success'}
  class:failed={tool.status === 'failed'}
  transition:fly={{ y: 8, duration: 150 }}
>
  <div class="tool-card-header">
    <span class="tool-icon">{statusIcon}</span>
    <span class="tool-name">{displayName}</span>
    <span class="tool-status" class:running={tool.status === 'running'} class:success={tool.status === 'success'} class:failed={tool.status === 'failed'}>
      {statusLabel}
    </span>
  </div>

  {#if argsPreview}
    <div class="tool-card-args">{argsPreview}</div>
  {/if}
</div>

<style>
  .tool-card {
    margin: 8px 0;
    border-radius: var(--radius-sm);
    font-size: 12px;
    overflow: hidden;
    background: var(--card);
    border: 1px solid var(--border);
  }

  .tool-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--card-highlight);
    border-bottom: 1px solid var(--border);
  }

  .tool-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    opacity: 0.8;
  }

  .tool-name {
    font-weight: 500;
    color: var(--text);
    font-size: 12px;
    flex: 1;
  }

  .tool-status {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .tool-status.running {
    background: var(--accent-subtle);
    color: var(--accent-hover);
    animation: pulse-subtle 2s ease-in-out infinite;
  }

  .tool-status.success {
    background: var(--ok-subtle);
    color: var(--ok);
  }

  .tool-status.failed {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  .tool-card-args {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    background: var(--bg);
    overflow-x: auto;
    white-space: nowrap;
  }

  @keyframes pulse-subtle {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  @media (prefers-reduced-motion: reduce) {
    .tool-status.running {
      animation: none;
    }
  }
</style>
