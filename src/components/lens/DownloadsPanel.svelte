<script>
  import { downloadsStore } from '../../lib/stores/downloads.svelte.js';

  let { onClose = () => {} } = $props();

  /**
   * Format a byte count to a human-readable string.
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Compute progress percentage (0–100). Returns null if total is unknown.
   * @param {import('../../lib/stores/downloads.svelte.js').DownloadEntry} entry
   * @returns {number|null}
   */
  function getProgress(entry) {
    if (!entry.totalBytes || entry.totalBytes <= 0) return null;
    return Math.min(100, Math.round((entry.receivedBytes / entry.totalBytes) * 100));
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="downloads-panel"
  onkeydown={handleKeydown}
  role="region"
  aria-label="Downloads"
>
  <div class="downloads-header">
    <button class="back-btn" onclick={onClose} title="Close downloads" aria-label="Close downloads">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <span class="downloads-title">Downloads</span>
    {#if downloadsStore.downloads.some(d => d.state !== 'downloading')}
      <button class="clear-btn" onclick={() => downloadsStore.clearCompleted()} title="Clear completed">
        Clear completed
      </button>
    {/if}
  </div>

  <div class="downloads-list">
    {#if downloadsStore.downloads.length === 0}
      <div class="empty-state">No downloads yet</div>
    {:else}
      {#each downloadsStore.downloads as entry (entry.id)}
        {@render downloadEntry(entry)}
      {/each}
    {/if}
  </div>
</div>

{#snippet downloadEntry(entry)}
  <div class="download-entry" class:failed={entry.state === 'failed' || entry.state === 'interrupted'} class:completed={entry.state === 'completed'}>
    <div class="entry-main">
      <div class="entry-icon">
        {#if entry.state === 'completed'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {:else if entry.state === 'failed' || entry.state === 'interrupted'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
        {/if}
      </div>

      <div class="entry-content">
        <span class="entry-filename" title={entry.filename}>{entry.filename}</span>
        <span class="entry-size">
          {#if entry.state === 'downloading'}
            {formatBytes(entry.receivedBytes)}{entry.totalBytes > 0 ? ` / ${formatBytes(entry.totalBytes)}` : ''}
          {:else if entry.state === 'completed'}
            {formatBytes(entry.totalBytes || entry.receivedBytes)}
          {:else if entry.state === 'failed'}
            Failed
          {:else if entry.state === 'interrupted'}
            Interrupted
          {/if}
        </span>
      </div>

      {#if entry.state === 'completed' && entry.path}
        <div class="entry-actions">
          <button
            class="action-btn"
            onclick={() => downloadsStore.openFile(entry.path)}
            title="Open file"
          >Open</button>
          <button
            class="action-btn"
            onclick={() => downloadsStore.openFolder(entry.path)}
            title="Show in folder"
          >Folder</button>
        </div>
      {/if}
    </div>

    {#if entry.state === 'downloading'}
      {@const pct = getProgress(entry)}
      <div class="progress-bar-track">
        {#if pct !== null}
          <div class="progress-bar-fill" style="width: {pct}%"></div>
        {:else}
          <div class="progress-bar-fill indeterminate"></div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .downloads-panel {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .downloads-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .back-btn:hover {
    background: var(--bg);
  }

  .downloads-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    flex: 1;
  }

  .clear-btn {
    font-size: 11px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
  }

  .clear-btn:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }

  .downloads-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }

  .download-entry {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .download-entry.completed {
    opacity: 0.75;
  }

  .download-entry.failed {
    background: color-mix(in srgb, var(--error, #f85149) 8%, transparent);
  }

  .entry-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .entry-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--muted);
  }

  .download-entry.failed .entry-icon {
    color: var(--error, #f85149);
  }

  .download-entry.completed .entry-icon {
    color: var(--success, #3fb950);
  }

  .entry-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-filename {
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  .entry-size {
    font-size: 11px;
    color: var(--muted);
  }

  .download-entry.failed .entry-size {
    color: var(--error, #f85149);
  }

  .entry-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .action-btn {
    font-size: 11px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
    white-space: nowrap;
  }

  .action-btn:hover {
    background: var(--bg-elevated);
  }

  .progress-bar-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 200ms ease-out;
  }

  .progress-bar-fill.indeterminate {
    width: 40%;
    animation: indeterminate 1.4s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
</style>
