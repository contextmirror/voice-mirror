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
  let activeMenuId = $state(null);
  let submenuLeft = $state(0);

  /** Refs for menu bar buttons (for submenu positioning) */
  let menuBtnEls = $state({});

  function toggleAppMenu(e) {
    e.stopPropagation();
    appMenuOpen = !appMenuOpen;
    if (!appMenuOpen) activeMenuId = null;
  }

  function closeAppMenu() {
    appMenuOpen = false;
    activeMenuId = null;
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

  // ---- Menu Bar ----

  const menuBarItems = [
    { id: 'file', label: 'File' },
    { id: 'edit', label: 'Edit' },
    { id: 'selection', label: 'Selection' },
    { id: 'view', label: 'View' },
    { id: 'go', label: 'Go' },
    { id: 'run', label: 'Run' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'help', label: 'Help' },
  ];

  const menuDefinitions = {
    file: [
      { label: 'Open File', kbd: 'Ctrl+O', action: handleOpenFile },
      { label: 'Open Project', action: handleOpenProject },
      { separator: true },
      { label: 'Settings', kbd: 'Ctrl+,', action: handleSettings },
    ],
    edit: [
      { label: 'Undo', kbd: 'Ctrl+Z' },
      { label: 'Redo', kbd: 'Ctrl+Shift+Z' },
      { separator: true },
      { label: 'Cut', kbd: 'Ctrl+X' },
      { label: 'Copy', kbd: 'Ctrl+C' },
      { label: 'Paste', kbd: 'Ctrl+V' },
      { separator: true },
      { label: 'Find', kbd: 'Ctrl+F' },
    ],
    selection: [
      { label: 'Select All', kbd: 'Ctrl+A' },
      { label: 'Expand Selection' },
      { label: 'Shrink Selection' },
    ],
    view: [
      { label: 'Command Palette', kbd: 'Ctrl+P' },
      { separator: true },
      { label: 'Sidebar' },
      { label: 'Terminal' },
      { label: 'File Tree' },
    ],
    go: [
      { label: 'Go to File', kbd: 'Ctrl+P' },
      { label: 'Go to Symbol' },
      { label: 'Go to Line', kbd: 'Ctrl+G' },
    ],
    run: [
      { label: 'Start' },
      { label: 'Stop' },
      { label: 'Restart' },
    ],
    terminal: [
      { label: 'New Terminal' },
      { label: 'Split Terminal' },
      { separator: true },
      { label: 'Clear Terminal' },
    ],
    help: [
      { label: 'Documentation' },
      { label: 'Keyboard Shortcuts' },
      { separator: true },
      { label: 'About Voice Mirror' },
    ],
  };

  function toggleSubmenu(id) {
    if (activeMenuId === id) {
      activeMenuId = null;
    } else {
      activeMenuId = id;
      updateSubmenuPosition(id);
    }
  }

  function handleMenuHover(id) {
    if (activeMenuId) {
      activeMenuId = id;
      updateSubmenuPosition(id);
    }
  }

  function updateSubmenuPosition(id) {
    const el = menuBtnEls[id];
    if (el) {
      const rect = el.getBoundingClientRect();
      submenuLeft = rect.left;
    }
  }

  function handleSubmenuAction(item) {
    if (item.action) {
      item.action();
    }
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
    </div>

    {#if appMenuOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <nav class="menu-bar" onclick={(e) => e.stopPropagation()}>
        {#each menuBarItems as item}
          <button
            class="menu-bar-item"
            class:active={activeMenuId === item.id}
            bind:this={menuBtnEls[item.id]}
            onclick={() => toggleSubmenu(item.id)}
            onmouseenter={() => handleMenuHover(item.id)}
          >
            {item.label}
          </button>
        {/each}
      </nav>
    {/if}

    <div class="mode-toggle" class:menu-open={appMenuOpen} role="radiogroup" aria-label="App mode">
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

<!-- Submenu dropdown (positioned absolutely under active menu bar item) -->
{#if appMenuOpen && activeMenuId && menuDefinitions[activeMenuId]}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="submenu-dropdown" style="left: {submenuLeft}px;" role="menu" onclick={(e) => e.stopPropagation()}>
    {#each menuDefinitions[activeMenuId] as item}
      {#if item.separator}
        <div class="app-menu-separator"></div>
      {:else}
        <button
          class="submenu-item"
          class:disabled={!item.action}
          onclick={() => handleSubmenuAction(item)}
          disabled={!item.action}
          role="menuitem"
        >
          <span>{item.label}</span>
          {#if item.kbd}<kbd>{item.kbd}</kbd>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

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
  }

  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: none;
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

  /* ========== Horizontal Menu Bar ========== */
  .menu-bar {
    display: flex;
    align-items: center;
    gap: 0;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    z-index: 10001;
    animation: menu-bar-in 0.15s var(--ease-out);
  }

  @keyframes menu-bar-in {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .menu-bar-item {
    padding: 4px 8px;
    background: none;
    border: none;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
    white-space: nowrap;
  }

  .menu-bar-item:hover,
  .menu-bar-item.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  /* ========== Mode Toggle ========== */
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
    transition: margin-left var(--duration-normal, 200ms) var(--ease-out);
  }

  .mode-toggle.menu-open {
    margin-left: 4px;
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

  /* ========== Submenu Dropdown ========== */
  .submenu-dropdown {
    position: fixed;
    top: 40px;
    min-width: 200px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 6px);
    padding: 4px 0;
    box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.3));
    z-index: 10002;
    animation: submenu-in 0.1s var(--ease-out);
    -webkit-app-region: no-drag;
  }

  @keyframes submenu-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .submenu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 14px;
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

  .submenu-item:hover:not(.disabled) {
    background: var(--bg-hover);
  }

  .submenu-item.disabled {
    opacity: 0.4;
    cursor: default;
  }

  .submenu-item span {
    flex: 1;
  }

  .submenu-item kbd {
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

  .native-controls-spacer {
    width: 4px;
  }

  .decorum-controls {
    display: flex;
    flex-direction: row;
    -webkit-app-region: no-drag;
  }

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

  :global(button.decorum-tb-btn svg) {
    color: inherit !important;
    fill: currentColor !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .win-btn, .mode-btn, .menu-bar-item, .mode-toggle {
      transition: none;
    }
    .menu-bar, .submenu-dropdown {
      animation: none;
    }
  }
</style>
