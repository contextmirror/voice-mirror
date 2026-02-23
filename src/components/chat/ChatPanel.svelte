<script>
  /**
   * ChatPanel -- Container for the entire chat view.
   *
   * Renders MessageGroup components from the chat store, handles smart
   * auto-scroll (only scrolls if user is near bottom), and shows an
   * empty state when there are no messages.
   */
  import { tick } from 'svelte';
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { attachmentsStore } from '../../lib/stores/attachments.svelte.js';
  import { chatLoad, chatSave, exportChatToFile, lensCapturePreview } from '../../lib/api.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
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
  let browserSnapshot = $state(null);

  let pendingAttachments = $derived(attachmentsStore.pending);
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

  /** Whether the user has manually scrolled up away from the bottom. */
  let userScrolledUp = $state(false);

  /** Handle scroll events to detect manual scroll-up. */
  function handleScroll() {
    if (!scrollContainer) return;
    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    userScrolledUp = distanceFromBottom > SCROLL_THRESHOLD;
  }

  /**
   * Smart auto-scroll: only scroll if user is near the bottom.
   * During streaming, use instant scroll for responsiveness.
   * When not streaming, use smooth scroll for polish.
   * @param {boolean} [forceSmooth=false] - Force smooth scrolling (e.g. for new messages)
   */
  function autoScroll(forceSmooth = false) {
    if (!scrollContainer) return;
    if (userScrolledUp) return;

    const behavior = forceSmooth ? 'smooth'
      : chatStore.isStreaming ? 'instant'
      : 'smooth';

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior,
    });
  }

  /** Clear all messages from the current chat.
   *  Immediately persists empty state to disk (bypasses the 500ms auto-save
   *  debounce) so messages don't resurrect if the app is closed quickly. */
  async function handleClear() {
    const activeId = chatStore.activeChatId;
    chatStore.clearMessages();

    // Flush empty messages to disk immediately
    if (activeId) {
      try {
        const result = await chatLoad(activeId);
        const chat = result?.data || result;
        if (chat) {
          chat.messages = [];
          chat.updatedAt = Date.now();
          await chatSave(chat);
        }
      } catch (err) {
        console.warn('[ChatPanel] Failed to persist clear:', err);
      }
    }
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

  /** Open the screenshot picker modal. Captures browser preview first if active. */
  async function handleScreenshot() {
    // Capture the Lens browser while it's still visible
    if (lensStore.webviewReady) {
      try {
        const result = await lensCapturePreview();
        console.log('[ChatPanel] lensCapturePreview result:', result);
        // IpcResponse: { success, data?: { path, thumbnail, dataUrl }, error? }
        if (result?.success && result?.data) {
          browserSnapshot = result.data;
        } else {
          console.warn('[ChatPanel] Browser capture returned error:', result?.error || result);
          browserSnapshot = null;
        }
      } catch (err) {
        console.error('[ChatPanel] lensCapturePreview threw:', err);
        browserSnapshot = null;
      }
    } else {
      console.log('[ChatPanel] webviewReady is false, skipping browser capture');
      browserSnapshot = null;
    }
    showScreenshotPicker = true;
  }

  /** Called when a screenshot is captured from the picker. */
  function handleScreenshotCapture(path, dataUrl) {
    showScreenshotPicker = false;
    attachmentsStore.add({ path, dataUrl, type: 'image/png', name: 'Screenshot' });
  }

  /** Remove an attachment by index from the pending list. */
  function handleRemoveAttachment(index) {
    attachmentsStore.remove(index);
  }

  /** Clear all pending attachments. */
  function handleClearAttachments() {
    attachmentsStore.clear();
  }

  /** Called when the screenshot picker is closed without capturing. */
  function handleScreenshotClose() {
    showScreenshotPicker = false;
  }

  // Track previous message count to detect new messages
  let prevMessageCount = 0;

  // Auto-scroll when new messages are added (length changes)
  $effect(() => {
    const len = chatStore.messages.length;
    if (!scrollContainer || len === 0) return;

    if (len > prevMessageCount) {
      // New message arrived — reset scroll lock so we follow it
      userScrolledUp = false;
    }
    prevMessageCount = len;

    tick().then(() => {
      autoScroll(true);
    });
  });

  // Auto-scroll during streaming updates (text content changes).
  // Only reads .length and .streaming to minimize proxy subscriptions.
  $effect(() => {
    const len = chatStore.messages.length;
    if (!scrollContainer || len === 0) return;
    const streaming = chatStore.isStreaming;
    if (!streaming) return;

    tick().then(() => {
      autoScroll();
    });
  });
</script>

<div class="chat-panel">
  <div class="chat-scroll-area" bind:this={scrollContainer} onscroll={handleScroll}>
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
      {browserSnapshot}
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
    overflow-x: hidden;
    padding: 12px 8px;
    position: relative;
  }

  .messages-container {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
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
