<script>
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-shell';
  import { readFile, revealInExplorer } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { basename, unwrapResult } from '../../lib/utils.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  // `size` may be supplied by the caller (e.g. FileEditor already read the file
  // and found it non-UTF8); otherwise we fetch it ourselves.
  let { tab, size = null } = $props();

  let fileSize = $state(size);
  let loading = $state(size == null);

  const name = $derived(basename(tab?.path || '') || tab?.title || 'file');

  /** Absolute path = project root + relative tab path. */
  function absolutePath() {
    const root = projectStore.root || '';
    const rel = tab?.path || '';
    if (!root) return rel;
    return `${root.replace(/[\\/]$/, '')}/${rel}`;
  }

  onMount(async () => {
    if (size != null) return;
    try {
      const result = await readFile(tab.path, projectStore.root);
      const data = unwrapResult(result);
      fileSize = data?.size ?? 0;
    } catch {
      fileSize = null;
    } finally {
      loading = false;
    }
  });

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function openInDefaultApp() {
    try {
      await open(absolutePath());
    } catch (err) {
      console.warn('[BinaryFilePanel] open in default app failed:', err);
      toastStore.addToast({ message: 'Could not open file in the default app.', severity: 'error' });
    }
  }

  async function reveal() {
    try {
      await revealInExplorer(tab.path, projectStore.root);
    } catch (err) {
      console.warn('[BinaryFilePanel] reveal in explorer failed:', err);
      toastStore.addToast({ message: 'Could not reveal file in Explorer.', severity: 'error' });
    }
  }
</script>

<div class="binary-panel">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
  <span class="binary-title">{name}</span>
  <span class="binary-detail">
    {#if loading}
      Reading file…
    {:else if fileSize != null}
      {formatSize(fileSize)} — no in-app preview for this file type.
    {:else}
      No in-app preview for this file type.
    {/if}
  </span>
  <div class="binary-actions">
    <button class="binary-btn primary" onclick={openInDefaultApp}>Open in default app</button>
    <button class="binary-btn" onclick={reveal}>Reveal in Explorer</button>
  </div>
</div>

<style>
  .binary-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    padding: 24px;
    color: var(--muted);
    font-family: var(--font-family);
  }

  .binary-panel svg {
    opacity: 0.6;
  }

  .binary-title {
    font-weight: 600;
    color: var(--text);
    font-size: 15px;
    word-break: break-all;
    text-align: center;
  }

  .binary-detail {
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }

  .binary-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .binary-btn {
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    border: 1px solid var(--border, var(--muted));
    background: var(--bg-elevated);
    color: var(--text);
    transition: filter var(--duration-fast, 120ms) var(--ease-out, ease);
  }

  .binary-btn:hover {
    filter: brightness(1.15);
  }

  .binary-btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 600;
  }
</style>
