/**
 * chat-store.js - Chat persistence and sidebar history
 * Manages saving/loading conversations via IPC and rendering the chat list.
 */

import { addMessage } from './messages.js';
import { getAllMessages, clearChat } from './chat-input.js';

let currentChatId = null;

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
