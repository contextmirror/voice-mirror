<script>
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { editorGroupsStore } from '../../lib/stores/editor-groups.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { getActionHandler } from '../../lib/stores/shortcuts.svelte.js';
  import { renameEntry } from '../../lib/api.js';
  import TabContextMenu from './TabContextMenu.svelte';

  let { groupId = 1, onBrowserClick = null, showBrowser = false, onDevicePreviewClick = null, showDevicePreview = false } = $props();

  let tabMenu = $state({ visible: false, x: 0, y: 0, tab: null });
  let splitMenu = $state({ visible: false, x: 0, y: 0 });
  let moreMenu = $state({ visible: false, x: 0, y: 0 });
  let dragOverIndex = $state(-1);
  let renamingTabId = $state(null);
  let renameValue = $state('');

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

  function doSplit(direction) {
    const activeTab = activeTabId ? tabsStore.tabs.find(t => t.id === activeTabId) : null;
    const newGroupId = editorGroupsStore.splitGroup(groupId, direction);
    if (activeTab) {
      tabsStore.openFile({ name: activeTab.title, path: activeTab.path }, newGroupId);
    }
  }

  function handleSplitEditor() {
    // Default left-click: split right (horizontal)
    doSplit('horizontal');
  }

  function handleSplitContextMenu(e) {
    e.preventDefault();
    splitMenu = { visible: true, x: e.clientX, y: e.clientY };
  }

  function closeSplitMenu() {
    splitMenu = { visible: false, x: 0, y: 0 };
  }

  function startRename(tab) {
    renamingTabId = tab.id;
    renameValue = tab.title;
  }

  async function commitRename(tab) {
    const newName = renameValue.trim();
    renamingTabId = null;
    if (!newName || newName === tab.title) return;

    const isUntitled = tab.path?.startsWith('untitled:');
    if (isUntitled) {
      // For untitled files, just update the title
      tabsStore.updateTitle(tab.id, newName);
    } else {
      // For real files, rename on disk
      const root = projectStore.activeProject?.path || null;
      const dir = tab.path.substring(0, tab.path.lastIndexOf('/') + 1) || tab.path.substring(0, tab.path.lastIndexOf('\\') + 1);
      const newPath = dir + newName;
      try {
        await renameEntry(tab.path, newPath, root);
        // Update tab path and title
        tabsStore.updateTitle(tab.id, newName);
        // Note: The tab's ID is path-based, so we'd need to reopen.
        // For now, update title visually. File watcher will catch the rest.
      } catch (err) {
        console.error('[GroupTabBar] Rename failed:', err);
      }
    }
  }

  function cancelRename() {
    renamingTabId = null;
  }

  function handleCloseSplit() {
    if (editorGroupsStore.focusedGroupId !== 1) {
      editorGroupsStore.closeGroup(editorGroupsStore.focusedGroupId);
    } else {
      const ids = editorGroupsStore.allGroupIds;
      if (ids.length >= 2) editorGroupsStore.closeGroup(ids[1]);
    }
  }

  // ── More actions menu ──

  function handleMoreMenu(e) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    moreMenu = { visible: true, x: rect.right - 200, y: rect.bottom + 4 };
  }

  function closeMoreMenu() {
    moreMenu = { visible: false, x: 0, y: 0 };
  }

  function handleShowOpenedEditors() {
    closeMoreMenu();
    const handler = getActionHandler('go-to-file');
    if (handler) handler();
  }

  async function handleCloseAll() {
    closeMoreMenu();
    for (const tab of [...groupTabs]) {
      const closed = await tabsStore.requestClose(tab.id);
      if (!closed) break; // User cancelled — stop closing remaining tabs
    }
  }

  function handleCloseSaved() {
    closeMoreMenu();
    for (const tab of [...groupTabs]) {
      if (!tab.dirty) tabsStore.closeTab(tab.id);
    }
  }

  function handleTogglePreview() {
    closeMoreMenu();
    tabsStore.togglePreviewMode?.();
  }

  function handleLockGroup() {
    closeMoreMenu();
    editorGroupsStore.toggleGroupLock?.(groupId);
  }

  let isGroupLocked = $derived(editorGroupsStore.groups.get(groupId)?.locked || false);
  let previewEnabled = $derived(tabsStore.previewEnabled ?? true);

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

  function handleTabsWheel(e) {
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
  }

  // ── Drag/Drop for tab reorder ──

  function handleDragStart(e, tab) {
    e.dataTransfer.effectAllowed = 'move';
    const data = JSON.stringify({ tabId: tab.id, sourceGroupId: groupId });
    e.dataTransfer.setData('text/plain', data);
    e.dataTransfer.setData('application/x-voice-mirror-tab', data);
    window.dispatchEvent(new CustomEvent('tab-drag-start'));
  }

  function handleDragEnd() {
    window.dispatchEvent(new CustomEvent('tab-drag-end'));
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
      const raw = e.dataTransfer.getData('text/plain');
      const data = JSON.parse(raw);

      // File dropped from file tree → open in this group
      if (data?.type === 'file-tree' && data.entry?.path) {
        tabsStore.openFile(data.entry, groupId);
        window.dispatchEvent(new CustomEvent('file-tree-drag-end'));
        return;
      }

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
  <!-- Browser: permanent fixed tab on far left (rendered in first group only) -->
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
  <div class="tabs-scroll" onwheel={handleTabsWheel}>
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
        onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); tabsStore.requestClose(tab.id); } }}
        oncontextmenu={(e) => handleTabContextMenu(e, tab)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTabClick(tab); }}
        ondragstart={(e) => handleDragStart(e, tab)}
        ondragend={handleDragEnd}
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
        {#if renamingTabId === tab.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename-input"
            type="text"
            bind:value={renameValue}
            autofocus
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(tab);
              else if (e.key === 'Escape') cancelRename();
              e.stopPropagation();
            }}
            onblur={() => commitRename(tab)}
          />
        {:else}
          <span class="tab-title">{tab.title}</span>
        {/if}
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
          onclick={(e) => { e.stopPropagation(); tabsStore.requestClose(tab.id); }}
          aria-label="Close tab"
        >
          <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          <svg class="icon-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 7h4l-8 8-1-7H5z"/></svg>
        </button>
      </div>
    {/each}

    <!-- Drop zone / empty area: double-click creates untitled file -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab-empty-area"
      class:drag-over-left={dragOverIndex === groupTabs.length}
      ondragover={(e) => handleDragOver(e, groupTabs.length)}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, groupTabs.length)}
      ondblclick={() => tabsStore.createUntitled(groupId)}
    ></div>
  </div>

  <!-- Right-side action buttons (VS Code style) -->
  <div class="editor-actions">
    {#if onDevicePreviewClick}
      <button class="action-btn" class:active={showDevicePreview} onclick={onDevicePreviewClick} aria-label="Device Preview" title="Device Preview">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      </button>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button class="action-btn" class:active={hasSplit} onclick={handleSplitEditor} oncontextmenu={handleSplitContextMenu} aria-label="Split editor right" title="Split editor right (Ctrl+\) — right-click for more">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>
      </svg>
    </button>

    <button class="action-btn" onclick={handleMoreMenu} aria-label="More actions" title="More actions...">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
      </svg>
    </button>
  </div>
</div>

<TabContextMenu
  x={tabMenu.x}
  y={tabMenu.y}
  tab={tabMenu.tab}
  visible={tabMenu.visible}
  onClose={() => { tabMenu.visible = false; }}
  onRename={(tab) => startRename(tab)}
/>

<!-- Split editor context menu -->
{#if splitMenu.visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="split-menu-backdrop" onclick={closeSplitMenu} oncontextmenu={(e) => { e.preventDefault(); closeSplitMenu(); }}></div>
  <div class="split-menu" style="left: {splitMenu.x}px; top: {splitMenu.y}px;">
    <button class="split-menu-item" onclick={() => { doSplit('horizontal'); closeSplitMenu(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>
      </svg>
      <span>Split Right</span>
      <span class="split-menu-shortcut">Ctrl+\</span>
    </button>
    <button class="split-menu-item" onclick={() => { doSplit('vertical'); closeSplitMenu(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/>
      </svg>
      <span>Split Down</span>
    </button>
    {#if hasSplit}
      <div class="split-menu-divider"></div>
      <button class="split-menu-item split-menu-item-danger" onclick={() => { handleCloseSplit(); closeSplitMenu(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
        <span>Close Split</span>
      </button>
    {/if}
  </div>
{/if}

<!-- More actions menu -->
{#if moreMenu.visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="split-menu-backdrop" onclick={closeMoreMenu} oncontextmenu={(e) => { e.preventDefault(); closeMoreMenu(); }}></div>
  <div class="split-menu" style="left: {moreMenu.x}px; top: {moreMenu.y}px;">
    <button class="split-menu-item" onclick={handleShowOpenedEditors}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <span>Show Opened Editors</span>
    </button>
    <div class="split-menu-divider"></div>
    <button class="split-menu-item" onclick={handleCloseAll}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
      <span>Close All</span>
      <span class="split-menu-shortcut">Ctrl+K W</span>
    </button>
    <button class="split-menu-item" onclick={handleCloseSaved}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
      <span>Close Saved</span>
      <span class="split-menu-shortcut">Ctrl+K U</span>
    </button>
    <div class="split-menu-divider"></div>
    <button class="split-menu-item" onclick={handleTogglePreview}>
      {#if previewEnabled}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      {:else}
        <span class="menu-icon-spacer"></span>
      {/if}
      <span>Enable Preview Editors</span>
    </button>
    <button class="split-menu-item" onclick={handleLockGroup}>
      {#if isGroupLocked}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      {:else}
        <span class="menu-icon-spacer"></span>
      {/if}
      <span>Lock Group</span>
    </button>
  </div>
{/if}

<style>
  .group-tab-bar {
    display: flex;
    align-items: center;
    height: 36px;
    flex-shrink: 0;
    background: var(--bg);
    border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, var(--bg));
    -webkit-app-region: no-drag;
  }

  .group-tab-bar.focused {
    border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, var(--bg));
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
  .tab-empty-area.drag-over-left::before {
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

  .tab-empty-area {
    position: relative;
    flex: 1;
    min-width: 20px;
    height: 100%;
    cursor: default;
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

  .tab-rename-input {
    width: 100px;
    height: 18px;
    padding: 0 4px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text-strong);
    font-size: 12px;
    font-family: var(--font-family);
    outline: none;
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

  /* ── Split context menu ── */
  .split-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
  }

  .split-menu {
    position: fixed;
    z-index: 10001;
    min-width: 180px;
    background: var(--bg-elevated, var(--bg));
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font-family: var(--font-family);
    font-size: 12px;
  }

  .split-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--font-family);
    text-align: left;
    transition: background 0.1s ease;
  }

  .split-menu-item:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .split-menu-item-danger:hover {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
    color: var(--danger);
  }

  .split-menu-shortcut {
    margin-left: auto;
    color: var(--muted);
    font-size: 11px;
  }

  .split-menu-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 6px;
  }

  .menu-icon-spacer {
    display: inline-block;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
</style>
