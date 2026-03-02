<script>
  import fuzzysort from 'fuzzysort';
  import { searchFiles, lspRequestDocumentSymbols } from '../../lib/api.js';
  import { commandRegistry } from '../../lib/commands.svelte.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import { basename } from '../../lib/utils.js';

  let { visible = $bindable(false), onClose = () => {}, initialMode = 'files' } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state(null);
  let listEl = $state(null);
  let cachedFiles = $state([]);
  let loadingFiles = $state(false);
  let symbols = $state([]);
  let loadingSymbols = $state(false);

  // ── Mode detection from prefix ──

  let mode = $derived.by(() => {
    if (query.startsWith('>')) return 'commands';
    if (query.startsWith(':')) return 'goto-line';
    if (query.startsWith('@')) return 'goto-symbol';
    return 'files';
  });

  /** The query text with the prefix stripped */
  let strippedQuery = $derived.by(() => {
    if (mode === 'commands') return query.slice(1).trim();
    if (mode === 'goto-line') return query.slice(1).trim();
    if (mode === 'goto-symbol') return query.slice(1).trim();
    return query.trim();
  });

  let placeholder = $derived.by(() => {
    switch (mode) {
      case 'commands': return 'Type a command name...';
      case 'goto-line': return 'Enter a line number...';
      case 'goto-symbol': return 'Type to filter symbols...';
      default: return 'Search files and commands...';
    }
  });

  // ── File mode results ──

  let filteredFiles = $derived.by(() => {
    if (mode !== 'files') return [];
    if (!strippedQuery || cachedFiles.length === 0) return [];
    const results = fuzzysort.go(strippedQuery, cachedFiles, { limit: 20 });
    return results.map(r => ({
      name: basename(r.target),
      path: r.target,
      score: r.score,
    }));
  });

  // ── Command mode results ──

  let commandResults = $derived.by(() => {
    if (mode !== 'commands') return { items: [], groups: [] };
    if (!strippedQuery) {
      // Empty query: show all commands grouped by category (MRU first)
      return { items: [], groups: commandRegistry.getAll() };
    }
    return { items: commandRegistry.search(strippedQuery), groups: [] };
  });

  // ── Symbol mode results ──

  let filteredSymbols = $derived.by(() => {
    if (mode !== 'goto-symbol') return [];
    if (!strippedQuery || symbols.length === 0) return symbols;
    const results = fuzzysort.go(strippedQuery, symbols, { key: 'name', limit: 30 });
    return results.map(r => r.obj);
  });

  // ── Combined allResults for all modes ──

  /**
   * @typedef {{ type: string, label?: string, name?: string, path?: string, score?: number, id?: string, category?: string, keybinding?: string, kind?: number, line?: number, character?: number }} PaletteItem
   */

  let allResults = $derived.by(() => {
    /** @type {PaletteItem[]} */
    const items = [];

    if (mode === 'files') {
      if (filteredFiles.length > 0) {
        items.push({ type: 'header', label: 'Files' });
        for (const f of filteredFiles) {
          items.push({ type: 'file', ...f });
        }
      }
    } else if (mode === 'commands') {
      if (commandResults.items.length > 0) {
        // Search results (flat list)
        for (const c of commandResults.items) {
          items.push({ type: 'command', id: c.id, label: c.label, category: c.category, keybinding: c.keybinding });
        }
      } else if (commandResults.groups.length > 0) {
        // Grouped view (empty query)
        for (const group of commandResults.groups) {
          items.push({ type: 'header', label: group.category });
          for (const c of group.commands) {
            items.push({ type: 'command', id: c.id, label: c.label, category: c.category, keybinding: c.keybinding });
          }
        }
      }
    } else if (mode === 'goto-line') {
      const num = parseInt(strippedQuery, 10);
      if (strippedQuery && !isNaN(num) && num > 0) {
        items.push({ type: 'goto-line', label: `Go to line ${num}`, line: num });
      } else if (!strippedQuery) {
        items.push({ type: 'hint', label: 'Type a line number and press Enter' });
      }
    } else if (mode === 'goto-symbol') {
      if (loadingSymbols) {
        items.push({ type: 'hint', label: 'Loading symbols...' });
      } else if (filteredSymbols.length > 0) {
        for (const sym of filteredSymbols) {
          items.push({
            type: 'symbol',
            name: sym.name,
            kind: sym.kind,
            label: sym.name,
            line: (sym.range?.start?.line ?? 0) + 1,
            character: sym.range?.start?.character ?? 0,
          });
        }
      } else if (symbols.length === 0 && !loadingSymbols) {
        items.push({ type: 'hint', label: 'No symbols available (LSP not running?)' });
      }
    }

    return items;
  });

  // Only selectable items (not headers/hints)
  let selectableItems = $derived(allResults.filter(i => i.type !== 'header' && i.type !== 'hint'));

  // ── Helpers ──

  function extractDirectory(filepath) {
    const parts = filepath.split(/[/\\]/);
    parts.pop();
    return parts.join('/');
  }

  const SYMBOL_KIND_LABELS = {
    1: 'file', 2: 'module', 3: 'namespace', 4: 'package',
    5: 'class', 6: 'method', 7: 'property', 8: 'field',
    9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function',
    13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
    17: 'boolean', 18: 'array', 19: 'object', 20: 'key',
    21: 'null', 22: 'enum member', 23: 'struct', 24: 'event',
    25: 'operator', 26: 'type parameter',
  };

  function symbolKindLabel(kind) {
    return SYMBOL_KIND_LABELS[kind] || 'symbol';
  }

  // ── Actions ──

  function close() {
    visible = false;
    query = '';
    selectedIndex = 0;
    symbols = [];
    onClose();
  }

  function executeItem(item) {
    if (!item) return;
    if (item.type === 'command') {
      commandRegistry.execute(item.id);
    } else if (item.type === 'file') {
      tabsStore.openFile({ name: item.name, path: item.path });
    } else if (item.type === 'goto-line') {
      const groupId = editorGroupsStore.focusedGroupId;
      window.dispatchEvent(new CustomEvent(`lens-goto-position-${groupId}`, {
        detail: { line: item.line - 1, character: 0 },
      }));
    } else if (item.type === 'symbol') {
      const groupId = editorGroupsStore.focusedGroupId;
      window.dispatchEvent(new CustomEvent(`lens-goto-position-${groupId}`, {
        detail: { line: (item.line || 1) - 1, character: item.character || 0 },
      }));
    }
    close();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectableItems.length > 0) {
        selectedIndex = (selectedIndex + 1) % selectableItems.length;
        scrollSelectedIntoView();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectableItems.length > 0) {
        selectedIndex = (selectedIndex - 1 + selectableItems.length) % selectableItems.length;
        scrollSelectedIntoView();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // For goto-line mode with no selectable items but valid input
      if (mode === 'goto-line' && selectableItems.length === 0) {
        const num = parseInt(strippedQuery, 10);
        if (!isNaN(num) && num > 0) {
          executeItem({ type: 'goto-line', line: num });
        }
        return;
      }
      const item = selectableItems[selectedIndex];
      if (item) executeItem(item);
      return;
    }
  }

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      if (!listEl) return;
      const el = listEl.querySelector('[data-selected="true"]');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  // ── Data fetching ──

  async function fetchFiles() {
    const project = projectStore.activeProject;
    if (!project?.path) return;
    loadingFiles = true;
    try {
      const result = await searchFiles(project.path);
      const files = result?.data || result || [];
      cachedFiles = Array.isArray(files) ? files : [];
    } catch (err) {
      console.warn('[CommandPalette] Failed to fetch files:', err);
      cachedFiles = [];
    } finally {
      loadingFiles = false;
    }
  }

  async function fetchSymbols() {
    const tab = tabsStore.getActiveTabForGroup(editorGroupsStore.focusedGroupId);
    if (!tab?.path || tab.path.startsWith('untitled:')) {
      symbols = [];
      return;
    }
    const project = projectStore.activeProject;
    loadingSymbols = true;
    try {
      const root = project?.path || null;
      if (!root) { symbols = []; loadingSymbols = false; return; }
      const result = await lspRequestDocumentSymbols(tab.path, root);
      const data = result?.data?.symbols || [];
      symbols = Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('[CommandPalette] Failed to fetch symbols:', err);
      symbols = [];
    } finally {
      loadingSymbols = false;
    }
  }

  // ── Effects ──

  // Freeze/unfreeze webview when palette opens/closes
  $effect(() => {
    if (visible) {
      lensStore.freeze();
    } else {
      lensStore.unfreeze();
    }
  });

  // Initialize on open: set prefix based on initialMode, focus input, fetch data
  $effect(() => {
    if (visible) {
      // Pre-fill prefix based on initialMode
      switch (initialMode) {
        case 'commands':  query = '>'; break;
        case 'goto-line': query = ':'; break;
        case 'goto-symbol': query = '@'; break;
        default: query = '';
      }
      selectedIndex = 0;
      symbols = [];

      requestAnimationFrame(() => {
        inputEl?.focus();
      });

      fetchFiles();
    }
  });

  // Fetch symbols when entering symbol mode
  $effect(() => {
    if (visible && mode === 'goto-symbol') {
      fetchSymbols();
    }
  });

  // Reset selected index when query changes
  $effect(() => {
    query;
    selectedIndex = 0;
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" style="-webkit-app-region: no-drag" onkeydown={handleKeydown}>
      <div class="search-row">
        {#if mode !== 'files'}
          <span class="mode-pill">{query.charAt(0)}</span>
        {:else}
          <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        {/if}
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          placeholder={placeholder}
          spellcheck="false"
          autocomplete="off"
        />
      </div>

      <div class="results" bind:this={listEl}>
        {#if allResults.length === 0}
          <div class="empty">
            {#if mode === 'files' && loadingFiles}
              Loading files...
            {:else if mode === 'files' && strippedQuery}
              No results for "{strippedQuery}"
            {:else if mode === 'commands' && strippedQuery}
              No commands matching "{strippedQuery}"
            {:else if mode === 'files'}
              Start typing to search files...
            {:else}
              No results
            {/if}
          </div>
        {:else}
          {#each allResults as item, i}
            {#if item.type === 'header'}
              <div class="category-header">{item.label}</div>
            {:else if item.type === 'hint'}
              <div class="empty">{item.label}</div>
            {:else if item.type === 'file'}
              {@const selIdx = selectableItems.indexOf(item)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="result-item"
                class:selected={selIdx === selectedIndex}
                data-selected={selIdx === selectedIndex}
                onmousedown={() => executeItem(item)}
                onmouseenter={() => { selectedIndex = selIdx; }}
              >
                <svg class="item-icon file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div class="item-content">
                  <span class="item-label">{item.name}</span>
                  <span class="item-path">{extractDirectory(item.path)}</span>
                </div>
              </div>
            {:else if item.type === 'command'}
              {@const selIdx = selectableItems.indexOf(item)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="result-item"
                class:selected={selIdx === selectedIndex}
                data-selected={selIdx === selectedIndex}
                onmousedown={() => executeItem(item)}
                onmouseenter={() => { selectedIndex = selIdx; }}
              >
                <svg class="item-icon cmd-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5"/>
                  <line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
                <div class="item-content">
                  <span class="item-label">{item.label}</span>
                  {#if item.category}
                    <span class="item-category">{item.category}</span>
                  {/if}
                </div>
                {#if item.keybinding}
                  <kbd class="item-hint">{item.keybinding}</kbd>
                {/if}
              </div>
            {:else if item.type === 'goto-line'}
              {@const selIdx = selectableItems.indexOf(item)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="result-item"
                class:selected={selIdx === selectedIndex}
                data-selected={selIdx === selectedIndex}
                onmousedown={() => executeItem(item)}
                onmouseenter={() => { selectedIndex = selIdx; }}
              >
                <svg class="item-icon cmd-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12"/>
                  <polyline points="14 6 20 12 14 18"/>
                </svg>
                <div class="item-content">
                  <span class="item-label">{item.label}</span>
                </div>
              </div>
            {:else if item.type === 'symbol'}
              {@const selIdx = selectableItems.indexOf(item)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="result-item"
                class:selected={selIdx === selectedIndex}
                data-selected={selIdx === selectedIndex}
                onmousedown={() => executeItem(item)}
                onmouseenter={() => { selectedIndex = selIdx; }}
              >
                <span class="symbol-kind">{symbolKindLabel(item.kind)}</span>
                <div class="item-content">
                  <span class="item-label">{item.name}</span>
                  <span class="item-path">line {item.line}</span>
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10002;
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 20vh;
    -webkit-app-region: no-drag;
  }

  .modal {
    width: 100%;
    max-width: 560px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: var(--shadow-lg), 0 0 0 1px color-mix(in srgb, var(--text) 3%, transparent);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 60vh;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .search-icon {
    flex-shrink: 0;
    color: var(--muted);
  }

  .mode-pill {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-subtle);
    color: var(--accent);
    border-radius: 6px;
    font-size: 14px;
    font-weight: 700;
    font-family: var(--font-family);
    line-height: 1;
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-strong);
    font-size: 15px;
    font-family: var(--font-family);
    line-height: 1.4;
  }

  input::placeholder {
    color: var(--muted);
  }

  .results {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }

  .results::-webkit-scrollbar {
    width: 6px;
  }

  .results::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: 3px;
  }

  .results::-webkit-scrollbar-track {
    background: transparent;
  }

  .empty {
    padding: 20px 16px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }

  .category-header {
    padding: 8px 16px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    cursor: pointer;
    transition: background var(--duration-fast) ease;
    user-select: none;
  }

  .result-item:hover {
    background: var(--card-highlight);
  }

  .result-item.selected {
    background: var(--accent-subtle);
  }

  .item-icon {
    flex-shrink: 0;
    color: var(--muted);
  }

  .result-item.selected .item-icon {
    color: var(--accent);
  }

  .file-icon {
    color: var(--accent);
    opacity: 0.7;
  }

  .cmd-icon {
    color: var(--muted);
  }

  .item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .item-label {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-item.selected .item-label {
    color: var(--text-strong);
  }

  .item-path {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
  }

  .item-category {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    opacity: 0.7;
  }

  .item-hint {
    flex-shrink: 0;
    font-family: var(--font-family);
    font-size: 11px;
    color: var(--muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
    line-height: 1.6;
  }

  .symbol-kind {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--accent);
    background: var(--accent-subtle);
    border-radius: 4px;
    padding: 1px 6px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1.8;
  }
</style>
