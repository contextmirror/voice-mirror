<script>
  /**
   * TerminalIconPicker.svelte -- Popup grid for choosing a terminal tab icon.
   *
   * Shows terminal-related SVG icons with a filter input for quick search.
   * Positioned via x/y props (fixed positioning, z-index above context menu).
   * Calls terminalTabsStore.setInstanceIcon() on selection.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  let { instanceId = null, x = 0, y = 0, visible = false, onSelect = () => {}, onClose = () => {} } = $props();

  let filter = $state('');

  const ICONS = [
    { id: 'terminal', label: 'Terminal', svg: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
    { id: 'terminal-bash', label: 'Bash', svg: '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">$_</text>' },
    { id: 'terminal-powershell', label: 'PowerShell', svg: '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">PS</text>' },
    { id: 'terminal-cmd', label: 'Command Prompt', svg: '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="7" font-weight="bold">C:\\</text>' },
    { id: 'code', label: 'Code', svg: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
    { id: 'bug', label: 'Bug', svg: '<rect x="8" y="6" width="8" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="6" y1="10" x2="2" y2="10"/><line x1="18" y1="10" x2="22" y2="10"/><line x1="6" y1="16" x2="2" y2="16"/><line x1="18" y1="16" x2="22" y2="16"/>' },
    { id: 'server', label: 'Server', svg: '<rect x="2" y="2" width="20" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="14" width="20" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/>' },
    { id: 'database', label: 'Database', svg: '<ellipse cx="12" cy="5" rx="9" ry="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M21 5v14c0 1.66-4.03 3-9 3s-9-1.34-9-3V5" fill="none" stroke="currentColor" stroke-width="1.5"/>' },
    { id: 'node', label: 'Node.js', svg: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="currentColor" font-size="10" font-weight="bold">N</text>' },
    { id: 'python', label: 'Python', svg: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="currentColor" font-size="10" font-weight="bold">Py</text>' },
    { id: 'star', label: 'Star', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="1.5"/>' },
    { id: 'heart', label: 'Heart', svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="none" stroke="currentColor" stroke-width="1.5"/>' },
    { id: 'bolt', label: 'Bolt', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="none" stroke="currentColor" stroke-width="1.5"/>' },
    { id: 'gear', label: 'Settings', svg: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.5"/>' },
    { id: 'globe', label: 'Web', svg: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="1"/>' },
    { id: 'none', label: 'Default', svg: '' },
  ];

  const filteredIcons = $derived(
    filter ? ICONS.filter(i => i.label.toLowerCase().includes(filter.toLowerCase())) : ICONS
  );

  function selectIcon(icon) {
    if (instanceId) {
      terminalTabsStore.setInstanceIcon(instanceId, icon.id === 'none' ? null : icon.id);
    }
    onSelect(icon);
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
  <div class="icon-picker" style="left: {x}px; top: {y}px;" onclick={(e) => e.stopPropagation()}>
    <div class="icon-picker-label">Tab Icon</div>
    <input
      class="icon-filter"
      type="text"
      placeholder="Filter icons..."
      bind:value={filter}
    />
    <div class="icon-grid">
      {#each filteredIcons as icon}
        <button
          class="icon-option"
          title={icon.label}
          onclick={() => selectIcon(icon)}
        >
          {#if icon.svg}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              {@html icon.svg}
            </svg>
          {:else}
            <span class="icon-default">&#8212;</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .icon-picker {
    position: fixed;
    z-index: 10001;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 200px;
  }

  .icon-picker-label {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 4px;
    padding: 0 2px;
  }

  .icon-filter {
    width: 100%;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--text) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-family);
    outline: none;
    margin-bottom: 6px;
    box-sizing: border-box;
  }

  .icon-filter:focus {
    border-color: var(--accent);
  }

  .icon-filter::placeholder {
    color: var(--muted);
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }

  .icon-option {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, border-color 0.1s;
  }

  .icon-option:hover {
    background: var(--bg);
    border-color: var(--accent);
  }

  .icon-default {
    color: var(--muted);
    font-size: 14px;
  }
</style>
