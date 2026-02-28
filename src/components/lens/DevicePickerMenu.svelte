<script>
  /**
   * DevicePickerMenu -- Dropdown menu for selecting device presets.
   *
   * Opens upward from the [+] button in the device preview control strip.
   * Lists all device presets grouped by category with checkboxes for multi-select.
   */
  import { DEVICE_PRESETS, DEVICE_CATEGORIES } from '../../lib/device-presets.js';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';

  let { onClose = () => {}, anchorRect = null } = $props();

  /**
   * Get presets for a given category.
   * @param {string} category
   */
  function presetsForCategory(category) {
    return DEVICE_PRESETS.filter(p => p.category === category);
  }

  /**
   * Check if a preset is currently active.
   * @param {string} presetId
   */
  function isActive(presetId) {
    return devicePreviewStore.activeDevices.some(d => d.presetId === presetId);
  }

  /**
   * Handle checkbox change for a device preset.
   * @param {string} presetId
   * @param {Event} e
   */
  function handleToggle(presetId, e) {
    if (e.target.checked) {
      devicePreviewStore.addDevice(presetId);
    } else {
      devicePreviewStore.removeDevice(presetId);
    }
  }
</script>

<!-- Backdrop: transparent overlay to detect outside clicks -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose} onkeydown={() => {}}></div>

<div class="picker-menu" style={anchorRect ? `position: fixed; bottom: ${window.innerHeight - anchorRect.top + 4}px; left: ${anchorRect.left}px;` : ''}>
  {#each DEVICE_CATEGORIES as category}
    <div class="category-header">{category}</div>
    {#each presetsForCategory(category) as preset}
      {@const active = isActive(preset.id)}
      <label
        class="device-item"
        class:active
      >
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
    width: 280px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 10002;
    -webkit-app-region: no-drag;
  }

  .category-header {
    padding: 6px 12px;
    font-weight: 600;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
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
