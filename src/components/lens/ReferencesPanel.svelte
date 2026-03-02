<script>
  import { basename } from '../../lib/utils.js';

  let {
    references = [],
    visible = false,
    /** @type {(e?: MouseEvent) => void} */
    onClose = () => {},
    /** @type {(ref: any) => void} */
    onNavigate = (_ref) => {},
  } = $props();
</script>

{#if visible && references.length > 0}
  <div class="references-panel">
    <div class="references-header">
      <span class="references-count">{references.length} reference{references.length === 1 ? '' : 's'}</span>
      <button class="references-close" onclick={() => onClose()} aria-label="Close">x</button>
    </div>
    <div class="references-list">
      {#each references as ref}
        <button
          class="reference-item"
          onclick={() => onNavigate(ref)}
        >
          <span class="ref-file">{basename(ref.path || ref.uri)}</span>
          <span class="ref-line">:{(ref.range?.start?.line ?? ref.line ?? 0) + 1}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .references-panel {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 200px;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    z-index: 10001;
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
  }

  .references-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .references-count {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .references-close {
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 3px;
    -webkit-app-region: no-drag;
  }

  .references-close:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .references-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .reference-item {
    display: flex;
    align-items: center;
    width: 100%;
    border: none;
    background: transparent;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
    -webkit-app-region: no-drag;
  }

  .reference-item:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .ref-file {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ref-line {
    color: var(--muted);
    flex-shrink: 0;
  }

  .reference-item:hover .ref-line {
    color: inherit;
    opacity: 0.7;
  }
</style>
