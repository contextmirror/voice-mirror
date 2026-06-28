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
  const windows = $derived(sandboxPreviewStore.windows);
  const currentHwnd = $derived(sandboxPreviewStore.currentHwnd);
  const noWindow = $derived(sandboxPreviewStore.noWindow);

  // The MJPEG stream serves immediately but is empty until the app window exists
  // (a `tauri dev` app compiles Rust first, so its window can appear minutes
  // later). Track the first painted frame so we can show a clear waiting state.
  let hasFrame = $state(false);
  // Reset the frame flag whenever the stream URL changes (new session).
  $effect(() => {
    url;
    hasFrame = false;
  });

  // Frame-timeout safety net: if a stream URL is set but no frame paints within
  // ~5s, treat it as "no window" so the user gets a clear empty state + an
  // "Open app" button instead of an infinite spinner. (Covers the case where the
  // backend re-targets to a non-presentable window that never produces frames.)
  const FRAME_TIMEOUT_MS = 5000;
  let stalled = $state(false);
  $effect(() => {
    // Re-arm whenever the stream URL changes or a frame arrives.
    stalled = false;
    if (!url || hasFrame) return;
    const t = setTimeout(() => {
      if (!hasFrame) stalled = true;
    }, FRAME_TIMEOUT_MS);
    return () => clearTimeout(t);
  });

  // Show the clear empty state (not the spinner) once the store knows there's no
  // mirrorable window, or the first-load wait has timed out.
  const showEmpty = $derived(noWindow || stalled);
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
    {#if windows.length > 1}
      <!-- Window switcher: pick which app window to mirror (auto-follows new ones). -->
      <select
        class="window-switcher"
        value={currentHwnd}
        onchange={(e) => sandboxPreviewStore.switchTo(e.currentTarget.value)}
        title="Switch which app window is shown"
        aria-label="App window"
      >
        {#each windows as w (w.hwnd)}
          <option value={w.hwnd}>{w.title}</option>
        {/each}
      </select>
    {/if}
    <button
      class="header-btn open-app-btn"
      onclick={() => sandboxPreviewStore.openApp()}
      title="Open / relaunch the app (re-runs the project's dev server)"
      aria-label="Open or relaunch the app"
    >
      <!-- Launch / play-in-window glyph -->
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M10 9l4 3-4 3z" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button
      class="header-btn maximize-btn"
      onclick={() => sandboxPreviewStore.toggleMaximize()}
      title={sandboxPreviewStore.maximized
        ? 'Restore to side panel (dock beside the editor)'
        : 'Maximize (fill the preview area)'}
      aria-label={sandboxPreviewStore.maximized ? 'Restore live preview to side panel' : 'Maximize live preview'}
    >
      {#if sandboxPreviewStore.maximized}
        <!-- Restore-to-columns glyph: editor pane + side panel -->
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      {:else}
        <!-- Maximize / expand glyph -->
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" />
        </svg>
      {/if}
    </button>
    <button
      class="header-btn close-btn"
      onclick={() => sandboxPreviewStore.hide()}
      title="Hide live preview (keeps it running — re-open from the App button)"
      aria-label="Hide live preview"
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
    {:else if showEmpty && !hasFrame}
      <!-- The app window closed (or never appeared) and nothing is mirrorable.
           Show a clear, actionable empty state instead of an endless spinner. -->
      <div class="sandbox-msg empty">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="14" x2="16" y2="14" />
        </svg>
        <span>{noWindow ? 'The app window was closed.' : 'No app window is open.'}</span>
        <small>Relaunch the app, or pick a window below if one is still open.</small>
        <button class="open-app-cta" onclick={() => sandboxPreviewStore.openApp()}>
          Open app
        </button>
        {#if windows.length > 0}
          <select
            class="window-switcher empty-switcher"
            value={currentHwnd}
            onchange={(e) => sandboxPreviewStore.switchTo(e.currentTarget.value)}
            title="Switch which app window is shown"
            aria-label="App window"
          >
            {#each windows as w (w.hwnd)}
              <option value={w.hwnd}>{w.title}</option>
            {/each}
          </select>
        {/if}
      </div>
    {:else}
      {#if !hasFrame}
        <div class="sandbox-msg waiting">
          <span class="spinner" aria-hidden="true"></span>
          Waiting for the app window…
          <small>The app builds &amp; launches before it appears here.</small>
        </div>
      {/if}
      <!-- MJPEG stream of the real app window; onload fires on the first frame. -->
      <img
        class="sandbox-frame"
        class:visible={hasFrame}
        src={url}
        alt="Live preview of the app being built"
        onload={() => { hasFrame = true; }}
      />
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
    justify-content: flex-start;
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
    flex: 1;
    min-width: 0;
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

  .window-switcher {
    margin-left: auto;
    max-width: 160px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-mono);
    outline: none;
    cursor: pointer;
    padding: 0 4px;
  }
  .window-switcher:focus {
    border-color: var(--accent);
  }

  .header-btn {
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

  .header-btn:hover {
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
    /* Hidden until the first frame paints, so no broken-image icon shows. */
    display: none;
  }

  .sandbox-frame.visible {
    display: block;
  }

  .sandbox-msg {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
    padding: 16px;
    text-align: center;
  }

  .sandbox-msg small {
    color: var(--muted);
    opacity: 0.7;
    font-size: 11px;
  }

  .sandbox-msg.error {
    color: var(--danger);
  }

  .sandbox-msg.empty {
    color: var(--text);
  }

  .open-app-cta {
    margin-top: 4px;
    padding: 6px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-fg, #fff);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .open-app-cta:hover {
    filter: brightness(1.08);
  }

  .empty-switcher {
    margin: 0;
    max-width: 220px;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid color-mix(in srgb, var(--muted) 40%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: sandbox-spin 0.8s linear infinite;
  }

  @keyframes sandbox-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-dot { animation: none; }
    .spinner { animation: none; }
  }
</style>
