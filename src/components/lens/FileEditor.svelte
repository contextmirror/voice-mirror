<script>
  import { onDestroy, tick } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { readFile, writeFile } from '../../lib/api.js';
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

  // Cache CodeMirror modules after first load
  let cmCache = null;

  async function loadCM() {
    if (cmCache) return cmCache;
    const [
      { EditorView, basicSetup },
      { EditorState },
      { keymap },
      { oneDark },
      { autocompletion },
    ] = await Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/theme-one-dark'),
      import('@codemirror/autocomplete'),
    ]);
    cmCache = { EditorView, basicSetup, EditorState, keymap, oneDark, autocompletion };
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

  async function save() {
    if (!view) return;
    try {
      const content = view.state.doc.toString();
      const root = projectStore.activeProject?.path || null;
      await writeFile(tab.path, content, root);
      tabsStore.setDirty(tab.id, false);
    } catch (err) {
      console.error('[FileEditor] Save failed:', err);
    }
  }

  async function loadFile(filePath) {
    if (!filePath || filePath === currentPath) return;
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

      const extensions = [
        cm.basicSetup,
        cm.oneDark,
        cm.autocompletion({
          activateOnTyping: true,
          maxRenderedOptions: 20,
        }),
        cm.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            tabsStore.setDirty(tab.id, true);
            tabsStore.pinTab(tab.id);
          }
        }),
        cm.keymap.of([{
          key: 'Mod-s',
          run: () => { save(); return true; },
        }]),
      ];

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

  onDestroy(() => {
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
</style>
