<script>
  /**
   * ChatInput -- Text input bar at the bottom of the chat panel.
   *
   * Auto-resizing textarea, Enter to send, Shift+Enter for newline,
   * "+" action menu (screenshot, save, clear), voice recording indicator,
   * and send button.
   */
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { chatStore } from '../../lib/stores/chat.svelte.js';

  let {
    onSend = () => {},
    onClear = () => {},
    onSave = () => {},
    onScreenshot = () => {},
    isRecording = false,
    disabled = false,
    saveFlash = false,
    attachments = [],
    onRemoveAttachment = () => {},
    onClearAttachments = () => {},
  } = $props();

  let text = $state('');
  let textareaEl = $state(null);
  let menuOpen = $state(false);
  let menuBtnEl = $state(null);

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
    if ((trimmed.length === 0 && !hasAttachments) || disabled) return;

    // Add user message to the store (with attachments if any)
    const meta = hasAttachments ? { attachments: [...attachments] } : {};
    chatStore.addMessage('user', trimmed, meta);

    // Fire the callback so parent can route to AI provider
    onSend(trimmed, attachments);

    // Clear attachments and reset textarea
    onClearAttachments();
    text = '';
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.overflowY = 'hidden';
    }
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function handleMenuAction(action) {
    closeMenu();
    action();
  }

  /** Close menu on outside click */
  function handleDocumentClick(e) {
    if (menuOpen && menuBtnEl && !menuBtnEl.contains(e.target)) {
      closeMenu();
    }
  }

  /** Close menu on Escape */
  function handleDocumentKeydown(e) {
    if (e.key === 'Escape' && menuOpen) {
      closeMenu();
    }
  }

  const thumbnailUrls = $derived(
    attachments.map(att => ({ ...att, url: convertFileSrc(att.path) }))
  );
  const hasAttachments = $derived(attachments.length > 0);
  const sendDisabled = $derived(disabled || (text.trim().length === 0 && !hasAttachments));
  const hasMessages = $derived(chatStore.messages.length > 0);
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<div class="chat-input-bar" class:recording={isRecording}>
  {#if thumbnailUrls.length > 0}
    <div class="attachment-preview-strip">
      {#each thumbnailUrls as att, idx}
        <div class="attachment-thumb">
          <img src={att.url} alt={att.name || 'Attachment'} class="attachment-thumb-img" />
          <button class="attachment-remove-btn" onclick={() => onRemoveAttachment(idx)} title="Remove" aria-label="Remove attachment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if isRecording}
    <div class="recording-indicator">
      <span class="recording-dot"></span>
      <span class="recording-text">Listening...</span>
    </div>
  {/if}

  <div class="input-row" class:hidden-input={isRecording}>
    <!-- Action menu button -->
    <div class="menu-anchor" bind:this={menuBtnEl}>
      <button
        class="menu-btn"
        class:active={menuOpen}
        onclick={toggleMenu}
        title="Actions"
        aria-label="Actions menu"
        aria-expanded={menuOpen}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {#if menuOpen}
        <div class="action-menu" role="menu">
          <button class="action-menu-item" onclick={() => handleMenuAction(onScreenshot)} role="menuitem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Screenshot
          </button>
          <button
            class="action-menu-item"
            class:saved={saveFlash}
            onclick={() => handleMenuAction(onSave)}
            disabled={!hasMessages}
            role="menuitem"
          >
            {#if saveFlash}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Saved
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Save chat
            {/if}
          </button>
          <button
            class="action-menu-item danger"
            onclick={() => handleMenuAction(onClear)}
            disabled={!hasMessages}
            role="menuitem"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <path d="M3 6h18"/>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
            Clear chat
          </button>
        </div>
      {/if}
    </div>

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
  /* ========== Attachment Preview Strip ========== */
  .attachment-preview-strip {
    display: flex;
    gap: 8px;
    padding: 8px 0 4px;
    overflow-x: auto;
  }

  .attachment-thumb {
    position: relative;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .attachment-thumb-img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    display: block;
  }

  .attachment-remove-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .attachment-remove-btn:hover {
    background: var(--danger);
  }

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

  /* ========== Menu Button & Popup ========== */
  .menu-anchor {
    position: relative;
    flex-shrink: 0;
  }

  .menu-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .menu-btn:hover,
  .menu-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .action-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 10001;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px 0;
    min-width: 160px;
    box-shadow: var(--shadow-md);
  }

  .action-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .action-menu-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .action-menu-item:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .action-menu-item.danger:hover:not(:disabled) {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  .action-menu-item.saved {
    color: var(--ok);
  }

  .action-menu-item svg {
    flex-shrink: 0;
  }

  /* ========== Textarea ========== */
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

    .menu-btn,
    .action-menu-item {
      transition: none;
    }
  }
</style>
