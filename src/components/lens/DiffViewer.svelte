<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { readFile, getFileGitContent, revealInExplorer } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { voiceMirrorEditorTheme } from '../../lib/editor-theme.js';
  import DiffToolbar from './DiffToolbar.svelte';
  import DiffMinimap from './DiffMinimap.svelte';

  let { tab } = $props();

  let editorEl;
  let unifiedView;   // EditorView for unified mode
  let splitView;      // MergeView for split mode
  let loading = $state(true);
  let error = $state(null);
  let isBinary = $state(false);
  let stats = $state({ additions: 0, deletions: 0 });

  // Diff mode and feature toggles
  let viewMode = $state('unified');  // 'unified' | 'split'
  let wordWrap = $state(false);
  let showWhitespace = $state(false);

  // Chunk navigation state
  let chunkCount = $state(0);
  let currentChunkIndex = $state(-1);

  // Minimap chunk data (updated alongside chunkCount)
  let minimapChunks = $state([]);
  let totalLines = $state(0);

  // Content stored at component scope for mode switching
  let oldContent = $state('');
  let newContent = $state('');

  // Context menu state
  let contextMenu = $state({ visible: false, x: 0, y: 0 });
  let menuEl = $state(null);

  let menuStyle = $derived.by(() => {
    const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : contextMenu.x;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - 200 : contextMenu.y;
    return `left: ${Math.min(contextMenu.x, maxX)}px; top: ${Math.min(contextMenu.y, maxY)}px;`;
  });

  // ── CM module cache (loadCM pattern from FileEditor) ──

  let cmCache = null;

  async function loadCM() {
    if (cmCache) return cmCache;
    const [
      { EditorView, basicSetup },
      { EditorState },
      { keymap },
      { MergeView, unifiedMergeView, getChunks, goToNextChunk, goToPreviousChunk },
    ] = await Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/merge'),
    ]);
    cmCache = { EditorView, basicSetup, EditorState, keymap, MergeView, unifiedMergeView, getChunks, goToNextChunk, goToPreviousChunk };
    return cmCache;
  }

  // ── Context menu handlers ──

  function closeMenu() {
    contextMenu.visible = false;
  }

  function handleMenuClickOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  function handleMenuKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  }

  $effect(() => {
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleMenuClickOutside, true);
      document.addEventListener('keydown', handleMenuKeydown, true);
      return () => {
        document.removeEventListener('mousedown', handleMenuClickOutside, true);
        document.removeEventListener('keydown', handleMenuKeydown, true);
      };
    }
  });

  function getActiveView() {
    if (viewMode === 'unified') return unifiedView;
    if (splitView) return splitView.b;
    return null;
  }

  function menuCopy() {
    closeMenu();
    const v = getActiveView();
    if (v) {
      const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
      if (sel) navigator.clipboard.writeText(sel);
    }
  }

  function menuSelectAll() {
    closeMenu();
    const v = getActiveView();
    if (v) {
      v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
      v.focus();
    }
  }

  function menuOpenFile() {
    closeMenu();
    const fileName = tab.path.split(/[/\\]/).pop() || tab.path;
    tabsStore.openFile({ name: fileName, path: tab.path });
  }

  function menuCopyPath() {
    closeMenu();
    const root = projectStore.activeProject?.path || '';
    const fullPath = root ? `${root}/${tab.path}` : tab.path;
    navigator.clipboard.writeText(fullPath);
  }

  function menuCopyRelativePath() {
    closeMenu();
    navigator.clipboard.writeText(tab.path);
  }

  function menuReveal() {
    closeMenu();
    revealInExplorer(tab.path, projectStore.activeProject?.path || null);
  }

  // ── Language support ──

  async function loadLanguage(filePath) {
    const ext = filePath?.split('.').pop()?.toLowerCase() || '';
    try {
      switch (ext) {
        case 'js': case 'jsx': case 'mjs': case 'cjs': {
          const { javascript } = await import('@codemirror/lang-javascript');
          return javascript();
        }
        case 'ts': case 'tsx': {
          const { javascript } = await import('@codemirror/lang-javascript');
          return javascript({ typescript: true });
        }
        case 'rs': {
          const { rust } = await import('@codemirror/lang-rust');
          return rust();
        }
        case 'css': case 'scss': {
          const { css } = await import('@codemirror/lang-css');
          return css();
        }
        case 'html': case 'svelte': {
          const { html } = await import('@codemirror/lang-html');
          return html();
        }
        case 'json': {
          const { json } = await import('@codemirror/lang-json');
          return json();
        }
        case 'md': case 'markdown': {
          const { markdown } = await import('@codemirror/lang-markdown');
          return markdown();
        }
        case 'py': case 'python': {
          const { python } = await import('@codemirror/lang-python');
          return python();
        }
        default:
          return [];
      }
    } catch (err) {
      console.warn('[DiffViewer] Language load failed for', ext, err);
      return [];
    }
  }

  // ── Stats counting ──

  function countChanges(oldText, newText) {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    const oldSet = new Map();
    for (const line of oldLines) {
      oldSet.set(line, (oldSet.get(line) || 0) + 1);
    }
    const newSet = new Map();
    for (const line of newLines) {
      newSet.set(line, (newSet.get(line) || 0) + 1);
    }
    let additions = 0;
    let deletions = 0;
    for (const [line, count] of newSet) {
      const oldCount = oldSet.get(line) || 0;
      if (count > oldCount) additions += count - oldCount;
    }
    for (const [line, count] of oldSet) {
      const newCount = newSet.get(line) || 0;
      if (count > newCount) deletions += count - newCount;
    }
    return { additions, deletions };
  }

  // ── Whitespace normalization ──

  function normalizeWhitespace(text) {
    return text.split('\n').map(line => line.trimEnd()).join('\n');
  }

  // ── Shared extensions builder ──

  function buildSharedExtensions(cm, langSupport) {
    const contextMenuHandler = cm.EditorView.domEventHandlers({
      contextmenu: (event) => {
        event.preventDefault();
        contextMenu = { visible: true, x: event.clientX, y: event.clientY };
        return true;
      },
    });

    const dismissMenuOnChange = cm.EditorView.updateListener.of((update) => {
      if ((update.docChanged || update.viewportChanged) && contextMenu.visible) {
        contextMenu.visible = false;
      }
    });

    const wrapExt = wordWrap ? cm.EditorView.lineWrapping : [];

    const exts = [
      cm.basicSetup,
      ...voiceMirrorEditorTheme,
      cm.EditorView.editable.of(false),
      cm.EditorState.readOnly.of(true),
      contextMenuHandler,
      dismissMenuOnChange,
      wrapExt,
    ];

    // Add language support
    if (langSupport && !Array.isArray(langSupport)) {
      exts.splice(1, 0, langSupport);
    } else if (Array.isArray(langSupport) && langSupport.length > 0) {
      exts.splice(1, 0, ...langSupport);
    }

    return exts;
  }

  // ── Chunk tracking ──

  function updateChunkInfo(cm, v) {
    if (!v) { chunkCount = 0; currentChunkIndex = -1; minimapChunks = []; return; }
    try {
      const info = cm.getChunks(v.state);
      if (!info) { chunkCount = 0; currentChunkIndex = -1; minimapChunks = []; return; }
      chunkCount = info.chunks.length;
      totalLines = v.state.doc.lines;
      // Find which chunk contains or is nearest to cursor
      const cursor = v.state.selection.main.head;
      let idx = -1;
      const mapChunks = [];
      for (let i = 0; i < info.chunks.length; i++) {
        const chunk = info.chunks[i];
        // Use document B positions for unified, check both sides for split
        const from = info.side === 'a' ? chunk.fromA : chunk.fromB;
        const to = info.side === 'a' ? chunk.toA : chunk.toB;
        if (cursor >= from && cursor <= to) { idx = i; }
        else if (idx === -1 && cursor < from) { idx = i; }
        // Build minimap chunk data
        const startLine = v.state.doc.lineAt(Math.min(from, v.state.doc.length)).number;
        const endLine = v.state.doc.lineAt(Math.min(Math.max(to - 1, from), v.state.doc.length)).number;
        const hasOld = chunk.fromA < chunk.toA;
        const hasNew = chunk.fromB < chunk.toB;
        const type = hasOld && hasNew ? 'change' : hasNew ? 'addition' : 'deletion';
        mapChunks.push({ startLine, endLine, type });
      }
      if (idx === -1 && info.chunks.length > 0) idx = info.chunks.length - 1;
      currentChunkIndex = idx;
      minimapChunks = mapChunks;
    } catch {
      chunkCount = 0;
      currentChunkIndex = -1;
      minimapChunks = [];
    }
  }

  // ── View creation ──

  async function createUnifiedView(cm, langSupport) {
    const effectiveOld = showWhitespace ? normalizeWhitespace(oldContent) : oldContent;
    const effectiveNew = showWhitespace ? normalizeWhitespace(newContent) : newContent;

    const shared = buildSharedExtensions(cm, langSupport);

    const chunkTracker = cm.EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        updateChunkInfo(cm, update.view);
      }
    });

    const navKeymap = cm.keymap.of([
      { key: 'Alt-ArrowDown', run: cm.goToNextChunk },
      { key: 'Alt-ArrowUp', run: cm.goToPreviousChunk },
    ]);

    const extensions = [
      ...shared,
      chunkTracker,
      navKeymap,
      cm.unifiedMergeView({
        original: effectiveOld,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
      }),
    ];

    const state = cm.EditorState.create({
      doc: effectiveNew,
      extensions,
    });

    await tick();

    if (editorEl) {
      unifiedView = new cm.EditorView({ state, parent: editorEl });
      updateChunkInfo(cm, unifiedView);
    }
  }

  async function createSplitView(cm, langSupport) {
    const effectiveOld = showWhitespace ? normalizeWhitespace(oldContent) : oldContent;
    const effectiveNew = showWhitespace ? normalizeWhitespace(newContent) : newContent;

    const sharedA = buildSharedExtensions(cm, langSupport);
    const sharedB = buildSharedExtensions(cm, langSupport);

    // Add chunk tracker to side B
    const chunkTracker = cm.EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        updateChunkInfo(cm, update.view);
      }
    });

    const navKeymap = cm.keymap.of([
      { key: 'Alt-ArrowDown', run: cm.goToNextChunk },
      { key: 'Alt-ArrowUp', run: cm.goToPreviousChunk },
    ]);

    sharedB.push(chunkTracker, navKeymap);

    await tick();

    if (editorEl) {
      splitView = new cm.MergeView({
        a: { doc: effectiveOld, extensions: sharedA },
        b: { doc: effectiveNew, extensions: sharedB },
        parent: editorEl,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
      updateChunkInfo(cm, splitView.b);
    }
  }

  // ── Destroy/toggle ──

  function destroyView() {
    if (unifiedView) { unifiedView.destroy(); unifiedView = null; }
    if (splitView) { splitView.destroy(); splitView = null; }
    if (editorEl) editorEl.innerHTML = '';
    chunkCount = 0;
    currentChunkIndex = -1;
  }

  async function toggleMode() {
    const cm = await loadCM();
    const langSupport = await loadLanguage(tab.path);
    destroyView();
    if (viewMode === 'unified') {
      viewMode = 'split';
      await createSplitView(cm, langSupport);
    } else {
      viewMode = 'unified';
      await createUnifiedView(cm, langSupport);
    }
  }

  // ── Navigation ──

  function navigateChunk(direction) {
    const v = getActiveView();
    if (!v) return;
    const cm = cmCache;
    if (!cm) return;
    if (direction === 'next') {
      cm.goToNextChunk(v);
    } else {
      cm.goToPreviousChunk(v);
    }
    // Update chunk info after navigation
    updateChunkInfo(cm, v);
  }

  // ── Toggles ──

  async function toggleWrap() {
    wordWrap = !wordWrap;
    const cm = await loadCM();
    const langSupport = await loadLanguage(tab.path);
    destroyView();
    if (viewMode === 'unified') {
      await createUnifiedView(cm, langSupport);
    } else {
      await createSplitView(cm, langSupport);
    }
  }

  async function toggleWhitespace() {
    showWhitespace = !showWhitespace;
    const cm = await loadCM();
    const langSupport = await loadLanguage(tab.path);
    destroyView();
    if (viewMode === 'unified') {
      await createUnifiedView(cm, langSupport);
    } else {
      await createSplitView(cm, langSupport);
    }
  }

  // ── Mount ──

  onMount(async () => {
    try {
      const root = projectStore.activeProject?.path || null;

      const [oldResult, newResult] = await Promise.all([
        tab.status === 'added'
          ? Promise.resolve({ success: true, data: { content: '', isNew: true } })
          : getFileGitContent(tab.path, root),
        tab.status === 'deleted'
          ? Promise.resolve({ success: true, data: { content: '' } })
          : readFile(tab.path, root),
      ]);

      const oldData = oldResult?.data || oldResult;
      const newData = newResult?.data || newResult;

      if (oldData?.binary || newData?.binary) {
        isBinary = true;
        loading = false;
        return;
      }

      if (oldResult?.error && tab.status !== 'added') {
        error = oldResult.error;
        loading = false;
        return;
      }
      if (newResult?.error && tab.status !== 'deleted') {
        error = newResult.error;
        loading = false;
        return;
      }

      oldContent = oldData?.content ?? '';
      newContent = newData?.content ?? '';

      stats = countChanges(oldContent, newContent);
      tabsStore.setDiffStats(tab.id, stats);

      const cm = await loadCM();
      const langSupport = await loadLanguage(tab.path);

      loading = false;
      await createUnifiedView(cm, langSupport);
    } catch (err) {
      console.error('[DiffViewer] Mount failed:', err);
      error = err.message || 'Failed to load diff';
      loading = false;
    }
  });

  onDestroy(() => {
    destroyView();
  });
</script>

{#if isBinary}
  <div class="diff-placeholder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <span class="placeholder-title">Binary file</span>
    <span class="placeholder-detail">Cannot show diff for binary files.</span>
  </div>
{:else if error}
  <div class="diff-placeholder">
    <span class="error-text">{error}</span>
  </div>
{:else}
  {#if !loading}
    <DiffToolbar
      filePath={tab.path}
      {stats}
      {viewMode}
      {chunkCount}
      {currentChunkIndex}
      {wordWrap}
      {showWhitespace}
      onToggleMode={toggleMode}
      onPrevChunk={() => navigateChunk('prev')}
      onNextChunk={() => navigateChunk('next')}
      onToggleWrap={toggleWrap}
      onToggleWhitespace={toggleWhitespace}
    />
  {/if}
  <div class="diff-viewer-container">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="diff-viewer" bind:this={editorEl}
      oncontextmenu={(e) => {
        e.preventDefault();
        if (contextMenu.visible) return;
        contextMenu = { visible: true, x: e.clientX, y: e.clientY };
      }}
    >
      {#if loading}
        <div class="diff-loading">
          <span class="loading-text">Loading diff...</span>
        </div>
      {/if}
    </div>
    {#if !loading && minimapChunks.length > 0}
      <DiffMinimap chunks={minimapChunks} {totalLines} />
    {/if}
  </div>
{/if}

{#if contextMenu.visible}
  <div class="diff-context-menu" style={menuStyle} bind:this={menuEl} role="menu">
    <button class="diff-context-item" onclick={menuCopy} role="menuitem">
      Copy
      <span class="diff-context-shortcut">Ctrl+C</span>
    </button>
    <button class="diff-context-item" onclick={menuSelectAll} role="menuitem">
      Select All
      <span class="diff-context-shortcut">Ctrl+A</span>
    </button>
    <div class="diff-context-separator"></div>
    <button class="diff-context-item" onclick={menuOpenFile} role="menuitem">
      Open File
    </button>
    <div class="diff-context-separator"></div>
    <button class="diff-context-item" onclick={menuCopyPath} role="menuitem">Copy Path</button>
    <button class="diff-context-item" onclick={menuCopyRelativePath} role="menuitem">Copy Relative Path</button>
    <button class="diff-context-item" onclick={menuReveal} role="menuitem">Reveal in File Explorer</button>
  </div>
{/if}

<style>
  .diff-viewer-container {
    flex: 1;
    overflow: hidden;
    height: 100%;
    position: relative;
  }

  .diff-viewer {
    width: 100%;
    height: 100%;
  }

  /* Override CodeMirror to fill available space */
  .diff-viewer :global(.cm-editor) {
    height: 100%;
  }

  .diff-viewer :global(.cm-scroller) {
    overflow: auto;
  }

  /* Scrollbar + smooth scroll inherited from global base.css */

  /* ── MergeView (split mode) ── */
  .diff-viewer :global(.cm-mergeView) {
    height: 100%;
    overflow: auto;
  }

  /* Split mode: side A (old) colors */
  .diff-viewer :global(.cm-merge-a .cm-changedLine) {
    background: color-mix(in srgb, var(--danger) 16%, transparent) !important;
    border-left: 3px solid var(--danger);
  }

  .diff-viewer :global(.cm-merge-a .cm-changedText) {
    background: color-mix(in srgb, var(--danger) 32%, transparent) !important;
  }

  /* Split mode: side B (new) colors */
  .diff-viewer :global(.cm-merge-b .cm-changedLine) {
    background: color-mix(in srgb, var(--ok) 16%, transparent) !important;
    border-left: 3px solid var(--ok);
  }

  .diff-viewer :global(.cm-merge-b .cm-changedText) {
    background: color-mix(in srgb, var(--ok) 32%, transparent) !important;
  }

  /* ── Unified mode: green for additions, red for deletions ── */
  .diff-viewer :global(.cm-changedLine) {
    background: color-mix(in srgb, var(--ok) 16%, transparent) !important;
    border-left: 3px solid var(--ok);
  }

  .diff-viewer :global(.cm-deletedChunk) {
    background: color-mix(in srgb, var(--danger) 16%, transparent) !important;
    border-left: 3px solid var(--danger);
  }

  /* Inline word-level highlights */
  .diff-viewer :global(.cm-changedText) {
    background: color-mix(in srgb, var(--ok) 32%, transparent) !important;
  }

  .diff-viewer :global(.cm-deletedChunk .cm-deletedText),
  .diff-viewer :global(.cm-deletedText) {
    background: color-mix(in srgb, var(--danger) 32%, transparent) !important;
  }

  /* Gutter markers */
  .diff-viewer :global(.cm-changeGutter) {
    width: 3px;
    padding: 0;
  }

  /* ── Collapsed unchanged lines ── */
  .diff-viewer :global(.cm-collapsedLines) {
    border-top: 1px dashed var(--muted);
    border-bottom: 1px dashed var(--muted);
    color: var(--muted);
    font-style: italic;
    padding: 2px 12px;
    text-align: center;
    font-size: 12px;
    cursor: pointer;
  }

  .diff-viewer :global(.cm-collapsedLines:hover) {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .diff-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .diff-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .placeholder-title {
    font-weight: 600;
    color: var(--text);
    font-size: 14px;
  }

  .placeholder-detail {
    color: var(--muted);
    font-size: 12px;
  }

  .error-text {
    color: var(--danger, #ef4444);
  }

  /* Context menu */
  .diff-context-menu {
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

  .diff-context-item {
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

  .diff-context-item:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .diff-context-shortcut {
    color: var(--muted);
    font-size: 11px;
    margin-left: 24px;
  }

  .diff-context-item:hover .diff-context-shortcut {
    color: inherit;
    opacity: 0.7;
  }

  .diff-context-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
</style>
