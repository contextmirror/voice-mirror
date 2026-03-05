<script>
  import { revealInExplorer } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { copyFullPath, copyRelativePath } from '../../lib/utils.js';
  import { clampToViewport } from '$lib/clamp-to-viewport.js';
  import { setupClickOutside } from '$lib/popup-utils.js';

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
    if (visible && menuEl) clampToViewport(menuEl);
  });

  function close() {
    onClose();
  }

  $effect(() => {
    if (visible) return setupClickOutside(menuEl, close);
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

  function handleGotoTypeDefinition() {
    close();
    if (lsp && view) {
      const pos = view.state.selection.main.head;
      lsp.handleGoToTypeDefinition(view, pos);
    }
  }

  function handleGotoImplementation() {
    close();
    if (lsp && view) {
      const pos = view.state.selection.main.head;
      lsp.handleGoToImplementation(view, pos);
    }
  }

  function handleFormatSelection() {
    close();
    if (lsp && view) lsp.formatSelection(view, filePath);
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
    copyFullPath(filePath, projectStore.root);
  }

  function handleCopyRelativePath() {
    close();
    copyRelativePath(filePath);
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
    revealInExplorer(filePath, projectStore.root);
  }
</script>

{#if visible}
  <div class="context-menu" style={menuStyle} bind:this={menuEl} role="menu">
    {#if hasDiagnostic}
      <button class="context-menu-item" onclick={handleAiFix} role="menuitem">Fix This Error</button>
      <div class="context-menu-divider"></div>
    {/if}

    {#if hasSelection}
      <button class="context-menu-item" onclick={handleAiExplain} role="menuitem">Ask AI: Explain This</button>
      <button class="context-menu-item" onclick={handleAiRefactor} role="menuitem">Ask AI: Refactor This</button>
      <button class="context-menu-item" onclick={handleAiTest} role="menuitem">Ask AI: Add Tests</button>
      <div class="context-menu-divider"></div>
    {/if}

    {#if hasLsp}
      <button class="context-menu-item" onclick={handleGotoDefinition} role="menuitem">
        Go to Definition
        <span class="context-menu-shortcut">Ctrl+Click</span>
      </button>
      <button class="context-menu-item" onclick={handleGotoTypeDefinition} role="menuitem">
        Go to Type Definition
      </button>
      <button class="context-menu-item" onclick={handleGotoImplementation} role="menuitem">
        Go to Implementation
        <span class="context-menu-shortcut">Ctrl+F12</span>
      </button>
      <button class="context-menu-item" onclick={handleFindReferences} role="menuitem">
        Find References
        <span class="context-menu-shortcut">Shift+F12</span>
      </button>
      {#if !tab?.readOnly}
        <button class="context-menu-item" onclick={handleRenameSymbol} role="menuitem">
          Rename Symbol
          <span class="context-menu-shortcut">F2</span>
        </button>
      {/if}
      {#if hasDiagnostic}
        <button class="context-menu-item" onclick={handleQuickFix} role="menuitem">
          Quick Fix...
          <span class="context-menu-shortcut">Ctrl+.</span>
        </button>
      {/if}
      {#if hasSelection && !tab?.readOnly}
        <button class="context-menu-item" onclick={handleFormatSelection} role="menuitem">
          Format Selection
          <span class="context-menu-shortcut">Shift+Alt+F</span>
        </button>
      {/if}
      <div class="context-menu-divider"></div>
    {/if}

    {#if !tab?.readOnly}
      <button class="context-menu-item" onclick={handleCut} role="menuitem">
        Cut
        <span class="context-menu-shortcut">Ctrl+X</span>
      </button>
    {/if}
    <button class="context-menu-item" onclick={handleCopy} role="menuitem">
      Copy
      <span class="context-menu-shortcut">Ctrl+C</span>
    </button>
    {#if !tab?.readOnly}
      <button class="context-menu-item" onclick={handlePaste} role="menuitem">
        Paste
        <span class="context-menu-shortcut">Ctrl+V</span>
      </button>
    {/if}
    <button class="context-menu-item" onclick={handleSelectAll} role="menuitem">
      Select All
      <span class="context-menu-shortcut">Ctrl+A</span>
    </button>
    <div class="context-menu-divider"></div>

    <button class="context-menu-item" onclick={handleFold} role="menuitem">Fold at Cursor</button>
    <button class="context-menu-item" onclick={handleUnfold} role="menuitem">Unfold at Cursor</button>
    <button class="context-menu-item" onclick={handleFoldAll} role="menuitem">Fold All</button>
    <button class="context-menu-item" onclick={handleUnfoldAll} role="menuitem">Unfold All</button>
    <div class="context-menu-divider"></div>

    <button class="context-menu-item" onclick={handleCopyPath} role="menuitem">Copy Path</button>
    <button class="context-menu-item" onclick={handleCopyRelativePath} role="menuitem">Copy Relative Path</button>
    <button class="context-menu-item" onclick={handleCopyMarkdown} role="menuitem">Copy as Markdown</button>
    <button class="context-menu-item" onclick={handleReveal} role="menuitem">Reveal in File Explorer</button>
  </div>
{/if}

<style>
  @import '../../styles/context-menu.css';

  /* EditorContextMenu overrides */
  .context-menu {
    min-width: 200px;
    max-width: 280px;
    -webkit-app-region: no-drag;
  }

  .context-menu-item {
    justify-content: space-between;
    -webkit-app-region: no-drag;
  }

  .context-menu-item.disabled {
    color: var(--muted);
    cursor: default;
    opacity: 0.4;
  }

  .context-menu-item.disabled:hover {
    background: none;
    color: var(--text);
  }

  .context-menu-item.disabled:hover .context-menu-shortcut {
    color: var(--muted);
    opacity: 1;
  }
</style>
