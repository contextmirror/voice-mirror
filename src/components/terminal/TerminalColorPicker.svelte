<script>
  /**
   * TerminalColorPicker.svelte -- Popup grid for choosing a terminal tab color.
   *
   * Shows predefined theme-aware colors plus a "None" option to clear.
   * Positioned via x/y props (fixed positioning, z-index above context menu).
   * Calls terminalTabsStore.setInstanceColor() on selection.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  let { instanceId = null, x = 0, y = 0, visible = false, onSelect = () => {}, onClose = () => {} } = $props();

  const COLORS = [
    { id: 'red', label: 'Red', value: 'var(--danger)' },
    { id: 'orange', label: 'Orange', value: '#f97316' },
    { id: 'yellow', label: 'Yellow', value: 'var(--warn)' },
    { id: 'green', label: 'Green', value: 'var(--ok)' },
    { id: 'blue', label: 'Blue', value: '#3b82f6' },
    { id: 'purple', label: 'Purple', value: '#8b5cf6' },
    { id: 'pink', label: 'Pink', value: '#ec4899' },
    { id: 'cyan', label: 'Cyan', value: '#06b6d4' },
    { id: 'accent', label: 'Accent', value: 'var(--accent)' },
    { id: 'none', label: 'None', value: null },
  ];

  function selectColor(color) {
    if (instanceId) {
      terminalTabsStore.setInstanceColor(instanceId, color.value);
    }
    onSelect(color);
    onClose();
  }

  // Close on outside click
  $effect(() => {
    if (!visible) return;
    function handleClick() { onClose(); }
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick);
    };
  });
</script>

{#if visible}
  <div class="color-picker" style="left: {x}px; top: {y}px;" onclick={(e) => e.stopPropagation()}>
    <div class="color-picker-label">Tab Color</div>
    <div class="color-grid">
      {#each COLORS as color}
        <button
          class="color-swatch"
          class:none={!color.value}
          title={color.label}
          style={color.value ? `background: ${color.value}` : ''}
          onclick={() => selectColor(color)}
        >
          {#if !color.value}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .color-picker {
    position: fixed;
    z-index: 10001;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 160px;
  }

  .color-picker-label {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 6px;
    padding: 0 2px;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }

  .color-swatch {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s, box-shadow 0.1s;
  }

  .color-swatch:hover {
    transform: scale(1.15);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .color-swatch.none {
    background: var(--bg);
    color: var(--muted);
  }
</style>
