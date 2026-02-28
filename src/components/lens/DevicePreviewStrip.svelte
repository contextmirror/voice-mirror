<script>
  /**
   * DevicePreviewStrip -- Thin control bar at the bottom of the device preview pane.
   *
   * Shows active device chips with remove buttons, an add button with picker dropdown,
   * orientation toggle, and sync toggle.
   */
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';
  import { getPresetById } from '../../lib/device-presets.js';
  import DevicePickerMenu from './DevicePickerMenu.svelte';

  let pickerVisible = $state(false);
  let addBtnEl = $state(null);
  let pickerAnchor = $state(null);
</script>

<div class="device-strip">
  <div class="strip-left">
    {#each devicePreviewStore.activeDevices as device (device.presetId)}
      <span class="device-chip">
        <span class="chip-name">{getPresetById(device.presetId)?.name ?? device.presetId}</span>
        <button
          class="chip-close"
          title="Remove device"
          onclick={() => devicePreviewStore.removeDevice(device.presetId)}
        >&times;</button>
      </span>
    {/each}

    <div class="add-wrapper">
      <button
        bind:this={addBtnEl}
        class="add-btn"
        title="Add device"
        disabled={!devicePreviewStore.canAddDevice}
        onclick={() => {
          if (!pickerVisible && addBtnEl) {
            pickerAnchor = addBtnEl.getBoundingClientRect();
          }
          pickerVisible = !pickerVisible;
        }}
      >+</button>

      {#if pickerVisible && pickerAnchor}
        <DevicePickerMenu onClose={() => pickerVisible = false} anchorRect={pickerAnchor} />
      {/if}
    </div>
  </div>

  <div class="strip-right">
    <button
      class="action-btn"
      title={devicePreviewStore.orientation === 'portrait' ? 'Switch to landscape' : 'Switch to portrait'}
      onclick={() => devicePreviewStore.toggleOrientation()}
    >&#x21bb;</button>

    <button
      class="action-btn"
      class:active={devicePreviewStore.syncEnabled}
      title={devicePreviewStore.syncEnabled ? 'Sync on' : 'Sync off'}
      onclick={() => devicePreviewStore.toggleSync()}
    >&#x21c6;</button>
  </div>
</div>

<style>
  .device-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    padding: 0 8px;
    position: relative;
    -webkit-app-region: no-drag;
  }

  .strip-left {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    min-width: 0;
  }

  .strip-right {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .device-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 4px;
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
    user-select: none;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .chip-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    border-radius: 2px;
    line-height: 1;
    -webkit-app-region: no-drag;
  }

  .chip-close:hover {
    background: color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--text);
  }

  .add-wrapper {
    position: relative;
  }

  .add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 16px;
    cursor: pointer;
    border-radius: 4px;
    -webkit-app-region: no-drag;
  }

  .add-btn:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .add-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
    border-radius: 4px;
    -webkit-app-region: no-drag;
  }

  .action-btn:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .action-btn.active {
    color: var(--accent);
  }
</style>
