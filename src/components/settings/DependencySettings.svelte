<script>
  /**
   * DependencySettings.svelte -- Dependency status panel.
   *
   * Two sections:
   *   1. Bundled      -- Components shipped inside the app (ghostty-web)
   *   2. System Tools -- External CLI tools the app depends on, with update support
   *
   * Hidden behind cfg.advanced.showDependencies feature flag.
   */
  import { checkNpmVersions, updateNpmPackage } from '../../lib/api.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Button from '../shared/Button.svelte';

  // ---- Bundled components (shipped with the app via Vite) ----

  const BUNDLED = [
    { key: 'ghosttyWeb', label: 'ghostty-web', desc: 'Terminal Emulator (WASM)', version: '0.4.0' },
  ];

  // ---- System tools (external CLIs detected on the user's machine) ----

  const SYSTEM_TOOLS = [
    { key: 'claude',   label: 'Claude Code', desc: 'AI CLI Agent',              updatable: true },
    { key: 'opencode', label: 'OpenCode',    desc: 'AI CLI Provider',           updatable: true },
    { key: 'ollama',   label: 'Ollama',      desc: 'Local LLM Server',          updatable: false },
    { key: 'ffmpeg',   label: 'ffmpeg',      desc: 'Audio/Video Processing',    updatable: false },
  ];

  // ---- Local state ----

  let checking = $state(false);
  let lastChecked = $state('');

  /** @type {Record<string, {version?: string, installed?: boolean, path?: string, latest?: string, updateAvailable?: boolean}>} */
  let systemData = $state({});

  /** @type {Record<string, 'idle'|'updating'|'updated'|'error'>} */
  let updateStatus = $state({});

  // ---- Derived ----

  const hasUpdates = $derived(
    SYSTEM_TOOLS.some(t => t.updatable && systemData[t.key]?.updateAvailable)
  );

  // ---- Check on mount ----

  $effect(() => {
    checkDependencies();
  });

  // ---- Functions ----

  async function checkDependencies(showToast = false) {
    checking = true;
    updateStatus = {};
    try {
      const result = await checkNpmVersions();
      const data = result?.data || result;
      if (data?.system) systemData = data.system;
      lastChecked = new Date().toLocaleTimeString();

      if (showToast) {
        const updates = SYSTEM_TOOLS.filter(t => t.updatable && systemData[t.key]?.updateAvailable);
        const missing = SYSTEM_TOOLS.filter(t => !systemData[t.key]?.installed);
        if (updates.length > 0) {
          toastStore.addToast({
            message: `${updates.length} update${updates.length > 1 ? 's' : ''} available: ${updates.map(t => t.label).join(', ')}`,
            severity: 'warning',
          });
        } else if (missing.length > 0) {
          toastStore.addToast({
            message: `All installed tools are up to date. ${missing.length} tool${missing.length > 1 ? 's' : ''} not found.`,
            severity: 'info',
          });
        } else {
          toastStore.addToast({ message: 'All dependencies up to date', severity: 'success' });
        }
      }
    } catch (err) {
      console.error('[DependencySettings] Check failed:', err);
      if (showToast) {
        toastStore.addToast({ message: 'Failed to check dependencies', severity: 'error' });
      }
    } finally {
      checking = false;
    }
  }

  async function handleUpdate(tool) {
    updateStatus[tool.key] = 'updating';
    try {
      const result = await updateNpmPackage(tool.key);
      const ok = result?.success ?? result?.data?.updated;
      if (ok) {
        updateStatus[tool.key] = 'updated';
        toastStore.addToast({ message: `${tool.label} updated successfully`, severity: 'success' });
        setTimeout(() => checkDependencies(false), 1500);
      } else {
        updateStatus[tool.key] = 'error';
        const errMsg = result?.error || 'Unknown error';
        toastStore.addToast({ message: `Failed to update ${tool.label}: ${errMsg}`, severity: 'error' });
      }
    } catch (err) {
      console.error(`[DependencySettings] Update failed for ${tool.label}:`, err);
      updateStatus[tool.key] = 'error';
      toastStore.addToast({ message: `Failed to update ${tool.label}`, severity: 'error' });
    }
  }

  async function handleUpdateAll() {
    const toUpdate = SYSTEM_TOOLS.filter(t => t.updatable && systemData[t.key]?.updateAvailable);
    for (const tool of toUpdate) {
      await handleUpdate(tool);
    }
    setTimeout(() => checkDependencies(), 1500);
  }

  function getSystemBadge(tool) {
    const info = systemData[tool.key];
    const status = updateStatus[tool.key];

    if (status === 'updating') return { cls: 'checking', text: 'Updating...' };
    if (status === 'updated')  return { cls: 'up-to-date', text: 'Updated!' };
    if (status === 'error')    return { cls: 'error', text: 'Update failed' };

    if (!info) return { cls: 'checking', text: checking ? 'Checking...' : '--' };
    if (!info.installed) return { cls: 'not-installed', text: 'Not found' };
    if (info.updateAvailable) return { cls: 'update-available', text: 'Update available' };
    return { cls: 'up-to-date', text: 'Installed' };
  }
</script>

<div class="dependency-settings">
  <!-- Section 1: Bundled Components -->
  <section class="dep-section">
    <div class="dep-section-header">
      <h3>Bundled</h3>
    </div>

    <div class="dep-cards">
      {#each BUNDLED as pkg}
        <div class="dep-card dep-card-compact">
          <div class="dep-header">
            <div class="dep-name-group">
              <span class="dep-name">{pkg.label}</span>
              <span class="dep-desc">{pkg.desc}</span>
            </div>
          </div>
          <div class="dep-footer">
            <span class="dep-badge up-to-date">v{pkg.version}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Section 2: System Tools -->
  <section class="dep-section">
    <div class="dep-section-header">
      <h3>System Tools</h3>
      {#if hasUpdates}
        <Button
          variant="secondary"
          small
          onClick={handleUpdateAll}
        >
          Update All
        </Button>
      {/if}
    </div>

    <div class="dep-cards">
      {#each SYSTEM_TOOLS as tool}
        {@const info = systemData[tool.key]}
        {@const badge = getSystemBadge(tool)}
        {@const status = updateStatus[tool.key]}
        <div class="dep-card">
          <div class="dep-header">
            <div class="dep-name-group">
              <span class="dep-name">{tool.label}</span>
              <span class="dep-desc">{tool.desc}</span>
            </div>
          </div>
          {#if info?.installed}
            <div class="dep-versions">
              <div class="dep-row">
                <span class="dep-label">Installed</span>
                <span class="dep-value">{info.version || 'Available'}</span>
              </div>
              {#if tool.updatable}
                <div class="dep-row">
                  <span class="dep-label">Latest</span>
                  <span class="dep-value">{info.latest || (checking ? '...' : '--')}</span>
                </div>
              {/if}
            </div>
          {/if}
          <div class="dep-footer">
            <span class="dep-badge {badge.cls}">{badge.text}</span>
            {#if tool.updatable && info?.updateAvailable && status !== 'updated'}
              <button
                class="dep-update-btn"
                disabled={status === 'updating'}
                onclick={() => handleUpdate(tool)}
              >
                {status === 'updating' ? 'Updating...' : (status === 'error' ? 'Retry' : 'Update')}
              </button>
            {/if}
          </div>
          {#if info?.path}
            <div class="dep-path-row">
              <span class="dep-path" title={info.path}>{info.path}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- Actions footer -->
  <div class="dep-actions">
    <Button
      variant="secondary"
      small
      onClick={() => checkDependencies(true)}
      disabled={checking}
    >
      {checking ? 'Checking...' : 'Check for Updates'}
    </Button>
    {#if lastChecked}
      <span class="last-checked">Last checked: {lastChecked}</span>
    {/if}
  </div>
</div>

<style>
  .dependency-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dep-section {
    margin-bottom: 20px;
  }

  .dep-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .dep-section-header h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .dep-cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dep-card {
    background: var(--card-highlight);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 14px 16px;
  }

  .dep-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }

  .dep-name-group {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .dep-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-strong);
    font-family: var(--font-mono);
  }

  .dep-desc {
    font-size: 11px;
    color: var(--muted);
  }

  .dep-versions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .dep-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .dep-label {
    font-size: 12px;
    color: var(--muted);
  }

  .dep-value {
    font-size: 12px;
    color: var(--text);
    font-family: var(--font-mono);
  }

  .dep-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dep-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .dep-badge.up-to-date {
    background: var(--ok-subtle, rgba(74, 222, 128, 0.15));
    color: var(--ok);
  }

  .dep-badge.update-available {
    background: var(--warn-subtle);
    color: var(--warn);
  }

  .dep-badge.not-installed {
    background: var(--bg-hover);
    color: var(--muted);
  }

  .dep-badge.error {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  .dep-badge.checking {
    color: var(--muted);
  }

  .dep-update-btn {
    padding: 4px 14px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    background: var(--warn-subtle);
    color: var(--warn);
    transition: background var(--duration-fast) var(--ease-out);
  }

  .dep-update-btn:hover:not(:disabled) {
    filter: brightness(1.2);
  }

  .dep-update-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dep-path-row {
    margin-top: 6px;
  }

  .dep-path {
    font-size: 10px;
    color: var(--muted);
    font-family: var(--font-mono);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dep-card-compact {
    padding: 10px 16px;
  }

  .dep-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }

  .last-checked {
    color: var(--muted);
    font-size: 11px;
  }

  @media (prefers-reduced-motion: reduce) {
    .dep-update-btn {
      transition: none;
    }
  }
</style>
