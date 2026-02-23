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
  let grouped = $derived.by(() => {
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
    return [...quickfix, ...refactor, ...source, ...other];
  });

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

{#if visible && grouped.length > 0}
  <div class="code-actions-menu" style={menuStyle} bind:this={menuEl} role="menu">
    {#each grouped as action}
      <button
        class="code-action-item"
        role="menuitem"
        onclick={() => { onClose(); onApply(action); }}
      >
        {action.title}
      </button>
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
</style>
