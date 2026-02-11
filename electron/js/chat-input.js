/**
 * chat-input.js - Chat input bar behavior
 * Handles sending text messages, toggling voice, clearing and saving chat history.
 */

import { addMessage, isDuplicate, autoScroll } from './messages.js';

let textarea;
let sendBtn;
let clearBtn;
let saveBtn;
let chatContainer;
let welcomeMessage;

function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    addMessage('user', text);
    isDuplicate(text); // Register in dedup map so Python echo is suppressed
    window.voiceMirror.python.sendQuery({ text });

    textarea.value = '';
    textarea.style.height = '';
}

export function clearChat() {
    const elements = chatContainer.querySelectorAll('.message-group, .tool-card');
    for (const el of elements) {
        if (el.id === 'welcome-message') continue;
        el.remove();
    }

    if (welcomeMessage) {
        welcomeMessage.style.display = '';
    }

    chatContainer.scrollTop = 0;
}

export function getAllMessages() {
    const groups = chatContainer.querySelectorAll('.message-group');
    const messages = [];

    for (const group of groups) {
        if (group.id === 'welcome-message') continue;

        const role = group.classList.contains('user') ? 'user' : 'assistant';
        const bubble = group.querySelector('.message-bubble');
        const timeEl = group.querySelector('.message-time');

        messages.push({
            role,
            text: bubble ? bubble.innerText : '',
            time: timeEl ? timeEl.innerText : ''
        });
    }

    return messages;
}

function saveChat() {
    const messages = getAllMessages();
    if (messages.length === 0) return;

    const json = JSON.stringify(messages, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
}

export function initChatInput() {
    textarea = document.getElementById('chat-input');
    sendBtn = document.getElementById('chat-send-btn');
    clearBtn = document.getElementById('action-clear-chat');
    saveBtn = document.getElementById('action-save-chat');
    chatContainer = document.getElementById('chat-container');
    welcomeMessage = document.getElementById('welcome-message');

    // Auto-resize textarea (grows up to 40% of viewport, then scrolls)
    textarea.addEventListener('input', () => {
        textarea.style.height = '';
        const maxHeight = window.innerHeight * 0.4;
        textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
        // Keep chat scrolled to bottom as input bar grows/shrinks
        autoScroll(chatContainer);
    });

    // Send on Enter (Shift+Enter inserts newline)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Send button
    sendBtn.addEventListener('click', sendMessage);

    // Clear chat
    clearBtn.addEventListener('click', clearChat);

    // Save chat
    saveBtn.addEventListener('click', saveChat);
}
