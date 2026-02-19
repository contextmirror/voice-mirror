<script>
  /**
   * MigrationPrompt.svelte -- Config migration dialog.
   *
   * On first run, checks if an old Electron config exists and offers
   * to import settings from it. Shown as an overlay dialog.
   */
  import { migrateElectronConfig, setConfig } from '../lib/api.js';
  import { configStore, loadConfig } from '../lib/stores/config.svelte.js';
  import Button from './shared/Button.svelte';

  // ---- State ----

  let visible = $state(false);
  let importing = $state(false);
  let importError = $state('');

  /** @type {Object|null} */
  let migratedConfig = $state(null);

  // ---- Check on mount ----

  $effect(() => {
    // Wait for config to fully load before checking
    if (!configStore.loaded) return;

    const cfg = configStore.value;
    if (!cfg) return;

    // Only show migration prompt on first launch
    if (cfg.system?.firstLaunchDone) return;

    checkForElectronConfig();
  });

  async function checkForElectronConfig() {
    try {
      const result = await migrateElectronConfig();
      const data = result?.data || result;

      if (data?.found && data?.config) {
        migratedConfig = data.config;
        visible = true;
      }
    } catch (err) {
      // Silently fail -- migration is optional
      console.error('[MigrationPrompt] Check failed:', err);
    }
  }

  // ---- Actions ----

  async function markDone() {
    try {
      await setConfig({ system: { firstLaunchDone: true } });
    } catch {
      // Best-effort — config save failure shouldn't block UX
    }
  }

  async function applyMigration() {
    if (!migratedConfig) return;
    importing = true;
    importError = '';

    try {
      // Apply the migrated config as a patch, including firstLaunchDone
      await setConfig({ ...migratedConfig, system: { firstLaunchDone: true } });
      await loadConfig();
      visible = false;
    } catch (err) {
      console.error('[MigrationPrompt] Import failed:', err);
      importError = 'Failed to apply migrated settings. You can configure settings manually.';
    } finally {
      importing = false;
    }
  }

  function dismiss() {
    visible = false;
    migratedConfig = null;
    markDone();
  }
</script>

{#if visible}
  <div class="migration-overlay" role="dialog" aria-modal="true" aria-label="Import settings from Electron">
    <div class="migration-dialog">
      <h3>Import Settings</h3>

      <p class="migration-message">
        An existing Voice Mirror (Electron) configuration was detected on this system.
        Would you like to import your previous settings?
      </p>

      <div class="migration-details">
        <div class="detail-item">
          <span class="detail-label">AI Provider</span>
          <span class="detail-value">{migratedConfig?.ai?.provider || 'default'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Theme</span>
          <span class="detail-value">{migratedConfig?.appearance?.theme || 'colorblind'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">TTS Voice</span>
          <span class="detail-value">{migratedConfig?.voice?.ttsAdapter || 'kokoro'} / {migratedConfig?.voice?.ttsVoice || 'default'}</span>
        </div>
      </div>

      {#if importError}
        <div class="migration-error">{importError}</div>
      {/if}

      <div class="migration-actions">
        <Button variant="secondary" onClick={dismiss} disabled={importing}>
          Skip
        </Button>
        <Button variant="primary" onClick={applyMigration} disabled={importing}>
          {importing ? 'Importing...' : 'Import Settings'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .migration-overlay {
    position: fixed;
    inset: 0;
    z-index: 10002;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
  }

  .migration-dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 24px;
    max-width: 420px;
    width: 90%;
    box-shadow: var(--shadow-lg);
  }

  .migration-dialog h3 {
    color: var(--text-strong);
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 12px 0;
  }

  .migration-message {
    color: var(--text);
    font-size: 13px;
    line-height: 1.5;
    margin: 0 0 16px 0;
  }

  .migration-details {
    background: var(--bg);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .detail-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }

  .detail-label {
    color: var(--muted);
  }

  .detail-value {
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .migration-error {
    padding: 8px 12px;
    margin-bottom: 12px;
    background: var(--danger-subtle);
    color: var(--danger);
    border-radius: var(--radius-sm);
    border-left: 3px solid var(--danger);
    font-size: 12px;
  }

  .migration-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
</style>
