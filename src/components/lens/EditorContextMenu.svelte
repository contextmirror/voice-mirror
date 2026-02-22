<script>
  let {
    x = 0,
    y = 0,
    visible = false,
    hasSelection = false,
    selectedText = '',
    hasLsp = false,
    hasDiagnostic = false,
    diagnosticMessage = '',
    filePath = '',
    lineNumber = 1,
    onClose = () => {},
    onAction = () => {},
  } = $props();

  // Clamp position to viewport
  let menuEl = $state(null);
  let menuStyle = $derived.by(() => {
    const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : x;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - 300 : y;
    return `left: ${Math.min(x, maxX)}px; top: ${Math.min(y, maxY)}px;`;
  });

  function close() {
    onClose();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function handleClickOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) {
      close();
    }
  }

  $effect(() => {
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('keydown', handleKeydown, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
        document.removeEventListener('keydown', handleKeydown, true);
      };
    }
  });

  // ── Diagnostic Actions ──

  function handleAiFix() {
    close();
    onAction('ai-fix', { diagnosticMessage, filePath, lineNumber });
  }

  // ── AI Actions ──

  function handleAiExplain() {
    close();
    onAction('ai-explain', { selectedText, filePath, lineNumber });
  }

  function handleAiRefactor() {
    close();
    onAction('ai-refactor', { selectedText, filePath, lineNumber });
  }

  function handleAiTest() {
    close();
    onAction('ai-test', { selectedText, filePath, lineNumber });
  }

  // ── LSP Actions ──

  function handleGotoDefinition() {
    close();
    onAction('goto-definition');
  }

  // ── Edit Actions ──

  function handleCut() {
    close();
    onAction('cut');
  }

  function handleCopy() {
    close();
    onAction('copy');
  }

  function handlePaste() {
    close();
    onAction('paste');
  }

  function handleSelectAll() {
    close();
    onAction('select-all');
  }

  // ── Folding Actions ──

  function handleFold() {
    close();
    onAction('fold');
  }

  function handleUnfold() {
    close();
    onAction('unfold');
  }

  function handleFoldAll() {
    close();
    onAction('fold-all');
  }

  function handleUnfoldAll() {
    close();
    onAction('unfold-all');
  }

  // ── File Actions ──

  function handleCopyPath() {
    close();
    onAction('copy-path');
  }

  function handleCopyRelativePath() {
    close();
    onAction('copy-relative-path');
  }

  function handleCopyMarkdown() {
    close();
    onAction('copy-markdown');
  }

  function handleReveal() {
    close();
    onAction('reveal');
  }
</script>

{#if visible}
  <div class="context-menu" style={menuStyle} bind:this={menuEl} role="menu">
    {#if hasDiagnostic}
      <button class="context-item" onclick={handleAiFix} role="menuitem">Fix This Error</button>
      <div class="context-separator"></div>
    {/if}

    {#if hasSelection}
      <button class="context-item" onclick={handleAiExplain} role="menuitem">Ask AI: Explain This</button>
      <button class="context-item" onclick={handleAiRefactor} role="menuitem">Ask AI: Refactor This</button>
      <button class="context-item" onclick={handleAiTest} role="menuitem">Ask AI: Add Tests</button>
      <div class="context-separator"></div>
    {/if}

    {#if hasLsp}
      <button class="context-item" onclick={handleGotoDefinition} role="menuitem">
        Go to Definition
        <span class="context-shortcut">Ctrl+Click</span>
      </button>
      <button class="context-item context-item-disabled" disabled role="menuitem">
        Find References
      </button>
      <div class="context-separator"></div>
    {/if}

    <button class="context-item" onclick={handleCut} role="menuitem">
      Cut
      <span class="context-shortcut">Ctrl+X</span>
    </button>
    <button class="context-item" onclick={handleCopy} role="menuitem">
      Copy
      <span class="context-shortcut">Ctrl+C</span>
    </button>
    <button class="context-item" onclick={handlePaste} role="menuitem">
      Paste
      <span class="context-shortcut">Ctrl+V</span>
    </button>
    <button class="context-item" onclick={handleSelectAll} role="menuitem">
      Select All
      <span class="context-shortcut">Ctrl+A</span>
    </button>
    <div class="context-separator"></div>

    <button class="context-item" onclick={handleFold} role="menuitem">Fold at Cursor</button>
    <button class="context-item" onclick={handleUnfold} role="menuitem">Unfold at Cursor</button>
    <button class="context-item" onclick={handleFoldAll} role="menuitem">Fold All</button>
    <button class="context-item" onclick={handleUnfoldAll} role="menuitem">Unfold All</button>
    <div class="context-separator"></div>

    <button class="context-item" onclick={handleCopyPath} role="menuitem">Copy Path</button>
    <button class="context-item" onclick={handleCopyRelativePath} role="menuitem">Copy Relative Path</button>
    <button class="context-item" onclick={handleCopyMarkdown} role="menuitem">Copy as Markdown</button>
    <button class="context-item" onclick={handleReveal} role="menuitem">Reveal in File Explorer</button>
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 10002;
    min-width: 200px;
    max-width: 280px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
    font-family: var(--font-family);
  }

  .context-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    -webkit-app-region: no-drag;
  }

  .context-item:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .context-item-disabled {
    opacity: 0.4;
    cursor: default;
  }

  .context-item-disabled:hover {
    background: transparent;
    color: var(--text);
  }

  .context-shortcut {
    color: var(--muted);
    font-size: 11px;
    margin-left: 24px;
  }

  .context-item:hover .context-shortcut {
    color: inherit;
    opacity: 0.7;
  }

  .context-item-disabled:hover .context-shortcut {
    color: var(--muted);
    opacity: 1;
  }

  .context-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
</style>
