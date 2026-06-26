<script>
  /**
   * SandboxPreview.svelte -- live, true-size view of the app being built.
   *
   * Shows a CDP screencast (served as MJPEG by services/sandbox_stream.rs) of the
   * real running app window. You and the AI look at the same surface: the AI sees
   * it via the sandbox_* MCP tools, you see it here. The <img> points at the
   * MJPEG `/stream` endpoint; object-fit:contain keeps the app at its true aspect
   * (a small pill app shows centered, not stretched).
   */
  import { sandboxPreviewStore } from '../../lib/stores/sandbox-preview.svelte.js';

  const url = $derived(sandboxPreviewStore.streamUrl);
  const loading = $derived(sandboxPreviewStore.loading);
  const error = $derived(sandboxPreviewStore.error);
</script>

<div class="sandbox-preview">
  <div class="sandbox-header">
    <span class="sandbox-title">
      <span class="live-dot" aria-hidden="true"></span>
      Live app preview
      {#if sandboxPreviewStore.cdpPort}
        <span class="port">CDP :{sandboxPreviewStore.cdpPort}</span>
      {/if}
    </span>
    <button
      class="close-btn"
      onclick={() => sandboxPreviewStore.close()}
      title="Close live preview"
      aria-label="Close live preview"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
  <div class="sandbox-body">
    {#if error}
      <div class="sandbox-msg error">{error}</div>
    {:else if loading || !url}
      <div class="sandbox-msg">Starting live preview…</div>
    {:else}
      <img class="sandbox-frame" src={url} alt="Live preview of the app being built" />
    {/if}
  </div>
</div>

<style>
  .sandbox-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border);
  }

  .sandbox-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 30px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .sandbox-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok, #0072b2);
    flex-shrink: 0;
    animation: live-pulse 2s ease-in-out infinite;
  }

  @keyframes live-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .port {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sandbox-body {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    overflow: hidden;
  }

  .sandbox-frame {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }

  .sandbox-msg {
    color: var(--muted);
    font-size: 13px;
    padding: 16px;
    text-align: center;
  }

  .sandbox-msg.error {
    color: var(--danger);
  }

  @media (prefers-reduced-motion: reduce) {
    .live-dot { animation: none; }
  }
</style>
