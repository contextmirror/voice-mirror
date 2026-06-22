<script>
  /**
   * DiagnosticsSettings -- Export recent logs for troubleshooting.
   *
   * Bundles every output channel plus the standalone MCP server's process log
   * into one plain-text blob copied to the clipboard, so the user can paste it
   * when reporting a problem (e.g. the "Voice Mirror" MCP connection dropping).
   * The MCP binary runs as a separate process, so its logs are otherwise
   * invisible to the app — this is the only place they surface.
   */
  import { exportDiagnostics } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Button from '../shared/Button.svelte';

  let copying = $state(false);
  let copiedFlash = $state(false);

  async function handleExport() {
    if (copying) return;
    copying = true;
    try {
      const result = await exportDiagnostics(300);
      const data = unwrapResult(result);
      const text = data?.text ?? '';
      if (!text.trim()) {
        toastStore.addToast({ message: 'No logs to export yet.', severity: 'warning' });
        return;
      }
      await navigator.clipboard.writeText(text);
      const lines = text.split('\n').length;
      copiedFlash = true;
      setTimeout(() => { copiedFlash = false; }, 1500);
      toastStore.addToast({
        message: `Diagnostics copied (${lines} lines). Paste them into your report.`,
        severity: 'success',
      });
    } catch (err) {
      console.warn('[diagnostics] Export failed:', err);
      toastStore.addToast({ message: `Export failed: ${err}`, severity: 'error' });
    } finally {
      copying = false;
    }
  }
</script>

<section class="settings-section">
  <h3>Diagnostics</h3>
  <p class="diag-hint">
    Copy recent logs from every channel — including the MCP server process — to
    your clipboard, then paste them when reporting a problem (e.g. the Voice
    Mirror connection dropping). The MCP server runs as a separate process, so
    this is the only place its logs surface in the app.
  </p>
  <div class="settings-group">
    <div class="diag-actions">
      <Button small onClick={handleExport} disabled={copying}>
        {copiedFlash ? 'Copied!' : copying ? 'Collecting…' : 'Copy diagnostics'}
      </Button>
    </div>
  </div>
</section>

<style>
  .diag-hint {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 10px 0;
    line-height: 1.5;
  }

  .diag-actions {
    padding: 8px;
  }
</style>
