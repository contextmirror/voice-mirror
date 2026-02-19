<script>
  import { chatList, chatLoad, chatSave, chatDelete, chatRename } from '../../lib/api.js';
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { uid } from '../../lib/utils.js';

  /** Chat entries from backend */
  let chats = $state([]);
  let activeChatId = $state(null);
  let loading = $state(false);

  /** Context menu state */
  let contextMenu = $state({ visible: false, x: 0, y: 0, chatId: null });

  /** Inline rename state */
  let renamingId = $state(null);
  let renameValue = $state('');

  /**
   * Load the chat list from the backend.
   */
  async function loadChats() {
    loading = true;
    try {
      const result = await chatList();
      const data = result?.data || result || [];
      // Sort by most recent
      chats = Array.isArray(data)
        ? data.sort((a, b) => new Date(b.updated) - new Date(a.updated))
        : [];
    } catch (err) {
      console.error('[ChatList] Failed to load chats:', err);
      chats = [];
    } finally {
      loading = false;
    }
  }

  /** Load on mount */
  $effect(() => {
    loadChats();
  });

  /**
   * Create a new chat.
   */
  async function handleNewChat() {
    const id = uid();
    const now = new Date().toISOString();
    const chat = {
      id,
      name: 'New Chat',
      created: now,
      updated: now,
      messages: [],
    };

    try {
      await chatSave(chat);
      activeChatId = id;
      chatStore.clearMessages();
      await loadChats();
    } catch (err) {
      console.error('[ChatList] Failed to create chat:', err);
    }
  }

  /**
   * Switch to a chat by id.
   */
  async function handleSelectChat(id) {
    if (id === activeChatId) return;

    try {
      const result = await chatLoad(id);
      const chat = result?.success !== false ? (result?.data || result) : null;
      if (!chat) return;

      activeChatId = chat.id;
      chatStore.clearMessages();

      if (chat.messages && chat.messages.length > 0) {
        for (const msg of chat.messages) {
          chatStore.addMessage(msg.role, msg.text, msg.metadata || {});
        }
      }
    } catch (err) {
      console.error('[ChatList] Failed to load chat:', err);
    }
  }

  /**
   * Delete a chat by id.
   */
  async function handleDeleteChat(id) {
    try {
      await chatDelete(id);

      if (id === activeChatId) {
        activeChatId = null;
        chatStore.clearMessages();
      }

      await loadChats();

      // If current chat was deleted and others exist, switch to first
      if (id === activeChatId || activeChatId === null) {
        if (chats.length > 0) {
          await handleSelectChat(chats[0].id);
        }
      }
    } catch (err) {
      console.error('[ChatList] Failed to delete chat:', err);
    }
  }

  /**
   * Show context menu on right-click.
   */
  function handleContextMenu(event, chatId) {
    event.preventDefault();
    contextMenu = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      chatId,
    };
  }

  /**
   * Hide context menu.
   */
  function hideContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, chatId: null };
  }

  /**
   * Start inline rename.
   */
  function startRename(chatId) {
    hideContextMenu();
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    renamingId = chatId;
    renameValue = chat.name || '';
  }

  /**
   * Commit inline rename.
   */
  async function commitRename() {
    if (renamingId === null) return;
    const newName = renameValue.trim();
    const id = renamingId;
    renamingId = null;

    if (newName && newName !== '') {
      try {
        await chatRename(id, newName);
        await loadChats();
      } catch (err) {
        console.error('[ChatList] Rename failed:', err);
      }
    }
  }

  /**
   * Cancel inline rename.
   */
  function cancelRename() {
    renamingId = null;
    renameValue = '';
  }

  /**
   * Handle rename input keydown.
   */
  function handleRenameKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }

  /**
   * Format relative time from ISO date string.
   */
  function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const now = Date.now();
    const then = new Date(dateString).getTime();
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

    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  }

  /** Svelte action to focus an element on mount (avoids a11y autofocus warning) */
  function autofocusAction(node) {
    node.focus();
    node.select();
  }

  /** Close context menu on outside click */
  function handleDocumentClick(e) {
    if (contextMenu.visible) {
      hideContextMenu();
    }
  }

  /** Close context menu on Escape */
  function handleDocumentKeydown(e) {
    if (e.key === 'Escape' && contextMenu.visible) {
      hideContextMenu();
    }
  }
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<div class="chat-list-container">
  <!-- Header with "New Chat" button -->
  <div class="chat-list-header">
    <span class="chat-list-title">Chats</span>
    <button class="new-chat-btn" onclick={handleNewChat} aria-label="New chat" title="New chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  </div>

  <!-- Chat entries -->
  <ul class="chat-entries" role="listbox" aria-label="Chat conversations">
    {#each chats as chat (chat.id)}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        class="chat-entry"
        class:active={chat.id === activeChatId}
        onclick={() => handleSelectChat(chat.id)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectChat(chat.id); }}
        oncontextmenu={(e) => handleContextMenu(e, chat.id)}
        role="option"
        aria-selected={chat.id === activeChatId}
        tabindex="0"
      >
        {#if renamingId === chat.id}
          <input
            type="text"
            class="rename-input"
            bind:value={renameValue}
            onkeydown={handleRenameKeydown}
            onblur={commitRename}
            use:autofocusAction
          />
        {:else}
          <span class="chat-name" title={chat.name || 'New Chat'}>
            {chat.name || 'New Chat'}
          </span>
          <span class="chat-time">{formatRelativeTime(chat.updated)}</span>
          <button
            class="chat-delete-btn"
            onclick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
            aria-label="Delete chat"
            title="Delete"
          >
            &times;
          </button>
        {/if}
      </li>
    {:else}
      {#if !loading}
        <li class="chat-entry-empty">No chats yet</li>
      {/if}
    {/each}
  </ul>
</div>

<!-- Context Menu -->
{#if contextMenu.visible}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    role="menu"
  >
    <button class="context-menu-item" onclick={() => startRename(contextMenu.chatId)} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
      </svg>
      Rename
    </button>
    <button class="context-menu-item danger" onclick={() => { const id = contextMenu.chatId; hideContextMenu(); handleDeleteChat(id); }} role="menuitem">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      Delete
    </button>
  </div>
{/if}

<style>
  /* ========== Chat List Container ========== */
  .chat-list-container {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 100%;
  }

  .chat-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
  }

  .chat-list-title {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .new-chat-btn {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--duration-fast) var(--ease-out);
    padding: 0;
  }

  .new-chat-btn:hover {
    background: var(--bg-hover);
    color: var(--text-strong);
  }

  .new-chat-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ========== Chat Entries ========== */
  .chat-entries {
    list-style: none;
    margin: 0;
    padding: 0 6px 6px;
    overflow-y: auto;
    flex: 1;
  }

  .chat-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    transition: all var(--duration-fast) var(--ease-out);
  }

  .chat-entry:hover {
    background: var(--bg-hover);
  }

  .chat-entry.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .chat-entry-empty {
    padding: 12px 10px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    list-style: none;
  }

  .chat-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-time {
    color: var(--muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .chat-delete-btn {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
    padding: 0;
  }

  .chat-entry:hover .chat-delete-btn {
    display: flex;
  }

  .chat-delete-btn:hover {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  /* ========== Rename Input ========== */
  .rename-input {
    width: 100%;
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-size: 12px;
    font-family: var(--font-family);
    outline: none;
  }

  /* ========== Context Menu ========== */
  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px 0;
    min-width: 140px;
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
    .chat-entry,
    .chat-delete-btn,
    .new-chat-btn,
    .context-menu-item {
      transition: none;
    }
  }
</style>
