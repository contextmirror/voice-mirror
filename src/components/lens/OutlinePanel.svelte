<script>
  import { lspRequestDocumentSymbols } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

  let { filePath = null, hasLsp = false, onSymbolClick = () => {} } = $props();

  let symbols = $state([]);
  let loading = $state(false);

  // Symbol kind number -> [icon letter, display name]
  const SYMBOL_KINDS = {
    1: ['F', 'File'],
    2: ['M', 'Module'],
    3: ['N', 'Namespace'],
    4: ['P', 'Package'],
    5: ['C', 'Class'],
    6: ['F', 'Method'],
    7: ['P', 'Property'],
    8: ['P', 'Field'],
    9: ['F', 'Constructor'],
    10: ['E', 'Enum'],
    11: ['I', 'Interface'],
    12: ['F', 'Function'],
    13: ['V', 'Variable'],
    14: ['V', 'Constant'],
    15: ['S', 'String'],
    16: ['#', 'Number'],
    17: ['B', 'Boolean'],
    18: ['A', 'Array'],
    19: ['O', 'Object'],
    20: ['K', 'Key'],
    21: ['N', 'Null'],
    22: ['E', 'Enum Member'],
    23: ['C', 'Struct'],
    24: ['E', 'Event'],
    25: ['O', 'Operator'],
    26: ['T', 'Type Parameter'],
  };

  function symbolIcon(kind) {
    return (SYMBOL_KINDS[kind] || ['?', 'Unknown'])[0];
  }

  function symbolKindName(kind) {
    return (SYMBOL_KINDS[kind] || ['?', 'Unknown'])[1];
  }

  async function fetchSymbols(path) {
    if (!path || !hasLsp) {
      symbols = [];
      return;
    }
    loading = true;
    try {
      const root = projectStore.root;
      const result = await lspRequestDocumentSymbols(path, root);
      if (result?.data?.symbols) {
        symbols = result.data.symbols;
      } else {
        symbols = [];
      }
    } catch {
      symbols = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchSymbols(filePath);
  });

  function handleClick(symbol) {
    const range = symbol.selectionRange || symbol.range || symbol.location?.range;
    if (range) {
      onSymbolClick({ line: range.start.line, character: range.start.character });
    }
  }
</script>

<div class="outline-panel">
  {#if loading}
    <div class="outline-empty">Loading...</div>
  {:else if symbols.length === 0}
    <div class="outline-empty">{hasLsp ? 'No symbols found' : 'No LSP available'}</div>
  {:else}
    <div class="outline-scroll">
      {#snippet symbolNode(items, depth)}
        {#each items as symbol}
          <button
            class="outline-item"
            style="padding-left: {8 + depth * 16}px"
            onclick={() => handleClick(symbol)}
          >
            <span class="symbol-icon" title={symbolKindName(symbol.kind)}>{symbolIcon(symbol.kind)}</span>
            <span class="symbol-name">{symbol.name}</span>
            {#if symbol.detail}
              <span class="symbol-detail">{symbol.detail}</span>
            {/if}
          </button>
          {#if symbol.children?.length}
            {@render symbolNode(symbol.children, depth + 1)}
          {/if}
        {/each}
      {/snippet}
      {@render symbolNode(symbols, 0)}
    </div>
  {/if}
</div>

<style>
  .outline-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .outline-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .outline-empty {
    color: var(--muted);
    text-align: center;
    padding: 24px 12px;
    font-size: 12px;
  }

  .outline-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 3px 8px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
    -webkit-app-region: no-drag;
  }

  .outline-item:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .symbol-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 3px;
    flex-shrink: 0;
    background: var(--accent);
    color: var(--bg);
  }

  .symbol-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .symbol-detail {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-left: auto;
  }
</style>
