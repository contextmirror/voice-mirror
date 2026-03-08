<script>
  /**
   * AISettings.svelte -- AI provider configuration panel.
   *
   * Provider selection, model input, auto-detect toggle,
   * provider scanning, status display, system prompt, and API keys.
   * Tool profiles are managed by ToolSettings.svelte (rendered by SettingsPanel).
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { switchProvider } from '../../lib/stores/ai-status.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { scanProviders as apiScanProviders, listModels as apiListModels } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import {
    PROVIDER_NAMES, PROVIDER_ICONS, PROVIDER_GROUPS,
    CLI_PROVIDERS, LOCAL_PROVIDERS, MCP_PROVIDERS, DEFAULT_ENDPOINTS,
  } from '../../lib/providers.js';
  import Select from '../shared/Select.svelte';
  import Toggle from '../shared/Toggle.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Button from '../shared/Button.svelte';

  // ---- Context length options ----

  const CONTEXT_LENGTH_OPTIONS = [
    { value: '4096', label: '4K' },
    { value: '8192', label: '8K' },
    { value: '16384', label: '16K' },
    { value: '32768', label: '32K (Default)' },
    { value: '65536', label: '64K' },
    { value: '131072', label: '128K' },
  ];

  // ---- API key provider labels ----

  const API_KEY_PROVIDERS = [
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'gemini', label: 'Gemini' },
    { key: 'grok', label: 'Grok' },
    { key: 'groq', label: 'Groq' },
    { key: 'mistral', label: 'Mistral' },
    { key: 'openrouter', label: 'OpenRouter' },
    { key: 'deepseek', label: 'DeepSeek' },
    { key: 'kimi', label: 'Kimi' },
  ];

  // ---- Local state ----

  let provider = $state('claude');
  let model = $state('');
  let autoDetect = $state(true);
  let endpoint = $state('');
  let contextLength = $state(32768);
  let systemPrompt = $state('');
  let apiKeys = $state({});
  let scanning = $state(false);
  let saving = $state(false);
  let hasScanned = $state(false);
  let selectedWorkspace = $state('');

  // Provider dropdown state
  let providerDropdownOpen = $state(false);
  let selectorEl = $state(null);

  /** @type {Array<{type: string, online: boolean, model?: string, models?: string[]}>} */
  let detectedProviders = $state([]);

  // Model dropdown state (for local LLM providers)
  /** @type {string[]} */
  let availableModels = $state([]);
  let loadingModels = $state(false);

  // ---- Derived ----

  const isCLI = $derived(CLI_PROVIDERS.includes(provider));
  const isLocal = $derived(LOCAL_PROVIDERS.includes(provider));
  const isDictation = $derived(provider === 'dictation');
  const showModel = $derived(!isCLI && !isDictation);
  const showEndpoint = $derived(isLocal && !isDictation);

  const providerStatusItems = $derived(
    ['ollama', 'lmstudio', 'jan'].map(type => {
      const found = detectedProviders.find(p => p.type === type);
      return {
        type,
        name: PROVIDER_NAMES[type] || type,
        online: found?.online || false,
        model: found?.model || null,
      };
    })
  );

  // ---- Sync from config (one-way, only on config load/change) ----
  // IMPORTANT: Do NOT read local $state variables (provider, activeProfile, etc.)
  // inside this effect — that creates circular dependencies where user edits
  // get overwritten by the config value before saving.

  $effect(() => {
    const cfg = configStore.value;
    if (!cfg) return;

    const cfgProvider = cfg.ai?.provider || 'claude';
    provider = cfgProvider;
    model = cfg.ai?.model || '';
    autoDetect = cfg.ai?.autoDetect !== false;
    contextLength = cfg.ai?.contextLength || 32768;
    systemPrompt = cfg.ai?.systemPrompt || '';

    // Use cfgProvider (not local `provider`) to avoid circular dependency
    const ep = cfg.ai?.endpoints || {};
    endpoint = ep[cfgProvider] || DEFAULT_ENDPOINTS[cfgProvider] || '';

    // Restore last-used workspace for CLI providers (default to active project)
    selectedWorkspace = cfg.ai?.lastWorkspace ?? projectStore.activeProject?.path ?? '';
  });

  // ---- Click-outside handler for provider dropdown ----

  $effect(() => {
    if (providerDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeydown);
      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleKeydown);
      };
    }
  });

  // ---- Auto-scan on mount ----

  let hasInitialFetch = false;
  $effect(() => {
    if (autoDetect && !hasScanned) {
      hasScanned = true;
      scanProviders();
    }
  });

  // Fetch models for local providers on initial config load
  $effect(() => {
    const cfg = configStore.value;
    if (!cfg || hasInitialFetch) return;
    const cfgProvider = cfg.ai?.provider || 'claude';
    if (LOCAL_PROVIDERS.includes(cfgProvider)) {
      hasInitialFetch = true;
      const ep = cfg.ai?.endpoints || {};
      const url = ep[cfgProvider] || DEFAULT_ENDPOINTS[cfgProvider] || '';
      fetchModels(cfgProvider, url);
    }
  });

  // ---- Provider change ----

  function handleProviderChange(newProvider) {
    provider = newProvider;
    providerDropdownOpen = false;

    if (newProvider === 'dictation') {
      availableModels = [];
      return;
    }

    // Load saved endpoint for this provider, or fall back to default
    const cfg = configStore.value;
    const savedEndpoints = cfg?.ai?.endpoints || {};
    if (LOCAL_PROVIDERS.includes(newProvider)) {
      endpoint = savedEndpoints[newProvider] || DEFAULT_ENDPOINTS[newProvider] || '';
      // Auto-fetch models from the local server
      fetchModels(newProvider, endpoint);
    } else {
      availableModels = [];
    }

    // Load saved model for this provider
    if (!CLI_PROVIDERS.includes(newProvider)) {
      model = cfg?.ai?.model || '';
    }
  }

  function toggleProviderDropdown() {
    providerDropdownOpen = !providerDropdownOpen;
  }

  function handleClickOutside(e) {
    if (selectorEl && !selectorEl.contains(e.target)) {
      providerDropdownOpen = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') providerDropdownOpen = false;
  }

  // ---- Scan providers ----

  async function scanProviders() {
    scanning = true;
    try {
      const result = await apiScanProviders();
      const data = unwrapResult(result) || {};

      // Local LLM server results (online status, models)
      detectedProviders = data.local || [];

      // If the current provider is local, populate its model list from scan
      if (LOCAL_PROVIDERS.includes(provider)) {
        const found = detectedProviders.find((p) => p.type === provider);
        if (found?.models?.length > 0) {
          availableModels = found.models;
          // If no model selected yet, auto-select the first one
          if (!model) {
            model = found.model || found.models[0];
          }
        }
      }
    } catch (err) {
      console.error('[AISettings] Scan failed:', err);
      detectedProviders = [];
    } finally {
      scanning = false;
    }
  }

  // ---- Fetch models from a local LLM server ----

  async function fetchModels(providerType, baseUrl) {
    loadingModels = true;
    availableModels = [];
    try {
      const result = await apiListModels(providerType, baseUrl || undefined);
      /** @type {{ online?: boolean, models?: string[], default?: string }} */
      const data = unwrapResult(result) || {};
      if (data.online && data.models?.length > 0) {
        availableModels = data.models;
        // Auto-select first model if none chosen
        if (!model) {
          model = data.default || data.models[0];
        }
      }
    } catch (err) {
      console.error('[AISettings] Fetch models failed:', err);
      availableModels = [];
    } finally {
      loadingModels = false;
    }
  }

  // ---- Workspace picker (CLI providers) ----

  async function browseWorkspace() {
    const selected = await openDialog({ directory: true });
    if (selected) selectedWorkspace = selected;
  }

  // ---- Save ----

  async function saveAISettings() {
    saving = true;
    try {
      const patch = {
        ai: {
          provider,
          model: model || null,
          autoDetect,
          contextLength: Number(contextLength),
          systemPrompt: systemPrompt || null,
        },
      };

      // Include endpoint for local providers
      if (isLocal && endpoint) {
        patch.ai.endpoints = { [provider]: endpoint };
      }

      // Persist last-used workspace for CLI providers
      if (isCLI && selectedWorkspace) {
        patch.ai.lastWorkspace = selectedWorkspace;
      }

      // Only include non-empty API keys
      const filteredKeys = {};
      for (const [k, v] of Object.entries(apiKeys)) {
        if (v) filteredKeys[k] = v;
      }
      if (Object.keys(filteredKeys).length > 0) {
        patch.ai.apiKeys = filteredKeys;
      }

      // 1. Persist config
      await updateConfig(patch);

      // 2. Switch the active provider in the Rust backend
      await switchProvider(provider, {
        model: model || undefined,
        baseUrl: (isLocal && endpoint) ? endpoint : undefined,
        apiKey: filteredKeys[provider] || undefined,
        contextLength: Number(contextLength),
        systemPrompt: systemPrompt || undefined,
        cwd: (isCLI && selectedWorkspace) ? selectedWorkspace : undefined,
      });

      // 3. Auto-switch view: Terminal for CLI, Chat for API, stay for dictation
      if (isDictation) {
        // Dictation-only: stay on current view
      } else if (CLI_PROVIDERS.includes(provider)) {
        navigationStore.setView('terminal');
      } else {
        navigationStore.setView('chat');
      }

      toastStore.addToast({ message: 'AI settings saved', severity: 'success' });
    } catch (err) {
      console.error('[AISettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save AI settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="ai-settings">
  <!-- Provider Selection -->
  <section class="settings-section">
    <h3>AI Provider</h3>
    <div class="settings-group">
      <!-- Custom provider selector with icons -->
      <div class="provider-select-row">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="provider-select-label">Provider</label>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="provider-selector"
          class:open={providerDropdownOpen}
          bind:this={selectorEl}
        >
          <button
            class="provider-selector-btn"
            type="button"
            onclick={toggleProviderDropdown}
          >
            {#if PROVIDER_ICONS[provider]?.type === 'cover'}
              <span class="provider-icon" style="background: url({PROVIDER_ICONS[provider].src}) center/cover no-repeat; border-radius: 4px;"></span>
            {:else if PROVIDER_ICONS[provider]}
              <span class="provider-icon" style="background: {PROVIDER_ICONS[provider].bg};">
                <img class="provider-icon-inner" src={PROVIDER_ICONS[provider].src} alt="" />
              </span>
            {:else}
              <span class="provider-icon"></span>
            {/if}
            <span class="provider-name">{PROVIDER_NAMES[provider] || provider}</span>
            <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {#if providerDropdownOpen}
            <div class="provider-dropdown">
              {#each PROVIDER_GROUPS as group}
                <div class="provider-group">
                  <div class="provider-group-label">
                    {group.label}
                    {#if group.badge}
                      <span class="group-badge" class:cli-badge={group.label === 'CLI Agents'} class:voice-badge={group.label === 'Voice Input'}>{group.badge}</span>
                    {/if}
                  </div>
                  {#each group.providers as opt}
                    <button
                      class="provider-option"
                      class:selected={provider === opt.value}
                      type="button"
                      onclick={() => handleProviderChange(opt.value)}
                    >
                      {#if PROVIDER_ICONS[opt.value]?.type === 'cover'}
                        <span class="provider-icon" style="background: url({PROVIDER_ICONS[opt.value].src}) center/cover no-repeat; border-radius: 4px;"></span>
                      {:else if PROVIDER_ICONS[opt.value]}
                        <span class="provider-icon" style="background: {PROVIDER_ICONS[opt.value].bg};">
                          <img class="provider-icon-inner" src={PROVIDER_ICONS[opt.value].src} alt="" />
                        </span>
                      {:else}
                        <span class="provider-icon"></span>
                      {/if}
                      <span>{opt.label}</span>
                      {#if MCP_PROVIDERS.includes(opt.value)}
                        <span class="provider-badge">MCP</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      {#if isCLI}
        <div class="info-box cli-warning">
          CLI providers use their own terminal process. Model selection and
          configuration happen inside the CLI tool, not here.
        </div>

        <!-- Workspace picker for CLI providers -->
        <div class="workspace-select-row">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="setting-label">Workspace</label>
          <div class="workspace-select-wrapper">
            <select
              class="workspace-select"
              value={selectedWorkspace}
              onchange={(e) => (selectedWorkspace = /** @type {HTMLSelectElement} */ (e.target).value)}
            >
              <option value="">Voice Mirror (default)</option>
              {#each projectStore.entries as project}
                <option value={project.path}>{project.name}</option>
              {/each}
            </select>
            <button class="workspace-browse-btn" type="button" onclick={browseWorkspace} title="Browse for folder...">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
            </button>
          </div>
        </div>
        {#if selectedWorkspace}
          <div class="workspace-path-hint">{selectedWorkspace}</div>
        {/if}
      {/if}

      {#if isDictation}
        <div class="info-box dictation-info">
          Voice-to-text only — speak and text will be typed into the focused
          application. No AI model needed.
        </div>
      {/if}

      {#if showModel}
        {#if isLocal && (availableModels.length > 0 || loadingModels)}
          <!-- Model dropdown populated from local server -->
          <div class="model-select-row">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="setting-label">Model</label>
            <div class="model-select-wrapper">
              <select
                class="model-select"
                value={model}
                disabled={loadingModels}
                onchange={(e) => (model = /** @type {HTMLSelectElement} */ (e.target).value)}
              >
                <option value="">Auto (default)</option>
                {#each availableModels as m}
                  <option value={m}>{m}</option>
                {/each}
              </select>
              {#if loadingModels}
                <span class="model-loading">Loading...</span>
              {/if}
            </div>
          </div>
        {:else}
          <!-- Fallback text input when server is offline or no models found -->
          <TextInput
            label="Model"
            value={model}
            placeholder="Auto (default)"
            onChange={(v) => (model = v)}
          />
        {/if}
      {/if}

      {#if showEndpoint}
        <TextInput
          label="Endpoint"
          value={endpoint}
          placeholder={DEFAULT_ENDPOINTS[provider] || 'http://...'}
          onChange={(v) => {
            endpoint = v;
            // Re-fetch models when endpoint changes (debounced by user action)
            if (isLocal && v) fetchModels(provider, v);
          }}
        />
      {/if}

      {#if isLocal && !isDictation}
        <Select
          label="Context Length"
          value={String(contextLength)}
          options={CONTEXT_LENGTH_OPTIONS}
          onChange={(v) => (contextLength = Number(v))}
        />
      {/if}
    </div>
  </section>

  <!-- Auto-Detection -->
  {#if !isDictation}
  <section class="settings-section">
    <h3>Detection</h3>
    <div class="settings-group">
      <Toggle
        label="Auto-detect providers"
        description="Scan for local LLM servers on startup"
        checked={autoDetect}
        onChange={(v) => (autoDetect = v)}
      />
      <div class="scan-row">
        <Button
          variant="secondary"
          small
          onClick={scanProviders}
          disabled={scanning}
        >
          {scanning ? 'Scanning...' : 'Scan Now'}
        </Button>
      </div>
    </div>
  </section>
  {/if}

  <!-- Provider Status -->
  {#if detectedProviders.length > 0 && !isDictation}
    <section class="settings-section">
      <h3>Local LLM Servers</h3>
      <div class="detection-status">
        {#each providerStatusItems as item}
          <div class="provider-item">
            <span class="status-dot" class:online={item.online}></span>
            <span class="provider-name">{item.name}</span>
            {#if item.online && item.model}
              <span class="model-name">{item.model}</span>
            {:else if !item.online}
              <span class="model-name">offline</span>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- System Prompt -->
  {#if !isDictation}
  <section class="settings-section">
    <h3>System Prompt</h3>
    <div class="settings-group">
      <div class="textarea-row">
        <textarea
          class="system-prompt-input"
          placeholder="Custom instructions for the AI... (optional)"
          maxlength="50000"
          bind:value={systemPrompt}
        ></textarea>
      </div>
    </div>
  </section>
  {/if}

  <!-- API Key (only for cloud providers that require authentication) -->
  {#if !isCLI && !isLocal && !isDictation}
    <section class="settings-section">
      <h3>API Key</h3>
      <div class="settings-group">
        <TextInput
          label={PROVIDER_NAMES[provider] || provider}
          type="password"
          value={apiKeys[provider] || ''}
          placeholder="Enter API key..."
          onChange={(v) => (apiKeys[provider] = v)}
        />
      </div>
    </section>
  {/if}

  <!-- Save -->
  <div class="settings-actions">
    <Button variant="primary" onClick={saveAISettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save AI Settings'}
    </Button>
  </div>
</div>

<style>
  .ai-settings {
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

  .info-box {
    padding: 10px 14px;
    margin: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
  }

  .cli-warning {
    background: var(--warn-subtle);
    border-left: 3px solid var(--warn);
  }

  .dictation-info {
    background: var(--ok-subtle, rgba(34, 197, 94, 0.1));
    border-left: 3px solid var(--ok);
  }

  .scan-row {
    padding: 8px 12px;
  }

  /* Detection status */
  .detection-status {
    padding: 12px;
    background: var(--bg);
    border-radius: var(--radius-sm);
    border-left: 3px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .provider-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
  }

  .status-dot.online {
    background: var(--ok);
    box-shadow: 0 0 6px var(--ok-glow);
  }

  .provider-name {
    flex: 1;
  }

  .model-name {
    color: var(--muted);
    font-size: 11px;
    margin-left: auto;
  }

  .textarea-row {
    padding: 12px;
  }

  .system-prompt-input {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    padding: 10px 12px;
    font-size: 13px;
    font-family: var(--font-family);
    width: 100%;
    min-height: 100px;
    resize: vertical;
    box-sizing: border-box;
    transition: border-color var(--duration-fast) var(--ease-in-out);
  }

  .system-prompt-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .system-prompt-input::placeholder {
    color: var(--muted);
  }

  /* ---- Model dropdown (local LLM providers) ---- */

  .model-select-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .setting-label {
    color: var(--text);
    font-size: 14px;
    white-space: nowrap;
  }

  .model-select-wrapper {
    min-width: 220px;
    position: relative;
  }

  .model-select {
    width: 100%;
    padding: 10px 32px 10px 14px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    font-size: 14px;
    font-family: var(--font-family);
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 16px;
    transition: border-color 0.15s ease;
  }

  .model-select:hover {
    border-color: var(--border-strong);
  }

  .model-select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .model-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .model-loading {
    position: absolute;
    right: 36px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    color: var(--muted);
    pointer-events: none;
  }

  /* ---- Workspace picker (CLI providers) ---- */

  .workspace-select-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .workspace-select-wrapper {
    min-width: 220px;
    display: flex;
    gap: 6px;
  }

  .workspace-select {
    flex: 1;
    padding: 10px 32px 10px 14px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    font-size: 14px;
    font-family: var(--font-family);
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 16px;
    transition: border-color 0.15s ease;
  }

  .workspace-select:hover {
    border-color: var(--border-strong);
  }

  .workspace-select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .workspace-browse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--muted);
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
  }

  .workspace-browse-btn:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .workspace-path-hint {
    padding: 2px 12px 8px;
    font-size: 11px;
    color: var(--muted);
    word-break: break-all;
  }

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }

  /* ---- Custom provider selector ---- */

  .provider-select-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .provider-select-label {
    color: var(--text);
    font-size: 14px;
    white-space: nowrap;
  }

  .provider-selector {
    position: relative;
    min-width: 220px;
  }

  .provider-selector-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    font-size: 14px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .provider-selector-btn:hover {
    border-color: var(--border-strong);
  }

  .provider-selector-btn:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .provider-selector-btn .provider-name {
    flex: 1;
    text-align: left;
  }

  .provider-selector-btn :global(.dropdown-arrow) {
    width: 16px;
    height: 16px;
    opacity: 0.6;
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }

  .provider-selector.open :global(.dropdown-arrow) {
    transform: rotate(180deg);
  }

  /* Provider icon base */
  .provider-icon {
    width: 24px;
    height: 24px;
    padding: 3px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .provider-icon-inner {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  /* Dropdown menu */
  .provider-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    max-height: 360px;
    overflow-y: auto;
    animation: dropdown-fade-in 0.15s ease;
  }

  @keyframes dropdown-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .provider-group {
    padding: 6px 0;
  }

  .provider-group:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }

  .provider-group-label {
    padding: 8px 14px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }

  .group-badge {
    display: inline-block;
    padding: 1px 6px;
    margin-left: 6px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border-radius: var(--radius-sm);
    vertical-align: middle;
  }

  .group-badge.cli-badge {
    background: var(--warn-subtle);
    color: var(--warn);
  }

  .group-badge.voice-badge {
    background: var(--ok-subtle, rgba(34, 197, 94, 0.1));
    color: var(--ok);
  }

  .provider-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    cursor: pointer;
    color: var(--text);
    font-size: 14px;
    font-family: var(--font-family);
    background: none;
    border: none;
    transition: background 0.15s ease;
    text-align: left;
  }

  .provider-option:hover {
    background: var(--accent-subtle);
  }

  .provider-option.selected {
    background: var(--accent-glow);
  }

  .provider-badge {
    display: inline-block;
    padding: 1px 7px;
    margin-left: auto;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border-radius: var(--radius-sm);
    background: var(--accent-subtle);
    color: var(--accent);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .provider-selector-btn,
    .provider-selector-btn :global(.dropdown-arrow),
    .provider-dropdown,
    .provider-option {
      transition: none;
      animation: none;
    }
  }
</style>
