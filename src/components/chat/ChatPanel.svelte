<script>
  /**
   * ChatPanel -- Container for the entire chat view.
   *
   * Renders MessageGroup components from the chat store, handles smart
   * auto-scroll (only scrolls if user is near bottom), and shows an
   * empty state when there are no messages.
   */
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { exportChatToFile } from '../../lib/api.js';
  import { save } from '@tauri-apps/plugin-dialog';
  import MessageGroup from './MessageGroup.svelte';
  import ChatInput from './ChatInput.svelte';
  import ScreenshotPicker from './ScreenshotPicker.svelte';

  let {
    onSend = () => {},
    inputDisabled = false,
  } = $props();

  let isRecording = $derived(voiceStore.isRecording);
  let saveFlash = $state(false);
  let showScreenshotPicker = $state(false);

  let pendingAttachments = $state([]);
  let scrollContainer = $state(null);

  /** Distance from bottom (in px) within which we auto-scroll */
  const SCROLL_THRESHOLD = 150;

  /**
   * Group consecutive messages by role into Slack-style groups.
   * Each group has { id, role, senderName, messages[] }.
   */
  const messageGroups = $derived.by(() => {
    const msgs = chatStore.messages;
    if (msgs.length === 0) return [];

    const groups = [];
    let current = null;

    for (const msg of msgs) {
      if (current && current.role === msg.role) {
        // Same role -- add to existing group
        current.messages.push(msg);
      } else {
        // New group
        current = {
          id: msg.id,
          role: msg.role,
          senderName: msg.role === 'user' ? 'You' : 'Assistant',
          messages: [msg],
        };
        groups.push(current);
      }
    }

    return groups;
  });

  const hasMessages = $derived(chatStore.messages.length > 0);

  /**
   * Smart auto-scroll: only scroll if user is near the bottom.
   * During streaming, use instant scroll for responsiveness.
   * When not streaming, use smooth scroll for polish.
   */
  function autoScroll() {
    if (!scrollContainer) return;

    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;

    if (distanceFromBottom > SCROLL_THRESHOLD) return;

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: chatStore.isStreaming ? 'instant' : 'smooth',
    });
  }

  /** Clear all messages from the current chat. */
  function handleClear() {
    chatStore.clearMessages();
  }

  /** Export the current chat via a native Save As dialog. */
  async function handleSave() {
    if (chatStore.messages.length === 0) return;

    // Format messages as Markdown
    const lines = chatStore.messages.map(m => {
      const role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Assistant' : m.role;
      return `**${role}:**\n${m.text}`;
    });
    const markdown = lines.join('\n\n---\n\n') + '\n';

    try {
      const filePath = await save({
        title: 'Export Chat',
        defaultPath: `chat-${Date.now()}.md`,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      // User cancelled the dialog
      if (!filePath) return;

      await exportChatToFile(filePath, markdown);
      saveFlash = true;
      setTimeout(() => { saveFlash = false; }, 1200);
    } catch (err) {
      console.error('[ChatPanel] Export failed:', err);
    }
  }

  /** Open the screenshot picker modal. */
  function handleScreenshot() {
    showScreenshotPicker = true;
  }

  /** Called when a screenshot is captured from the picker. */
  function handleScreenshotCapture(path) {
    showScreenshotPicker = false;
    pendingAttachments = [...pendingAttachments, { path, type: 'image/png', name: 'Screenshot' }];
  }

  /** Remove an attachment by index from the pending list. */
  function handleRemoveAttachment(index) {
    pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
  }

  /** Clear all pending attachments. */
  function handleClearAttachments() {
    pendingAttachments = [];
  }

  /** Called when the screenshot picker is closed without capturing. */
  function handleScreenshotClose() {
    showScreenshotPicker = false;
  }

  // Auto-scroll whenever messages change or streaming updates
  $effect(() => {
    // Track messages length and streaming state to trigger this effect
    const _len = chatStore.messages.length;
    const _streaming = chatStore.isStreaming;

    // Use tick-like delay to let DOM update first
    if (scrollContainer) {
      requestAnimationFrame(() => {
        autoScroll();
      });
    }
  });
</script>

<div class="chat-panel">
  <div class="chat-scroll-area" bind:this={scrollContainer}>
    {#if hasMessages}
      <div class="messages-container">
        {#each messageGroups as group (group.id)}
          <MessageGroup {group} />
        {/each}
      </div>
      <!-- Bottom spacer so last message doesn't hug the edge -->
      <div class="scroll-spacer"></div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <p class="empty-title">Start a conversation...</p>
        <p class="empty-subtitle">Type a message below or use voice to begin.</p>
      </div>
    {/if}
  </div>

  <ChatInput
    {onSend}
    onClear={handleClear}
    onSave={handleSave}
    onScreenshot={handleScreenshot}
    {isRecording}
    disabled={inputDisabled}
    {saveFlash}
    attachments={pendingAttachments}
    onRemoveAttachment={handleRemoveAttachment}
    onClearAttachments={handleClearAttachments}
  />

  {#if showScreenshotPicker}
    <ScreenshotPicker
      onCapture={handleScreenshotCapture}
      onClose={handleScreenshotClose}
    />
  {/if}
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .chat-scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    position: relative;
  }

  .messages-container {
    display: flex;
    flex-direction: column;
  }

  .scroll-spacer {
    height: 8px;
    flex-shrink: 0;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    padding: 32px;
    text-align: center;
  }

  .empty-icon {
    color: var(--muted);
    opacity: 0.4;
  }

  .empty-title {
    font-size: 16px;
    color: var(--text-strong);
    font-weight: 600;
    margin: 0;
  }

  .empty-subtitle {
    font-size: 13px;
    color: var(--muted);
    margin: 0;
  }
</style>
