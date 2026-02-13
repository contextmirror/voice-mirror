/**
 * messages.js - Chat message handling
 *
 * Model-agnostic chat UI that displays messages from any AI provider.
 */

import { state, recentMessages, DEDUP_WINDOW_MS } from './state.js';
import { renderMarkdown } from './markdown.js';
import { formatTime } from './utils.js';

/**
 * Smart auto-scroll: only scrolls if user is near the bottom.
 * Uses smooth scrolling for a polished feel.
 */
export function autoScroll(container) {
    // If user has scrolled up more than 150px from bottom, don't force scroll
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 150) return;

    container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
    });
}

/**
 * Strip provider prefix from message text.
 * Handles patterns like "Claude: ", "Ollama: ", "Claude (model): ", etc.
 */
function stripProviderPrefix(text) {
    if (!text) return text;
    // Match patterns: "Claude: ", "Ollama: ", "Claude (model-name): ", "Grok (xAI): ", etc.
    return text.replace(/^(?:Claude|Ollama|OpenAI|Gemini|Grok|Groq|Mistral|DeepSeek|LM Studio|Jan)(?:\s*\([^)]+\))?:\s*/i, '').trim();
}

/**
 * Strip tool call JSON from message text.
 * Local LLMs output JSON for tool calls - don't show that in the chat bubble.
 */
function stripToolJson(text) {
    if (!text) return text;

    // Pattern 1: Standalone JSON tool call
    // {"tool": "web_search", "args": {...}}
    const jsonPattern = /\{[\s\S]*?"tool"[\s\S]*?"args"[\s\S]*?\}/g;

    // Pattern 2: "Sure!" followed by JSON (common Ollama pattern)
    const prefixJsonPattern = /^(Sure!?\s*)?(\{[\s\S]*?"tool"[\s\S]*?"args"[\s\S]*?\})\s*/i;

    let cleaned = text;

    // Remove inline JSON tool calls
    cleaned = cleaned.replace(jsonPattern, '').trim();

    // Remove "Sure! {json}" patterns
    cleaned = cleaned.replace(prefixJsonPattern, '').trim();

    // Remove common pre-tool-call phrases that make no sense without the JSON
    cleaned = cleaned.replace(/^(Sure!?|I'll search|Let me search|Searching)[.!]?\s*$/i, '').trim();

    return cleaned;
}

/**
 * Check if text is primarily a tool call JSON (should not be shown as message)
 */
function isToolCallOnly(text) {
    if (!text) return false;
    const stripped = stripToolJson(text);
    // If after stripping tool JSON we have very little left, it was just a tool call
    return stripped.length < 10 || stripped.match(/^(Sure!?|OK|Okay)[.!]?\s*$/i);
}

/**
 * Check if message is a duplicate (within dedup window)
 */
export function isDuplicate(text) {
    if (!text) return false;

    // Normalize text (remove any provider prefix for comparison)
    const normalized = stripProviderPrefix(text).toLowerCase();
    const now = Date.now();

    // Clean old entries
    for (const [key, time] of recentMessages) {
        if (now - time > DEDUP_WINDOW_MS) {
            recentMessages.delete(key);
        }
    }

    // Check if we've seen this recently
    if (recentMessages.has(normalized)) {
        console.log('[Chat] Duplicate message suppressed:', text.slice(0, 50));
        window.voiceMirror?.devlog('UI', 'card-dedup', { text: text.slice(0, 200), reason: 'duplicate within 5s window' });
        return true;
    }

    recentMessages.set(normalized, now);
    return false;
}

/**
 * Add message with grouped structure (Slack-style)
 */
export function addMessage(role, text, imageBase64 = null) {
    const chatContainer = document.getElementById('chat-container');

    const group = document.createElement('div');
    group.className = `message-group ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';

    const header = document.createElement('div');
    header.className = 'message-header';
    // Use dynamic provider name from state for assistant messages
    const senderName = role === 'user' ? 'You' : state.currentProviderName;
    const senderSpan = document.createElement('span');
    senderSpan.className = 'message-sender';
    senderSpan.textContent = senderName;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatTime();
    header.appendChild(senderSpan);
    header.appendChild(timeSpan);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (imageBase64) {
        const img = document.createElement('img');
        img.className = 'message-image';
        img.src = imageBase64;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        img.style.marginBottom = text ? '8px' : '0';
        bubble.appendChild(img);
    }

    if (text) {
        // For assistant messages, clean up the text
        let displayText = text;
        if (role === 'assistant') {
            // Strip provider prefix (e.g., "Claude: ") since sender is shown in header
            displayText = stripProviderPrefix(text);
            // Strip tool JSON from message (shown in tool cards instead)
            displayText = stripToolJson(displayText);

            // If the message was just a tool call with no real content, don't show it
            if (isToolCallOnly(text)) {
                window.voiceMirror?.devlog('UI', 'card-skipped', { text: text?.slice(0, 200), reason: 'tool-call-only content' });
                return;
            }
        }

        if (displayText) {
            const textNode = document.createElement('div');
            // Use markdown rendering for assistant messages, plain text for user
            if (role === 'assistant') {
                textNode.className = 'markdown-content';
                textNode.innerHTML = renderMarkdown(displayText);
            } else {
                textNode.textContent = displayText;
            }
            bubble.appendChild(textNode);
        }
    }

    // Add copy button for assistant messages
    if (role === 'assistant' && text) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'message-copy-btn';
        copyBtn.title = 'Copy';
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.onclick = function() { copyMessage(this); };
        bubble.appendChild(copyBtn);
    }

    content.appendChild(header);
    content.appendChild(bubble);

    group.appendChild(avatar);
    group.appendChild(content);

    chatContainer.appendChild(group);
    autoScroll(chatContainer);

    // Dev log: card rendered
    window.voiceMirror?.devlog('UI', 'card-rendered', {
        role,
        text: text?.slice(0, 200),
        source: role === 'assistant' ? state.currentProviderName : 'voice',
    });
}

/**
 * Copy message text to clipboard
 */
export function copyMessage(btn) {
    const bubble = btn.parentElement;
    const textEl = bubble.querySelector('div');
    if (!textEl) return;

    navigator.clipboard.writeText(textEl.textContent).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        `;
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            `;
        }, 2000);
    });
}

/**
 * Initialize scroll-to-top / scroll-to-bottom buttons.
 */
export function initScrollButtons() {
    const chatContainer = document.getElementById('chat-container');
    const topBtn = document.getElementById('scroll-to-top');
    const bottomBtn = document.getElementById('scroll-to-bottom');
    if (!chatContainer || !topBtn || !bottomBtn) return;

    topBtn.addEventListener('click', () => {
        chatContainer.scrollTo({ top: 0, behavior: 'smooth' });
    });

    bottomBtn.addEventListener('click', () => {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    });
}
