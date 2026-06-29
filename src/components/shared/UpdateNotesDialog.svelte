<script>
  /**
   * UpdateNotesDialog.svelte -- Release-notes modal for an available/ready update.
   *
   * Opened by the `show-update-notes` window event (fired from the status bar,
   * settings, or the sticky "restart to apply" toast). Mirrors the AboutDialog /
   * GettingStarted modal pattern. Reads the current update from the updater store.
   */
  import { updaterStore } from '../../lib/stores/updater.svelte.js';

  let visible = $state(false);

  // Snapshot from the store (kept reactive so it updates if the store changes
  // while the dialog is open).
  let version = $derived(updaterStore.version);
  let notes = $derived(updaterStore.notes);
  let isReady = $derived(updaterStore.isReady);

  function close() {
    visible = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function downloadNow() {
    updaterStore.downloadAndInstall();
    close();
  }

  function restartNow() {
    updaterStore.restartToApply();
  }

  $effect(() => {
    const show = () => { visible = true; };
    window.addEventListener('show-update-notes', show);
    return () => window.removeEventListener('show-update-notes', show);
  });
</script>

<svelte:window onkeydown={visible ? handleKeydown : null} />

{#if visible}
  <div class="modal-overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-label="Voice Mirror Update">
      <h3 class="app-name">Voice Mirror update</h3>
      <div class="version">Version {version || 'unknown'}</div>

      <div class="notes" role="document">
        {#if notes}
          <pre class="notes-body">{notes}</pre>
        {:else}
          <p class="notes-empty">No release notes were provided for this version.</p>
        {/if}
      </div>

      <div class="modal-actions">
        {#if isReady}
          <button class="btn-primary" onclick={restartNow}>Restart now</button>
        {:else}
          <button class="btn-primary" onclick={downloadNow}>Download &amp; install</button>
        {/if}
        <button class="btn-close" onclick={close}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: overlay-in 0.12s ease-out;
  }

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    padding: 24px;
    width: 420px;
    max-width: 90vw;
    text-align: center;
    animation: modal-in 0.14s ease-out;
  }

  .app-name {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
  }

  .version {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 14px;
  }

  .notes {
    text-align: left;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px;
    margin-bottom: 18px;
  }

  .notes-body {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .notes-empty {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }

  .modal-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
  }

  .btn-primary {
    padding: 6px 20px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-fg, #fff);
  }

  .btn-primary:hover {
    filter: brightness(1.08);
  }

  .btn-close {
    padding: 6px 20px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .btn-close:hover {
    background: var(--bg-hover);
  }

  @keyframes overlay-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modal-in {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-overlay, .modal { animation: none; }
  }
</style>
