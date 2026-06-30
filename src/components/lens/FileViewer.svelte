<script>
  /**
   * FileViewer — thin router for `type:'file'` tabs.
   *
   * Resolves the viewer type from the file extension and renders the matching
   * sub-viewer. Text (and unknown code-ish files) go to the existing FileEditor
   * (CodeMirror) unchanged; non-text types are routed away from the text-read
   * path entirely, so a raw "File not found (os error 2)" can never surface.
   */
  import { resolveViewerType } from '../../lib/viewer-type.js';
  import FileEditor from './FileEditor.svelte';
  import ImageViewer from './ImageViewer.svelte';
  import PdfViewer from './PdfViewer.svelte';
  import OfficeViewer from './OfficeViewer.svelte';
  import BinaryFilePanel from './BinaryFilePanel.svelte';

  let { tab, groupId = 1 } = $props();

  let viewerType = $derived(resolveViewerType(tab?.path));
</script>

{#if viewerType === 'image'}
  <ImageViewer {tab} />
{:else if viewerType === 'pdf'}
  <PdfViewer {tab} />
{:else if viewerType === 'office'}
  <OfficeViewer {tab} />
{:else if viewerType === 'binary'}
  <BinaryFilePanel {tab} />
{:else}
  <FileEditor {tab} {groupId} />
{/if}
