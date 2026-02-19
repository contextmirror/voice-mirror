<script>
  /**
   * MessageGroup -- Slack-style message group with avatar, header, and stacked bubbles.
   *
   * Avatar on left for assistant, right for user. Shows sender name + timestamp.
   * Avatars driven by config presets or custom uploaded images.
   */
  import { fly } from 'svelte/transition';
  import { formatTime } from '../../lib/utils.js';
  import { configStore } from '../../lib/stores/config.svelte.js';
  import { resolveAvatar } from '../../lib/avatar-presets.js';
  import ChatBubble from './ChatBubble.svelte';

  let { group } = $props();

  const isUser = $derived(group.role === 'user');
  const senderName = $derived(isUser ? 'You' : (group.senderName || 'Assistant'));
  const groupTime = $derived(
    group.messages.length > 0
      ? formatTime(group.messages[0].timestamp)
      : ''
  );

  const mc = $derived(configStore.value?.appearance?.messageCard || {});
  const customAvatars = $derived(mc.customAvatars || []);
  const aiAvatar = $derived(resolveAvatar(mc.aiAvatar, customAvatars, 'ai'));
  const userAvatar = $derived(resolveAvatar(mc.userAvatar, customAvatars, 'user'));
  const avatar = $derived(isUser ? userAvatar : aiAvatar);
</script>

<div
  class="message-group"
  class:user={isUser}
  class:assistant={!isUser}
  transition:fly={{ y: 20, duration: 200 }}
>
  <div class="message-avatar" class:user-avatar={isUser} class:assistant-avatar={!isUser}>
    {#if avatar.type === 'image'}
      <img src={avatar.dataUrl} alt={avatar.name} class="avatar-image" />
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
        {@html avatar.svg}
      </svg>
    {/if}
  </div>

  <div class="message-content">
    <div class="message-header">
      <span class="message-sender">{senderName}</span>
      <span class="message-time">{groupTime}</span>
    </div>

    <div class="message-bubbles">
      {#each group.messages as message (message.id)}
        <ChatBubble {message} />
      {/each}
    </div>
  </div>
</div>

<style>
  .message-group {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }

  .message-group.user {
    flex-direction: row-reverse;
  }

  .message-avatar {
    width: var(--msg-avatar-size, 36px);
    height: var(--msg-avatar-size, 36px);
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--muted);
  }

  .user-avatar {
    background: var(--accent-subtle);
    border-color: var(--accent);
    color: var(--accent);
  }

  .assistant-avatar {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
    color: var(--accent-contrast);
    border-color: transparent;
  }

  .avatar-image {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .message-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    max-width: calc(100% - 48px);
    min-width: 0;
  }

  .message-group.user .message-content {
    align-items: flex-end;
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .message-group.user .message-header {
    flex-direction: row-reverse;
  }

  .message-sender {
    font-weight: 600;
    color: var(--text-strong);
  }

  .message-time {
    color: var(--muted);
  }

  .message-bubbles {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .message-group.user .message-bubbles {
    align-items: flex-end;
  }

</style>
