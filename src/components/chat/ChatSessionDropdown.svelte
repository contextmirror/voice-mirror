<script>
  import { tick } from 'svelte';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { chatList, chatLoad, chatSave, chatDelete, chatRename } from '../../lib/api.js';
  import { uid } from '../../lib/utils.js';

  /** Dropdown open state */
  let open = $state(false);
  let searchQuery = $state('');

  /** Context menu state */
  let contextMenu = $state({ visible: false, x: 0, y: 0, sessionId: null });

  /** Inline rename state */
  let renamingId = $state(null);
  let renameValue = $state('');

  /** DOM refs */
  let dropdownEl = $state(null);
  let panelEl = $state(null);

  /** Keyboard navigation */
  let selectedIndex = $state(-1);

  /** Mirror-mode chat list (loaded from backend) */
  let mirrorChats = $state([]);

  /** Auto-save tracking */
  let lastSavedMessageCount = 0;
  let saveTimeout = null;

  /** Mode detection */
  let isLensMode = $derived(navigationStore.appMode === 'lens');

  /**
   * Unified sessions list — Lens uses projectStore.sessions,
   * Mirror uses locally-loaded chats filtered to exclude project-scoped ones.
   */
  let allSessions = $derived(isLensMode ? projectStore.sessions : mirrorChats);

  /**
   * Load Mirror-mode chats on mount.
   * Filters out chats that have a projectPath (those belong to Lens mode).
   */
  $effect(() => {
    if (!isLensMode) {
      loadMirrorChats();
    }
  });

  async function loadMirrorChats() {
    try {
      const result = await chatList();
      const data = result?.data || result || [];
      mirrorChats = Array.isArray(data)
        ? data.filter((c) => !c.projectPath).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        : [];
    } catch (err) {
      console.error('[ChatSessionDropdown] Failed to load chats:', err);
      mirrorChats = [];
    }
  }

  /**
   * Group sessions by date (Today, Yesterday, This Week, Older).
   */
  function groupByDate(sessions) {
    const now = Date.now();
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday - 86400000;
    const weekAgo = now - 7 * 86400000;
    const groups = { today: [], yesterday: [], week: [], older: [] };
    for (const s of sessions) {
      const t = s.updatedAt || s.createdAt;
      if (t >= startOfToday) groups.today.push(s);
      else if (t >= startOfYesterday) groups.yesterday.push(s);
      else if (t >= weekAgo) groups.week.push(s);
      else groups.older.push(s);
    }
    for (const g of Object.values(groups)) g.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const result = [];
    if (groups.today.length) result.push({ label: 'Today', sessions: groups.today });
    if (groups.yesterday.length) result.push({ label: 'Yesterday', sessions: groups.yesterday });
    if (groups.week.length) result.push({ label: 'This Week', sessions: groups.week });
    if (groups.older.length) result.push({ label: 'Older', sessions: groups.older });
    return result;
  }

  /** Search filter + date grouping */
  let filteredGroups = $derived.by(() => {
    let list = allSessions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => (s.name || '').toLowerCase().includes(q));
    }
    return groupByDate(list);
  });

  /** Flat list of filtered sessions for keyboard navigation */
  let flatSessions = $derived.by(() => {
    const flat = [];
    for (const group of filteredGroups) {
      for (const session of group.sessions) {
        flat.push(session);
      }
    }
    return flat;
  });

  // ── Auto-save (500ms debounce on message count change) ──

  $effect(() => {
    const msgCount = chatStore.messages.length;
    const activeId = chatStore.activeChatId;
    if (!activeId) return;
    if (msgCount === lastSavedMessageCount) return;

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveActiveSession();
      lastSavedMessageCount = msgCount;
    }, 500);
  });

  // ── Auto-title (rename "New Session"/"New Chat" on first user message) ──

  $effect(() => {
    const activeId = chatStore.activeChatId;
    const msgs = chatStore.messages;
    if (!activeId || msgs.length === 0) return;

    const session = allSessions.find((s) => s.id === activeId);
    if (!session || (session.name !== 'New Session' && session.name !== 'New Chat')) return;

    const firstUserMsg = msgs.find((m) => m.role === 'user');
    if (!firstUserMsg) return;

    const title = generateTitle(firstUserMsg.text);
    if (title) {
      chatRename(activeId, title)
        .then(() => reloadSessions())
        .catch((err) => console.error('[ChatSessionDropdown] Auto-title failed:', err));
    }
  });

  /**
   * Generate a short title from message text.
   * Takes first ~50 characters, trims at word boundary.
   */
  function generateTitle(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    if (cleaned.length <= 50) return cleaned;
    const cut = cleaned.slice(0, 50);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '...';
  }

  /**
   * Save the current messages to the active session file.
   */
  async function saveActiveSession() {
    const activeId = chatStore.activeChatId;
    if (!activeId) return;

    const session = allSessions.find((s) => s.id === activeId);
    if (!session) return;

    const toSave = {
      id: activeId,
      name: session.name || (isLensMode ? 'New Session' : 'New Chat'),
      createdAt: session.createdAt || Date.now(),
      updatedAt: Date.now(),
      projectPath: isLensMode ? (projectStore.activeProject?.path || null) : undefined,
      messages: chatStore.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.text,
        timestamp: m.timestamp,
      })),
    };

    try {
      await chatSave(toSave);
    } catch (err) {
      console.error('[ChatSessionDropdown] Auto-save failed:', err);
    }
  }

  /**
   * Format relative time from a timestamp.
   */
  function formatRelativeTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const then = typeof ts === 'number' ? ts : new Date(ts).getTime();
    const diffMs = now - then;
    if (isNaN(diffMs) || diffMs < 0) return '';

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days === 1) return '1d';
    if (days < 7) return `${days}d`;

    return new Date(then).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  }

  /** Reload sessions for the current mode */
  function reloadSessions() {
    if (isLensMode) {
      projectStore.loadSessions();
    } else {
      loadMirrorChats();
    }
  }

  /**
   * Load a session by id. Save current first, then switch.
   */
  async function handleLoadSession(id) {
    if (id === chatStore.activeChatId) return;

    try {
      // Suppress fly transitions during session switch
      chatStore.setSwitching(true);

      // Save current session before switching
      if (chatStore.activeChatId && chatStore.messages.length > 0) {
        await saveActiveSession();
      }

      const result = await chatLoad(id);
      const chat = result?.success !== false ? (result?.data || result) : null;
      if (!chat) {
        chatStore.setSwitching(false);
        return;
      }

      // Build all messages at once to avoid flash of old content
      const loaded = (chat.messages || []).map((msg) => ({
        id: msg.id || uid(),
        role: msg.role,
        text: msg.content || msg.text,
        timestamp: msg.timestamp || Date.now(),
        streaming: false,
        toolCalls: msg.metadata?.toolCalls || [],
        attachments: msg.metadata?.attachments || [],
        metadata: msg.metadata || {},
      }));

      // Set messages BEFORE activeChatId so DOM updates atomically
      chatStore.setMessages(loaded);
      chatStore.setActiveChatId(chat.id);
      lastSavedMessageCount = loaded.length;

      reloadSessions();

      // Re-enable transitions after DOM has settled
      tick().then(() => { chatStore.setSwitching(false); });
    } catch (err) {
      chatStore.setSwitching(false);
      console.error('[ChatSessionDropdown] Failed to load session:', err);
    }
  }

  /**
   * Create a new session.
   */
  async function handleNewSession() {
    // Save current session before creating a new one
    if (chatStore.activeChatId && chatStore.messages.length > 0) {
      await saveActiveSession();
    }

    const id = uid();
    const now = Date.now();
    const chat = {
      id,
      name: isLensMode ? 'New Session' : 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    // Add projectPath for Lens mode
    if (isLensMode && projectStore.activeProject) {
      chat.projectPath = projectStore.activeProject.path;
    }

    try {
      await chatSave(chat);
      chatStore.setActiveChatId(id);
      chatStore.clearMessages();
      lastSavedMessageCount = 0;
      reloadSessions();
    } catch (err) {
      console.error('[ChatSessionDropdown] Failed to create session:', err);
    }
  }

  // ── Context menu handlers ──

  function handleContextMenu(event, id) {
    event.preventDefault();
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, sessionId: id };
  }

  function hideContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, sessionId: null };
  }

  function startRename() {
    const id = contextMenu.sessionId;
    hideContextMenu();
    if (!id) return;
    const session = allSessions.find((s) => s.id === id);
    renameValue = session?.name || '';
    renamingId = id;
  }

  async function commitRename() {
    const id = renamingId;
    const name = renameValue.trim();
    renamingId = null;
    if (!id || !name) return;

    try {
      await chatRename(id, name);
      reloadSessions();
    } catch (err) {
      console.error('[ChatSessionDropdown] Failed to rename session:', err);
    }
  }

  function cancelRename() {
    renamingId = null;
    renameValue = '';
  }

  function handleRenameKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  }

  async function handleDeleteSession() {
    const id = contextMenu.sessionId;
    hideContextMenu();
    if (!id) return;

    try {
      await chatDelete(id);
      // If we deleted the active session, clear it
      if (chatStore.activeChatId === id) {
        chatStore.setActiveChatId(null);
        chatStore.clearMessages();
      }
      reloadSessions();
    } catch (err) {
      console.error('[ChatSessionDropdown] Failed to delete session:', err);
    }
  }

  // ── Dropdown controls ──

  function toggle() {
    open = !open;
    if (open) {
      selectedIndex = -1;
      searchQuery = '';
      reloadSessions();
    }
  }

  function close() {
    open = false;
    searchQuery = '';
    selectedIndex = -1;
  }

  /** Click-outside handler (pattern from StatusDropdown) */
  function handleWindowClick(e) {
    // Close context menu on any click
    if (contextMenu.visible) hideContextMenu();

    if (!open) return;
    if (!e.target.isConnected) return; // target removed by reactive DOM update
    if (dropdownEl?.contains(e.target)) return;
    close();
  }

  /** Keyboard handler */
  function handleWindowKeydown(e) {
    if (e.key === 'Escape') {
      if (contextMenu.visible) {
        hideContextMenu();
      } else if (open) {
        close();
      }
      return;
    }

    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatSessions.length > 0) {
        selectedIndex = (selectedIndex + 1) % flatSessions.length;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatSessions.length > 0) {
        selectedIndex = selectedIndex <= 0 ? flatSessions.length - 1 : selectedIndex - 1;
      }
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < flatSessions.length) {
      e.preventDefault();
      handleLoadSession(flatSessions[selectedIndex].id);
      close();
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="session-dropdown" bind:this={dropdownEl}>
  <!-- Always-visible trigger bar -->
  <div class="dropdown-header">
    <button class="dropdown-trigger" onclick={toggle}>
      <span>Past Conversations</span>
      <svg class="chevron" class:open viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button class="new-session-btn" onclick={handleNewSession} title="New conversation">
      <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </div>

  {#if open}
    <div class="dropdown-panel" bind:this={panelEl}>
      <div class="search-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" type="text" placeholder="Search sessions..." bind:value={searchQuery} />
      </div>
      <div class="session-list">
        {#each filteredGroups as group}
          <div class="date-separator">{group.label}</div>
          {#each group.sessions as session, i}
            {#if renamingId === session.id}
              <div class="session-item renaming">
                <input
                  class="rename-input"
                  type="text"
                  bind:value={renameValue}
                  onkeydown={handleRenameKeydown}
                  onblur={commitRename}
                  autofocus
                />
              </div>
            {:else}
              <button
                class="session-item"
                class:active={session.id === chatStore.activeChatId}
                class:selected={flatSessions[selectedIndex]?.id === session.id}
                onclick={() => { handleLoadSession(session.id); close(); }}
                oncontextmenu={(e) => handleContextMenu(e, session.id)}
                title={session.name || 'Untitled'}
              >
                <span class="session-title">{session.name || 'Untitled'}</span>
                <span class="session-time">{formatRelativeTime(session.updatedAt)}</span>
              </button>
            {/if}
          {/each}
        {:else}
          <div class="session-empty">{searchQuery ? 'No matching sessions' : 'No sessions yet'}</div>
        {/each}
      </div>
    </div>
  {/if}

  {#if contextMenu.visible}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;" role="menu">
      <button class="context-menu-item" onclick={startRename} role="menuitem">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Rename
      </button>
      <button class="context-menu-item danger" onclick={handleDeleteSession} role="menuitem">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        Delete
      </button>
    </div>
  {/if}
</div>

<style>
  .session-dropdown {
    position: relative;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .dropdown-header {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    gap: 4px;
  }

  .dropdown-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-strong);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-family);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease-out);
  }

  .dropdown-trigger:hover {
    background: var(--bg-hover);
  }

  .chevron {
    width: 14px;
    height: 14px;
    transition: transform var(--duration-fast) var(--ease-out);
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .new-session-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all var(--duration-fast) var(--ease-out);
  }

  .new-session-btn:hover {
    color: var(--accent);
    background: var(--bg-hover);
  }

  .new-session-btn svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
  }

  .dropdown-panel {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 10002;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--border);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search-wrapper {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    gap: 8px;
  }

  .search-icon {
    width: 14px;
    height: 14px;
    color: var(--muted);
    flex-shrink: 0;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--muted);
  }

  .session-list {
    overflow-y: auto;
    padding: 4px 0;
    max-height: calc(60vh - 50px);
  }

  .session-list::-webkit-scrollbar {
    width: 6px;
  }

  .session-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .session-list::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--text) 20%, transparent);
    border-radius: 3px;
  }

  .date-separator {
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    background: transparent;
    border: none;
    font-family: var(--font-family);
    text-align: left;
    width: 100%;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .session-item:hover {
    background: var(--bg-hover);
  }

  .session-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .session-item.selected {
    background: var(--bg-hover);
  }

  .session-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-time {
    color: var(--muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .session-empty {
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    padding: 24px 12px;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    padding: 2px 6px;
    outline: none;
  }

  .session-item.renaming {
    padding: 4px 12px;
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    z-index: 10003;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px 0;
    min-width: 120px;
    box-shadow: var(--shadow-md);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .context-menu-item:hover {
    background: var(--bg-hover);
  }

  .context-menu-item.danger:hover {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  .context-menu-item svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
  }

  @media (prefers-reduced-motion: reduce) {
    .dropdown-trigger, .new-session-btn, .session-item, .chevron, .context-menu-item {
      transition: none;
    }
  }
</style>
