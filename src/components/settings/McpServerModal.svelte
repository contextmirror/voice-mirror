<script>
  import { mcpWriteServer, mcpTestConnection } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { onMount, untrack } from 'svelte';

  let { mode = 'add', server = null, onClose, onSave } = $props();

  // Freeze WebView2 while modal is open (airspace problem)
  onMount(() => {
    lensStore.freeze();
    return () => lensStore.unfreeze();
  });

  // Form state
  let name = $state(untrack(() => server?.name || ''));
  let command = $state(untrack(() => server?.config?.command || ''));
  let args = $state(untrack(() => (server?.config?.args || []).join('\n')));
  let envVars = $state(untrack(() =>
    server?.config?.env
      ? Object.entries(server.config.env).map(([k, v]) => ({ key: k, value: v }))
      : []
  ));
  let scope = $state(untrack(() => server?.source === 'project' ? (server?._projectPath || 'global') : 'global'));
  let saving = $state(false);
  let nameError = $state('');

  // Test state
  let testing = $state(false);
  let testResult = $state(null);

  // Scope options
  const scopeOptions = $derived.by(() => {
    const opts = [{ value: 'global', label: 'Global' }];
    for (const p of projectStore.entries) {
      opts.push({ value: p.path, label: `Project: ${p.name}` });
    }
    return opts;
  });

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }

  function addEnvVar() {
    envVars = [...envVars, { key: '', value: '' }];
  }

  function removeEnvVar(index) {
    envVars = envVars.filter((_, i) => i !== index);
  }

  function parseArgs() {
    return args.split('\n').map(a => a.trim()).filter(Boolean);
  }

  function buildEnv() {
    const env = {};
    for (const { key, value } of envVars) {
      const k = key.trim();
      if (k) env[k] = value;
    }
    return Object.keys(env).length > 0 ? env : null;
  }

  async function handleTest() {
    testing = true;
    testResult = null;
    try {
      const result = await mcpTestConnection(command, parseArgs(), buildEnv());
      const data = unwrapResult(result);
      testResult = data;
    } catch (err) {
      testResult = { success: false, error: String(err) };
    } finally {
      testing = false;
    }
  }

  async function handleSave() {
    nameError = '';

    const trimmedName = name.trim();
    if (!trimmedName) { nameError = 'Name is required'; return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) { nameError = 'Only letters, numbers, hyphens, underscores'; return; }
    if (!command.trim()) { nameError = 'Command is required'; return; }

    saving = true;
    try {
      const result = await mcpWriteServer(
        trimmedName,
        command.trim(),
        parseArgs(),
        buildEnv(),
        scope,
      );
      const data = unwrapResult(result);
      if (data === null && result?.error) {
        nameError = result.error;
        return;
      }
      onSave?.();
      onClose();
    } catch (err) {
      nameError = String(err);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal mcp-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-label="{mode === 'add' ? 'Add' : 'Edit'} MCP Server">
    <h3 class="modal-title">{mode === 'add' ? 'Add MCP Server' : 'Edit MCP Server'}</h3>

    <!-- Name -->
    <label class="field-label">
      Name
      <input class="field-input" type="text" bind:value={name} disabled={mode === 'edit'} placeholder="my-server" />
    </label>
    {#if nameError}
      <div class="field-error">{nameError}</div>
    {/if}

    <!-- Command -->
    <label class="field-label">
      Command
      <input class="field-input" type="text" bind:value={command} placeholder="npx" />
    </label>

    <!-- Args -->
    <label class="field-label">
      Arguments <span class="field-hint">(one per line)</span>
      <textarea class="field-textarea" bind:value={args} rows="3" placeholder="-y&#10;@anthropic/mcp-fs"></textarea>
    </label>

    <!-- Env vars -->
    <div class="field-label">Environment Variables</div>
    {#each envVars as env, i}
      <div class="env-row">
        <input class="field-input env-key" type="text" bind:value={env.key} placeholder="KEY" />
        <span class="env-eq">=</span>
        <input class="field-input env-val" type="text" bind:value={env.value} placeholder="value" />
        <button class="env-remove" onclick={() => removeEnvVar(i)} title="Remove">×</button>
      </div>
    {/each}
    <button class="env-add-btn" onclick={addEnvVar}>+ Add Variable</button>

    <!-- Scope -->
    <label class="field-label">
      Scope
      {#if mode === 'edit'}
        <input class="field-input" type="text" value={scope === 'global' ? 'Global' : `Project: ${scope}`} disabled />
      {:else}
        <select class="field-select" bind:value={scope}>
          {#each scopeOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {/if}
    </label>

    <!-- Test result -->
    {#if testResult}
      <div class="test-result" class:success={testResult.success} class:failure={!testResult.success}>
        {#if testResult.success}
          Connected{testResult.serverName ? ` to ${testResult.serverName}` : ''} — {testResult.toolCount ?? '?'} tools available
        {:else}
          {testResult.error || 'Connection failed'}
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-actions">
      <button class="btn-cancel" onclick={onClose}>Cancel</button>
      <button class="btn-test" onclick={handleTest} disabled={testing || !command.trim()}>
        {testing ? 'Testing...' : 'Test'}
      </button>
      <button class="btn-save" onclick={handleSave} disabled={saving || !name.trim() || !command.trim()}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mcp-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-title {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    margin-top: 12px;
  }

  .field-hint {
    opacity: 0.6;
    font-weight: normal;
  }

  .field-input, .field-textarea, .field-select {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-family);
    outline: none;
    box-sizing: border-box;
  }

  .field-input:focus, .field-textarea:focus, .field-select:focus {
    border-color: var(--accent);
  }

  .field-textarea {
    resize: vertical;
    min-height: 60px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  .field-error {
    font-size: 12px;
    color: var(--danger, #ef4444);
    margin-top: 4px;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
  }

  .env-key { flex: 2; font-family: var(--font-mono, monospace); font-size: 12px; }
  .env-eq { color: var(--muted); font-size: 13px; }
  .env-val { flex: 3; font-family: var(--font-mono, monospace); font-size: 12px; }

  .env-remove {
    background: none;
    border: none;
    color: var(--danger, #ef4444);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .env-remove:hover { background: var(--bg-hover); }

  .env-add-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    padding: 4px 0;
    margin-top: 4px;
    font-family: var(--font-family);
  }

  .env-add-btn:hover { text-decoration: underline; }

  .test-result {
    font-size: 12px;
    padding: 8px 10px;
    border-radius: var(--radius);
    margin-top: 12px;
  }

  .test-result.success {
    color: var(--ok, #22c55e);
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .test-result.failure {
    color: var(--danger, #ef4444);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .btn-cancel, .btn-test, .btn-save {
    padding: 6px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    font-family: var(--font-family);
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-cancel:hover { background: var(--bg-hover); }

  .btn-test {
    background: var(--bg);
    border: 1px solid var(--accent);
    color: var(--accent);
  }

  .btn-test:hover { background: var(--bg-hover); }

  .btn-save {
    background: var(--accent);
    color: #fff;
  }

  .btn-save:hover { filter: brightness(1.1); }

  .btn-test:disabled, .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
