<script>
  import { setupClickOutside } from '$lib/popup-utils.js';

  let {
    zoomLevel = 100,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onFind,
    onDownloads,
    onHistory,
    onDownloadSettings,
  } = $props();

  let open = $state(false);
  let triggerEl = $state(null);
  let menuEl = $state(null);
  let focusedIndex = $state(-1);

  // All focusable items in order — zoom buttons are indices 0,1,(2 if reset shown)
  // We track them via data-index attributes to simplify keyboard nav
  function getMenuItems() {
    if (!menuEl) return [];
    return Array.from(menuEl.querySelectorAll('[data-menuitem]'));
  }

  function openMenu() {
    open = true;
    focusedIndex = -1;
  }

  function closeMenu() {
    open = false;
    focusedIndex = -1;
  }

  function handleTriggerClick() {
    if (open) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function handleTriggerKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
    }
  }

  function handleMenuKeydown(e) {
    const items = getMenuItems();
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = (focusedIndex + 1) % items.length;
      items[focusedIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = (focusedIndex - 1 + items.length) % items.length;
      items[focusedIndex]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  }

  // keepOpen: zoom buttons pass keepOpen=true so menu stays open
  function handleItem(callback, keepOpen = false) {
    if (callback) callback();
    if (!keepOpen) closeMenu();
  }

  $effect(() => {
    if (open && menuEl) {
      return setupClickOutside(menuEl, closeMenu);
    }
  });

  // Also close on Escape even if trigger has focus
  $effect(() => {
    if (!open) return;
    function handleEsc(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        triggerEl?.focus();
      }
    }
    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  });
</script>

<div class="browser-menu-wrapper">
  <!-- Three-dot trigger button -->
  <button
    bind:this={triggerEl}
    class="nav-btn trigger-btn"
    class:active={open}
    onclick={handleTriggerClick}
    onkeydown={handleTriggerKeydown}
    title="Customize and control"
    aria-label="Open browser menu"
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3" r="1.5"/>
      <circle cx="8" cy="8" r="1.5"/>
      <circle cx="8" cy="13" r="1.5"/>
    </svg>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={menuEl}
      class="browser-menu"
      role="menu"
      onkeydown={handleMenuKeydown}
    >
      <!-- Zoom row -->
      <div class="menu-zoom-row" role="none">
        <span class="zoom-label">Zoom</span>
        <div class="zoom-controls">
          <button
            class="zoom-btn"
            role="menuitem"
            data-menuitem
            onclick={() => handleItem(onZoomOut, true)}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3" y1="7" x2="11" y2="7"/>
            </svg>
          </button>
          <button
            class="zoom-pct"
            role="menuitem"
            data-menuitem
            onclick={() => handleItem(zoomLevel !== 100 ? onZoomReset : undefined, true)}
            aria-label={zoomLevel !== 100 ? `Reset zoom (currently ${zoomLevel}%)` : `${zoomLevel}%`}
            title={zoomLevel !== 100 ? 'Reset zoom' : ''}
            class:resettable={zoomLevel !== 100}
          >
            {zoomLevel}%
          </button>
          <button
            class="zoom-btn"
            role="menuitem"
            data-menuitem
            onclick={() => handleItem(onZoomIn, true)}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="7" y1="3" x2="7" y2="11"/>
              <line x1="3" y1="7" x2="11" y2="7"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="menu-separator" role="separator"></div>

      <!-- Find on page -->
      <button
        class="menu-item"
        role="menuitem"
        data-menuitem
        onclick={() => handleItem(onFind)}
      >
        <span class="menu-item-label">Find on page</span>
        <span class="menu-item-shortcut">Ctrl+F</span>
      </button>

      <div class="menu-separator" role="separator"></div>

      <!-- Downloads -->
      <button
        class="menu-item"
        role="menuitem"
        data-menuitem
        onclick={() => handleItem(onDownloads)}
      >
        <span class="menu-item-label">Downloads</span>
      </button>

      <!-- History -->
      <button
        class="menu-item"
        role="menuitem"
        data-menuitem
        onclick={() => handleItem(onHistory)}
      >
        <span class="menu-item-label">History</span>
      </button>

      <div class="menu-separator" role="separator"></div>

      <!-- Download settings -->
      <button
        class="menu-item"
        role="menuitem"
        data-menuitem
        onclick={() => handleItem(onDownloadSettings)}
      >
        <span class="menu-item-label">Download settings</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .browser-menu-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* Matches LensToolbar's .nav-btn */
  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out);
    flex-shrink: 0;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg);
  }

  .nav-btn.active {
    background: var(--bg);
  }

  /* Dropdown panel */
  .browser-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color, var(--border));
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    padding: 4px 0;
    z-index: 10010;
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
    outline: none;
  }

  /* Separator */
  .menu-separator {
    height: 1px;
    background: var(--border-color, var(--border));
    margin: 4px 0;
  }

  /* Regular menu items */
  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 7px 12px;
    border: none;
    background: transparent;
    color: var(--text-primary, var(--text));
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    -webkit-app-region: no-drag;
    gap: 8px;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--bg-hover, var(--bg));
    outline: none;
  }

  .menu-item-label {
    flex: 1;
  }

  .menu-item-shortcut {
    font-size: 11px;
    color: var(--text-secondary, var(--muted));
    flex-shrink: 0;
  }

  /* Zoom row */
  .menu-zoom-row {
    display: flex;
    align-items: center;
    padding: 4px 12px;
    gap: 8px;
  }

  .zoom-label {
    flex: 1;
    font-size: 13px;
    color: var(--text-primary, var(--text));
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-color, var(--border));
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary, var(--text));
    cursor: pointer;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out);
    flex-shrink: 0;
  }

  .zoom-btn:hover,
  .zoom-btn:focus-visible {
    background: var(--bg-hover, var(--bg));
    outline: none;
  }

  .zoom-pct {
    min-width: 48px;
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--border-color, var(--border));
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary, var(--text));
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: default;
    text-align: center;
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease-out),
                border-color var(--duration-fast, 100ms) var(--ease-out, ease-out);
  }

  .zoom-pct.resettable {
    cursor: pointer;
    border-color: var(--accent);
    color: var(--accent);
  }

  .zoom-pct.resettable:hover,
  .zoom-pct.resettable:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    outline: none;
  }
</style>
