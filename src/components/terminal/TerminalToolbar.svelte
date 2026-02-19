<script>
  /**
   * TerminalToolbar -- Small toolbar above the terminal with clear, copy, paste buttons.
   *
   * Props:
   *   onClear {function} - Clear the terminal screen
   *   onCopy {function} - Copy selected text to clipboard
   *   onPaste {function} - Paste from clipboard into terminal
   */
  let {
    onClear = () => {},
    onCopy = () => {},
    onPaste = () => {},
  } = $props();
</script>

<div class="terminal-toolbar">
  <div class="toolbar-left">
    <span class="toolbar-title">Terminal</span>
  </div>
  <div class="toolbar-actions">
    <button class="toolbar-btn" onclick={onClear} title="Clear terminal">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
        <line x1="18" y1="9" x2="12" y2="15"/>
        <line x1="12" y1="9" x2="18" y2="15"/>
      </svg>
      <span class="btn-label">Clear</span>
    </button>
    <button class="toolbar-btn" onclick={onCopy} title="Copy selection (Ctrl+C)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span class="btn-label">Copy</span>
    </button>
    <button class="toolbar-btn" onclick={onPaste} title="Paste (Ctrl+V)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      </svg>
      <span class="btn-label">Paste</span>
    </button>
  </div>
</div>

<style>
  .terminal-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 36px;
    user-select: none;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-in-out),
                background var(--duration-fast) var(--ease-in-out);
  }

  .toolbar-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .toolbar-btn:active {
    color: var(--text-strong);
    background: var(--bg-accent);
  }

  .toolbar-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .btn-label {
    pointer-events: none;
  }

  .toolbar-btn svg {
    flex-shrink: 0;
  }
</style>
