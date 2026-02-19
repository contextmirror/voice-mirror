<script>
  /**
   * AISettings.svelte -- AI provider + Tool configuration panel.
   *
   * Provider selection, model input, auto-detect toggle,
   * provider scanning, status display, API keys,
   * and tool profiles with group toggles.
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { switchProvider } from '../../lib/stores/ai-status.svelte.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { scanProviders as apiScanProviders, listModels as apiListModels } from '../../lib/api.js';
  import Select from '../shared/Select.svelte';
  import Toggle from '../shared/Toggle.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Button from '../shared/Button.svelte';

  // ---- Provider icon imports (Vite resolves these) ----
  import claudeIcon from '../../assets/icons/providers/claude.webp';
  import ollamaIcon from '../../assets/icons/providers/ollama.svg';
  import lmstudioIcon from '../../assets/icons/providers/lmstudio.svg';
  import janIcon from '../../assets/icons/providers/jan.svg';
  import opencodeIcon from '../../assets/icons/providers/opencode.svg';

  // ---- Provider metadata ----

  const PROVIDER_NAMES = {
    claude: 'Claude Code',
    opencode: 'OpenCode',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    jan: 'Jan',
  };

  const PROVIDER_ICONS = {
    claude: { type: 'cover', src: claudeIcon },
    opencode: { type: 'inner', src: opencodeIcon, bg: 'linear-gradient(135deg, #1a1717, #131010)' },
    ollama: { type: 'inner', src: ollamaIcon, bg: 'linear-gradient(135deg, #f0f0f0, #d0d0d0)' },
    lmstudio: { type: 'inner', src: lmstudioIcon, bg: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
    jan: { type: 'inner', src: janIcon, bg: 'linear-gradient(135deg, #a855f7, #7c3aed)' },
  };

  const CLI_PROVIDERS = ['claude', 'opencode'];
  const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'jan'];

  const MCP_PROVIDERS = ['claude', 'opencode'];

  const DEFAULT_ENDPOINTS = {
    ollama: 'http://127.0.0.1:11434',
    lmstudio: 'http://127.0.0.1:1234',
    jan: 'http://127.0.0.1:1337',
  };

  const PROVIDER_GROUPS = [
    {
      label: 'CLI Agents',
      badge: 'Terminal Access',
      providers: [
        { value: 'claude', label: 'Claude Code' },
        { value: 'opencode', label: 'OpenCode' },
      ],
    },
    {
      label: 'Local LLM Servers',
      badge: null,
      providers: [
        { value: 'ollama', label: 'Ollama' },
        { value: 'lmstudio', label: 'LM Studio' },
        { value: 'jan', label: 'Jan' },
      ],
    },
  ];

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

  // ---- Tool group definitions (mirrors mcp-server/tool-groups.js) ----

  // Only show the 7 user-facing groups (matches Electron's settings-ai.html).
  // Facade groups (memory-facade, n8n-facade, browser-facade) and diagnostic
  // are internal — they're selected automatically via tool profiles, not manually.
  const TOOL_GROUPS = [
    { id: 'core', name: 'core', description: 'Voice I/O', toolCount: 4, alwaysLoaded: true },
    { id: 'meta', name: 'meta', description: 'Dynamic loading', toolCount: 3, alwaysLoaded: true },
    { id: 'screen', name: 'screen', description: 'Screenshots', toolCount: 1, alwaysLoaded: false },
    { id: 'memory', name: 'memory', description: 'Persistent memory', toolCount: 5, alwaysLoaded: false },
    { id: 'voice-clone', name: 'voice-clone', description: 'Voice cloning', toolCount: 3, alwaysLoaded: false },
    { id: 'browser', name: 'browser', description: 'Browser automation', toolCount: 14, alwaysLoaded: false },
    { id: 'n8n', name: 'n8n', description: 'Workflow automation', toolCount: 22, alwaysLoaded: false },
  ];

  // ---- Default tool profiles ----

  const DEFAULT_PROFILES = {
    'voice-assistant': { label: 'Voice Assistant', groups: ['core', 'meta', 'screen', 'memory', 'browser'] },
    'voice-assistant-lite': { label: 'Voice Assistant (Lite)', groups: ['core', 'meta', 'screen', 'memory-facade', 'browser-facade'] },
    'n8n-workflows': { label: 'n8n Workflows', groups: ['core', 'meta', 'n8n'] },
    'web-browser': { label: 'Web Browser', groups: ['core', 'meta', 'screen', 'browser'] },
    'full-toolbox': { label: 'Full Toolbox', groups: ['core', 'meta', 'screen', 'memory', 'voice-clone', 'browser', 'n8n'] },
    'minimal': { label: 'Minimal', groups: ['core', 'meta'] },
  };

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

  // Provider dropdown state
  let providerDropdownOpen = $state(false);
  let selectorEl = $state(null);

  /** @type {Array<{type: string, online: boolean, model?: string, models?: string[]}>} */
  let detectedProviders = $state([]);

  // Model dropdown state (for local LLM providers)
  /** @type {string[]} */
  let availableModels = $state([]);
  let loadingModels = $state(false);

  // Tool profile state
  let activeProfile = $state('voice-assistant');
  let enabledGroups = $state(new Set(['core', 'meta', 'screen', 'memory', 'browser']));

  // ---- Derived ----

  const isCLI = $derived(CLI_PROVIDERS.includes(provider));
  const isLocal = $derived(LOCAL_PROVIDERS.includes(provider));
  const showModel = $derived(!isCLI);
  const showEndpoint = $derived(isLocal);

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

  // Tool profile derived values
  const profileOptions = $derived(
    Object.entries(DEFAULT_PROFILES).map(([key, profile]) => ({
      value: key,
      label: profile.label,
    }))
  );

  const totalToolCount = $derived(
    TOOL_GROUPS
      .filter(g => enabledGroups.has(g.id))
      .reduce((sum, g) => sum + g.toolCount, 0)
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

    // Tool profile sync — use config value directly, not local `activeProfile`
    const cfgProfile = cfg.ai?.toolProfile || 'voice-assistant';
    activeProfile = cfgProfile;
    const profiles = cfg.ai?.toolProfiles || {};
    const profile = profiles[cfgProfile];
    if (profile?.groups) {
      enabledGroups = new Set(profile.groups);
    }
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
      const data = result?.data || result || {};

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
      const data = result?.data || result || {};
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

  // ---- Tool profile handlers ----

  function handleProfileChange(profileId) {
    activeProfile = profileId;
    const profile = DEFAULT_PROFILES[profileId];
    if (profile) {
      enabledGroups = new Set(profile.groups);
    }
  }

  function handleGroupToggle(groupId, enabled) {
    const next = new Set(enabledGroups);
    if (enabled) {
      next.add(groupId);
    } else {
      next.delete(groupId);
    }
    enabledGroups = next;
    activeProfile = detectMatchingProfile(next) || activeProfile;
  }

  function detectMatchingProfile(groups) {
    for (const [key, profile] of Object.entries(DEFAULT_PROFILES)) {
      const profileSet = new Set(profile.groups);
      if (profileSet.size === groups.size && [...groups].every(g => profileSet.has(g))) {
        return key;
      }
    }
    return null;
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
          toolProfile: activeProfile,
          toolProfiles: {
            [activeProfile]: { groups: [...enabledGroups] },
          },
        },
      };

      // Include endpoint for local providers
      if (isLocal && endpoint) {
        patch.ai.endpoints = { [provider]: endpoint };
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
      });

      // 3. Auto-switch view: Terminal for CLI providers, Chat for API providers
      if (CLI_PROVIDERS.includes(provider)) {
        navigationStore.setView('terminal');
      } else {
        navigationStore.setView('chat');
      }

      toastStore.addToast({ message: 'AI & Tools settings saved', severity: 'success' });
    } catch (err) {
      console.error('[AISettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save AI & Tools settings', severity: 'error' });
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
                      <span class="group-badge cli-badge">{group.badge}</span>
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
                onchange={(e) => (model = e.target.value)}
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

      {#if isLocal}
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

  <!-- Provider Status -->
  {#if detectedProviders.length > 0}
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

  <!-- API Key (only for cloud providers that require authentication) -->
  {#if !isCLI && !isLocal}
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

  <!-- Tool Profiles (only for CLI/MCP providers) -->
  {#if isCLI}
  <section class="settings-section">
    <h3>Tool Profile</h3>
    <div class="settings-group">
      <Select
        label="Active Profile"
        value={activeProfile}
        options={profileOptions}
        onChange={handleProfileChange}
      />
      <div class="tool-count-badge">
        <span class="tool-count-label">Total tools:</span>
        <span class="tool-count-value">{totalToolCount}</span>
      </div>
    </div>
  </section>

  <!-- Tool Groups -->
  <section class="settings-section">
    <h3>Tool Groups</h3>
    <div class="settings-group">
      {#each TOOL_GROUPS as group}
        <label class="tool-group-item">
          <input
            type="checkbox"
            checked={enabledGroups.has(group.id)}
            disabled={group.alwaysLoaded}
            onchange={(e) => handleGroupToggle(group.id, e.target.checked)}
          />
          <span class="tool-group-name">{group.name} <span class="tool-group-count">({group.toolCount})</span></span>
          <span class="tool-group-desc">{group.description}</span>
          {#if group.alwaysLoaded}
            <span class="tool-group-badge">always on</span>
          {/if}
        </label>
      {/each}
    </div>
  </section>
  {/if}

  <!-- Save -->
  <div class="settings-actions">
    <Button variant="primary" onClick={saveAISettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save AI & Tools'}
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

  .tool-count-badge {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 8px;
  }

  .tool-count-label {
    color: var(--muted);
    font-size: 13px;
  }

  .tool-count-value {
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }

  /* Tool group checkbox items (matches Electron's settings-ai.html) */
  .tool-group-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
  }

  .tool-group-item:hover {
    background: var(--accent-subtle);
  }

  .tool-group-item input[type="checkbox"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .tool-group-name {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }

  .tool-group-count {
    color: var(--muted);
    font-weight: 400;
  }

  .tool-group-desc {
    color: var(--muted);
    font-size: 12px;
    margin-left: auto;
  }

  .tool-group-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--accent-subtle);
    color: var(--accent);
    white-space: nowrap;
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
    width: 22px;
    height: 22px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .provider-icon-inner {
    width: 65%;
    height: 65%;
    object-fit: contain;
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
