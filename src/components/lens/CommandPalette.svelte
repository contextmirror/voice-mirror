<script>
  import fuzzysort from 'fuzzysort';
  import { searchFiles } from '../../lib/api.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { layoutStore } from '../../lib/stores/layout.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';

  let { visible = $bindable(false), onClose = () => {} } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state(null);
  let listEl = $state(null);
  let cachedFiles = $state([]);
  let loadingFiles = $state(false);

  const commands = [
    { id: 'open-lens', label: 'Open Lens', category: 'command' },
    { id: 'new-session', label: 'New Session', hint: 'Ctrl+Shift+S', category: 'command' },
    { id: 'toggle-terminal', label: 'Toggle Terminal', hint: 'Ctrl+`', category: 'command' },
    { id: 'toggle-chat', label: 'Toggle Chat', category: 'command' },
    { id: 'toggle-file-tree', label: 'Toggle File Tree', category: 'command' },
    { id: 'open-settings', label: 'Settings', hint: 'Ctrl+,', category: 'command' },
  ];

  const commandHandlers = {
    'open-lens': () => navigationStore.setMode('lens'),
    'toggle-terminal': () => layoutStore.toggleTerminal(),
    'toggle-chat': () => layoutStore.toggleChat(),
    'toggle-file-tree': () => layoutStore.toggleFileTree(),
    'open-settings': () => navigationStore.setView('settings'),
    'new-session': () => { /* TODO: new session */ },
  };

  // Filter commands based on query
  let filteredCommands = $derived.by(() => {
    if (!query.trim()) return commands;
    const results = fuzzysort.go(query, commands, { key: 'label', limit: 10 });
    return results.map(r => r.obj);
  });

  // Filter files based on query
  let filteredFiles = $derived.by(() => {
    if (!query.trim() || cachedFiles.length === 0) return [];
    const results = fuzzysort.go(query, cachedFiles, { limit: 20 });
    return results.map(r => ({
      name: extractFilename(r.target),
      path: r.target,
      score: r.score,
    }));
  });

  // Combined results: files first (if query matches), then commands
  let allResults = $derived.by(() => {
    const items = [];
    if (filteredFiles.length > 0) {
      items.push({ type: 'header', label: 'Files' });
      for (const f of filteredFiles) {
        items.push({ type: 'file', ...f });
      }
    }
    if (filteredCommands.length > 0) {
      items.push({ type: 'header', label: 'Commands' });
      for (const c of filteredCommands) {
        items.push({ type: 'command', ...c });
      }
    }
    return items;
  });

  // Only selectable items (not headers)
  let selectableItems = $derived(allResults.filter(i => i.type !== 'header'));

  function extractFilename(filepath) {
    return filepath.split(/[/\\]/).pop() || filepath;
  }

  function extractDirectory(filepath) {
    const parts = filepath.split(/[/\\]/);
    parts.pop();
    return parts.join('/');
  }

  function close() {
    visible = false;
    query = '';
    selectedIndex = 0;
    onClose();
  }

  function executeItem(item) {
    if (!item) return;
    if (item.type === 'command') {
      const handler = commandHandlers[item.id];
      if (handler) handler();
    } else if (item.type === 'file') {
      tabsStore.openFile({ name: item.name, path: item.path });
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
      const item = selectableItems[selectedIndex];
      if (item) executeItem(item);
      return;
    }
  }

  function scrollSelectedIntoView() {
    // Use tick-like approach: defer to next frame
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

  // Fetch files when palette opens
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

  // Freeze/unfreeze webview when palette opens/closes (WebView2 renders above DOM).
  // freeze() captures a screenshot so the browser area shows a static image instead of going black.
  $effect(() => {
    if (visible) {
      lensStore.freeze();
    } else {
      lensStore.unfreeze();
    }
  });

  // Watch visible: focus input and fetch files
  $effect(() => {
    if (visible) {
      query = '';
      selectedIndex = 0;
      // Focus input after DOM updates
      requestAnimationFrame(() => {
        inputEl?.focus();
      });
      fetchFiles();
    }
  });

  // Reset selected index when query changes
  $effect(() => {
    // Access query to track it
    query;
    selectedIndex = 0;
  });

  // Get the index within allResults for a given selectable index
  function getResultIndex(selectableIdx) {
    const item = selectableItems[selectableIdx];
    if (!item) return -1;
    return allResults.indexOf(item);
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" style="-webkit-app-region: no-drag" onkeydown={handleKeydown}>
      <div class="search-row">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          placeholder="Search files and commands..."
          spellcheck="false"
          autocomplete="off"
        />
      </div>

      <div class="results" bind:this={listEl}>
        {#if allResults.length === 0}
          <div class="empty">
            {#if loadingFiles}
              Loading files...
            {:else if query.trim()}
              No results for "{query}"
            {:else}
              Start typing to search...
            {/if}
          </div>
        {:else}
          {#each allResults as item, i}
            {#if item.type === 'header'}
              <div class="category-header">{item.label}</div>
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
                </div>
                {#if item.hint}
                  <kbd class="item-hint">{item.hint}</kbd>
                {/if}
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
    background: rgba(0, 0, 0, 0.4);
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
    box-shadow: var(--shadow-lg), 0 0 0 1px rgba(255, 255, 255, 0.03);
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
</style>
