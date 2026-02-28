<script>
  import { revealInExplorer } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

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
    view = null,
    tab = null,
    lsp = null,
    onClose = () => {},
    onSendToAi = () => {},
    onNavigateDefinition = () => {},
  } = $props();

  // Clamp position to viewport (initial placement, refined after render)
  let menuEl = $state(null);
  let menuStyle = $derived.by(() => {
    return `left: ${x}px; top: ${y}px;`;
  });

  // Post-render: measure actual menu size and reposition if it overflows
  $effect(() => {
    if (visible && menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const pad = 4;
      if (rect.bottom > window.innerHeight - pad) {
        menuEl.style.top = `${Math.max(pad, window.innerHeight - rect.height - pad)}px`;
      }
      if (rect.right > window.innerWidth - pad) {
        menuEl.style.left = `${Math.max(pad, window.innerWidth - rect.width - pad)}px`;
      }
    }
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

  function getLanguageFromPath(path) {
    const ext = path?.split('.').pop()?.toLowerCase() || '';
    const map = { js: 'javascript', ts: 'typescript', rs: 'rust', py: 'python', svelte: 'svelte', json: 'json', css: 'css', html: 'html', md: 'markdown' };
    return map[ext] || ext;
  }

  // ── Diagnostic Actions ──

  function handleAiFix() {
    close();
    const msg = `Error on line ${lineNumber} of \`${filePath}\`: "${diagnosticMessage}"\n\nFix this error.`;
    onSendToAi(msg);
  }

  // ── AI Actions ──

  function handleAiExplain() {
    close();
    const lang = getLanguageFromPath(filePath);
    const msg = `Looking at \`${filePath}\` line ${lineNumber}:\n\`\`\`${lang}\n${selectedText}\n\`\`\`\nExplain what this code does.`;
    onSendToAi(msg);
  }

  function handleAiRefactor() {
    close();
    const lang = getLanguageFromPath(filePath);
    const msg = `Looking at \`${filePath}\` line ${lineNumber}:\n\`\`\`${lang}\n${selectedText}\n\`\`\`\nRefactor this code to be cleaner and more maintainable.`;
    onSendToAi(msg);
  }

  function handleAiTest() {
    close();
    const lang = getLanguageFromPath(filePath);
    const msg = `Looking at \`${filePath}\` line ${lineNumber}:\n\`\`\`${lang}\n${selectedText}\n\`\`\`\nWrite tests for this code.`;
    onSendToAi(msg);
  }

  // ── LSP Actions ──

  function handleGotoDefinition() {
    close();
    onNavigateDefinition();
  }

  function handleFindReferences() {
    close();
    if (lsp && view) lsp.handleFindReferences(view, filePath);
  }

  function handleRenameSymbol() {
    close();
    if (lsp && view) lsp.handleRenameSymbol(view, filePath);
  }

  function handleQuickFix() {
    close();
    if (lsp && view) {
      const allDiags = lsp.cachedDiagnostics.get(filePath) || [];
      const pos = view.state.selection.main.head;
      const cursorDiags = allDiags.filter(d => pos >= d.from && pos <= d.to);
      lsp.handleCodeActions(view, filePath, cursorDiags);
    }
  }

  // ── Edit Actions ──

  function handleCut() {
    close();
    document.execCommand('cut');
  }

  function handleCopy() {
    close();
    document.execCommand('copy');
  }

  function handlePaste() {
    close();
    navigator.clipboard.readText().then(text => {
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text } });
    }).catch(err => console.warn('[editor] Clipboard read denied:', err));
  }

  function handleSelectAll() {
    close();
    if (view) view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  }

  // ── Folding Actions ──

  async function handleFold() {
    close();
    if (!view) return;
    const { foldCode } = await import('@codemirror/language');
    foldCode(view);
  }

  async function handleUnfold() {
    close();
    if (!view) return;
    const { unfoldCode } = await import('@codemirror/language');
    unfoldCode(view);
  }

  async function handleFoldAll() {
    close();
    if (!view) return;
    const { foldAll } = await import('@codemirror/language');
    foldAll(view);
  }

  async function handleUnfoldAll() {
    close();
    if (!view) return;
    const { unfoldAll } = await import('@codemirror/language');
    unfoldAll(view);
  }

  // ── File Actions ──

  function handleCopyPath() {
    close();
    const root = projectStore.activeProject?.path || '';
    const fullPath = root ? `${root}/${filePath}` : filePath;
    navigator.clipboard.writeText(fullPath.replace(/\//g, '\\'));
  }

  function handleCopyRelativePath() {
    close();
    navigator.clipboard.writeText(filePath);
  }

  function handleCopyMarkdown() {
    close();
    if (!view) return;
    const lang = getLanguageFromPath(filePath);
    const text = view.state.selection.main.empty
      ? view.state.doc.toString()
      : view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    navigator.clipboard.writeText(`\`${filePath}\`\n\`\`\`${lang}\n${text}\n\`\`\``);
  }

  function handleReveal() {
    close();
    revealInExplorer(filePath, projectStore.activeProject?.path || null);
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
      <button class="context-item" onclick={handleFindReferences} role="menuitem">
        Find References
        <span class="context-shortcut">Shift+F12</span>
      </button>
      {#if !tab?.readOnly}
        <button class="context-item" onclick={handleRenameSymbol} role="menuitem">
          Rename Symbol
          <span class="context-shortcut">F2</span>
        </button>
      {/if}
      {#if hasDiagnostic}
        <button class="context-item" onclick={handleQuickFix} role="menuitem">
          Quick Fix...
          <span class="context-shortcut">Ctrl+.</span>
        </button>
      {/if}
      <div class="context-separator"></div>
    {/if}

    {#if !tab?.readOnly}
      <button class="context-item" onclick={handleCut} role="menuitem">
        Cut
        <span class="context-shortcut">Ctrl+X</span>
      </button>
    {/if}
    <button class="context-item" onclick={handleCopy} role="menuitem">
      Copy
      <span class="context-shortcut">Ctrl+C</span>
    </button>
    {#if !tab?.readOnly}
      <button class="context-item" onclick={handlePaste} role="menuitem">
        Paste
        <span class="context-shortcut">Ctrl+V</span>
      </button>
    {/if}
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
