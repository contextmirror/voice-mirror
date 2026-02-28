<script>
  /**
   * DevicePickerMenu -- Dropdown menu for selecting device presets.
   *
   * Grouped by manufacturer with collapsible sections, search filter,
   * popular quick-pick section, and manufacturer icons.
   */
  import { MANUFACTURERS, getPresetsByManufacturer, getPopularPresets } from '../../lib/device-presets.js';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';

  let { onClose = () => {}, anchorRect = null } = $props();

  let search = $state('');
  let collapsed = $state({});

  const popularPresets = getPopularPresets();

  function isActive(presetId) {
    return devicePreviewStore.activeDevices.some(d => d.presetId === presetId);
  }

  function handleToggle(presetId, e) {
    if (e.target.checked) {
      devicePreviewStore.addDevice(presetId);
    } else {
      devicePreviewStore.removeDevice(presetId);
    }
  }

  function toggleSection(manufacturerId) {
    collapsed = { ...collapsed, [manufacturerId]: !collapsed[manufacturerId] };
  }

  function filterPresets(presets) {
    if (!search.trim()) return presets;
    const q = search.trim().toLowerCase();
    return presets.filter(p => p.name.toLowerCase().includes(q));
  }

  function getSubGroups(manufacturerId) {
    const all = filterPresets(getPresetsByManufacturer(manufacturerId));
    const phones = all.filter(p => p.type === 'phone');
    const tablets = all.filter(p => p.type === 'tablet');
    return { phones, tablets, hasSubGroups: phones.length > 0 && tablets.length > 0 };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose} onkeydown={() => {}}></div>

<div class="picker-menu" style={anchorRect ? `position: fixed; bottom: ${window.innerHeight - anchorRect.top + 4}px; left: ${anchorRect.left}px;` : ''}>

  <div class="search-row">
    <input
      class="search-input"
      type="text"
      placeholder="Search devices..."
      bind:value={search}
    />
  </div>

  {#if !search.trim()}
    {#if popularPresets.length > 0}
      <div class="section-header popular-header">
        <span class="section-icon">&#9733;</span>
        <span class="section-label">Popular</span>
      </div>
      {#each popularPresets as preset}
        {@const active = isActive(preset.id)}
        <label class="device-item" class:active>
          <input
            type="checkbox"
            checked={active}
            disabled={!devicePreviewStore.canAddDevice && !active}
            onchange={(e) => handleToggle(preset.id, e)}
          />
          <span class="device-name">{preset.name}</span>
          <span class="device-dims">{preset.width}&times;{preset.height}</span>
        </label>
      {/each}
      <div class="section-divider"></div>
    {/if}
  {/if}

  {#each MANUFACTURERS as mfr}
    {@const { phones, tablets, hasSubGroups } = getSubGroups(mfr.id)}
    {@const total = phones.length + tablets.length}
    {#if total > 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="section-header" onclick={() => toggleSection(mfr.id)} onkeydown={() => {}}>
        <span class="chevron">{collapsed[mfr.id] ? '▸' : '▾'}</span>
        <span class="section-icon">{@html mfr.icon}</span>
        <span class="section-label">{mfr.name}</span>
        <span class="section-count">{total}</span>
      </div>

      {#if !collapsed[mfr.id]}
        {#if hasSubGroups}
          <div class="sub-header">Phones</div>
        {/if}
        {#each phones as preset}
          {@const active = isActive(preset.id)}
          <label class="device-item" class:active>
            <input
              type="checkbox"
              checked={active}
              disabled={!devicePreviewStore.canAddDevice && !active}
              onchange={(e) => handleToggle(preset.id, e)}
            />
            <span class="device-name">{preset.name}</span>
            <span class="device-dims">{preset.width}&times;{preset.height}</span>
          </label>
        {/each}
        {#if hasSubGroups}
          <div class="sub-header">Tablets</div>
        {/if}
        {#each tablets as preset}
          {@const active = isActive(preset.id)}
          <label class="device-item" class:active>
            <input
              type="checkbox"
              checked={active}
              disabled={!devicePreviewStore.canAddDevice && !active}
              onchange={(e) => handleToggle(preset.id, e)}
            />
            <span class="device-name">{preset.name}</span>
            <span class="device-dims">{preset.width}&times;{preset.height}</span>
          </label>
        {/each}
      {/if}
    {/if}
  {/each}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10001;
    -webkit-app-region: no-drag;
  }

  .picker-menu {
    width: 300px;
    max-height: 480px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 10002;
    -webkit-app-region: no-drag;
  }

  .search-row {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .search-input {
    width: 100%;
    padding: 5px 8px;
    background: color-mix(in srgb, var(--bg) 50%, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--muted);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .section-header:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .popular-header {
    cursor: default;
    color: var(--accent);
  }

  .popular-header:hover {
    background: none;
  }

  .chevron {
    font-size: 10px;
    width: 10px;
    text-align: center;
    color: var(--muted);
    flex-shrink: 0;
  }

  .section-icon {
    display: flex;
    align-items: center;
    color: var(--muted);
    flex-shrink: 0;
  }

  .section-label {
    flex: 1;
  }

  .section-count {
    font-size: 10px;
    color: var(--muted);
    font-weight: 400;
  }

  .section-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .sub-header {
    padding: 4px 12px 2px 36px;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 36px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    -webkit-app-region: no-drag;
  }

  .device-item:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .device-item.active {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .device-item input[type="checkbox"] {
    accent-color: var(--accent);
    margin: 0;
    flex-shrink: 0;
  }

  .device-item input[type="checkbox"]:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .device-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .device-dims {
    color: var(--muted);
    font-size: 11px;
    flex-shrink: 0;
    font-family: var(--font-mono);
  }
</style>
