<script>
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { saveProjectIcon, removeProjectIcon, discoverMcpServers } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';

  let { projectIndex, onClose } = $props();

  // Freeze WebView2 while modal is open (airspace problem — native control renders above HTML)
  onMount(() => {
    lensStore.freeze();
    // Fetch MCP servers for this project
    if (entry?.path) {
      discoverMcpServers(entry.path, entry.mcpServers || null)
        .then(result => {
          const servers = unwrapResult(result) || [];
          mcpServers = servers;
          mcpToggles = {};
          for (const s of servers) {
            mcpToggles[s.name] = s.enabled;
          }
        })
        .catch(err => console.error('[edit-project] MCP discovery failed:', err))
        .finally(() => { mcpLoading = false; });
    } else {
      mcpLoading = false;
    }
    return () => lensStore.unfreeze();
  });

  const entry = $derived(projectStore.entries[projectIndex]);

  // Local editing state (only persisted on Save)
  let name = $state(entry?.name || '');
  let color = $state(entry?.color || '#3b82f6');
  let iconFilename = $state(entry?.icon || null);
  let iconPreview = $state(entry?.icon ? (projectStore.iconCache[entry.icon] || null) : null);
  let uploadedFilename = $state(null);
  let sizeWarning = $state(false);
  let saving = $state(false);
  let mcpServers = $state([]);
  let mcpLoading = $state(true);
  let mcpToggles = $state({}); // { serverName: boolean }

  const originalIcon = entry?.icon || null;

  const COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  ];

  function handleKeydown(e) {
    if (e.key === 'Escape') handleCancel();
  }

  async function handlePickImage() {
    const selected = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'gif', 'bmp', 'tif', 'tiff'] }],
    });
    if (!selected) return;

    try {
      // Clean up previous upload if it wasn't the original icon
      if (uploadedFilename && uploadedFilename !== originalIcon) {
        try { await removeProjectIcon(uploadedFilename); } catch {}
      }

      const result = await saveProjectIcon(selected);
      const data = unwrapResult(result);
      if (data) {
        iconFilename = data.filename;
        iconPreview = data.dataUrl;
        uploadedFilename = data.filename;
        sizeWarning = data.sizeWarning || false;
      }
    } catch (err) {
      console.error('[edit-project] Failed to save icon:', err);
    }
  }

  function handleRemoveIcon() {
    iconFilename = null;
    iconPreview = null;
    sizeWarning = false;
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    saving = true;

    if (trimmed !== entry.name) {
      projectStore.updateProjectField(projectIndex, 'name', trimmed);
    }
    if (color !== entry.color) {
      projectStore.updateProjectField(projectIndex, 'color', color);
    }

    if (iconFilename !== originalIcon) {
      projectStore.updateProjectField(projectIndex, 'icon', iconFilename || null);

      // Update icon cache
      if (iconFilename && iconPreview) {
        projectStore.setIconCache(iconFilename, iconPreview);
      }
      // Delete old icon file if it was removed or replaced
      if (originalIcon && originalIcon !== iconFilename) {
        try { await removeProjectIcon(originalIcon); } catch {}
        projectStore.removeIconCache(originalIcon);
      }
    }

    // Clean up uploaded file that got replaced before saving
    if (uploadedFilename && uploadedFilename !== iconFilename && uploadedFilename !== originalIcon) {
      try { await removeProjectIcon(uploadedFilename); } catch {}
    }

    // Save MCP server preferences
    if (mcpServers.length > 0) {
      const mcpPrefs = {};
      for (const s of mcpServers) {
        if (s.isOwn) continue;
        mcpPrefs[s.name] = { enabled: mcpToggles[s.name] ?? true };
      }
      projectStore.updateProjectField(projectIndex, 'mcpServers', mcpPrefs);
    }

    onClose();
  }

  async function handleCancel() {
    // Clean up uploaded icon that wasn't saved
    if (uploadedFilename && uploadedFilename !== originalIcon) {
      try { await removeProjectIcon(uploadedFilename); } catch {}
    }
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={handleCancel} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit project">
    <h3 class="modal-title">Edit Project</h3>

    <!-- Name -->
    <label class="field-label">
      Name
      <input class="field-input" type="text" bind:value={name} />
    </label>

    <!-- Icon -->
    <div class="field-label">Icon</div>
    <div class="icon-area">
      <button class="icon-preview" onclick={handlePickImage} title="Click to change icon">
        {#if iconPreview}
          <img src={iconPreview} alt="Project icon" class="icon-img" />
        {:else}
          <span class="icon-letter" style="background: {color};">{(name.charAt(0) || '?').toUpperCase()}</span>
        {/if}
      </button>
      {#if iconFilename}
        <button class="remove-icon-btn" onclick={handleRemoveIcon}>Remove icon</button>
      {/if}
    </div>
    <div class="icon-hint">Recommended: 128×128px</div>
    {#if sizeWarning}
      <div class="size-warning">Image was over 1 MB but has been resized.</div>
    {/if}

    <!-- Color (hidden when custom icon is set) -->
    {#if !iconFilename}
      <div class="field-label">Color</div>
      <div class="color-swatches">
        {#each COLORS as c}
          <button
            class="swatch"
            class:selected={color === c}
            style="background: {c};"
            onclick={() => { color = c; }}
            aria-label="Color {c}"
          >
            {(name.charAt(0) || '?').toUpperCase()}
          </button>
        {/each}
      </div>
    {/if}

    <!-- MCP Servers -->
    {#if mcpLoading}
      <div class="field-label" style="margin-top: 16px;">MCP Servers</div>
      <div class="mcp-loading">Discovering servers...</div>
    {:else if mcpServers.length > 0}
      <div class="field-label" style="margin-top: 16px;">MCP Servers</div>
      <div class="mcp-list">
        {#each mcpServers as server}
          <label class="mcp-row">
            <input
              type="checkbox"
              checked={mcpToggles[server.name] ?? true}
              disabled={server.isOwn}
              onchange={(e) => { mcpToggles[server.name] = e.target.checked; mcpToggles = mcpToggles; }}
            />
            <span class="mcp-name">{server.name}</span>
            <span class="mcp-source">{server.source}</span>
          </label>
        {/each}
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-actions">
      <button class="btn-cancel" onclick={handleCancel}>Cancel</button>
      <button class="btn-save" onclick={handleSave} disabled={!name.trim() || saving}>{saving ? 'Saving...' : 'Save'}</button>
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

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 400px;
    max-width: 90vw;
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

  .field-input {
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

  .field-input:focus {
    border-color: var(--accent);
  }

  .icon-area {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-preview {
    width: 64px;
    height: 64px;
    border-radius: 10px;
    border: 2px dashed var(--border);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0;
  }

  .icon-preview:hover {
    border-color: var(--accent);
  }

  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }

  .icon-letter {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #fff;
    font-size: 18px;
    font-weight: 700;
  }

  .remove-icon-btn {
    background: none;
    border: none;
    color: var(--danger);
    font-size: 12px;
    cursor: pointer;
    padding: 4px 0;
    font-family: var(--font-family);
  }

  .remove-icon-btn:hover {
    text-decoration: underline;
  }

  .icon-hint {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }

  .size-warning {
    font-size: 11px;
    color: var(--warning, #eab308);
    margin-top: 4px;
  }

  .color-swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .swatch {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    font-family: var(--font-family);
    padding: 0;
    transition: transform 0.1s;
  }

  .swatch:hover {
    transform: scale(1.1);
  }

  .swatch.selected {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--accent);
  }

  .swatch-icon {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .btn-cancel, .btn-save {
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

  .btn-cancel:hover {
    background: var(--bg-hover);
  }

  .btn-save {
    background: var(--accent);
    color: #fff;
  }

  .btn-save:hover {
    filter: brightness(1.1);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mcp-loading {
    font-size: 12px;
    color: var(--muted);
    padding: 8px 0;
  }

  .mcp-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px;
  }

  .mcp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
  }

  .mcp-row:hover {
    background: var(--bg-hover);
  }

  .mcp-row input[type="checkbox"] {
    margin: 0;
    accent-color: var(--accent);
  }

  .mcp-name {
    flex: 1;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  .mcp-source {
    font-size: 11px;
    color: var(--muted);
    padding: 1px 5px;
    background: var(--bg);
    border-radius: 3px;
  }
</style>
