<script>
  /**
   * BehaviorSettings.svelte -- General settings panel.
   *
   * User name, startup behavior, and advanced toggles
   * (debug mode, show dependencies).
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Toggle from '../shared/Toggle.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Button from '../shared/Button.svelte';

  // ---- Local state ----

  let userName = $state('');
  let startMinimized = $state(false);
  let startWithSystem = $state(false);
  let debugMode = $state(false);
  let showDependencies = $state(false);

  let saving = $state(false);

  // ---- Sync from config store ----

  $effect(() => {
    const cfg = configStore.value;
    if (!cfg) return;

    userName = cfg.user?.name || '';
    startMinimized = cfg.behavior?.startMinimized === true;
    startWithSystem = cfg.behavior?.startWithSystem === true;
    debugMode = cfg.advanced?.debugMode === true;
    showDependencies = cfg.advanced?.showDependencies === true;
  });

  // ---- Save handler ----

  async function saveBehaviorSettings() {
    saving = true;
    try {
      const patch = {
        user: {
          name: userName || null,
        },
        behavior: {
          startMinimized,
          startWithSystem,
        },
        advanced: {
          debugMode,
          showDependencies,
        },
      };
      await updateConfig(patch);
      toastStore.addToast({ message: 'General settings saved', severity: 'success' });
    } catch (err) {
      console.error('[BehaviorSettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="behavior-settings">
  <!-- User Name -->
  <section class="settings-section">
    <h3>User</h3>
    <div class="settings-group">
      <TextInput
        label="Name"
        value={userName}
        placeholder="Your name..."
        onChange={(v) => (userName = v.slice(0, 50))}
      />
    </div>
  </section>

  <!-- Startup Behavior -->
  <section class="settings-section">
    <h3>Startup</h3>
    <div class="settings-group">
      <Toggle
        label="Start Minimized"
        description="Launch with the panel hidden"
        checked={startMinimized}
        onChange={(v) => (startMinimized = v)}
      />
      <Toggle
        label="Start with System"
        description="Launch automatically on login"
        checked={startWithSystem}
        onChange={(v) => (startWithSystem = v)}
      />
    </div>
  </section>

  <!-- Advanced -->
  <section class="settings-section">
    <h3>Advanced</h3>
    <div class="settings-group">
      <Toggle
        label="Debug Mode"
        description="Enable debug logging"
        checked={debugMode}
        onChange={(v) => (debugMode = v)}
      />
      <Toggle
        label="Show Dependencies"
        description="Show Dependencies tab in settings"
        checked={showDependencies}
        onChange={(v) => (showDependencies = v)}
      />
    </div>
  </section>

  <!-- Save Button -->
  <div class="settings-actions">
    <Button variant="primary" onClick={saveBehaviorSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save General Settings'}
    </Button>
  </div>
</div>

<style>
  .behavior-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 12px 0;
  }

  .settings-group {
    background: var(--card-highlight);
    border-radius: var(--radius-md);
    padding: 4px;
  }

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
</style>
