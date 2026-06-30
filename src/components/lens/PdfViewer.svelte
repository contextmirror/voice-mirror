<script>
  import { open } from '@tauri-apps/plugin-shell';
  import { readFileBase64 } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { basename, unwrapResult } from '../../lib/utils.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  let { tab } = $props();

  let blobUrl = $state(null);
  let loading = $state(true);
  let error = $state(null);

  const name = $derived(basename(tab?.path || '') || tab?.title || 'document.pdf');

  /** Decode a base64 string into a Uint8Array (chunked to avoid call-stack limits). */
  function base64ToBytes(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function absolutePath() {
    const root = projectStore.root || '';
    const rel = tab?.path || '';
    if (!root) return rel;
    return `${root.replace(/[\\/]$/, '')}/${rel}`;
  }

  async function openInDefaultApp() {
    try {
      await open(absolutePath());
    } catch (err) {
      console.warn('[PdfViewer] open in default app failed:', err);
      toastStore.addToast({ message: 'Could not open PDF in the default app.', severity: 'error' });
    }
  }

  $effect(() => {
    const path = tab?.path;
    if (!path) return;
    loading = true;
    error = null;
    let currentUrl = null;
    (async () => {
      try {
        const result = await readFileBase64(path, projectStore.root);
        const data = unwrapResult(result);
        if (!data?.base64) {
          error = result?.error || 'Could not read PDF file.';
          return;
        }
        const bytes = base64ToBytes(data.base64);
        const blob = new Blob([bytes], { type: data.mime || 'application/pdf' });
        currentUrl = URL.createObjectURL(blob);
        blobUrl = currentUrl;
      } catch (err) {
        console.warn('[PdfViewer] failed to load PDF:', err);
        error = err?.message || 'Failed to load PDF.';
      } finally {
        loading = false;
      }
    })();

    // Revoke the object URL on unmount / path change to avoid leaks.
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      if (blobUrl === currentUrl) blobUrl = null;
    };
  });
</script>

<div class="pdf-viewer">
  <div class="pdf-toolbar">
    <span class="pdf-name">{name}</span>
    <button class="pdf-open-btn" onclick={openInDefaultApp}>Open in default app</button>
  </div>
  <div class="pdf-body">
    {#if error}
      <div class="pdf-message">
        <span class="pdf-error">{error}</span>
        <button class="pdf-open-btn" onclick={openInDefaultApp}>Open in default app</button>
      </div>
    {:else if blobUrl}
      <iframe class="pdf-frame" src={blobUrl} title={name}></iframe>
    {:else if loading}
      <div class="pdf-message"><span>Loading PDF…</span></div>
    {/if}
  </div>
</div>

<style>
  .pdf-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .pdf-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border, var(--muted));
    flex-shrink: 0;
  }

  .pdf-name {
    font-size: 12px;
    color: var(--muted);
    font-family: var(--font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pdf-open-btn {
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    border: 1px solid var(--border, var(--muted));
    background: var(--bg);
    color: var(--text);
    white-space: nowrap;
  }

  .pdf-open-btn:hover {
    filter: brightness(1.15);
  }

  .pdf-body {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .pdf-frame {
    width: 100%;
    height: 100%;
    border: none;
    background: #525659;
  }

  .pdf-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .pdf-error {
    color: var(--danger);
  }
</style>
