<script>
  /**
   * TerminalContextMenu.svelte -- Right-click context menu for terminal instances/tabs.
   *
   * Accepts props for positioning and visibility. Shows actions like split,
   * rename, kill, unsplit, and placeholders for color/icon customization.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  /** @type {{ instanceId: string|null, x: number, y: number, visible: boolean, onClose: () => void }} */
  let { instanceId = null, x = 0, y = 0, visible = false, onClose = () => {} } = $props();

  // Derived: the instance and its group
  const instance = $derived(instanceId ? terminalTabsStore.getInstance(instanceId) : null);
  const group = $derived(instance ? terminalTabsStore.groups.find(g => g.id === instance.groupId) : null);
  const canUnsplit = $derived(group ? group.instanceIds.length > 1 : false);

  function handleSplit() {
    terminalTabsStore.splitInstance();
    onClose();
  }

  function handleChangeColor() {
    console.log('[TerminalContextMenu] Change Color (placeholder)', instanceId);
    onClose();
  }

  function handleChangeIcon() {
    console.log('[TerminalContextMenu] Change Icon (placeholder)', instanceId);
    onClose();
  }

  function handleRename() {
    if (!instanceId) return;
    const currentTitle = instance?.title || 'Terminal';
    const newTitle = prompt('Rename terminal:', currentTitle);
    if (newTitle !== null && newTitle.trim()) {
      terminalTabsStore.renameInstance(instanceId, newTitle.trim());
    }
    onClose();
  }

  function handleKill() {
    if (!instanceId) return;
    terminalTabsStore.killInstance(instanceId);
    onClose();
  }

  function handleUnsplit() {
    if (!instance) return;
    terminalTabsStore.unsplitGroup(instance.groupId);
    onClose();
  }

  // Close on outside click
  $effect(() => {
    if (!visible) return;
    function handleClick() { onClose(); }
    function handleContextMenu() { onClose(); }
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick);
      window.addEventListener('contextmenu', handleContextMenu);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  });
</script>

{#if visible && instanceId}
  <div
    class="context-menu"
    style="left: {x}px; top: {y}px;"
    onclick={(e) => e.stopPropagation()}
  >
    <button class="context-menu-item" onclick={handleSplit}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>
        <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      <span class="item-label">Split Terminal</span>
      <span class="item-shortcut">Ctrl+Shift+5</span>
    </button>

    <div class="context-menu-divider"></div>

    <button class="context-menu-item" onclick={handleChangeColor}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>
      <span class="item-label">Change Color...</span>
    </button>

    <button class="context-menu-item" onclick={handleChangeIcon}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.2" fill="none"/>
        <circle cx="8" cy="7" r="2" fill="currentColor"/>
        <path d="M4 12 Q8 9 12 12" stroke="currentColor" stroke-width="1" fill="none"/>
      </svg>
      <span class="item-label">Change Icon...</span>
    </button>

    <button class="context-menu-item" onclick={handleRename}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>
      <span class="item-label">Rename...</span>
      <span class="item-shortcut">F2</span>
    </button>

    <div class="context-menu-divider"></div>

    <button class="context-menu-item danger" onclick={handleKill}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/>
        <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <span class="item-label">Kill Terminal</span>
      <span class="item-shortcut">Delete</span>
    </button>

    {#if canUnsplit}
      <button class="context-menu-item" onclick={handleUnsplit}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>
        </svg>
        <span class="item-label">Unsplit Terminal</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 4px;
    min-width: 200px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .context-menu-item {
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

  .context-menu-item:hover {
    background: rgba(255,255,255,0.06);
  }

  .context-menu-item.danger {
    color: var(--danger, #ef4444);
  }

  .context-menu-item.danger:hover {
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border, rgba(255,255,255,0.06));
    margin: 4px 0;
  }

  .item-label {
    flex: 1;
  }

  .item-shortcut {
    font-size: 11px;
    color: var(--muted);
    margin-left: auto;
  }
</style>
