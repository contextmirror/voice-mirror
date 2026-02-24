<script>
  import { overlayStore } from '../../lib/stores/overlay.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { open } from '@tauri-apps/plugin-dialog';
  import Orb from '../overlay/Orb.svelte';

  let appMode = $derived(navigationStore.appMode);

  function handleModeSwitch(mode) {
    navigationStore.setMode(mode);
  }

  /** @type {{ centerContent?: import('svelte').Snippet, rightContent?: import('svelte').Snippet }} */
  let { centerContent, rightContent } = $props();

  async function handleCompact() {
    try {
      await overlayStore.compact();
    } catch (err) {
      console.error('[TitleBar] Compact to orb failed:', err);
    }
  }

  // ---- App Menu ----
  let appMenuOpen = $state(false);

  function toggleAppMenu(e) {
    e.stopPropagation();
    appMenuOpen = !appMenuOpen;
  }

  function closeAppMenu() {
    appMenuOpen = false;
  }

  async function handleOpenProject() {
    closeAppMenu();
    const selected = await open({ directory: true });
    if (selected) {
      projectStore.addProject(selected);
      navigationStore.setMode('lens');
    }
  }

  async function handleOpenFile() {
    closeAppMenu();
    const selected = await open({
      multiple: false,
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Source', extensions: ['js', 'ts', 'svelte', 'rs', 'json', 'css', 'html', 'md', 'py'] },
      ]
    });
    if (selected) {
      // Opening a file switches to Lens mode and opens it in the editor
      navigationStore.setMode('lens');
      window.dispatchEvent(new CustomEvent('lens-open-file', { detail: { path: selected } }));
    }
  }

  function handleSettings() {
    closeAppMenu();
    navigationStore.setView('settings');
  }

  function handleAppMenuKeydown(e) {
    if (e.key === 'Escape') closeAppMenu();
  }
</script>

<svelte:document onclick={closeAppMenu} onkeydown={handleAppMenuKeydown} />

<header class="titlebar" data-tauri-drag-region>
  <div class="titlebar-left" data-tauri-drag-region>
    <div class="app-menu-anchor">
      <button
        class="app-menu-btn"
        class:open={appMenuOpen}
        onclick={toggleAppMenu}
        aria-label="App menu"
        aria-expanded={appMenuOpen}
        aria-haspopup="menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12a4 4 0 0 1 8 0"/>
          <circle cx="12" cy="12" r="1"/>
        </svg>
      </button>

      {#if appMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="app-menu-dropdown" role="menu" onclick={(e) => e.stopPropagation()}>
          <button class="app-menu-item" onclick={handleOpenFile} role="menuitem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            <span>Open File</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <button class="app-menu-item" onclick={handleOpenProject} role="menuitem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>Open Project</span>
          </button>
          <div class="app-menu-separator"></div>
          <button class="app-menu-item" onclick={handleSettings} role="menuitem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Settings</span>
            <kbd>Ctrl+,</kbd>
          </button>
        </div>
      {/if}
    </div>
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
    {#if rightContent}
      {@render rightContent()}
    {/if}
    <button
      class="win-btn win-compact"
      onclick={handleCompact}
      aria-label="Collapse to orb"
      title="Collapse to orb"
    >
      <Orb size={16} isStatic={true} />
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

  /* ========== App Menu Button ========== */
  .app-menu-anchor {
    position: relative;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    z-index: 10001;
  }

  .app-menu-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-md, 6px);
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
  }

  .app-menu-btn svg {
    width: 20px;
    height: 20px;
  }

  .app-menu-btn:hover,
  .app-menu-btn.open {
    background: var(--accent-subtle, rgba(99, 102, 241, 0.15));
  }

  /* ========== App Menu Dropdown ========== */
  .app-menu-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 220px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 6px);
    padding: 4px 0;
    box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.3));
    z-index: 10002;
    animation: app-menu-in 0.12s var(--ease-out);
  }

  @keyframes app-menu-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .app-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 14px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .app-menu-item:hover {
    background: var(--bg-hover);
  }

  .app-menu-item svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    color: var(--muted);
  }

  .app-menu-item:hover svg {
    color: var(--text);
  }

  .app-menu-item span {
    flex: 1;
  }

  .app-menu-item kbd {
    font-size: 11px;
    color: var(--muted);
    font-family: var(--font-mono);
    opacity: 0.6;
  }

  .app-menu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 8px;
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
    gap: 16px;
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

  /* Style the native decorum buttons to match our titlebar height and theme */
  :global(button.decorum-tb-btn),
  :global(button#decorum-tb-minimize),
  :global(button#decorum-tb-maximize),
  :global(button#decorum-tb-close),
  :global(div[data-tauri-decorum-tb]) {
    height: 40px !important;
  }

  :global(button.decorum-tb-btn) {
    color: var(--muted) !important;
    background: transparent !important;
    border: none !important;
    transition: color 0.15s, background 0.15s !important;
  }

  :global(button.decorum-tb-btn:hover) {
    color: var(--text-strong) !important;
    background: var(--bg-hover, rgba(255, 255, 255, 0.08)) !important;
  }

  :global(button#decorum-tb-close:hover) {
    color: #ffffff !important;
    background: var(--danger, #ef4444) !important;
  }

  /* Ensure decorum SVG icons inherit the button color */
  :global(button.decorum-tb-btn svg) {
    color: inherit !important;
    fill: currentColor !important;
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
