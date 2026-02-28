<script>
  /**
   * OutputPanel.svelte -- VS Code-style output log viewer.
   *
   * Shows one log channel at a time. Controls (channel, level, clear)
   * live in the TerminalTabs tab bar, VS Code style.
   * Auto-scrolls to bottom; pauses when user scrolls up.
   */
  import { onMount } from 'svelte';
  import { outputStore } from '../../lib/stores/output.svelte.js';

  let logContainer;

  // Auto-scroll on new entries
  $effect(() => {
    // Access filteredEntries to create dependency
    const _ = outputStore.filteredEntries.length;
    if (outputStore.autoScroll && logContainer) {
      requestAnimationFrame(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
      });
    }
  });

  function handleScroll() {
    if (!logContainer) return;
    const atBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 30;
    outputStore.setAutoScroll(atBottom);
  }

  function levelClass(level) {
    switch (level) {
      case 'ERROR': return 'log-error';
      case 'WARN': return 'log-warn';
      case 'DEBUG': return 'log-debug';
      case 'TRACE': return 'log-trace';
      default: return '';
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  }

  onMount(() => {
    outputStore.startListening();
  });
</script>

<div class="output-panel">
  <div
    class="output-log"
    class:no-wrap={!outputStore.wordWrap}
    bind:this={logContainer}
    onscroll={handleScroll}
  >
    {#each outputStore.filteredEntries as entry (entry.id)}
      <div class="log-line {levelClass(entry.level)}">
        <span class="log-time">{formatTime(entry.timestamp)}</span>
        <span class="log-level">[{entry.level}]</span>
        <span class="log-msg">{entry.message}</span>
      </div>
    {/each}
    {#if outputStore.filteredEntries.length === 0}
      <div class="log-empty">No log entries</div>
    {/if}
  </div>

  {#if !outputStore.autoScroll}
    <button class="scroll-to-bottom" onclick={() => {
      outputStore.setAutoScroll(true);
      if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
    }} title="Scroll to bottom">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .output-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    position: relative;
  }

  .output-log {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 8px;
    font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: 11px;
    line-height: 1.5;
  }

  .log-line {
    white-space: pre-wrap;
    word-break: break-all;
  }

  .output-log.no-wrap .log-line {
    white-space: pre;
    word-break: normal;
  }

  .output-log.no-wrap {
    overflow-x: auto;
  }

  .log-time {
    color: var(--muted);
    margin-right: 6px;
  }

  .log-level {
    margin-right: 4px;
    font-weight: 600;
  }

  .log-line.log-error .log-level { color: var(--danger); }
  .log-line.log-error .log-msg { color: var(--danger); }
  .log-line.log-warn .log-level { color: var(--warn); }
  .log-line.log-warn .log-msg { color: var(--warn); }
  .log-line.log-debug { opacity: 0.65; }
  .log-line.log-trace { opacity: 0.4; }

  .log-empty {
    color: var(--muted);
    padding: 20px;
    text-align: center;
    font-size: 12px;
    opacity: 0.6;
  }

  /* Floating scroll-to-bottom button */
  .scroll-to-bottom {
    position: absolute;
    bottom: 12px;
    right: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-elevated);
    border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    color: var(--muted);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: color 0.15s, background 0.15s;
    z-index: 10;
  }

  .scroll-to-bottom:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }
</style>
