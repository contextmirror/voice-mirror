<script>
  /**
   * ChatBubble -- Single message bubble with markdown rendering,
   * streaming support, tool cards, and copy button.
   */
  import { fly } from 'svelte/transition';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { renderMarkdown } from '../../lib/markdown.js';
  import StreamingCursor from './StreamingCursor.svelte';
  import ToolCard from './ToolCard.svelte';

  let { message } = $props();

  let copied = $state(false);

  const isUser = $derived(message.role === 'user');
  const isError = $derived(message.role === 'error');
  const htmlContent = $derived(renderMarkdown(message.text));
  const hasToolCalls = $derived(
    message.toolCalls !== null
    && message.toolCalls !== undefined
    && message.toolCalls.length > 0
  );
  const attachments = $derived(message.attachments || []);
  const hasAttachments = $derived(attachments.length > 0);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.text);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }
</script>

<div
  class="chat-bubble"
  class:user={isUser}
  class:assistant={!isUser && !isError}
  class:error={isError}
  class:streaming={message.streaming}
  transition:fly={{ y: 12, duration: 250 }}
>
  <div class="bubble-content">
    {#if hasAttachments}
      <div class="bubble-attachments">
        {#each attachments as att}
          <img src={convertFileSrc(att.path)} alt={att.name || 'Attachment'} class="bubble-attachment-img" />
        {/each}
      </div>
    {/if}
    {#if message.text}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html htmlContent}
    {/if}
    {#if message.streaming}
      <StreamingCursor />
    {/if}
  </div>

  {#if hasToolCalls}
    <div class="tool-calls-section">
      {#each message.toolCalls as tool (tool.id || tool.name)}
        <ToolCard {tool} />
      {/each}
    </div>
  {/if}

  {#if message.streaming}
    <div class="streaming-indicator">
      <span class="streaming-dot"></span>
    </div>
  {/if}

  {#if !message.streaming}
    <div class="bubble-meta">
      <button
        class="copy-btn"
        class:copied
        onclick={copyText}
        title={copied ? 'Copied!' : 'Copy message'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy message text'}
      >
        {#if copied}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .chat-bubble {
    max-width: 85%;
    padding: var(--msg-padding);
    border-radius: var(--msg-ai-radius);
    background: var(--msg-ai-bg);
    border: 1px solid var(--msg-ai-border);
    font-size: var(--msg-font-size);
    line-height: var(--msg-line-height);
    align-self: flex-start;
    word-wrap: break-word;
    overflow-wrap: break-word;
    position: relative;
  }

  .chat-bubble.user {
    align-self: flex-end;
    width: max-content;
    max-width: 600px;
    background: var(--msg-user-bg);
    border-color: var(--msg-user-border);
    border-radius: var(--msg-user-radius);
  }

  .chat-bubble.error {
    border-color: var(--danger);
    background: var(--danger-subtle);
  }

  .chat-bubble.streaming {
    border-color: var(--accent);
  }

  .chat-bubble.assistant {
    box-shadow: var(--shadow-sm), inset 0 1px 0 var(--card-highlight);
  }

  /* Markdown content styling */
  .bubble-content :global(p) {
    margin: 0 0 8px 0;
  }

  .bubble-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .bubble-content :global(pre) {
    margin: 8px 0;
    padding: 10px 12px;
    background: var(--bg);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    overflow-x: auto;
    font-size: 13px;
  }

  .bubble-content :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85em;
    line-height: 1.5;
  }

  .bubble-content :global(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--bg);
    padding: 0.15em 0.4em;
    border-radius: var(--radius-sm);
  }

  .bubble-content :global(ul),
  .bubble-content :global(ol) {
    padding-left: 20px;
    margin: 8px 0;
  }

  .bubble-content :global(li) {
    margin: 0.25em 0;
  }

  .bubble-content :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding: 8px 12px;
    margin: 8px 0;
    color: var(--muted);
    background: var(--card-highlight);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .bubble-content :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .bubble-content :global(a:hover) {
    color: var(--accent-hover);
  }

  .bubble-content :global(strong) {
    font-weight: 600;
    color: var(--text-strong);
  }

  .bubble-content :global(h1),
  .bubble-content :global(h2),
  .bubble-content :global(h3),
  .bubble-content :global(h4) {
    color: var(--text-strong);
    margin: 1em 0 0.5em 0;
    font-weight: 600;
  }

  .bubble-content :global(h1:first-child),
  .bubble-content :global(h2:first-child),
  .bubble-content :global(h3:first-child),
  .bubble-content :global(h4:first-child) {
    margin-top: 0;
  }

  .bubble-content :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1em 0;
  }

  .bubble-content :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
    font-size: 0.9em;
  }

  .bubble-content :global(th),
  .bubble-content :global(td) {
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
  }

  .bubble-content :global(th) {
    background: var(--card-highlight);
    font-weight: 600;
  }

  /* Attachment images */
  .bubble-attachments {
    margin-bottom: 8px;
  }

  .bubble-attachment-img {
    max-width: 100%;
    max-height: 300px;
    border-radius: var(--radius-sm);
    object-fit: contain;
    display: block;
  }

  /* Tool calls section */
  .tool-calls-section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  /* Copy button — absolutely positioned so it doesn't affect bubble sizing */
  .bubble-meta {
    position: absolute;
    bottom: 4px;
    right: 4px;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    color: var(--muted);
    background: var(--bg-elevated);
    transition: all var(--duration-fast) var(--ease-in-out);
    opacity: 0;
    pointer-events: none;
  }

  .chat-bubble:hover .copy-btn {
    opacity: 0.7;
    pointer-events: auto;
  }

  .copy-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
    opacity: 1;
  }

  .copy-btn:focus-visible {
    opacity: 1;
    pointer-events: auto;
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .copy-btn.copied {
    opacity: 1;
    pointer-events: auto;
    color: var(--ok);
  }

  /* Streaming indicator — in-flow below text */
  .streaming-indicator {
    margin-top: 6px;
  }

  .streaming-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  @media (prefers-reduced-motion: reduce) {
    .streaming-dot {
      animation: none;
      opacity: 0.7;
    }
  }
</style>
