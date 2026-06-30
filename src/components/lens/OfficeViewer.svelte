<script>
  import DOMPurify from 'dompurify';
  import { readFileBase64 } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { unwrapResult } from '../../lib/utils.js';
  import BinaryFilePanel from './BinaryFilePanel.svelte';

  let { tab } = $props();

  let html = $state('');
  let loading = $state(true);
  // When true we give up on in-app rendering and show the binary action panel
  // (non-docx office types, conversion errors, large files, …). Never a dead end.
  let fellBack = $state(false);

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  $effect(() => {
    const path = tab?.path;
    if (!path) return;
    loading = true;
    fellBack = false;
    html = '';
    (async () => {
      // Only .docx is convertible with mammoth; everything else (.doc, .xlsx, …)
      // falls back to the binary panel immediately.
      const ext = (path.split('.').pop() || '').toLowerCase();
      if (ext !== 'docx') {
        fellBack = true;
        loading = false;
        return;
      }
      try {
        const result = await readFileBase64(path, projectStore.root);
        const data = unwrapResult(result);
        if (!data?.base64) {
          fellBack = true;
          return;
        }
        const bytes = base64ToBytes(data.base64);
        // Lazy-load mammoth so it stays out of the main bundle (like CodeMirror).
        const mod = await import('mammoth');
        const mammoth = mod.convertToHtml ? mod : mod.default;
        const out = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
        const rendered = out?.value || '';
        if (!rendered) {
          fellBack = true;
          return;
        }
        html = DOMPurify.sanitize(rendered);
      } catch (err) {
        console.warn('[OfficeViewer] docx conversion failed:', err);
        fellBack = true;
      } finally {
        loading = false;
      }
    })();
  });
</script>

{#if fellBack}
  <BinaryFilePanel {tab} />
{:else if loading}
  <div class="office-loading"><span>Rendering document…</span></div>
{:else}
  <div class="markdown-preview office-scroll">
    <div class="markdown-preview-content">
      {@html html}
    </div>
  </div>
{/if}

<style>
  @import '../../styles/markdown-preview.css';

  .office-scroll {
    height: 100%;
    overflow: auto;
  }

  .office-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }
</style>
