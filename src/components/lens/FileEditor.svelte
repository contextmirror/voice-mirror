<script>
  import { onDestroy, tick } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { readFile, readExternalFile, writeFile, getFileGitContent, lspRequestDefinition, lspApplyWorkspaceEdit, writeUserMessage, aiPtyInput } from '../../lib/api.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import EditorContextMenu from './EditorContextMenu.svelte';
  import ReferencesPanel from './ReferencesPanel.svelte';
  import CodeActionsMenu from './CodeActionsMenu.svelte';
  import RenameInput from './RenameInput.svelte';
  import SignatureHelp from './SignatureHelp.svelte';
  import { open } from '@tauri-apps/plugin-shell';
  import { voiceMirrorEditorTheme } from '../../lib/editor-theme.js';
  import { renderMarkdown } from '../../lib/markdown.js';
  import { createEditorLsp, LSP_EXTENSIONS, uriToRelativePath, lspPositionToOffset, mapCompletionKind } from '../../lib/editor-lsp.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { buildEditorExtensions, createIndentCompartments, detectIndentation, convertIndentation } from '../../lib/editor-extensions.js';
  import { navigationHistoryStore } from '../../lib/stores/navigation-history.svelte.js';
  import { basename, unwrapResult } from '../../lib/utils.js';
  import { gitGutterPlugin } from '../../lib/editor-git-gutter.js';
  import { loadLanguageExtension } from '../../lib/codemirror-languages.js';
  import { statusBarStore, getLanguageName } from '../../lib/stores/status-bar.svelte.js';

  let { tab, groupId = 1 } = $props();

  let editorEl;
  let view;
  let loading = $state(true);
  let error = $state(null);
  let isBinary = $state(false);
  let fileSize = $state(0);
  let currentPath = $state(null);

  // Conflict detection state — shown when file changes on disk while tab is dirty
  let conflictDetected = $state(false);

  // Markdown preview state
  let isMarkdown = $derived(!!tab?.path?.match(/\.(md|markdown)$/i));
  let markdownPreviewDefault = $derived(configStore.value?.editor?.markdownPreview !== false);
  let showPreview = $state(true);
  let markdownContent = $state('');

  // Context menu state
  let editorMenu = $state({ visible: false, x: 0, y: 0 });
  let menuContext = $state({
    hasSelection: false,
    selectedText: '',
    hasDiagnostic: false,
    diagnosticMessage: '',
    lineNumber: 0,
  });

  let sigHelpDebounce = null;

  // Indentation state (compartments for dynamic reconfiguration)
  const indentCompartments = createIndentCompartments();
  let currentIndent = $state({ type: 'spaces', size: 2 });

  // LSP helper (extracted to editor-lsp.svelte.js)
  const lsp = createEditorLsp();

  // Cache CodeMirror modules after first load
  let cmCache = null;

  async function loadCM() {
    if (cmCache) return cmCache;
    const [
      { EditorView, basicSetup },
      { EditorState, EditorSelection, StateEffect, StateField, RangeSet, Annotation },
      { keymap, hoverTooltip, ViewPlugin, Decoration, WidgetType, gutter, GutterMarker },
      { autocompletion },
      { setDiagnostics, lintGutter },
    ] = await Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/autocomplete'),
      import('@codemirror/lint'),
    ]);
    cmCache = { EditorView, basicSetup, EditorState, EditorSelection, StateEffect, StateField, RangeSet, Annotation, keymap, hoverTooltip, ViewPlugin, Decoration, WidgetType, gutter, GutterMarker, autocompletion, setDiagnostics, lintGutter };
    return cmCache;
  }

  const loadLanguage = loadLanguageExtension;

  // Range highlight decoration (VS Code-style rangeHighlight for Problems panel navigation)
  let rangeHighlightEffect = null;
  let clearRangeHighlightEffect = null;
  let rangeHighlightField = null;
  let rangeHighlightTimer = null;

  function initRangeHighlight(cm) {
    rangeHighlightEffect = cm.StateEffect.define();
    clearRangeHighlightEffect = cm.StateEffect.define();

    const highlightMark = cm.Decoration.mark({ class: 'cm-range-highlight' });
    const highlightLine = cm.Decoration.line({ class: 'cm-range-highlight-line' });

    rangeHighlightField = cm.StateField.define({
      create() { return cm.RangeSet.empty; },
      update(decos, tr) {
        for (const e of tr.effects) {
          if (e.is(clearRangeHighlightEffect)) return cm.RangeSet.empty;
          if (e.is(rangeHighlightEffect)) {
            const { from, to, wholeLine } = e.value;
            if (wholeLine) {
              // Highlight full lines
              const marks = [];
              for (let pos = from; pos <= to;) {
                const line = tr.state.doc.lineAt(pos);
                marks.push(highlightLine.range(line.from));
                pos = line.to + 1;
              }
              return cm.RangeSet.of(marks);
            }
            if (from < to) return cm.RangeSet.of([highlightMark.range(from, to)]);
            // Single point — highlight the whole line
            const line = tr.state.doc.lineAt(from);
            return cm.RangeSet.of([highlightLine.range(line.from)]);
          }
        }
        // Clear on user selection change (typing, clicking elsewhere)
        if (tr.selectionSet && !tr.effects.some(e => e.is(rangeHighlightEffect))) {
          return cm.RangeSet.empty;
        }
        return decos;
      },
      provide: f => cm.EditorView.decorations.from(f),
    });
  }

  function applyRangeHighlight(view, from, to) {
    if (!rangeHighlightEffect || !view) return;
    clearTimeout(rangeHighlightTimer);
    const wholeLine = from === to;
    view.dispatch({ effects: rangeHighlightEffect.of({ from, to, wholeLine }) });
    // Auto-clear after 3 seconds
    rangeHighlightTimer = setTimeout(() => {
      if (view && clearRangeHighlightEffect) {
        try { view.dispatch({ effects: clearRangeHighlightEffect.of(null) }); } catch {}
      }
    }, 3000);
  }

  function sendAiMessage(text) {
    chatStore.addMessage('user', text);
    if (aiStatusStore.isApiProvider) {
      aiPtyInput(text, null).catch(err => console.warn('[editor] AI send failed:', err));
    } else if (!aiStatusStore.isDictationProvider) {
      writeUserMessage(text).catch(err => console.warn('[editor] AI send failed:', err));
    }
  }

  async function handleFormat() {
    if (!view || !lsp.hasLsp) return;
    const root = projectStore.root;
    await lsp.formatDocument(view, currentPath, root);
  }

  const DEFAULT_FONT_SIZE = 14;
  const MIN_FONT_SIZE = 8;
  const MAX_FONT_SIZE = 32;

  function handleFontZoom(delta) {
    const current = configStore.value?.editor?.fontSize ?? DEFAULT_FONT_SIZE;
    let next;
    if (delta === 0) {
      next = DEFAULT_FONT_SIZE;
    } else {
      next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, current + delta));
    }
    if (next !== current) {
      updateConfig({ editor: { fontSize: next } });
    }
    // Immediately apply to DOM for responsiveness
    if (editorEl) {
      editorEl.style.setProperty('--cm-font-size', `${next}px`);
    }
  }

  // Apply persisted font size when editor mounts or config changes
  $effect(() => {
    const size = configStore.value?.editor?.fontSize ?? DEFAULT_FONT_SIZE;
    if (editorEl) {
      editorEl.style.setProperty('--cm-font-size', `${size}px`);
    }
  });

  function handleGoToDefinition() {
    if (!view || !lsp.hasLsp || !currentPath) return;
    const pos = view.state.selection.main.head;
    lsp.handleGoToDefinition(view, pos);
  }

  async function save() {
    if (!view) return;

    // Untitled files can't be saved without a real path
    if (tab.path?.startsWith('untitled:')) {
      console.warn('[FileEditor] Cannot save untitled file — use Save As');
      return;
    }

    try {
      const root = projectStore.root;

      // Format on save (if enabled)
      if (configStore.value?.editor?.formatOnSave && lsp.hasLsp) {
        try {
          await lsp.formatDocument(view, tab.path, root);
        } catch (err) {
          console.warn('[FileEditor] Format on save failed:', err);
        }
      }

      const content = view.state.doc.toString();
      await writeFile(tab.path, content, root);
      tabsStore.setDirty(tab.id, false);
      lsp.saveFile(tab.path, content, root);

      // Refresh git gutter after save (file on disk changed)
      const gp = view?.plugin?.(gitGutterPlugin);
      if (gp) gp.refreshOriginal();
    } catch (err) {
      console.error('[FileEditor] Save failed:', err);
    }
  }

  async function reloadFromDisk() {
    if (!view || !currentPath) return;
    try {
      const root = projectStore.root;
      const result = await readFile(currentPath, root);
      const data = unwrapResult(result);
      if (!data?.content || data.content == null) return;
      const currentContent = view.state.doc.toString();
      if (data.content !== currentContent) {
        view.dispatch({
          changes: { from: 0, to: currentContent.length, insert: data.content },
        });
      }
      markdownContent = data.content;
      tabsStore.setDirty(tab.id, false);
      conflictDetected = false;
    } catch (err) {
      console.warn('[FileEditor] Conflict reload failed:', err);
    }
  }

  function dismissConflict() {
    conflictDetected = false;
  }

  async function loadFile(filePath) {
    if (!filePath || filePath === currentPath) return;

    // Close previous LSP document
    if (currentPath && lsp.hasLsp) {
      const root = projectStore.root;
      lsp.closeFile(currentPath, root);
    }
    lsp.reset();
    clearTimeout(sigHelpDebounce);

    // CRITICAL: Destroy old view BEFORE setting currentPath.
    // Setting currentPath triggers the pending cursor $effect, which checks
    // `pending.path === currentPath`. If the old view still exists at that
    // point, the $effect fires applyPendingCursor on the WRONG editor,
    // consumes the pending cursor, and the real new editor never gets it.
    // By nulling view first, the $effect's `if (!view) return` guard works.
    if (view) {
      view.destroy();
      view = null;
    }

    currentPath = filePath;
    loading = true;
    error = null;
    isBinary = false;
    conflictDetected = false;
    showPreview = markdownPreviewDefault;

    // Check if this is an external (read-only) file
    const isExternal = tab?.external || false;
    const isReadOnly = tab?.readOnly || false;
    const isUntitled = filePath.startsWith('untitled:');

    try {
      const cm = await loadCM();
      const root = projectStore.root;

      let data;
      if (isUntitled) {
        // Untitled files start with empty content, no disk read
        data = { content: '' };
      } else {
        const result = isExternal
          ? await readExternalFile(filePath)
          : await readFile(filePath, root);
        data = unwrapResult(result);

        // Check if tab changed while loading
        if (filePath !== currentPath) return;

        if (!result?.success || result?.error) {
          error = result?.error || 'Failed to read file';
          loading = false;
          return;
        }

        if (data?.binary) {
          isBinary = true;
          fileSize = data.size || 0;
          loading = false;
          return;
        }

        if (data?.content == null) {
          error = 'Failed to read file';
          loading = false;
          return;
        }
      }

      // Store content for markdown preview
      markdownContent = data.content || '';

      const langSupport = await loadLanguage(filePath);

      // Check again if tab changed
      if (filePath !== currentPath) return;

      // Determine LSP support from file extension (no LSP for external files)
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      lsp.setHasLsp(!isExternal && LSP_EXTENSIONS.has(ext));

      const extensions = buildEditorExtensions(cm, lsp, {
        isReadOnly,
        filePath,
        voiceMirrorEditorTheme,
        onDocChanged: (update) => {
          tabsStore.setDirty(tab.id, true);
          tabsStore.pinTab(tab.id);
          markdownContent = update.state.doc.toString();
          if (lsp.hasLsp) {
            const content = update.state.doc.toString();
            const r = projectStore.root;
            lsp.changeFile(currentPath, content, r);
          }
        },
        onDismissMenu: () => {
          if (editorMenu.visible) {
            editorMenu.visible = false;
          }
        },
        onSave: () => save(),
        onFormat: lsp.hasLsp ? () => handleFormat() : null,
        onSignatureHelp: lsp.hasLsp ? {
          onDocChanged(update) {
            const pos = update.state.selection.main.head;
            if (pos === 0) return;
            const lastChar = update.state.doc.sliceString(pos - 1, pos);

            if (lastChar === '(' || lastChar === ',') {
              clearTimeout(sigHelpDebounce);
              sigHelpDebounce = setTimeout(async () => {
                await lsp.requestSignatureHelp(update.view, currentPath, lastChar);
              }, 80);
            } else if (lastChar === ')') {
              clearTimeout(sigHelpDebounce);
              lsp.dismissSignatureHelp();
            } else if (lsp.showSignatureHelp) {
              clearTimeout(sigHelpDebounce);
              sigHelpDebounce = setTimeout(async () => {
                await lsp.requestSignatureHelp(update.view, currentPath, null);
              }, 150);
            }
          },
          onSelectionChanged(update) {
            if (lsp.showSignatureHelp) {
              const pos = update.state.selection.main.head;
              const triggerLine = update.state.doc.lineAt(lsp.signatureHelpPos);
              const cursorLine = update.state.doc.lineAt(pos);
              if (pos < lsp.signatureHelpPos || cursorLine.number !== triggerLine.number) {
                lsp.dismissSignatureHelp();
              }
            }
          },
        } : null,
        onContextMenu: (event, v) => {
          event.preventDefault();
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return true;
          const line = v.state.doc.lineAt(pos);
          const sel = v.state.selection.main;
          const selHas = !sel.empty;
          const selText = selHas ? v.state.sliceDoc(sel.from, sel.to) : '';

          // Check if pos falls within any cached diagnostic range
          const diagnostics = lsp.cachedDiagnostics.get(currentPath) || [];
          const diagnostic = diagnostics.find(d => pos >= d.from && pos <= d.to);

          editorMenu = { visible: true, x: event.clientX, y: event.clientY };
          menuContext = {
            hasSelection: selHas,
            selectedText: selText,
            hasDiagnostic: !!diagnostic,
            diagnosticMessage: diagnostic?.message || '',
            lineNumber: line.number,
          };
          return true;
        },
        onClick: lsp.hasLsp ? async (event, v) => {
          if (!event.ctrlKey && !event.metaKey) return false;
          event.preventDefault();
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return true;

          const lineInfo = v.state.doc.lineAt(pos);
          const line = lineInfo.number - 1;
          const character = pos - lineInfo.from;
          const r = projectStore.root;

          try {
            // Record departure point for back/forward navigation
            navigationHistoryStore.pushLocation({
              path: currentPath,
              line,
              character,
              groupId,
            });

            const result = await lspRequestDefinition(currentPath, line, character, r);
            if (!result?.data?.locations?.length) return true;

            const loc = result.data.locations[0];
            const rootStr = projectStore.root || '';
            const resolved = uriToRelativePath(loc.uri, rootStr);
            if (!resolved) return true;

            if (resolved.path === currentPath && !resolved.external) {
              const targetLine = v.state.doc.line(loc.range.start.line + 1);
              v.dispatch({
                selection: { anchor: targetLine.from + loc.range.start.character },
                scrollIntoView: true,
              });
            } else {
              const fileName = basename(resolved.path);
              tabsStore.openFile({ name: fileName, path: resolved.path, readOnly: resolved.external, external: resolved.external });
            }
          } catch {}
          return true;
        } : null,
        onFontZoom: (delta) => handleFontZoom(delta),
        onNavigateBack: () => {
          const loc = navigationHistoryStore.goBack();
          if (!loc) return;
          if (loc.path !== currentPath) {
            const name = basename(loc.path);
            tabsStore.openFile({ name, path: loc.path }, loc.groupId);
          }
          // Move cursor to stored position
          if (view) {
            const cmLine = view.state.doc.line(Math.min(loc.line + 1, view.state.doc.lines));
            const pos = Math.min(cmLine.from + loc.character, cmLine.to);
            view.dispatch({
              selection: { anchor: pos },
              scrollIntoView: true,
            });
          }
        },
        onNavigateForward: () => {
          const loc = navigationHistoryStore.goForward();
          if (!loc) return;
          if (loc.path !== currentPath) {
            const name = basename(loc.path);
            tabsStore.openFile({ name, path: loc.path }, loc.groupId);
          }
          if (view) {
            const cmLine = view.state.doc.line(Math.min(loc.line + 1, view.state.doc.lines));
            const pos = Math.min(cmLine.from + loc.character, cmLine.to);
            view.dispatch({
              selection: { anchor: pos },
              scrollIntoView: true,
            });
          }
        },
        onCursorActivity: (update) => {
          const pos = update.state.selection.main.head;
          const lineInfo = update.state.doc.lineAt(pos);
          statusBarStore.setCursor(lineInfo.number, pos - lineInfo.from + 1);
        },
        getOriginalContent: isExternal ? null : async (filePath) => {
          const root = projectStore.root;
          try {
            const result = await getFileGitContent(filePath, root);
            return unwrapResult(result);
          } catch { return null; }
        },
        showIndentGuides: configStore.value?.editor?.indentGuides !== false,
        indentCompartments,
        indentType: currentIndent.type,
        indentSize: currentIndent.size,
      });

      if (langSupport && !Array.isArray(langSupport)) {
        extensions.splice(1, 0, langSupport);
      } else if (Array.isArray(langSupport) && langSupport.length > 0) {
        extensions.splice(1, 0, ...langSupport);
      }

      // Add range highlight decoration support (for Problems panel navigation)
      initRangeHighlight(cm);
      if (rangeHighlightField) extensions.push(rangeHighlightField);

      const state = cm.EditorState.create({
        doc: data.content,
        extensions,
      });

      loading = false;
      await tick();

      if (editorEl) {
        view = new cm.EditorView({ state, parent: editorEl });
        // Attach current path for LSP handler access
        view._lspPath = filePath;

        // Initialize git gutter with file path
        if (!isExternal && !isReadOnly && !isUntitled) {
          const gp = view.plugin(gitGutterPlugin);
          if (gp) gp.setPath(filePath);
        }

        // Status bar: set language and initial editor state
        statusBarStore.setLanguage(getLanguageName(filePath));
        statusBarStore.setEditorFocused(true);
        statusBarStore.setEncoding('UTF-8');

        // Detect EOL from content
        const hasCarriageReturn = data.content?.includes('\r\n');
        statusBarStore.setEol(hasCarriageReturn ? 'CRLF' : 'LF');

        // Detect and set indentation
        const detected = detectIndentation(data.content || '');
        currentIndent = detected;
        statusBarStore.setIndent(detected.type, detected.size);

        // Set initial cursor position
        const initialPos = view.state.selection.main.head;
        const initialLine = view.state.doc.lineAt(initialPos);
        statusBarStore.setCursor(initialLine.number, initialPos - initialLine.from + 1);

        // Apply pending cursor if Problems panel or similar set one before file loaded
        applyPendingCursor();
      }

      // Open file in LSP (fire and forget)
      if (lsp.hasLsp) {
        lsp.openFile(filePath, data.content, root);
      }

      // Restore cached diagnostics if we have them (from editor's own cache)
      if (lsp.hasLsp && lsp.cachedDiagnostics.has(filePath) && view) {
        try {
          view.dispatch(cm.setDiagnostics(view.state, lsp.cachedDiagnostics.get(filePath)));
        } catch {}
      }

      // Also apply pre-existing diagnostics from the global store (received before file was opened).
      // The TS language server scans the workspace and publishes diagnostics for files
      // we haven't opened yet — the store has them, but the editor's listener wasn't active.
      if (lsp.hasLsp && !lsp.cachedDiagnostics.has(filePath) && view) {
        const storeDiags = lspDiagnosticsStore.getRawForFile(filePath);
        if (storeDiags?.length) {
          try {
            const cmDiags = storeDiags.map(d => {
              let from = lspPositionToOffset(view.state.doc, d.range.start);
              let to = lspPositionToOffset(view.state.doc, d.range.end);
              from = Math.max(0, Math.min(from, view.state.doc.length));
              to = Math.max(0, Math.min(to, view.state.doc.length));
              if (from > to) { const tmp = from; from = to; to = tmp; }
              return {
                from,
                to,
                severity: d.severity || 'error',
                message: d.message,
                source: d.source || undefined,
              };
            });
            lsp.cachedDiagnostics.set(filePath, cmDiags);
            view.dispatch(cm.setDiagnostics(view.state, cmDiags));
          } catch {}
        }
      }
    } catch (err) {
      if (filePath !== currentPath) return;
      console.error('[FileEditor] Load failed:', err);
      error = err.message || 'Failed to load editor';
      loading = false;
    }
  }

  // React to tab.path changes
  $effect(() => {
    if (tab?.path) {
      loadFile(tab.path);
    }
  });

  // Live file sync: reload editor content when the file changes on disk.
  $effect(() => {
    let unlisten;
    (async () => {
      unlisten = await listen('fs-file-changed', async (event) => {
        const { files } = event.payload;
        if (!view || !currentPath || !files?.includes(currentPath)) return;

        const dirty = tabsStore.tabs.find(t => t.path === currentPath)?.dirty;
        if (dirty) {
          conflictDetected = true;
          return;
        }

        try {
          const root = projectStore.root;
          const result = await readFile(currentPath, root);
          const data = unwrapResult(result);
          if (!data?.content || data.content == null) return;

          const currentContent = view.state.doc.toString();
          if (data.content === currentContent) return;

          view.dispatch({
            changes: { from: 0, to: currentContent.length, insert: data.content },
          });
        } catch (err) {
          console.warn('[FileEditor] Live reload failed:', err);
        }
      });
    })();

    return () => {
      unlisten?.();
    };
  });

  // Listen for LSP diagnostics via the extracted helper
  $effect(() => {
    if (!lsp.hasLsp || !currentPath) return;
    let unlisten;
    (async () => {
      unlisten = await listen('lsp-diagnostics', lsp.diagnosticListener(currentPath, () => view, cmCache));
    })();
    return () => { unlisten?.(); };
  });

  /**
   * Apply a pending cursor position to the current editor view.
   * Awaits document.fonts.ready so the scroll dispatch and CM6's height map
   * rebuild (triggered by fonts.ready) happen in the same measure cycle.
   * Without this, CM6 consumes scrollTarget in the first measure, then
   * fonts.ready triggers a full height map rebuild that resets scroll.
   */
  async function applyPendingCursor() {
    const pending = tabsStore.pendingCursorPosition;
    if (!pending || !view || pending.path !== currentPath) return;

    // Save and clear immediately so no other code path re-triggers
    const savedPending = { ...pending };
    tabsStore.clearPendingCursor();

    // Wait for fonts to load — CM6's constructor registers a document.fonts.ready
    // callback that sets mustMeasureContent="refresh" and rebuilds the height map.
    // If we scroll before this, the rebuild destroys our scroll position.
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    // Re-check state is still valid after await
    if (!view || savedPending.path !== currentPath) return;

    try {
      const lineNum = Math.min(Math.max(savedPending.line + 1, 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNum);
      const anchor = line.from + Math.min(savedPending.character || 0, line.length);

      // Compute end position for range highlight
      let highlightEnd = anchor;
      if (savedPending.endLine != null) {
        const endLineNum = Math.min(Math.max(savedPending.endLine + 1, 1), view.state.doc.lines);
        const endLine = view.state.doc.line(endLineNum);
        highlightEnd = endLine.from + Math.min(savedPending.endCharacter || 0, endLine.length);
      }

      // Set cursor and scroll
      const scrollEffect = cmCache?.EditorView?.scrollIntoView(anchor, { y: 'center' });
      view.dispatch({
        selection: { anchor },
        ...(scrollEffect ? { effects: scrollEffect } : { scrollIntoView: true }),
      });

      // Apply VS Code-style range highlight decoration
      applyRangeHighlight(view, anchor, highlightEnd);
      view.focus();
    } catch (e) {
      // Ignore if line is out of range
    }
  }

  // Apply pending cursor position (from Problems panel click-to-navigate).
  // For already-open files: view exists, fonts already loaded, works immediately.
  // For new files: called from loadFile() after view creation, awaits fonts.ready.
  $effect(() => {
    const pending = tabsStore.pendingCursorPosition;
    if (!pending || pending.path !== currentPath) return;
    if (!view) return;
    applyPendingCursor();
  });

  // Listen for outline symbol navigation (from OutlinePanel via LensWorkspace)
  // Scoped by groupId so each editor instance only handles its own events
  $effect(() => {
    const eventName = `lens-goto-position-${groupId}`;
    function handleGotoPosition(e) {
      if (!view) return;
      const { line, character } = e.detail;
      try {
        const targetLine = view.state.doc.line(line + 1);
        const anchor = targetLine.from + Math.min(character, targetLine.length);
        const scrollEffect = cmCache?.EditorView?.scrollIntoView(anchor, { y: 'center' });
        view.dispatch({
          selection: { anchor },
          ...(scrollEffect ? { effects: scrollEffect } : { scrollIntoView: true }),
        });
        view.focus();
      } catch {}
    }

    // Command events dispatched by the command registry
    const handleCommandSave = () => save();
    const handleCommandFormat = () => handleFormat();

    // Also listen to unscoped event for backwards compatibility
    window.addEventListener(eventName, handleGotoPosition);
    window.addEventListener('lens-goto-position', handleGotoPosition);
    window.addEventListener('command:save', handleCommandSave);
    window.addEventListener('command:format', handleCommandFormat);
    return () => {
      window.removeEventListener(eventName, handleGotoPosition);
      window.removeEventListener('lens-goto-position', handleGotoPosition);
      window.removeEventListener('command:save', handleCommandSave);
      window.removeEventListener('command:format', handleCommandFormat);
    };
  });

  // Indent change events from StatusBar dropdown
  async function reconfigureIndent(type, size) {
    currentIndent = { type, size };
    statusBarStore.setIndent(type, size);
    if (!view) return;
    const cm = await loadCM();
    const { indentUnit: iu } = await import('@codemirror/language');
    view.dispatch({
      effects: [
        indentCompartments.indentUnit.reconfigure(iu.of(type === 'tabs' ? '\t' : ' '.repeat(size))),
        indentCompartments.tabSize.reconfigure(cm.EditorState.tabSize.of(size)),
      ],
    });
  }

  $effect(() => {
    function handleIndentChange(e) {
      const { type, size } = e.detail;
      reconfigureIndent(type, size);
    }

    function handleIndentConvert(e) {
      if (!view) return;
      const { to } = e.detail;
      const size = currentIndent.size || 2;
      const doc = view.state.doc.toString();
      const converted = convertIndentation(doc, to, size);
      // Apply document changes (even if content looks similar, tabs ≠ spaces)
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: converted },
      });
      // Switch indent type (and reconfigure editor so Tab key uses new mode)
      reconfigureIndent(to, size);
    }

    function handleIndentDetect() {
      if (!view) return;
      const detected = detectIndentation(view.state.doc.toString());
      reconfigureIndent(detected.type, detected.size);
    }

    window.addEventListener('status-bar-indent-change', handleIndentChange);
    window.addEventListener('status-bar-indent-convert', handleIndentConvert);
    window.addEventListener('status-bar-indent-detect', handleIndentDetect);
    return () => {
      window.removeEventListener('status-bar-indent-change', handleIndentChange);
      window.removeEventListener('status-bar-indent-convert', handleIndentConvert);
      window.removeEventListener('status-bar-indent-detect', handleIndentDetect);
    };
  });

  onDestroy(() => {
    if (currentPath && lsp.hasLsp) {
      const root = projectStore.root;
      lsp.closeFile(currentPath, root);
    }
    clearTimeout(sigHelpDebounce);
    lsp.destroy();
    view?.destroy();
    statusBarStore.clearEditorState();
  });
</script>

{#if isBinary}
  <div class="editor-binary">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <span class="binary-title">Binary file</span>
    <span class="binary-detail">{(fileSize / 1024).toFixed(1)} KB — This file is not displayed because it is binary.</span>
  </div>
{:else if error}
  <div class="editor-error">
    <span class="error-text">{error}</span>
  </div>
{:else}
  {#if tab?.readOnly}
    <div class="readonly-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span>Read-only — {tab.external ? 'external file' : 'cannot edit'}</span>
    </div>
  {/if}
  {#if conflictDetected}
    <div class="conflict-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>File changed on disk.</span>
      <button class="conflict-btn conflict-reload" onclick={reloadFromDisk}>Reload</button>
      <button class="conflict-btn conflict-dismiss" onclick={dismissConflict}>Dismiss</button>
    </div>
  {/if}
  {#if isMarkdown && !loading}
    <div class="editor-preview-toolbar">
      <button class="preview-btn" class:active={showPreview} onclick={() => { showPreview = true; }} title="Preview" aria-label="Preview markdown">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
      <button class="preview-btn" class:active={!showPreview} onclick={() => { showPreview = false; }} title="Edit" aria-label="Edit markdown">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>
        </svg>
      </button>
    </div>
  {/if}
  {#if isMarkdown && showPreview && !loading}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="markdown-preview" onclick={(e) => {
      const a = /** @type {HTMLElement} */ (e.target).closest('a[href]');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        open(href);
      }
    }}>
      {#if markdownContent}
        {@html renderMarkdown(markdownContent)}
      {:else}
        <div class="editor-loading"><span class="loading-text">No content</span></div>
      {/if}
    </div>
  {/if}
  <div class="file-editor" class:hidden={isMarkdown && showPreview} bind:this={editorEl}
    oncontextmenu={(e) => {
      // Fallback: catch right-clicks on gutter markers, tooltips, and other
      // CodeMirror DOM layers that bypass the EditorView.domEventHandlers callback.
      // If the CM handler already fired this event cycle, editorMenu is already visible.
      if (editorMenu.visible) return;
      e.preventDefault();

      // Try to resolve editor position from click coordinates
      let lineNumber = 0;
      let diagnostic = null;
      if (view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos != null) {
          const line = view.state.doc.lineAt(pos);
          lineNumber = line.number;
          const diagnostics = lsp.cachedDiagnostics.get(currentPath) || [];
          diagnostic = diagnostics.find(d => pos >= d.from && pos <= d.to);
        }
      }

      // If we couldn't get a precise position, try line-from-Y as best effort
      if (!lineNumber && view) {
        const block = view.lineBlockAtHeight(e.clientY - view.documentTop);
        if (block) {
          try { lineNumber = view.state.doc.lineAt(block.from).number; } catch {}
        }
      }

      // Check for diagnostics on this line even if pos wasn't exact
      if (!diagnostic && lineNumber && currentPath) {
        const diagnostics = lsp.cachedDiagnostics.get(currentPath) || [];
        diagnostic = diagnostics.find(d => {
          try { return view.state.doc.lineAt(d.from).number === lineNumber; } catch { return false; }
        });
      }

      editorMenu = { visible: true, x: e.clientX, y: e.clientY };
      menuContext = {
        hasSelection: false,
        selectedText: '',
        hasDiagnostic: !!diagnostic,
        diagnosticMessage: diagnostic?.message || '',
        lineNumber,
      };
    }}>
    {#if loading}
      <div class="editor-loading">
        <span class="loading-text">Loading...</span>
      </div>
    {/if}
  </div>
{/if}

<EditorContextMenu
  x={editorMenu.x}
  y={editorMenu.y}
  visible={editorMenu.visible}
  hasSelection={menuContext.hasSelection}
  selectedText={menuContext.selectedText}
  hasLsp={lsp.hasLsp}
  hasDiagnostic={menuContext.hasDiagnostic}
  diagnosticMessage={menuContext.diagnosticMessage}
  filePath={currentPath}
  lineNumber={menuContext.lineNumber}
  {view}
  {tab}
  {lsp}
  onClose={() => { editorMenu.visible = false; }}
  onSendToAi={sendAiMessage}
  onNavigateDefinition={handleGoToDefinition}
/>

<ReferencesPanel
  references={lsp.referencesResult}
  visible={lsp.showReferences}
  onClose={() => { lsp.setShowReferences(false); }}
  onNavigate={(ref) => {
    lsp.setShowReferences(false);
    if (ref.path === currentPath && !ref.external) {
      if (view) {
        const line = view.state.doc.line((ref.range?.start?.line ?? 0) + 1);
        view.dispatch({ selection: { anchor: line.from + (ref.range?.start?.character ?? 0) }, scrollIntoView: true });
      }
    } else {
      const fileName = basename(ref.path);
      tabsStore.openFile({ name: fileName, path: ref.path, readOnly: ref.external, external: ref.external });
    }
  }}
/>

<CodeActionsMenu
  actions={lsp.codeActions}
  visible={lsp.showCodeActions}
  x={lsp.codeActionsPosition.x}
  above={lsp.codeActionsPosition.above}
  below={lsp.codeActionsPosition.below}
  onClose={() => { lsp.setShowCodeActions(false); }}
  onApply={async (action) => {
    lsp.setShowCodeActions(false);
    const edit = action.edit;
    if (edit) {
      const root = projectStore.root;
      await lspApplyWorkspaceEdit(edit, root);
    }
  }}
/>

<RenameInput
  visible={lsp.showRename}
  x={lsp.renamePosition.x}
  above={lsp.renamePosition.above}
  below={lsp.renamePosition.below}
  currentName={lsp.renamePlaceholder}
  onConfirm={(newName) => { lsp.executeRename(view, currentPath, newName); }}
  onCancel={() => { lsp.setShowRename(false); }}
/>

<SignatureHelp
  visible={lsp.showSignatureHelp}
  data={lsp.signatureHelpData}
  cursorX={lsp.signatureHelpCoords.x}
  cursorY={lsp.signatureHelpCoords.y}
  onDismiss={() => lsp.dismissSignatureHelp()}
/>

<style>
  @import '../../styles/markdown-preview.css';

  .file-editor {
    flex: 1;
    overflow: hidden;
    height: 100%;
    position: relative;
  }

  /* Override CodeMirror to fill available space */
  .file-editor :global(.cm-editor) {
    height: 100%;
  }

  .file-editor :global(.cm-scroller) {
    overflow: auto;
  }

  .editor-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .editor-error,
  .editor-binary {
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

  .error-text {
    color: var(--danger);
  }

  .binary-title {
    font-weight: 600;
    color: var(--text);
    font-size: 14px;
  }

  .binary-detail {
    color: var(--muted);
    font-size: 12px;
  }

  .file-editor :global(.lsp-hover-tooltip) {
    max-width: 500px;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--muted);
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .conflict-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: color-mix(in srgb, var(--warn) 15%, transparent);
    border-bottom: 1px solid var(--warn);
    color: var(--warn);
    font-size: 12px;
    font-family: var(--font-family);
  }

  .conflict-banner svg {
    flex-shrink: 0;
  }

  .conflict-btn {
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
  }

  .conflict-reload {
    background: var(--warn);
    color: var(--bg);
    font-weight: 600;
  }

  .conflict-reload:hover {
    filter: brightness(1.1);
  }

  .conflict-dismiss {
    background: transparent;
    color: var(--warn);
    border: 1px solid var(--warn);
  }

  .conflict-dismiss:hover {
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }

  .readonly-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--muted);
    color: var(--muted);
    font-size: 11px;
    font-family: var(--font-family);
  }

  .readonly-banner svg {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .file-editor :global(.cm-lintPoint-error) {
    border-bottom-color: var(--danger);
  }

  .file-editor :global(.cm-lintPoint-warning) {
    border-bottom-color: var(--warn);
  }

  /* VS Code-style range highlight for Problems panel navigation */
  .file-editor :global(.cm-range-highlight) {
    background-color: color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 2px;
  }

  .file-editor :global(.cm-range-highlight-line) {
    background-color: color-mix(in srgb, var(--accent) 15%, transparent);
  }

</style>
