<script>
  /**
   * TerminalSidebar.svelte -- Instance list sidebar for the terminal panel.
   *
   * Shows all groups and their instances in a tree structure. Single-instance
   * groups have no tree prefix; multi-instance groups use box-drawing chars.
   * Click focuses an instance; right-click dispatches a context menu event.
   * Displays color dot and icon indicator when set on an instance.
   */
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

  /** @type {{ oncontextmenu?: (e: MouseEvent, instanceId: string) => void }} */
  let { oncontextmenu } = $props();

  /** Icon SVG paths keyed by icon id (matches TerminalIconPicker ICONS) */
  const ICON_SVGS = {
    'terminal': '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    'terminal-bash': '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">$_</text>',
    'terminal-powershell': '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">PS</text>',
    'terminal-cmd': '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="7" font-weight="bold">C:\\</text>',
    'code': '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    'bug': '<rect x="8" y="6" width="8" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="6" y1="10" x2="2" y2="10"/><line x1="18" y1="10" x2="22" y2="10"/><line x1="6" y1="16" x2="2" y2="16"/><line x1="18" y1="16" x2="22" y2="16"/>',
    'server': '<rect x="2" y="2" width="20" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="14" width="20" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/>',
    'database': '<ellipse cx="12" cy="5" rx="9" ry="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M21 5v14c0 1.66-4.03 3-9 3s-9-1.34-9-3V5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    'node': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="currentColor" font-size="10" font-weight="bold">N</text>',
    'python': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="currentColor" font-size="10" font-weight="bold">Py</text>',
    'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    'bolt': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    'gear': '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.5"/>',
    'globe': '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="1"/>',
  };
</script>

<div class="terminal-sidebar">
  {#each terminalTabsStore.groups as group}
    {#each group.instanceIds as instId, idx}
      {@const instance = terminalTabsStore.getInstance(instId)}
      {@const prefix = group.instanceIds.length <= 1 ? '' : idx === 0 ? '\u250C ' : idx === group.instanceIds.length - 1 ? '\u2514 ' : '\u251C '}
      <div
        class="sidebar-instance"
        class:active={instId === terminalTabsStore.activeInstanceId}
        onclick={() => terminalTabsStore.focusInstance(instId)}
        oncontextmenu={(e) => { e.preventDefault(); oncontextmenu?.(e, instId); }}
        role="option"
        tabindex="0"
        aria-selected={instId === terminalTabsStore.activeInstanceId}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') terminalTabsStore.focusInstance(instId); }}
      >
        {#if prefix}<span class="tree-char">{prefix}</span>{/if}
        {#if instance?.color}
          <span class="color-dot" style="background-color: {instance.color}"></span>
        {/if}
        {#if instance?.icon && ICON_SVGS[instance.icon]}
          <svg class="instance-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            {@html ICON_SVGS[instance.icon]}
          </svg>
        {/if}
        <span class="instance-title">{instance?.title || 'Terminal'}</span>
      </div>
    {/each}
  {/each}
</div>

<style>
  .terminal-sidebar {
    width: 160px;
    border-left: 1px solid var(--muted);
    overflow-y: auto;
    flex-shrink: 0;
  }

  .sidebar-instance {
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .sidebar-instance:hover {
    background: var(--bg-elevated);
  }

  .sidebar-instance.active {
    background: var(--bg-elevated);
    color: var(--text-strong);
  }

  .tree-char {
    color: var(--muted);
    font-family: var(--font-mono);
    margin-right: 4px;
  }

  .color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-right: 4px;
  }

  .instance-icon {
    flex-shrink: 0;
    margin-right: 4px;
    color: var(--text);
  }

  .instance-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
