<script>
  import { onMount } from 'svelte';
  import { listWindows, startWindowStream } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';

  let { onClose, onStreamStarted } = $props();

  let windows = $state([]);
  let loading = $state(true);
  let selectedHwnd = $state(null);
  let fps = $state(30);
  let starting = $state(false);
  let error = $state('');

  onMount(() => {
    lensStore.freeze();
    loadWindows();
    return () => lensStore.unfreeze();
  });

  async function loadWindows() {
    loading = true;
    try {
      const result = await listWindows();
      const data = unwrapResult(result);
      windows = data || [];
    } catch (err) {
      console.error('[window-picker] Failed to list windows:', err);
      windows = [];
    } finally {
      loading = false;
    }
  }

  async function handleStream() {
    if (!selectedHwnd) return;
    starting = true;
    error = '';
    try {
      const result = await startWindowStream(selectedHwnd, fps);
      const data = unwrapResult(result);
      if (data?.url) {
        // Copy URL to clipboard
        try { await navigator.clipboard.writeText(data.url); } catch {}
        onStreamStarted?.(data);
        onClose();
      } else if (result?.error) {
        error = result.error;
      }
    } catch (err) {
      error = String(err);
    } finally {
      starting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="picker-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Stream Window">
    <h3 class="modal-title">Stream Window</h3>

    <div class="fps-row">
      <label class="fps-label">FPS:</label>
      <select class="fps-select" bind:value={fps}>
        <option value={5}>5</option>
        <option value={15}>15</option>
        <option value={30}>30</option>
      </select>
    </div>

    {#if loading}
      <div class="picker-loading">Scanning windows...</div>
    {:else if windows.length === 0}
      <div class="picker-empty">No windows found.</div>
    {:else}
      <div class="window-list">
        {#each windows as win}
          <button
            class="window-item"
            class:selected={selectedHwnd === win.hwnd}
            onclick={() => { selectedHwnd = win.hwnd; }}
          >
            {#if win.thumbnail}
              <img class="window-thumb" src="data:image/png;base64,{win.thumbnail}" alt="" />
            {:else}
              <div class="window-thumb-placeholder"></div>
            {/if}
            <div class="window-info">
              <span class="window-title">{win.title}</span>
              <span class="window-meta">{win.processName} — {win.width}×{win.height}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    {#if error}
      <div class="picker-error">{error}</div>
    {/if}

    <div class="modal-actions">
      <button class="btn-cancel" onclick={onClose}>Cancel</button>
      <button class="btn-stream" onclick={handleStream} disabled={!selectedHwnd || starting}>
        {starting ? 'Starting...' : 'Stream'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .picker-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }

  .modal-title {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .fps-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .fps-label {
    font-size: 12px;
    color: var(--muted);
  }

  .fps-select {
    padding: 4px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .picker-loading, .picker-empty {
    font-size: 13px;
    color: var(--muted);
    padding: 20px 0;
    text-align: center;
  }

  .window-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 400px;
  }

  .window-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    background: var(--bg);
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-family);
    color: var(--text);
  }

  .window-item:hover { background: var(--bg-hover); }
  .window-item.selected { border-color: var(--accent); background: var(--card-highlight); }

  .window-thumb {
    width: 80px;
    height: 50px;
    object-fit: cover;
    border-radius: 4px;
    background: #000;
    flex-shrink: 0;
  }

  .window-thumb-placeholder {
    width: 80px;
    height: 50px;
    border-radius: 4px;
    background: var(--bg-hover);
    flex-shrink: 0;
  }

  .window-info {
    flex: 1;
    min-width: 0;
  }

  .window-title {
    display: block;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window-meta {
    display: block;
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
  }

  .picker-error {
    font-size: 12px;
    color: var(--danger, #ef4444);
    margin-top: 8px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .btn-cancel, .btn-stream {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-cancel:hover { background: var(--bg-hover); }

  .btn-stream {
    background: var(--accent);
    color: #fff;
  }

  .btn-stream:hover { filter: brightness(1.1); }
  .btn-stream:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
