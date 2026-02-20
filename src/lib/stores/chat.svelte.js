/**
 * chat.js -- Svelte 5 reactive store for chat messages.
 *
 * Manages the message list, streaming state, and history operations.
 */

import { uid } from '../utils.js';

/**
 * @typedef {Object} ChatMessage
 * @property {string} id - Unique message ID
 * @property {'user'|'assistant'|'system'|'error'} role
 * @property {string} text - Message content (markdown)
 * @property {number} timestamp - Unix ms
 * @property {boolean} streaming - Whether this message is still being streamed
 * @property {Array} [toolCalls] - Tool calls attached to this message
 * @property {Array} [attachments] - File attachments [{path, type, name}]
 * @property {Object} [metadata] - Extra metadata
 */

function createChatStore() {
  let messages = $state([]);
  let isStreaming = $state(false);
  let activeChatId = $state(null);

  return {
    get messages() { return messages; },
    get isStreaming() { return isStreaming; },
    get activeChatId() { return activeChatId; },
    setActiveChatId(id) { activeChatId = id; },

    /**
     * Add a complete message.
     * @param {'user'|'assistant'|'system'|'error'} role
     * @param {string} text
     * @param {Object} [metadata]
     * @returns {string} The message ID
     */
    addMessage(role, text, metadata = {}) {
      const id = uid();
      messages = [...messages, {
        id,
        role,
        text,
        timestamp: Date.now(),
        streaming: false,
        toolCalls: metadata.toolCalls || [],
        attachments: metadata.attachments || [],
        metadata,
      }];
      return id;
    },

    /**
     * Begin a streaming message (appended with streaming=true).
     * @param {'assistant'|'system'} role
     * @param {string} [initialText='']
     * @returns {string} The message ID
     */
    startStreamingMessage(role = 'assistant', initialText = '') {
      const id = uid();
      isStreaming = true;
      messages = [...messages, {
        id,
        role,
        text: initialText,
        timestamp: Date.now(),
        streaming: true,
        toolCalls: [],
        attachments: [],
        metadata: {},
      }];
      return id;
    },

    /**
     * Append text to the current streaming message.
     * @param {string} text - Text chunk to append
     */
    updateStreamingMessage(text) {
      const idx = messages.findLastIndex((m) => m.streaming);
      if (idx === -1) return;
      const updated = [...messages];
      updated[idx] = { ...updated[idx], text: updated[idx].text + text };
      messages = updated;
    },

    /**
     * Replace the full text of the current streaming message.
     * @param {string} text
     */
    setStreamingMessageText(text) {
      const idx = messages.findLastIndex((m) => m.streaming);
      if (idx === -1) return;
      const updated = [...messages];
      updated[idx] = { ...updated[idx], text };
      messages = updated;
    },

    /**
     * Mark the streaming message as complete.
     * @param {Object} [metadata] - Optional metadata to merge
     */
    finalizeStreamingMessage(metadata = {}) {
      const idx = messages.findLastIndex((m) => m.streaming);
      if (idx === -1) return;
      const updated = [...messages];
      updated[idx] = {
        ...updated[idx],
        streaming: false,
        toolCalls: metadata.toolCalls || updated[idx].toolCalls,
        metadata: { ...updated[idx].metadata, ...metadata },
      };
      messages = updated;
      isStreaming = false;
    },

    /**
     * Clear all messages.
     */
    clearMessages() {
      messages = [];
      isStreaming = false;
    },

    /**
     * Remove a message by ID.
     * @param {string} id
     */
    removeMessage(id) {
      messages = messages.filter((m) => m.id !== id);
    },
  };
}

export const chatStore = createChatStore();
