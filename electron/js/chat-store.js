/**
 * chat-store.js - Chat persistence and sidebar history
 * Manages saving/loading conversations via IPC and rendering the chat list.
 */

import { addMessage } from './messages.js';
import { getAllMessages, clearChat } from './chat-input.js';

let currentChatId = null;
let contextMenuEl = null;

/**
 * Initialize chat store: wire up sidebar controls and load chat list.
 */
export async function initChatStore() {
    currentChatId = null;

    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => newChat());
    }

    await loadChatList();
}

/**
 * Fetch chat list from main process and render in the sidebar.
 */
export async function loadChatList() {
    const listEl = document.getElementById('chat-list');
    if (!listEl) return;

    let chats = [];
    try {
        chats = await window.voiceMirror.chat.list();
    } catch (err) {
        console.error('[ChatStore] Failed to load chat list:', err);
        return;
    }

    // Sort newest-updated first
    chats.sort((a, b) => new Date(b.updated) - new Date(a.updated));

    listEl.innerHTML = '';

    for (const chat of chats) {
        const li = document.createElement('li');
        li.dataset.chatId = chat.id;
        if (chat.id === currentChatId) li.classList.add('active');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chat-name';
        nameSpan.textContent = chat.name && chat.name.length > 40
            ? chat.name.slice(0, 40) + '...'
            : (chat.name || 'New Chat');

        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-time';
        timeSpan.textContent = formatRelativeTime(chat.updated);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'chat-delete-btn';
        deleteBtn.title = 'Delete';
        deleteBtn.textContent = '\u00d7';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChat(chat.id);
        });

        li.appendChild(nameSpan);
        li.appendChild(timeSpan);
        li.appendChild(deleteBtn);

        li.addEventListener('click', () => switchChat(chat.id));
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showChatContextMenu(e.clientX, e.clientY, chat.id);
        });

        listEl.appendChild(li);
    }
}

/**
 * Create a new empty chat, save it, and make it active.
 */
export async function newChat() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const chat = {
        id,
        name: 'New Chat',
        created: now,
        updated: now,
        messages: []
    };

    try {
        await window.voiceMirror.chat.save(chat);
    } catch (err) {
        console.error('[ChatStore] Failed to save new chat:', err);
        return;
    }

    currentChatId = id;

    // Clear chat area but keep welcome message visible
    clearChat();
    const welcomeMessage = document.getElementById('welcome-message');
    if (welcomeMessage) welcomeMessage.style.display = '';

    await loadChatList();
}

/**
 * Switch to a different chat by id.
 */
export async function switchChat(id) {
    // Auto-save current chat before switching
    await autoSave();

    let chat;
    try {
        chat = await window.voiceMirror.chat.load(id);
    } catch (err) {
        console.error('[ChatStore] Failed to load chat:', err);
        return;
    }

    if (!chat) return;

    currentChatId = chat.id;

    // Clear and re-render messages
    clearChat();

    const welcomeMessage = document.getElementById('welcome-message');

    if (chat.messages && chat.messages.length > 0) {
        if (welcomeMessage) welcomeMessage.style.display = 'none';
        for (const msg of chat.messages) {
            addMessage(msg.role, msg.text);
        }
    } else {
        if (welcomeMessage) welcomeMessage.style.display = '';
    }

    // Update active state in sidebar
    const listEl = document.getElementById('chat-list');
    if (listEl) {
        for (const li of listEl.children) {
            li.classList.toggle('active', li.dataset.chatId === id);
        }
    }
}

/**
 * Delete a chat by id. If it was the current chat, switch to the most
 * recent remaining chat or create a new one.
 */
export async function deleteChat(id) {
    try {
        await window.voiceMirror.chat.delete(id);
    } catch (err) {
        console.error('[ChatStore] Failed to delete chat:', err);
        return;
    }

    if (id === currentChatId) {
        currentChatId = null;

        let chats = [];
        try {
            chats = await window.voiceMirror.chat.list();
        } catch { /* empty */ }

        if (chats.length > 0) {
            chats.sort((a, b) => new Date(b.updated) - new Date(a.updated));
            await switchChat(chats[0].id);
        } else {
            await newChat();
        }
        return;
    }

    await loadChatList();
}

/**
 * Auto-save the current chat state. Scrapes messages from the DOM,
 * auto-names the chat from the first user message if still unnamed.
 */
export async function autoSave() {
    if (!currentChatId) return;

    const messages = getAllMessages();
    if (messages.length === 0) return;

    // Auto-name from first user message if still "New Chat"
    let name = null;
    try {
        const existing = await window.voiceMirror.chat.load(currentChatId);
        name = existing?.name || 'New Chat';
    } catch { /* empty */ }

    if (name === 'New Chat') {
        const firstUser = messages.find(m => m.role === 'user');
        if (firstUser && firstUser.text) {
            name = firstUser.text.length > 40
                ? firstUser.text.slice(0, 40) + '...'
                : firstUser.text;
        }
    }

    const chat = {
        id: currentChatId,
        name: name || 'New Chat',
        updated: new Date().toISOString(),
        messages
    };

    try {
        await window.voiceMirror.chat.save(chat);
    } catch (err) {
        console.error('[ChatStore] Auto-save failed:', err);
    }
}

/**
 * Format an ISO date string as a human-readable relative time.
 */
export function formatRelativeTime(dateString) {
    if (!dateString) return '';

    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diffMs = now - then;

    if (isNaN(diffMs) || diffMs < 0) return '';

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    return new Date(dateString).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short'
    });
}

/**
 * Trigger auto-save and refresh the sidebar.
 * Call this after a user message is sent so the chat title updates immediately.
 */
export async function triggerAutoName() {
    await autoSave();
    await loadChatList();
}

// ========== Context Menu ==========

function getOrCreateContextMenu() {
    if (contextMenuEl) return contextMenuEl;

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu hidden';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'context-menu-item';
    renameBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> Rename`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'context-menu-item';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg> Delete`;

    contextMenuEl.appendChild(renameBtn);
    contextMenuEl.appendChild(deleteBtn);
    document.body.appendChild(contextMenuEl);

    // Dismiss on click outside
    document.addEventListener('click', (e) => {
        if (!contextMenuEl.contains(e.target)) hideChatContextMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideChatContextMenu();
    });

    return contextMenuEl;
}

function showChatContextMenu(x, y, chatId) {
    const menu = getOrCreateContextMenu();
    menu.classList.remove('hidden');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Clamp to viewport
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 4}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 4}px`;
        }
    });

    // Wire up actions for this chat
    const [renameBtn, deleteBtn] = menu.querySelectorAll('.context-menu-item');

    renameBtn.onclick = () => {
        hideChatContextMenu();
        startInlineRename(chatId);
    };
    deleteBtn.onclick = () => {
        hideChatContextMenu();
        deleteChat(chatId);
    };
}

function hideChatContextMenu() {
    if (contextMenuEl) contextMenuEl.classList.add('hidden');
}

/**
 * Start inline rename for a chat item in the sidebar.
 */
function startInlineRename(chatId) {
    const listEl = document.getElementById('chat-list');
    if (!listEl) return;

    const li = listEl.querySelector(`li[data-chat-id="${chatId}"]`);
    if (!li) return;

    const nameSpan = li.querySelector('.chat-name');
    if (!nameSpan) return;

    const currentName = nameSpan.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-rename-input';
    input.value = currentName.replace(/\.\.\.$/, ''); // Remove trailing ellipsis for editing
    input.style.cssText = 'width:100%;background:var(--bg-elevated);color:var(--text);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:2px 4px;font-size:13px;outline:none;';

    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = async () => {
        if (committed) return;
        committed = true;

        const newName = input.value.trim();
        if (newName && newName !== currentName) {
            try {
                await window.voiceMirror.chat.rename(chatId, newName);
            } catch (err) {
                console.error('[ChatStore] Rename failed:', err);
            }
        }
        await loadChatList();
    };

    const cancel = async () => {
        if (committed) return;
        committed = true;
        await loadChatList();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
}
