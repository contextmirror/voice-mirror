<script>
  /**
   * OutputPanel.svelte -- VS Code-style output log viewer.
   *
   * Shows one log channel at a time with a dropdown to switch.
   * Auto-scrolls to bottom; pauses when user scrolls up.
   * Level filter buttons toggle visibility by severity.
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

  const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

  onMount(() => {
    outputStore.startListening();
  });
</script>

<div class="output-panel">
  <div class="output-toolbar">
    <select
      class="channel-select"
      value={outputStore.activeChannel}
      onchange={(e) => outputStore.switchChannel(e.target.value)}
    >
      {#each outputStore.channels as ch}
        <option value={ch}>{outputStore.channelLabels[ch]}</option>
      {/each}
    </select>

    <div class="level-filters">
      {#each LEVELS as lvl}
        <button
          class="level-btn"
          class:active={LEVELS.indexOf(outputStore.levelFilter) <= LEVELS.indexOf(lvl)}
          class:is-error={lvl === 'error'}
          class:is-warn={lvl === 'warn'}
          onclick={() => outputStore.setLevelFilter(lvl)}
          title="Show {lvl} and above"
        >
          {lvl.charAt(0).toUpperCase()}
        </button>
      {/each}
    </div>

    <div class="toolbar-spacer"></div>

    {#if !outputStore.autoScroll}
      <button class="scroll-btn" onclick={() => {
        outputStore.setAutoScroll(true);
        if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
      }} title="Scroll to bottom">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    {/if}

    <button class="clear-btn" onclick={() => outputStore.clearChannel()} title="Clear output">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
        <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
      </svg>
    </button>
  </div>

  <div
    class="output-log"
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
      <div class="log-empty">No log entries{outputStore.levelFilter !== 'trace' ? ` at ${outputStore.levelFilter} level or above` : ''}</div>
    {/if}
  </div>
</div>

<style>
  .output-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .output-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    min-height: 32px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    user-select: none;
  }

  .channel-select {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-family);
    padding: 2px 6px;
    cursor: pointer;
    outline: none;
  }

  .channel-select:focus {
    border-color: var(--accent);
  }

  .level-filters {
    display: flex;
    gap: 1px;
  }

  .level-btn {
    padding: 2px 6px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    opacity: 0.5;
  }

  .level-btn.active {
    opacity: 1;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--text);
  }

  .level-btn.is-error.active {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }

  .level-btn.is-warn.active {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }

  .toolbar-spacer {
    flex: 1;
  }

  .scroll-btn, .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .scroll-btn:hover, .clear-btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
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
</style>
