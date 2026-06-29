<script>
  import { overlayStore } from '../../lib/stores/overlay.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { commandRegistry } from '../../lib/commands.svelte.js';
  import { open } from '@tauri-apps/plugin-dialog';
  import Orb from '../overlay/Orb.svelte';

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
  // The menu bar (File/Edit/…) is shown by default and toggled only by the
  // broadcast button; the choice is remembered across sessions (localStorage,
  // to avoid a backend config rebuild). Click-outside / Escape close just the
  // open submenu dropdown — not the bar itself.
  const MENU_BAR_PREF = 'voice-mirror-menu-bar-open';
  function loadMenuBarOpen() {
    try {
      const v = localStorage.getItem(MENU_BAR_PREF);
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  }
  let appMenuOpen = $state(loadMenuBarOpen());
  let activeMenuId = $state(null);
  let submenuLeft = $state(0);

  /** Refs for menu bar buttons (for submenu positioning) */
  let menuBtnEls = $state({});

  function toggleAppMenu(e) {
    e.stopPropagation();
    appMenuOpen = !appMenuOpen;
    if (!appMenuOpen) activeMenuId = null;
    try {
      localStorage.setItem(MENU_BAR_PREF, String(appMenuOpen));
    } catch {
      // localStorage unavailable — non-fatal, just won't persist
    }
  }

  // Closes only the open submenu dropdown (click-outside / Escape / after an
  // action). The menu bar itself stays put — it's toggled only via the button.
  function closeAppMenu() {
    activeMenuId = null;
  }

  async function handleOpenProject() {
    closeAppMenu();
    const selected = await open({ directory: true });
    if (selected) {
      projectStore.addProject(selected);
      navigationStore.setView('lens');
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
      navigationStore.setView('lens');
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

  // Menu items wire to the central command registry (commands.svelte.js) via
  // `cmd`, so the title-bar menu and the command palette share one source of
  // truth. A few File items keep a local `action` (they need a native dialog).
  const menuDefinitions = {
    file: [
      { label: 'New File', kbd: 'Ctrl+N', cmd: 'file.newUntitled' },
      { separator: true },
      { label: 'Open File', kbd: 'Ctrl+O', action: handleOpenFile },
      { label: 'Open Project', action: handleOpenProject },
      { separator: true },
      { label: 'Save', kbd: 'Ctrl+S', cmd: 'file.save' },
      { label: 'Close Tab', kbd: 'Ctrl+W', cmd: 'file.closeTab' },
      { separator: true },
      { label: 'Settings', kbd: 'Ctrl+,', action: handleSettings },
    ],
    edit: [
      { label: 'Undo', kbd: 'Ctrl+Z', cmd: 'editor.undo' },
      { label: 'Redo', kbd: 'Ctrl+Shift+Z', cmd: 'editor.redo' },
      { separator: true },
      { label: 'Cut', kbd: 'Ctrl+X', cmd: 'editor.cut' },
      { label: 'Copy', kbd: 'Ctrl+C', cmd: 'editor.copy' },
      { label: 'Paste', kbd: 'Ctrl+V', cmd: 'editor.paste' },
      { separator: true },
      { label: 'Find', kbd: 'Ctrl+F', cmd: 'editor.find' },
      { label: 'Format Document', kbd: 'Shift+Alt+F', cmd: 'lsp.formatDocument' },
    ],
    selection: [
      { label: 'Select All', kbd: 'Ctrl+A', cmd: 'editor.selectAll' },
      { label: 'Expand Selection', kbd: 'Shift+Alt+Right', cmd: 'editor.expandSelection' },
      { label: 'Shrink Selection', kbd: 'Shift+Alt+Left', cmd: 'editor.shrinkSelection' },
    ],
    view: [
      { label: 'Command Palette', kbd: 'Ctrl+Shift+P', cmd: 'view.commandPalette' },
      { separator: true },
      { label: 'Toggle Sidebar', kbd: 'Ctrl+B', cmd: 'view.toggleSidebar' },
      { label: 'Toggle Chat Panel', cmd: 'view.toggleChat' },
      { label: 'Toggle Terminal', cmd: 'view.toggleTerminal' },
      { label: 'Toggle File Tree', cmd: 'view.toggleFileTree' },
    ],
    go: [
      { label: 'Go to File', kbd: 'Ctrl+P', cmd: 'view.goToFile' },
      { label: 'Go to Symbol', kbd: 'Ctrl+Shift+O', cmd: 'search.goToSymbol' },
      { label: 'Go to Line', kbd: 'Ctrl+G', cmd: 'search.goToLine' },
      { separator: true },
      { label: 'Go to Definition', kbd: 'F12', cmd: 'lsp.goToDefinition' },
      { label: 'Find References', kbd: 'Shift+F12', cmd: 'lsp.findReferences' },
    ],
    run: [
      { label: 'Start', cmd: 'run.start' },
      { label: 'Stop', cmd: 'run.stop' },
      { label: 'Restart', cmd: 'run.restart' },
    ],
    terminal: [
      { label: 'New Terminal', cmd: 'terminal.newTerminal' },
      { label: 'Split Terminal', cmd: 'terminal.split' },
      { separator: true },
      { label: 'Clear Terminal', cmd: 'terminal.clear' },
    ],
    help: [
      { label: 'Documentation', cmd: 'help.documentation' },
      { label: 'Keyboard Shortcuts', kbd: 'Ctrl+K Ctrl+S', cmd: 'help.keyboardShortcuts' },
      { separator: true },
      { label: 'About Voice Mirror', cmd: 'help.about' },
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
    closeAppMenu();
    if (item.cmd) {
      commandRegistry.execute(item.cmd);
    } else if (item.action) {
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <!-- Broadcast waves left -->
          <path d="M4.5 8.5a8.5 8.5 0 0 0 0 7"/>
          <path d="M6.5 9.8a5.5 5.5 0 0 0 0 4.4"/>
          <path d="M8.3 10.8a3 3 0 0 0 0 2.4"/>
          <!-- V shape -->
          <path d="M10 7l2 10 2-10" stroke-width="2.2"/>
          <!-- Broadcast waves right -->
          <path d="M15.7 10.8a3 3 0 0 1 0 2.4"/>
          <path d="M17.5 9.8a5.5 5.5 0 0 1 0 4.4"/>
          <path d="M19.5 8.5a8.5 8.5 0 0 1 0 7"/>
        </svg>
      </button>
    </div>

    {#if appMenuOpen}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <nav class="menu-bar" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
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
  <div class="submenu-dropdown" style="left: {submenuLeft}px;" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
    {#each menuDefinitions[activeMenuId] as item}
      {#if item.separator}
        <div class="app-menu-separator"></div>
      {:else}
        <button
          class="submenu-item"
          class:disabled={!item.action && !item.cmd}
          onclick={() => handleSubmenuAction(item)}
          disabled={!item.action && !item.cmd}
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
    .win-btn, .menu-bar-item {
      transition: none;
    }
    .menu-bar, .submenu-dropdown {
      animation: none;
    }
  }
</style>
