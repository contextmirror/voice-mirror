/**
 * messages.js - Chat message handling
 *
 * Model-agnostic chat UI that displays messages from any AI provider.
 */

import { state, recentMessages, DEDUP_WINDOW_MS } from './state.js';
import { renderMarkdown } from './markdown.js';
import { formatTime, escapeHtml } from './utils.js';
import { createLog } from './log.js';
const log = createLog('[Chat]');

const MAX_MESSAGE_GROUPS = 200;

// In-memory message array for persistence (avoids DOM scraping)
const messagesArray = [];

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
 * Uses brace-balancing to handle nested objects (e.g., {"tool":"x","args":{"q":"y"}}).
 */
function stripToolJson(text) {
    if (!text) return text;

    const toolPattern = /"tool"\s*:/;
    let result = text;

    // Find and remove brace-balanced JSON blocks containing "tool":
    let searchFrom = 0;
    while (searchFrom < result.length) {
        const braceIdx = result.indexOf('{', searchFrom);
        if (braceIdx === -1) break;

        // Find the matching closing brace (brace-balancing)
        let depth = 0;
        let endIdx = -1;
        for (let i = braceIdx; i < result.length; i++) {
            if (result[i] === '{') depth++;
            if (result[i] === '}') depth--;
            if (depth === 0) { endIdx = i; break; }
        }

        if (endIdx === -1) {
            // Unbalanced — remove from brace to end if it looks like a tool call
            const fragment = result.substring(braceIdx);
            if (toolPattern.test(fragment)) {
                result = result.substring(0, braceIdx).trim();
                break;
            }
            searchFrom = braceIdx + 1;
            continue;
        }

        const candidate = result.substring(braceIdx, endIdx + 1);
        if (toolPattern.test(candidate)) {
            result = result.substring(0, braceIdx) + result.substring(endIdx + 1);
            // Don't advance searchFrom — content shifted
        } else {
            searchFrom = endIdx + 1;
        }
    }

    result = result.trim();

    // Remove common pre-tool-call phrases that make no sense without the JSON
    result = result.replace(/^(Sure!?|I'll search|Let me search|Searching)[.!]?\s*$/i, '').trim();

    return result;
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
        log.info('Duplicate message suppressed:', text.slice(0, 50));
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
                try {
                    textNode.innerHTML = renderMarkdown(displayText);
                } catch (err) {
                    log.error('Markdown render failed:', err);
                    textNode.innerHTML = escapeHtml(displayText).replace(/\n/g, '<br>');
                }
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
        copyBtn.setAttribute('aria-label', 'Copy message');
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

    // Push to in-memory array for persistence
    messagesArray.push({ role, text, time: formatTime() });

    // Trim oldest message groups if over cap
    const groups = chatContainer.querySelectorAll('.message-group:not(#welcome-message)');
    if (groups.length > MAX_MESSAGE_GROUPS) {
        const excess = groups.length - MAX_MESSAGE_GROUPS;
        for (let i = 0; i < excess; i++) {
            groups[i].remove();
        }
        messagesArray.splice(0, excess);
    }

    autoScroll(chatContainer);

    // Dev log: card rendered
    window.voiceMirror?.devlog('UI', 'card-rendered', {
        role,
        text: text?.slice(0, 200),
        source: role === 'assistant' ? state.currentProviderName : 'voice',
    });
}

/**
 * Start a new streaming message in the chat UI.
 * Creates the message group with an empty bubble that fills token-by-token.
 */
export function startStreamingMessage() {
    // Clear any previous finalized flag — this is a NEW response
    state.streamingFinalizedAt = 0;

    const chatContainer = document.getElementById('chat-container');

    const group = document.createElement('div');
    group.className = 'message-group assistant streaming';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '\u{1F916}';

    const content = document.createElement('div');
    content.className = 'message-content';

    const header = document.createElement('div');
    header.className = 'message-header';
    const senderSpan = document.createElement('span');
    senderSpan.className = 'message-sender';
    senderSpan.textContent = state.currentProviderName;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatTime();
    header.appendChild(senderSpan);
    header.appendChild(timeSpan);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const textNode = document.createElement('div');
    textNode.className = 'streaming-text';
    bubble.appendChild(textNode);

    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    cursor.textContent = '\u2588';
    bubble.appendChild(cursor);

    content.appendChild(header);
    content.appendChild(bubble);
    group.appendChild(avatar);
    group.appendChild(content);
    chatContainer.appendChild(group);

    // Instant scroll during streaming (no animation delay)
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'instant' });

    state.streamingMessageGroup = group;
    state.streamingBubble = textNode;
    state.streamingText = '';
    state.streamingActive = true;
    state.streamingToolCount = 0;
}

/**
 * Append a token to the active streaming message.
 * Uses plain text (no markdown) for performance during streaming.
 */
export function appendStreamingToken(token) {
    if (!state.streamingActive || !state.streamingBubble) return;

    state.streamingText += token;
    state.streamingBubble.textContent = state.streamingText;

    // Instant scroll during active streaming
    const chatContainer = document.getElementById('chat-container');
    const distanceFromBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    if (distanceFromBottom <= 150) {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'instant' });
    }
}

/**
 * Insert an inline tool activity card into the active streaming message.
 * Strips tool JSON from accumulated text and shows a styled card instead.
 * @param {string} toolName - Raw tool name (e.g., 'memory_search')
 * @param {string} displayName - Friendly display name (e.g., 'Searching memory')
 * @param {number} iteration - Tool iteration number (for identifying the card)
 */
export function addStreamingToolCard(toolName, displayName, iteration) {
    if (!state.streamingActive || !state.streamingMessageGroup) return;

    const bubble = state.streamingMessageGroup.querySelector('.message-bubble');
    if (!bubble) return;

    // Strip tool JSON from accumulated streaming text
    const cleanedText = stripToolJson(state.streamingText).trim();
    if (state.streamingBubble) {
        if (cleanedText) {
            state.streamingBubble.textContent = cleanedText;
        } else {
            // Pre-tool text was just the JSON or empty — hide it
            state.streamingBubble.style.display = 'none';
        }
    }

    // Create the tool card element (uses existing .tool-card CSS)
    const card = document.createElement('div');
    card.className = 'tool-card tool-call inline';
    card.setAttribute('data-tool-iteration', iteration || 0);

    const header = document.createElement('div');
    header.className = 'tool-card-header';

    const icon = document.createElement('span');
    icon.className = 'tool-icon';
    icon.textContent = '\u26A1'; // ⚡

    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = displayName || toolName;

    const status = document.createElement('span');
    status.className = 'tool-status running';
    status.textContent = 'Running';

    header.appendChild(icon);
    header.appendChild(name);
    header.appendChild(status);
    card.appendChild(header);

    // Insert tool card before the cursor
    const cursor = bubble.querySelector('.streaming-cursor');
    bubble.insertBefore(card, cursor);

    // Create a new streaming text div for follow-up tokens
    const newTextNode = document.createElement('div');
    newTextNode.className = 'streaming-text';
    bubble.insertBefore(newTextNode, cursor);

    // Update streaming state to point to the new text node
    state.streamingBubble = newTextNode;
    state.streamingText = '';
    state.streamingToolCount++;

    // Scroll to show the tool card
    const chatContainer = document.getElementById('chat-container');
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'instant' });
}

/**
 * Update an inline tool card's status after tool execution completes.
 * @param {number} iteration - Tool iteration number
 * @param {boolean} success - Whether the tool succeeded
 */
export function updateStreamingToolCard(iteration, success) {
    if (!state.streamingMessageGroup) {
        log.debug('updateStreamingToolCard: no streamingMessageGroup');
        return;
    }

    const card = state.streamingMessageGroup.querySelector(`[data-tool-iteration="${iteration}"]`);
    if (!card) {
        log.debug(`updateStreamingToolCard: card not found for iteration ${iteration}`);
        return;
    }

    const status = card.querySelector('.tool-status');
    if (status) {
        status.classList.remove('running');
        status.classList.add(success ? 'success' : 'error');
        status.textContent = success ? 'Done' : 'Failed';
    }
}

/**
 * Finalize the streaming message: apply markdown rendering, add copy button.
 * @param {string} fullText - The complete response text
 */
export function finalizeStreamingMessage(fullText) {
    if (!state.streamingActive || !state.streamingMessageGroup) return;

    const group = state.streamingMessageGroup;
    const bubble = group.querySelector('.message-bubble');
    if (!bubble) return;

    // Remove streaming class and cursor
    group.classList.remove('streaming');
    const cursor = bubble.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();

    // Clean text for display
    let displayText = stripProviderPrefix(fullText);
    displayText = stripToolJson(displayText);

    // If was just a tool call with no tool cards and no content, remove the message
    if (state.streamingToolCount === 0 && isToolCallOnly(fullText)) {
        group.remove();
        state.streamingMessageGroup = null;
        state.streamingBubble = null;
        state.streamingText = '';
        state.streamingActive = false;
        state.streamingToolCount = 0;
        return;
    }

    // Safety net: finalize any tool cards still stuck on "running"
    const runningCards = bubble.querySelectorAll('.tool-status.running');
    for (const status of runningCards) {
        status.classList.remove('running');
        status.classList.add('success');
        status.textContent = 'Done';
    }

    // Handle all streaming text nodes (there may be multiple if tool cards were inserted)
    const textNodes = bubble.querySelectorAll('.streaming-text');
    for (const textNode of textNodes) {
        const isLast = textNode === textNodes[textNodes.length - 1];
        const content = textNode.textContent.trim();

        if (isLast && displayText) {
            // Last text node gets the full answer rendered as markdown
            textNode.className = 'markdown-content';
            try {
                textNode.innerHTML = renderMarkdown(displayText);
            } catch (err) {
                log.error('Markdown render failed during finalize:', err);
                textNode.innerHTML = escapeHtml(displayText).replace(/\n/g, '<br>');
            }
        } else if (!content || content.length < 5) {
            // Empty or trivial pre-tool text — remove it
            textNode.remove();
        } else {
            // Non-trivial pre-tool text — render with markdown
            textNode.className = 'markdown-content';
            try {
                textNode.innerHTML = renderMarkdown(content);
            } catch (err) {
                textNode.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
            }
        }
    }

    // Add copy button
    if (fullText) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'message-copy-btn';
        copyBtn.title = 'Copy';
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.onclick = function() { copyMessage(this); };
        bubble.appendChild(copyBtn);
    }

    // Push to in-memory array for persistence
    messagesArray.push({ role: 'assistant', text: fullText, time: formatTime() });

    // Trim oldest message groups if over cap
    const chatContainer = document.getElementById('chat-container');
    const groups = chatContainer.querySelectorAll('.message-group:not(#welcome-message)');
    if (groups.length > MAX_MESSAGE_GROUPS) {
        const excess = groups.length - MAX_MESSAGE_GROUPS;
        for (let i = 0; i < excess; i++) {
            groups[i].remove();
        }
        messagesArray.splice(0, excess);
    }

    autoScroll(chatContainer);

    // Register in dedup map so the later chat-message from inbox-watcher is suppressed
    isDuplicate(fullText);

    // Set timestamp so onChatMessage can suppress the delayed inbox-watcher duplicate
    // (inbox-watcher sends cleaned/stripped text that won't match raw fullText in dedup)
    state.streamingFinalizedAt = Date.now();

    // Dev log
    window.voiceMirror?.devlog('UI', 'card-rendered', {
        role: 'assistant',
        text: fullText?.slice(0, 200),
        source: state.currentProviderName,
        streaming: true,
    });

    // Reset streaming state
    state.streamingMessageGroup = null;
    state.streamingBubble = null;
    state.streamingText = '';
    state.streamingActive = false;
    state.streamingToolCount = 0;
}

/**
 * Get the in-memory messages array (for persistence, avoids DOM scraping).
 */
export function getMessagesArray() {
    return messagesArray;
}

/**
 * Clear the in-memory messages array (called when chat is cleared/switched).
 */
export function clearMessagesArray() {
    messagesArray.length = 0;
}

/**
 * Copy message text to clipboard
 */
export function copyMessage(btn) {
    const bubble = btn.parentElement;
    const textEl = bubble.querySelector('.markdown-content') || bubble.querySelector('div');
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
