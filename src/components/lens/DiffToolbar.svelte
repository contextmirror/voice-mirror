<script>
  let {
    filePath = '',
    stats = { additions: 0, deletions: 0 },
    viewMode = 'unified',
    chunkCount = 0,
    currentChunkIndex = -1,
    wordWrap = false,
    showWhitespace = false,
    /** @type {(mode: string) => void} */
    onToggleMode = (_mode) => {},
    /** @type {(e?: MouseEvent) => void} */
    onPrevChunk = () => {},
    /** @type {(e?: MouseEvent) => void} */
    onNextChunk = () => {},
    /** @type {(e?: MouseEvent) => void} */
    onToggleWrap = () => {},
    /** @type {(e?: MouseEvent) => void} */
    onToggleWhitespace = () => {},
  } = $props();

  let displayPath = $derived(filePath.split(/[/\\]/).slice(-3).join('/'));
  let chunkLabel = $derived(
    chunkCount > 0 ? `${currentChunkIndex + 1} of ${chunkCount}` : '0 of 0'
  );
  let hasPrev = $derived(currentChunkIndex > 0);
  let hasNext = $derived(currentChunkIndex < chunkCount - 1);
</script>

<div class="diff-toolbar">
  <span class="diff-file-path" title={filePath}>{displayPath}</span>

  <div class="diff-toolbar-group">
    <button
      class="diff-btn"
      class:active={viewMode === 'unified'}
      onclick={() => onToggleMode('unified')}
      aria-label="Unified view"
      title="Unified view"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="6" x2="20" y2="6"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="18" x2="20" y2="18"/>
      </svg>
    </button>
    <button
      class="diff-btn"
      class:active={viewMode === 'split'}
      onclick={() => onToggleMode('split')}
      aria-label="Split view"
      title="Split view"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="18" rx="1"/>
        <rect x="14" y="3" width="7" height="18" rx="1"/>
      </svg>
    </button>
  </div>

  <span class="diff-toolbar-separator"></span>

  <div class="diff-toolbar-group">
    <button
      class="diff-btn"
      disabled={!hasPrev}
      onclick={() => onPrevChunk()}
      aria-label="Previous change"
      title="Previous change"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
    </button>
    <span class="diff-chunk-label">{chunkLabel}</span>
    <button
      class="diff-btn"
      disabled={!hasNext}
      onclick={() => onNextChunk()}
      aria-label="Next change"
      title="Next change"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  </div>

  <span class="diff-toolbar-separator"></span>

  <div class="diff-toolbar-group">
    <button
      class="diff-btn"
      class:active={wordWrap}
      onclick={() => onToggleWrap()}
      aria-label="Toggle word wrap"
      title="Toggle word wrap"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6h16"/>
        <path d="M4 12h13a3 3 0 0 1 0 6h-4"/>
        <polyline points="13 15 9 18 13 21"/>
      </svg>
    </button>
    <button
      class="diff-btn"
      class:active={showWhitespace}
      onclick={() => onToggleWhitespace()}
      aria-label="Toggle whitespace"
      title="Toggle whitespace"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v16"/>
        <path d="M8 8c0-2.2 1.8-4 4-4s4 1.8 4 4"/>
        <circle cx="6" cy="18" r="1" fill="currentColor"/>
        <circle cx="12" cy="18" r="1" fill="currentColor"/>
        <circle cx="18" cy="18" r="1" fill="currentColor"/>
      </svg>
    </button>
  </div>

  <div class="diff-stats">
    {#if stats.additions > 0}
      <span class="diff-stat-add">+{stats.additions}</span>
    {/if}
    {#if stats.deletions > 0}
      <span class="diff-stat-del">-{stats.deletions}</span>
    {/if}
  </div>
</div>

<style>
  .diff-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .diff-file-path {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .diff-toolbar-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .diff-toolbar-separator {
    width: 1px;
    height: 16px;
    background: var(--border);
    flex-shrink: 0;
  }

  .diff-btn {
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
    transition: background var(--duration-fast) var(--ease-out);
  }

  .diff-btn:hover:not(:disabled) {
    background: var(--bg);
  }

  .diff-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .diff-btn.active {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .diff-chunk-label {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    min-width: 48px;
    text-align: center;
  }

  .diff-stats {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .diff-stat-add {
    color: var(--ok);
  }

  .diff-stat-del {
    color: var(--danger);
  }
</style>
