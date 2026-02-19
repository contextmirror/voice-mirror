<script>
  import { minimizeWindow, maximizeWindow, quitApp } from '../../lib/api.js';
  import { overlayStore } from '../../lib/stores/overlay.svelte.js';

  let maximized = $state(false);

  async function handleMinimize() {
    try {
      await minimizeWindow();
    } catch (err) {
      console.error('[TitleBar] Minimize failed:', err);
    }
  }

  async function handleMaximize() {
    try {
      const result = await maximizeWindow();
      if (result?.data?.maximized !== undefined) {
        maximized = result.data.maximized;
      } else {
        // Toggle local state as fallback
        maximized = !maximized;
      }
    } catch (err) {
      console.error('[TitleBar] Maximize failed:', err);
    }
  }

  async function handleClose() {
    try {
      await quitApp();
    } catch (err) {
      console.error('[TitleBar] Quit failed:', err);
    }
  }

  async function handleCompact() {
    try {
      await overlayStore.compact();
    } catch (err) {
      console.error('[TitleBar] Compact to orb failed:', err);
    }
  }
</script>

<header class="titlebar" data-tauri-drag-region>
  <div class="titlebar-left" data-tauri-drag-region>
    <svg class="titlebar-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 12a4 4 0 0 1 8 0"/>
      <circle cx="12" cy="12" r="1"/>
    </svg>
    <span class="titlebar-title" data-tauri-drag-region>Voice Mirror</span>
  </div>

  <div class="window-controls">
    <button
      class="win-btn win-compact"
      onclick={handleCompact}
      aria-label="Collapse to orb"
      title="Collapse to orb"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"/>
      </svg>
    </button>

    <button
      class="win-btn win-minimize"
      onclick={handleMinimize}
      aria-label="Minimize window"
      title="Minimize"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>

    <button
      class="win-btn win-maximize"
      onclick={handleMaximize}
      aria-label={maximized ? 'Restore window' : 'Maximize window'}
      title={maximized ? 'Restore' : 'Maximize'}
    >
      {#if maximized}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="7" y="3" width="14" height="14" rx="1"/>
          <path d="M3 7v12a2 2 0 0 0 2 2h12"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="5" y="5" width="14" height="14" rx="1"/>
        </svg>
      {/if}
    </button>

    <button
      class="win-btn win-close"
      onclick={handleClose}
      aria-label="Close window"
      title="Close"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>
</header>

<style>
  /* ========== Title Bar ========== */
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    min-height: 40px;
    padding: 0 12px;
    background: var(--chrome, var(--bg-elevated));
    border-bottom: 1px solid var(--border);
    user-select: none;
    /* data-tauri-drag-region handles the actual drag */
  }

  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: none; /* Allow drag-through to titlebar */
  }

  .titlebar-logo {
    width: 20px;
    height: 20px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .titlebar-title {
    color: var(--text-strong);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }

  /* ========== Window Control Buttons ========== */
  .window-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .win-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
    padding: 0;
  }

  .win-btn svg {
    width: 14px;
    height: 14px;
  }

  .win-btn:hover {
    background: var(--card-highlight);
    color: var(--text-strong);
  }

  .win-btn.win-compact:hover {
    background: var(--accent-subtle, rgba(99, 102, 241, 0.15));
    color: var(--accent);
  }

  .win-btn.win-minimize:hover {
    background: var(--warn-subtle);
    color: var(--warn);
  }

  .win-btn.win-maximize:hover {
    background: var(--ok-subtle);
    color: var(--ok);
  }

  .win-btn.win-close:hover {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  @media (prefers-reduced-motion: reduce) {
    .win-btn {
      transition: none;
    }
  }
</style>
