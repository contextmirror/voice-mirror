<script>
  /**
   * TerminalActionBar.svelte -- Action buttons for the terminal panel header.
   *
   * Contains:
   * - "+" button with dropdown: New Terminal (primary), Split Terminal, Configure (placeholder)
   * - "..." overflow menu: Clear Terminal
   * - Split Terminal button (quick action)
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  // Dropdown state: "+" new terminal menu
  let newDropdownOpen = $state(false);
  let newDropdownPos = $state({ x: 0, y: 0 });

  // Overflow menu state: "..." button
  let overflowOpen = $state(false);
  let overflowPos = $state({ x: 0, y: 0 });

  function toggleNewDropdown(e) {
    e.stopPropagation();
    if (newDropdownOpen) {
      newDropdownOpen = false;
      return;
    }
    overflowOpen = false;
    const rect = e.currentTarget.getBoundingClientRect();
    newDropdownPos = { x: rect.left, y: rect.bottom + 4 };
    newDropdownOpen = true;
  }

  function toggleOverflow(e) {
    e.stopPropagation();
    if (overflowOpen) {
      overflowOpen = false;
      return;
    }
    newDropdownOpen = false;
    const rect = e.currentTarget.getBoundingClientRect();
    overflowPos = { x: rect.right - 160, y: rect.bottom + 4 };
    overflowOpen = true;
  }

  function closeAll() {
    newDropdownOpen = false;
    overflowOpen = false;
  }

  function handleNewTerminal() {
    terminalTabsStore.addGroup();
    closeAll();
  }

  function handleSplitTerminal() {
    terminalTabsStore.splitInstance();
    closeAll();
  }

  function handleConfigureSettings() {
    console.log('[TerminalActionBar] Configure Terminal Settings (placeholder)');
    closeAll();
  }

  function handleClearTerminal() {
    // Dispatch a custom event that TerminalPanel can listen to
    const event = new CustomEvent('terminal-clear', { bubbles: true });
    document.dispatchEvent(event);
    closeAll();
  }

  // Close menus on outside click
  $effect(() => {
    if (!newDropdownOpen && !overflowOpen) return;
    function handleClick() { closeAll(); }
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick);
    };
  });
</script>

<div class="terminal-actions">
  <!-- Split Terminal (quick action) -->
  <button class="action-btn" title="Split Terminal" onclick={() => terminalTabsStore.splitInstance()}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.2"/>
    </svg>
  </button>

  <!-- New Terminal + dropdown -->
  <button class="action-btn" title="New Terminal" onclick={(e) => { terminalTabsStore.addGroup(); }} >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.5"/>
      <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  </button>
  <button class="action-btn dropdown-chevron" title="Terminal actions" onclick={toggleNewDropdown}>
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
      <polyline points="3 4.5 6 7.5 9 4.5"/>
    </svg>
  </button>

  <!-- Overflow menu -->
  <button class="action-btn" title="More actions" onclick={toggleOverflow}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="8" r="1.2" fill="currentColor"/>
      <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
      <circle cx="12" cy="8" r="1.2" fill="currentColor"/>
    </svg>
  </button>
</div>

<!-- New Terminal dropdown menu -->
{#if newDropdownOpen}
  <div class="dropdown-menu" style="left: {newDropdownPos.x}px; top: {newDropdownPos.y}px;">
    <button class="dropdown-item" onclick={handleNewTerminal}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.5"/>
        <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      New Terminal
    </button>
    <button class="dropdown-item" onclick={handleSplitTerminal}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>
        <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      Split Terminal
    </button>
    <div class="dropdown-divider"></div>
    <button class="dropdown-item" onclick={handleConfigureSettings}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.2" fill="none"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1"/>
      </svg>
      Configure Terminal Settings
    </button>
  </div>
{/if}

<!-- Overflow menu -->
{#if overflowOpen}
  <div class="dropdown-menu" style="left: {overflowPos.x}px; top: {overflowPos.y}px;">
    <button class="dropdown-item" onclick={handleClearTerminal}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
        <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
      </svg>
      Clear Terminal
    </button>
  </div>
{/if}

<style>
  .terminal-actions {
    display: flex;
    gap: 2px;
    margin-left: auto;
    align-items: center;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--bg-elevated);
  }

  .dropdown-chevron {
    padding: 4px 2px;
    margin-left: -2px;
  }

  /* -- Dropdown menu (position: fixed) -- */

  .dropdown-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 4px;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background 0.1s;
  }

  .dropdown-item:hover {
    background: rgba(255,255,255,0.06);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border, rgba(255,255,255,0.06));
    margin: 4px 0;
  }
</style>
