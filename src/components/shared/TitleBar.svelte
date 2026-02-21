<script>
  import { overlayStore } from '../../lib/stores/overlay.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';

  let appMode = $derived(navigationStore.appMode);

  function handleModeSwitch(mode) {
    navigationStore.setMode(mode);
  }

  /** @type {{ centerContent?: import('svelte').Snippet }} */
  let { centerContent } = $props();

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
    <div class="mode-toggle" role="radiogroup" aria-label="App mode">
      <button
        class="mode-btn"
        class:active={appMode === 'mirror'}
        onclick={() => handleModeSwitch('mirror')}
        role="radio"
        aria-checked={appMode === 'mirror'}
        aria-label="Mirror mode"
      >Mirror</button>
      <button
        class="mode-btn"
        class:active={appMode === 'lens'}
        onclick={() => handleModeSwitch('lens')}
        role="radio"
        aria-checked={appMode === 'lens'}
        aria-label="Lens mode"
      >Lens</button>
    </div>
  </div>

  {#if centerContent}
    <div class="titlebar-center">
      {@render centerContent()}
    </div>
  {/if}

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
    <!-- Native window controls injected by tauri-plugin-decorum on Windows -->
    <div class="native-controls-spacer"></div>
    <div data-tauri-decorum-tb class="decorum-controls"></div>
  </div>
</header>

<style>
  /* ========== Title Bar ========== */
  .titlebar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    min-height: 40px;
    padding: 0 0 0 12px;
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

  .mode-toggle {
    display: flex;
    align-items: center;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 9999px;
    padding: 2px;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    z-index: 10001;
  }

  .mode-btn {
    padding: 3px 12px;
    border: none;
    border-radius: 9999px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    white-space: nowrap;
    line-height: 1;
  }

  .mode-btn:hover:not(.active) {
    color: var(--text);
  }

  .mode-btn.active {
    background: var(--accent-subtle);
    color: var(--accent);
    font-weight: 600;
  }

  .titlebar-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    pointer-events: auto;
    -webkit-app-region: no-drag;
  }

  /* ========== Window Control Buttons ========== */
  .window-controls {
    display: flex;
    align-items: center;
    gap: 2px;
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
    -webkit-app-region: no-drag;
    z-index: 10001;
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

  /* Spacer before native controls */
  .native-controls-spacer {
    width: 4px;
  }

  /* Container for decorum-injected native buttons */
  .decorum-controls {
    display: flex;
    flex-direction: row;
    -webkit-app-region: no-drag;
  }

  /* Style the native decorum buttons to match our titlebar height */
  :global(button.decorum-tb-btn),
  :global(button#decorum-tb-minimize),
  :global(button#decorum-tb-maximize),
  :global(button#decorum-tb-close),
  :global(div[data-tauri-decorum-tb]) {
    height: 40px !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .win-btn {
      transition: none;
    }
    .mode-btn {
      transition: none;
    }
  }
</style>
