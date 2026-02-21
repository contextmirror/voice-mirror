<script>
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { chatLoad, chatSave, chatDelete, chatRename } from '../../lib/api.js';
  import { uid } from '../../lib/utils.js';

  let activeProject = $derived(projectStore.activeProject);
  let sessions = $derived(projectStore.sessions);

  /** Auto-save tracking */
  let lastSavedMessageCount = 0;
  let saveTimeout = null;

  /**
   * Auto-save: persist messages to disk when they change.
   * Debounced 500ms — same pattern as ChatList.
   */
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

  /**
   * Auto-title: when first user message arrives in a "New Session",
   * generate a title from the message text.
   */
  $effect(() => {
    const activeId = chatStore.activeChatId;
    const msgs = chatStore.messages;
    if (!activeId || msgs.length === 0) return;

    const session = sessions.find((s) => s.id === activeId);
    if (!session || session.name !== 'New Session') return;

    const firstUserMsg = msgs.find((m) => m.role === 'user');
    if (!firstUserMsg) return;

    const title = generateTitle(firstUserMsg.text);
    if (title) {
      chatRename(activeId, title)
        .then(() => projectStore.loadSessions())
        .catch((err) => console.error('[SessionPanel] Auto-title failed:', err));
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

    const session = sessions.find((s) => s.id === activeId);
    if (!session) return;

    const toSave = {
      id: activeId,
      name: session.name || 'New Session',
      createdAt: session.createdAt || Date.now(),
      updatedAt: Date.now(),
      projectPath: activeProject?.path || null,
      // TODO: terminalSessionId — link to terminal instance for replay
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
      console.error('[SessionPanel] Auto-save failed:', err);
    }
  }

  /** Context menu state */
  let contextMenu = $state({ visible: false, x: 0, y: 0, sessionId: null });

  /** Inline rename state */
  let renamingId = $state(null);
  let renameValue = $state('');

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
    const session = sessions.find((s) => s.id === id);
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
      projectStore.loadSessions();
    } catch (err) {
      console.error('[SessionPanel] Failed to rename session:', err);
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
      projectStore.loadSessions();
    } catch (err) {
      console.error('[SessionPanel] Failed to delete session:', err);
    }
  }

  function handleDocumentClick() {
    if (contextMenu.visible) hideContextMenu();
  }

  function handleDocumentKeydown(e) {
    if (e.key === 'Escape' && contextMenu.visible) hideContextMenu();
  }

  /**
   * Format relative time from a timestamp.
   * @param {number} ts - Unix ms timestamp
   * @returns {string}
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

  async function handleLoadSession(id) {
    // Don't reload the already-active session
    if (id === chatStore.activeChatId) return;

    try {
      // Save current session before switching
      if (chatStore.activeChatId && chatStore.messages.length > 0) {
        await saveActiveSession();
      }

      const result = await chatLoad(id);
      const chat = result?.success !== false ? (result?.data || result) : null;
      if (!chat) return;

      chatStore.setActiveChatId(chat.id);
      chatStore.clearMessages();
      lastSavedMessageCount = 0;

      if (chat.messages && chat.messages.length > 0) {
        for (const msg of chat.messages) {
          chatStore.addMessage(msg.role, msg.content || msg.text, msg.metadata || {});
        }
        lastSavedMessageCount = chat.messages.length;
      }

      // Stay in Lens mode — the LensWorkspace chat panel picks up the active chat
      projectStore.loadSessions();
    } catch (err) {
      console.error('[SessionPanel] Failed to load session:', err);
    }
  }

  async function handleNewSession() {
    if (!activeProject) return;

    // Save current session before creating a new one
    if (chatStore.activeChatId && chatStore.messages.length > 0) {
      await saveActiveSession();
    }

    const id = uid();
    const now = Date.now();
    const chat = {
      id,
      name: 'New Session',
      messages: [],
      createdAt: now,
      updatedAt: now,
      projectPath: activeProject.path,
      // TODO: terminalSessionId — allocate terminal instance for this session
    };

    try {
      await chatSave(chat);
      chatStore.setActiveChatId(id);
      chatStore.clearMessages();
      lastSavedMessageCount = 0;
      // Stay in Lens mode — reload sessions to show the new one
      projectStore.loadSessions();
    } catch (err) {
      console.error('[SessionPanel] Failed to create session:', err);
    }
  }
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<div class="session-panel">
  <div class="session-header">
    {activeProject?.name || 'No Project'}
  </div>

  <div class="session-list">
    {#each sessions as session (session.id)}
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
          onclick={() => handleLoadSession(session.id)}
          ondblclick={() => { renameValue = session.name || ''; renamingId = session.id; }}
          oncontextmenu={(e) => handleContextMenu(e, session.id)}
          title={session.name || 'Untitled'}
        >
          <span class="session-name">{session.name || 'Untitled'}</span>
          <span class="session-time">{formatRelativeTime(session.updatedAt)}</span>
        </button>
      {/if}
    {:else}
      <div class="session-empty">No sessions yet</div>
    {/each}
  </div>

  <button
    class="new-session-btn"
    onclick={handleNewSession}
    disabled={!activeProject}
  >
    + New Session
  </button>
</div>

{#if contextMenu.visible}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    role="menu"
  >
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

<style>
  .session-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 8px;
    min-height: 0;
  }

  .session-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
    padding: 4px 8px 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    background: transparent;
    border: none;
    font-family: var(--font-family);
    text-align: left;
    width: 100%;
    transition: all var(--duration-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .session-item:hover {
    background: var(--bg-hover);
  }

  .session-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .session-name {
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
    padding: 5px 10px;
  }

  .session-empty {
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    padding: 24px 8px;
  }

  .new-session-btn {
    flex-shrink: 0;
    padding: 8px 12px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    margin-top: 4px;
  }

  .new-session-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-hover);
  }

  .new-session-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ========== Context Menu ========== */
  .context-menu {
    position: fixed;
    z-index: 10000;
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
  }

  @media (prefers-reduced-motion: reduce) {
    .session-item,
    .new-session-btn,
    .context-menu-item {
      transition: none;
    }
  }
</style>
