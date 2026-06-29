<script>
  import { DEFAULT_GLOBAL_SHORTCUTS, IN_APP_SHORTCUTS } from '../../lib/stores/shortcuts.svelte.js';

  let visible = $state(false);

  // Build display groups from the shortcut definitions.
  // Each entry is { keys, label, category }.
  const globalShortcuts = Object.values(DEFAULT_GLOBAL_SHORTCUTS);
  const inAppShortcuts = Object.values(IN_APP_SHORTCUTS);

  function close() {
    visible = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  // Split a key combo like "Ctrl+Shift+;" or "Ctrl+K Ctrl+Left" into kbd tokens.
  function tokens(keys) {
    return keys.split(/\s+/).map((chord) => chord.split('+'));
  }

  $effect(() => {
    const show = () => { visible = true; };
    window.addEventListener('show-keyboard-shortcuts', show);
    return () => window.removeEventListener('show-keyboard-shortcuts', show);
  });
</script>

<svelte:window onkeydown={visible ? handleKeydown : null} />

{#if visible}
  <div class="modal-overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-label="Keyboard shortcuts">
      <h3 class="modal-title">Keyboard Shortcuts</h3>

      <div class="shortcut-scroll">
        <section>
          <h4 class="group-title">Global</h4>
          {#each globalShortcuts as s}
            <div class="shortcut-row">
              <span class="shortcut-label">{s.label}</span>
              <span class="shortcut-keys">
                {#each tokens(s.keys) as chord, ci}
                  {#if ci > 0}<span class="combo-sep">then</span>{/if}
                  {#each chord as key, ki}
                    {#if ki > 0}<span class="plus">+</span>{/if}
                    <kbd>{key}</kbd>
                  {/each}
                {/each}
              </span>
            </div>
          {/each}
        </section>

        <section>
          <h4 class="group-title">In-App</h4>
          {#each inAppShortcuts as s}
            <div class="shortcut-row">
              <span class="shortcut-label">{s.label}</span>
              <span class="shortcut-keys">
                {#each tokens(s.keys) as chord, ci}
                  {#if ci > 0}<span class="combo-sep">then</span>{/if}
                  {#each chord as key, ki}
                    {#if ki > 0}<span class="plus">+</span>{/if}
                    <kbd>{key}</kbd>
                  {/each}
                {/each}
              </span>
            </div>
          {/each}
        </section>
      </div>

      <div class="modal-actions">
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
    padding: 20px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    animation: modal-in 0.14s ease-out;
  }

  .modal-title {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .shortcut-scroll {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .group-title {
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  section + section {
    margin-top: 16px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
  }

  .shortcut-row:last-child {
    border-bottom: none;
  }

  .shortcut-label {
    font-size: 13px;
    color: var(--text);
  }

  .shortcut-keys {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  kbd {
    display: inline-block;
    padding: 1px 6px;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .plus {
    font-size: 11px;
    color: var(--muted);
  }

  .combo-sep {
    font-size: 10px;
    color: var(--muted);
    margin: 0 4px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }

  .btn-close {
    padding: 6px 16px;
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
