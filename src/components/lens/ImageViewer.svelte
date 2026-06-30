<script>
  import { readFile } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { basename, unwrapResult } from '../../lib/utils.js';
  import BinaryFilePanel from './BinaryFilePanel.svelte';

  let { tab } = $props();

  let dataUrl = $state(null);
  let fileSize = $state(0);
  let loading = $state(true);
  let failed = $state(false);

  const name = $derived(basename(tab?.path || '') || tab?.title || 'image');

  $effect(() => {
    const path = tab?.path;
    if (!path) return;
    loading = true;
    failed = false;
    dataUrl = null;
    (async () => {
      try {
        const result = await readFile(path, projectStore.root);
        const data = unwrapResult(result);
        // read_file returns { binary: true, dataUrl, size } for image bytes.
        if (data?.dataUrl) {
          dataUrl = data.dataUrl;
          fileSize = data.size || 0;
        } else if (typeof data?.content === 'string') {
          // SVGs are valid UTF-8, so read_file returns them as text content.
          const b64 = btoa(unescape(encodeURIComponent(data.content)));
          dataUrl = `data:image/svg+xml;base64,${b64}`;
          fileSize = data.size || data.content.length;
        } else {
          failed = true;
        }
      } catch (err) {
        console.warn('[ImageViewer] failed to load image:', err);
        failed = true;
      } finally {
        loading = false;
      }
    })();
  });

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if failed}
  <BinaryFilePanel {tab} size={fileSize || null} />
{:else if dataUrl}
  <div class="image-viewer">
    <img src={dataUrl} alt={name} />
    <span class="image-detail">{formatSize(fileSize)}</span>
  </div>
{:else if loading}
  <div class="image-loading"><span>Loading…</span></div>
{/if}

<style>
  .image-viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    overflow: auto;
    background: var(--checkerboard, repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%) 50% / 16px 16px);
  }

  .image-viewer img {
    max-width: 100%;
    max-height: calc(100% - 32px);
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }

  .image-detail {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
  }

  .image-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }
</style>
