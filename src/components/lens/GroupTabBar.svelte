<script>
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import TabContextMenu from './TabContextMenu.svelte';

  let { groupId = 1, onBrowserClick = null, showBrowser = false } = $props();

  let tabMenu = $state({ visible: false, x: 0, y: 0, tab: null });
  let dragOverIndex = $state(-1);

  let groupTabs = $derived(tabsStore.getTabsForGroup ? tabsStore.getTabsForGroup(groupId) : tabsStore.tabs.filter(t => (t.groupId || 1) === groupId));
  let activeTabId = $derived(editorGroupsStore.groups.get(groupId)?.activeTabId);
  let isFocused = $derived(editorGroupsStore.focusedGroupId === groupId);
  let hasSplit = $derived(editorGroupsStore.hasSplit);

  function handleTabContextMenu(event, tab) {
    event.preventDefault();
    tabMenu = { visible: true, x: event.clientX, y: event.clientY, tab };
  }

  function handleTabClick(tab) {
    tabsStore.setActive(tab.id);
    editorGroupsStore.setFocusedGroup(groupId);
    // Clicking a file tab should dismiss the browser overlay
    if (onBrowserClick && showBrowser) onBrowserClick();
  }

  async function handleAddFile() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ multiple: true, title: 'Open File' });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        const name = filePath.split(/[/\\]/).pop() || filePath;
        tabsStore.openFile({ name, path: filePath }, groupId);
        tabsStore.pinTab(filePath);
      }
    } catch (err) {
      console.error('[GroupTabBar] File picker failed:', err);
    }
  }

  function handleSplitEditor() {
    if (editorGroupsStore.hasSplit) {
      // Close the focused group (if not group 1, close focused; otherwise close the other)
      if (editorGroupsStore.focusedGroupId !== 1) {
        editorGroupsStore.closeGroup(editorGroupsStore.focusedGroupId);
      } else {
        const ids = editorGroupsStore.allGroupIds;
        if (ids.length >= 2) editorGroupsStore.closeGroup(ids[1]);
      }
    } else {
      const activeTab = activeTabId ? tabsStore.tabs.find(t => t.id === activeTabId) : null;
      const newGroupId = editorGroupsStore.splitGroup(groupId, 'horizontal');
      if (activeTab) {
        tabsStore.openFile({ name: activeTab.title, path: activeTab.path }, newGroupId);
      }
    }
  }

  function getTabIcon(tab) {
    if (tab.type === 'diff') return 'diff';
    const ext = tab.title?.split('.').pop()?.toLowerCase() || '';
    if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) return 'code';
    if (['rs'].includes(ext)) return 'code';
    if (['css', 'scss', 'less'].includes(ext)) return 'palette';
    if (['html', 'svelte', 'vue'].includes(ext)) return 'code';
    if (['json', 'toml', 'yaml', 'yml'].includes(ext)) return 'settings';
    if (['md', 'txt', 'log'].includes(ext)) return 'doc';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
    return 'file';
  }

  // ── Drag/Drop for tab reorder ──

  function handleDragStart(e, tab) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ tabId: tab.id, sourceGroupId: groupId }));
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverIndex = index;
  }

  function handleDragLeave() {
    dragOverIndex = -1;
  }

  function handleDrop(e, index) {
    e.preventDefault();
    dragOverIndex = -1;

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (!data?.tabId) return;

      if (data.sourceGroupId === groupId) {
        // Reorder within same group
        if (tabsStore.reorderTab) {
          tabsStore.reorderTab(data.tabId, index);
        }
      } else {
        // Move from another group
        if (tabsStore.moveTab) {
          tabsStore.moveTab(data.tabId, groupId, index);
        }
      }
    } catch {
      // Invalid drag data
    }
  }
</script>

<div class="group-tab-bar" class:focused={isFocused}>
  <!-- Browser: permanent fixed tab on far left -->
  {#if onBrowserClick}
    <button class="browser-tab" class:active={showBrowser} onclick={onBrowserClick}>
      <svg class="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span>Browser</span>
    </button>
    <div class="tab-separator"></div>
  {/if}

  <!-- Scrollable file tabs -->
  <div class="tabs-scroll">
    {#each groupTabs as tab, i (tab.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:active={tab.id === activeTabId && !showBrowser}
        class:preview={tab.preview}
        class:dirty={tab.dirty}
        class:drag-over-left={dragOverIndex === i}
        role="tab"
        tabindex="0"
        aria-selected={tab.id === activeTabId}
        draggable="true"
        onclick={() => handleTabClick(tab)}
        ondblclick={() => tabsStore.pinTab(tab.id)}
        oncontextmenu={(e) => handleTabContextMenu(e, tab)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTabClick(tab); }}
        ondragstart={(e) => handleDragStart(e, tab)}
        ondragover={(e) => handleDragOver(e, i)}
        ondragleave={handleDragLeave}
        ondrop={(e) => handleDrop(e, i)}
        title={tab.path || tab.title}
      >
        <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {#if getTabIcon(tab) === 'diff'}
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>
          {:else}
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          {/if}
        </svg>
        <span class="tab-title">{tab.title}</span>
        {#if tab.readOnly}
          <svg class="tab-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10" aria-label="Read-only">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        {/if}
        {#if tab.type === 'diff' && tab.diffStats}
          <span class="tab-diff-stats">
            <span class="tab-diff-stats-add">+{tab.diffStats.additions}</span>
            <span class="tab-diff-stats-del">-{tab.diffStats.deletions}</span>
          </span>
        {:else if tab.type === 'diff' && tab.status}
          <span
            class="tab-diff-badge"
            class:added={tab.status === 'added'}
            class:modified={tab.status === 'modified'}
            class:deleted={tab.status === 'deleted'}
          >{tab.status === 'added' ? 'A' : tab.status === 'deleted' ? 'D' : 'M'}</span>
        {/if}
        {#if tab.dirty}
          <span class="dirty-dot"></span>
        {/if}
        <button
          class="tab-action"
          class:pinned={!tab.preview}
          onclick={(e) => { e.stopPropagation(); tabsStore.closeTab(tab.id); }}
          aria-label="Close tab"
        >
          <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          <svg class="icon-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 7h4l-8 8-1-7H5z"/></svg>
        </button>
      </div>
    {/each}

    <!-- Drop zone at end of tab list -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab-drop-end"
      class:drag-over-left={dragOverIndex === groupTabs.length}
      ondragover={(e) => handleDragOver(e, groupTabs.length)}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, groupTabs.length)}
    ></div>

    <button class="tab-add" onclick={handleAddFile} aria-label="Open file" title="Open file">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </div>

  <!-- Right-side action buttons (VS Code style) -->
  <div class="editor-actions">
    <button class="action-btn" class:active={hasSplit} onclick={handleSplitEditor} aria-label={hasSplit ? 'Close split' : 'Split editor right'} title={hasSplit ? 'Close split (Ctrl+\\)' : 'Split editor right (Ctrl+\\)'}>
      {#if hasSplit}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
      {/if}
    </button>

    {#if groupTabs.length > 1}
      <button class="action-btn action-btn-danger" onclick={() => {
        for (const tab of [...groupTabs]) tabsStore.closeTab(tab.id);
      }} aria-label="Close all tabs" title="Close all tabs">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    {/if}
  </div>
</div>

<TabContextMenu
  x={tabMenu.x}
  y={tabMenu.y}
  tab={tabMenu.tab}
  visible={tabMenu.visible}
  onClose={() => { tabMenu.visible = false; }}
/>

<style>
  .group-tab-bar {
    display: flex;
    align-items: center;
    height: 36px;
    flex-shrink: 0;
    background: var(--bg);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    -webkit-app-region: no-drag;
  }

  .group-tab-bar.focused {
    border-bottom: 1px solid var(--accent);
  }

  /* Browser: permanent fixed tab on the far left */
  .browser-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 26px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    font-family: var(--font-family);
    -webkit-app-region: no-drag;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 8px;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .browser-tab:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .browser-tab.active {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--text) 12%, transparent);
    font-weight: 500;
  }

  .tab-separator {
    width: 1px;
    height: 16px;
    background: var(--border);
    flex-shrink: 0;
    margin: 0 2px;
  }

  /* Scrollable tabs area (flex: 1 — takes all available space) */
  .tabs-scroll {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 2px;
    padding: 0 8px;
    height: 100%;
  }

  .tabs-scroll::-webkit-scrollbar {
    height: 2px;
  }
  .tabs-scroll::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 1px;
  }

  /* Right-side action buttons (VS Code style — fixed, never scroll) */
  .editor-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 2px;
    padding: 0 8px 0 4px;
    height: 100%;
    border-left: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .action-btn:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .action-btn.active {
    color: var(--accent);
  }

  .action-btn-danger:hover {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .tab:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .tab.active {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--text) 12%, transparent);
    font-weight: 500;
  }

  .tab.preview .tab-title {
    font-style: italic;
  }

  /* Drag indicator: thin vertical line on left edge */
  .tab.drag-over-left::before,
  .tab-drop-end.drag-over-left::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 4px;
    bottom: 4px;
    width: 2px;
    background: var(--accent);
    border-radius: 1px;
    z-index: 1;
  }

  .tab-drop-end {
    position: relative;
    width: 4px;
    height: 26px;
    flex-shrink: 0;
  }

  .tab-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .tab-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    transition: opacity 0.1s;
  }

  .tab-action svg {
    width: 12px;
    height: 12px;
  }

  /* Preview tabs: hide action button, show X on hover */
  .tab-action:not(.pinned) {
    opacity: 0;
  }
  .tab-action:not(.pinned) .icon-pin { display: none; }
  .tab:hover .tab-action:not(.pinned) { opacity: 1; }

  /* Pinned tabs: show pin, swap to X on hover */
  .tab-action.pinned { opacity: 1; color: var(--accent); }
  .tab-action.pinned .icon-close { display: none; }
  .tab-action.pinned .icon-pin { display: block; }
  .tab:hover .tab-action.pinned .icon-pin { display: none; }
  .tab:hover .tab-action.pinned .icon-close { display: block; }
  .tab:hover .tab-action.pinned { opacity: 1; }

  .tab-action:hover {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }

  .tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 2px;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .tab-add:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .tab-lock {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .tab-diff-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    font-size: 9px;
    font-weight: 700;
    border-radius: 2px;
    flex-shrink: 0;
    color: var(--bg);
  }
  .tab-diff-badge.added { background: var(--ok); }
  .tab-diff-badge.modified { background: var(--accent); }
  .tab-diff-badge.deleted { background: var(--danger); }

  .tab-diff-stats {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .tab-diff-stats-add { color: var(--ok); }
  .tab-diff-stats-del { color: var(--danger); }
</style>
