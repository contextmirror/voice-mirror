<script>
  let {
    actions = [],
    visible = false,
    x = 0,
    y = 0,
    onClose = () => {},
    onApply = () => {},
  } = $props();

  let menuEl = $state(null);

  // Group actions by kind: quickfix first, then refactor, then source, then others
  let groups = $derived.by(() => {
    const quickfix = [];
    const refactor = [];
    const source = [];
    const other = [];
    for (const action of actions) {
      const kind = action.kind || '';
      if (kind.startsWith('quickfix')) quickfix.push(action);
      else if (kind.startsWith('refactor')) refactor.push(action);
      else if (kind.startsWith('source')) source.push(action);
      else other.push(action);
    }
    const result = [];
    if (quickfix.length) result.push({ label: 'Quick Fix', items: quickfix });
    if (refactor.length) result.push({ label: 'Refactor', items: refactor });
    if (source.length) result.push({ label: 'Source Action', items: source });
    if (other.length) result.push({ label: 'Other', items: other });
    return result;
  });

  let totalActions = $derived(groups.reduce((sum, g) => sum + g.items.length, 0));

  let menuStyle = $derived.by(() => {
    const maxX = typeof window !== 'undefined' ? window.innerWidth - 260 : x;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - 200 : y;
    return `left: ${Math.min(x, maxX)}px; top: ${Math.min(y, maxY)}px;`;
  });

  function handleClickOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) {
      onClose();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  $effect(() => {
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('keydown', handleKeydown, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
        document.removeEventListener('keydown', handleKeydown, true);
      };
    }
  });
</script>

{#if visible && totalActions > 0}
  <div class="code-actions-menu" style={menuStyle} bind:this={menuEl} role="menu">
    {#each groups as group, gi}
      {#if gi > 0}
        <div class="code-actions-separator"></div>
      {/if}
      <div class="code-actions-label">{group.label}</div>
      {#each group.items as action}
        <button
          class="code-action-item"
          role="menuitem"
          onclick={() => { onClose(); onApply(action); }}
        >
          {action.title}
        </button>
      {/each}
    {/each}
  </div>
{/if}

<style>
  .code-actions-menu {
    position: fixed;
    z-index: 10003;
    min-width: 200px;
    max-width: 400px;
    max-height: 300px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
  }

  .code-action-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    -webkit-app-region: no-drag;
  }

  .code-action-item:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .code-actions-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .code-actions-label {
    padding: 4px 12px 2px;
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-family: inherit;
  }
</style>
