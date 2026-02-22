<script>
  import { onDestroy, tick } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { readFile, writeFile, lspOpenFile, lspCloseFile, lspChangeFile, lspSaveFile, lspRequestCompletion, lspRequestHover, lspRequestDefinition } from '../../lib/api.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

  let { tab } = $props();

  let editorEl;
  let view;
  let loading = $state(true);
  let error = $state(null);
  let isBinary = $state(false);
  let fileSize = $state(0);
  let currentPath = $state(null);

  // LSP state
  let lspVersion = $state(0);
  let lspDebounceTimer = null;
  let cachedDiagnostics = $state(new Map()); // path -> diagnostics array
  let hasLsp = $state(false); // whether current file has LSP support

  const LSP_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'rs', 'py', 'css', 'scss', 'html', 'svelte', 'json', 'md', 'markdown']);

  // Cache CodeMirror modules after first load
  let cmCache = null;

  async function loadCM() {
    if (cmCache) return cmCache;
    const [
      { EditorView, basicSetup },
      { EditorState },
      { keymap, hoverTooltip },
      { oneDark },
      { autocompletion },
      { setDiagnostics, lintGutter },
    ] = await Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/theme-one-dark'),
      import('@codemirror/autocomplete'),
      import('@codemirror/lint'),
    ]);
    cmCache = { EditorView, basicSetup, EditorState, keymap, hoverTooltip, oneDark, autocompletion, setDiagnostics, lintGutter };
    return cmCache;
  }

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
      console.warn('[FileEditor] Language load failed for', ext, err);
      return [];
    }
  }

  /** Convert a file:// URI to a project-relative path. */
  function uriToRelativePath(uri, root) {
    if (!uri) return null;
    try {
      const url = new URL(uri);
      if (url.protocol !== 'file:') return null;
      // Decode percent-encoded characters and normalize slashes
      let filePath = decodeURIComponent(url.pathname).replace(/\\/g, '/');
      // On Windows, pathname starts with /C:/... — strip leading slash
      if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
      const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
      if (filePath.startsWith(normalizedRoot + '/')) {
        return filePath.slice(normalizedRoot.length + 1);
      }
      // Fallback: return the full path
      return filePath;
    } catch {
      return null;
    }
  }

  function lspPositionToOffset(doc, pos) {
    const line = doc.line(Math.min(pos.line + 1, doc.lines));
    return line.from + Math.min(pos.character, line.length);
  }

  function mapCompletionKind(kind) {
    const kinds = {
      1: 'text', 2: 'method', 3: 'function', 4: 'constructor',
      5: 'field', 6: 'variable', 7: 'class', 8: 'interface',
      9: 'module', 10: 'property', 11: 'unit', 12: 'value',
      13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color',
      17: 'file', 18: 'reference', 19: 'folder', 20: 'enum',
      21: 'constant', 22: 'struct', 23: 'event', 24: 'operator',
      25: 'type',
    };
    return kinds[kind] || 'text';
  }

  async function lspCompletionSource(context) {
    if (!hasLsp || !currentPath) return null;
    const pos = context.state.doc.lineAt(context.pos);
    const line = pos.number - 1; // LSP is 0-indexed
    const character = context.pos - pos.from;
    const root = projectStore.activeProject?.path || null;

    try {
      const result = await lspRequestCompletion(currentPath, line, character, root);
      if (!result?.data?.items?.length) return null;

      return {
        from: context.pos - (context.matchBefore(/\w*/)?.text.length || 0),
        options: result.data.items.map(item => ({
          label: item.label,
          type: mapCompletionKind(item.kind),
          detail: item.detail || undefined,
          info: item.documentation || undefined,
          apply: item.textEdit?.newText || item.insertText || item.label,
        })),
      };
    } catch {
      return null; // Fall back to keyword completions
    }
  }

  async function save() {
    if (!view) return;
    try {
      const content = view.state.doc.toString();
      const root = projectStore.activeProject?.path || null;
      await writeFile(tab.path, content, root);
      tabsStore.setDirty(tab.id, false);
      if (hasLsp) {
        lspSaveFile(tab.path, content, root).catch(() => {});
      }
    } catch (err) {
      console.error('[FileEditor] Save failed:', err);
    }
  }

  async function loadFile(filePath) {
    if (!filePath || filePath === currentPath) return;

    // Close previous LSP document
    if (currentPath && hasLsp) {
      const root = projectStore.activeProject?.path || null;
      lspCloseFile(currentPath, root).catch(() => {});
    }
    clearTimeout(lspDebounceTimer);
    lspVersion = 0;
    hasLsp = false;

    currentPath = filePath;
    loading = true;
    error = null;
    isBinary = false;

    try {
      const cm = await loadCM();
      const root = projectStore.activeProject?.path || null;
      const result = await readFile(filePath, root);
      const data = result?.data || result;

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

      const langSupport = await loadLanguage(filePath);

      // Check again if tab changed
      if (filePath !== currentPath) return;

      // Determine LSP support from file extension
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      hasLsp = LSP_EXTENSIONS.has(ext);

      const extensions = [
        cm.basicSetup,
        cm.oneDark,
        cm.lintGutter(),
        cm.autocompletion(hasLsp ? {
          override: [lspCompletionSource],
          maxRenderedOptions: 20,
        } : {
          activateOnTyping: true,
          maxRenderedOptions: 20,
        }),
        cm.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            tabsStore.setDirty(tab.id, true);
            tabsStore.pinTab(tab.id);
            if (hasLsp) {
              lspVersion++;
              clearTimeout(lspDebounceTimer);
              lspDebounceTimer = setTimeout(() => {
                const content = update.state.doc.toString();
                const r = projectStore.activeProject?.path || null;
                lspChangeFile(currentPath, content, lspVersion, r).catch(() => {});
              }, 300);
            }
          }
        }),
        cm.keymap.of([{
          key: 'Mod-s',
          run: () => { save(); return true; },
        }]),
      ];

      // Add hover tooltip for LSP
      if (hasLsp) {
        extensions.push(cm.hoverTooltip(async (v, pos) => {
          const lineInfo = v.state.doc.lineAt(pos);
          const line = lineInfo.number - 1;
          const character = pos - lineInfo.from;
          const r = projectStore.activeProject?.path || null;

          try {
            const result = await lspRequestHover(currentPath, line, character, r);
            if (!result?.data?.contents) return null;

            return {
              pos,
              create() {
                const dom = document.createElement('div');
                dom.className = 'lsp-hover-tooltip';
                dom.textContent = typeof result.data.contents === 'string'
                  ? result.data.contents
                  : result.data.contents.value || '';
                return { dom };
              },
            };
          } catch {
            return null;
          }
        }));

        // Go-to-definition on Ctrl+Click / Cmd+Click
        extensions.push(cm.EditorView.domEventHandlers({
          click: async (event, v) => {
            if (!event.ctrlKey && !event.metaKey) return false;
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;

            const lineInfo = v.state.doc.lineAt(pos);
            const line = lineInfo.number - 1;
            const character = pos - lineInfo.from;
            const r = projectStore.activeProject?.path || null;

            try {
              const result = await lspRequestDefinition(currentPath, line, character, r);
              if (!result?.data?.locations?.length) return false;

              const loc = result.data.locations[0];
              // Convert file:// URI to relative path by stripping the project root prefix
              const root = projectStore.activeProject?.path || '';
              const locPath = uriToRelativePath(loc.uri, root);
              if (!locPath) return false;

              if (locPath === currentPath) {
                // Same file: scroll to position
                const targetLine = v.state.doc.line(loc.range.start.line + 1);
                v.dispatch({
                  selection: { anchor: targetLine.from + loc.range.start.character },
                  scrollIntoView: true,
                });
              } else {
                // Different file: open in new tab
                tabsStore.openFile(locPath);
              }
              return true;
            } catch {
              return false;
            }
          },
        }));
      }

      if (langSupport && !Array.isArray(langSupport)) {
        extensions.splice(1, 0, langSupport);
      } else if (Array.isArray(langSupport) && langSupport.length > 0) {
        extensions.splice(1, 0, ...langSupport);
      }

      const state = cm.EditorState.create({
        doc: data.content,
        extensions,
      });

      // Destroy old editor if it exists
      if (view) {
        view.destroy();
        view = null;
      }

      loading = false;
      await tick();

      if (editorEl) {
        view = new cm.EditorView({ state, parent: editorEl });
      }

      // Open file in LSP (fire and forget)
      if (hasLsp) {
        lspOpenFile(filePath, data.content, root).catch(() => {});
      }

      // Restore cached diagnostics if we have them
      if (hasLsp && cachedDiagnostics.has(filePath) && view) {
        try {
          view.dispatch(cm.setDiagnostics(view.state, cachedDiagnostics.get(filePath)));
        } catch {}
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
  // Uses CodeMirror's dispatch to apply a minimal diff (preserves cursor + scroll).
  $effect(() => {
    let unlisten;
    (async () => {
      unlisten = await listen('fs-file-changed', async (event) => {
        const { files } = event.payload;
        if (!view || !currentPath || !files?.includes(currentPath)) return;

        // Skip reload if the editor has unsaved changes (user is actively editing)
        const dirty = tabsStore.tabs.find(t => t.path === currentPath)?.dirty;
        if (dirty) return;

        try {
          const root = projectStore.activeProject?.path || null;
          const result = await readFile(currentPath, root);
          const data = result?.data || result;
          if (!data?.content || data.content == null) return;

          const currentContent = view.state.doc.toString();
          if (data.content === currentContent) return; // No change

          // Apply as a transaction to preserve cursor position and scroll
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

  // Listen for LSP diagnostics
  $effect(() => {
    let unlisten;
    (async () => {
      unlisten = await listen('lsp-diagnostics', (event) => {
        const { uri, diagnostics: lspDiags } = event.payload;
        if (!view || !currentPath) return;
        // Normalize path for comparison
        const normalizedPath = currentPath.replace(/\\/g, '/');
        if (!uri.includes(normalizedPath)) return;

        try {
          const cm = cmCache;
          if (!cm) return;
          const cmDiags = lspDiags.map(d => {
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
          // Cache diagnostics for this file
          cachedDiagnostics.set(currentPath, cmDiags);
          view.dispatch(cm.setDiagnostics(view.state, cmDiags));
        } catch (err) {
          console.warn('[FileEditor] Failed to apply diagnostics:', err);
        }
      });
    })();
    return () => { unlisten?.(); };
  });

  onDestroy(() => {
    if (currentPath && hasLsp) {
      const root = projectStore.activeProject?.path || null;
      lspCloseFile(currentPath, root).catch(() => {});
    }
    clearTimeout(lspDebounceTimer);
    view?.destroy();
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
  <div class="file-editor" bind:this={editorEl}>
    {#if loading}
      <div class="editor-loading">
        <span class="loading-text">Loading...</span>
      </div>
    {/if}
  </div>
{/if}

<style>
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
    color: var(--danger, #ef4444);
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
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
    background: var(--bgElevated, #1e1e1e);
    border: 1px solid var(--muted, #444);
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .file-editor :global(.cm-lintPoint-error) {
    border-bottom-color: var(--danger, #ef4444);
  }

  .file-editor :global(.cm-lintPoint-warning) {
    border-bottom-color: var(--warn, #f59e0b);
  }
</style>
