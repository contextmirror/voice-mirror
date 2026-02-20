<script>
  /**
   * ChatInput -- Text input bar at the bottom of the chat panel.
   *
   * Auto-resizing textarea, Enter to send, Shift+Enter for newline,
   * voice recording indicator, and send button.
   */
  import { chatStore } from '../../lib/stores/chat.svelte.js';

  let {
    onSend = () => {},
    onClear = () => {},
    onSave = () => {},
    isRecording = false,
    disabled = false,
    saveFlash = false,
  } = $props();

  let text = $state('');
  let textareaEl = $state(null);

  /** Max number of lines before textarea scrolls internally */
  const MAX_LINES = 5;

  /** Auto-resize textarea to fit content, up to MAX_LINES */
  function autoResize() {
    if (!textareaEl) return;
    // Reset height to measure natural scroll height
    textareaEl.style.height = 'auto';

    // Calculate max height based on line height
    const lineHeight = parseFloat(getComputedStyle(textareaEl).lineHeight) || 20;
    const maxHeight = lineHeight * MAX_LINES + 16; // 16px for padding

    const newHeight = Math.min(textareaEl.scrollHeight, maxHeight);
    textareaEl.style.height = newHeight + 'px';
    textareaEl.style.overflowY = textareaEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function handleInput() {
    autoResize();
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const trimmed = text.trim();
    if (trimmed.length === 0 || disabled) return;

    // Add user message to the store
    chatStore.addMessage('user', trimmed);

    // Fire the callback so parent can route to AI provider
    onSend(trimmed);

    // Reset textarea
    text = '';
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.overflowY = 'hidden';
    }
  }

  const sendDisabled = $derived(disabled || text.trim().length === 0);
  const hasMessages = $derived(chatStore.messages.length > 0);
</script>

<div class="chat-input-bar" class:recording={isRecording}>
  {#if isRecording}
    <div class="recording-indicator">
      <span class="recording-dot"></span>
      <span class="recording-text">Listening...</span>
    </div>
  {/if}

  <div class="toolbar-row" class:hidden-input={isRecording}>
    <button
      class="toolbar-btn"
      onclick={onClear}
      disabled={!hasMessages}
      title="Clear chat"
      aria-label="Clear chat"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
        <path d="M3 6h18"/>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      </svg>
      Clear
    </button>
    <button
      class="toolbar-btn"
      class:saved={saveFlash}
      onclick={onSave}
      disabled={!hasMessages}
      title="Save chat"
      aria-label="Save chat"
    >
      {#if saveFlash}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Saved
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        Save
      {/if}
    </button>
  </div>

  <div class="input-row" class:hidden-input={isRecording}>
    <textarea
      bind:this={textareaEl}
      bind:value={text}
      oninput={handleInput}
      onkeydown={handleKeydown}
      placeholder="Type a message..."
      rows="1"
      {disabled}
      class="chat-textarea"
    ></textarea>

    <button
      class="send-btn"
      onclick={send}
      disabled={sendDisabled}
      title="Send message"
      aria-label="Send message"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .chat-input-bar {
    padding: 10px 16px 8px;
    background: var(--bg);
    border-top: 1px solid var(--border-strong);
    flex-shrink: 0;
    position: relative;
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .input-row.hidden-input {
    visibility: hidden;
    height: 0;
    overflow: hidden;
    padding: 0;
    margin: 0;
  }

  .chat-textarea {
    flex: 1;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    padding: 8px 12px;
    resize: none;
    min-height: 36px;
    line-height: 1.5;
    overflow-y: hidden;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .chat-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .chat-textarea::placeholder {
    color: var(--muted);
    opacity: 0.6;
  }

  .chat-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: var(--accent-contrast, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out),
                transform var(--duration-fast) var(--ease-out);
  }

  .send-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: scale(1.05);
  }

  .send-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Toolbar row (Clear, Save) */
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-bottom: 4px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-family);
    font-size: 11px;
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out),
                background var(--duration-fast) var(--ease-out);
  }

  .toolbar-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .toolbar-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .toolbar-btn.saved {
    color: var(--ok);
  }

  /* Recording indicator */
  .recording-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 0;
  }

  .recording-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    animation: recording-pulse 1.5s ease-in-out infinite;
  }

  .recording-text {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }

  @keyframes recording-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }

  @media (prefers-reduced-motion: reduce) {
    .recording-dot {
      animation: none;
      opacity: 0.7;
    }

    .send-btn:hover:not(:disabled) {
      transform: none;
    }

    .send-btn:active:not(:disabled) {
      transform: none;
    }

    .toolbar-btn {
      transition: none;
    }
  }
</style>
