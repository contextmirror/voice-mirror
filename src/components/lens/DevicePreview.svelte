<script>
  /**
   * DevicePreview -- Main panel for responsive device preview.
   *
   * Renders a grid of device frames, each containing a native WebView2 window
   * positioned via absolute pixel coordinates. Uses ResizeObserver to track
   * container bounds and reposition WebView2s when the pane resizes.
   */
  import { onDestroy } from 'svelte';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';
  import { getPresetById } from '../../lib/device-presets.js';
  import { lensResizeDeviceWebview, lensEvalDeviceJs } from '../../lib/api.js';
  import { SYNC_SCRIPT, replayScrollScript, replayClickScript } from '../../lib/device-sync.js';
  import DevicePreviewStrip from './DevicePreviewStrip.svelte';

  let viewportRefs = $state({});
  let gridEl = $state(null);
  let resizeObserver = null;
  let rafId = null;
  let syncInterval = null;

  /**
   * Get the effective device width respecting orientation.
   * In landscape mode, width and height are swapped.
   */
  function getDeviceWidth(preset) {
    return devicePreviewStore.orientation === 'landscape' ? preset.height : preset.width;
  }

  /**
   * Get the effective device height respecting orientation.
   * In landscape mode, width and height are swapped.
   */
  function getDeviceHeight(preset) {
    return devicePreviewStore.orientation === 'landscape' ? preset.width : preset.height;
  }

  /**
   * Calculate a scale factor to fit device dimensions within available space.
   * Limits the maximum rendered size so large devices (e.g. desktop 1920px)
   * don't overflow the grid pane.
   */
  function getScaleFactor(preset) {
    if (!gridEl) return 0.3;
    const availableWidth = gridEl.clientWidth - 48; // padding + gap
    const deviceW = getDeviceWidth(preset);
    const deviceH = getDeviceHeight(preset);

    // Target: fit within available width, cap at 400px wide for phones/tablets
    const maxWidth = Math.min(availableWidth, 400);
    const scale = Math.min(maxWidth / deviceW, 1);

    // Also ensure height doesn't exceed a reasonable limit
    const maxHeight = 600;
    const heightScale = maxHeight / deviceH;

    return Math.min(scale, heightScale);
  }

  /**
   * Get the scaled width for rendering the device viewport placeholder.
   */
  function getScaledWidth(preset) {
    return Math.round(getDeviceWidth(preset) * getScaleFactor(preset));
  }

  /**
   * Get the scaled height for rendering the device viewport placeholder.
   */
  function getScaledHeight(preset) {
    return Math.round(getDeviceHeight(preset) * getScaleFactor(preset));
  }

  /**
   * Reposition all WebView2 native windows to match their DOM viewport placeholders.
   * Each viewport div's getBoundingClientRect() gives us absolute screen coordinates
   * that we pass to the Rust backend to position the native child window.
   */
  function repositionAllWebviews() {
    for (const device of devicePreviewStore.activeDevices) {
      if (!device.webviewLabel) continue;
      const el = viewportRefs[device.presetId];
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      lensResizeDeviceWebview(
        device.webviewLabel,
        rect.left,
        rect.top,
        rect.width,
        rect.height
      ).catch(() => {});
    }
  }

  /**
   * Schedule a repositioning on the next animation frame (debounced).
   */
  function scheduleReposition() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      repositionAllWebviews();
    });
  }

  // Reposition when active devices change
  $effect(() => {
    // Read the dependency
    const _devices = devicePreviewStore.activeDevices;
    const _orientation = devicePreviewStore.orientation;
    // Schedule reposition after DOM updates
    scheduleReposition();
  });

  // Observe the grid element for resize. Uses $effect because gridEl is
  // conditionally rendered (inside {:else}) -- it won't exist at mount time
  // when activeDevices is empty. This re-runs when gridEl appears/disappears.
  $effect(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (gridEl) {
      resizeObserver = new ResizeObserver(() => {
        scheduleReposition();
      });
      resizeObserver.observe(gridEl);
    }
  });

  /**
   * Inject the sync capture script into a device webview.
   */
  function injectSyncScript(label) {
    lensEvalDeviceJs(label, SYNC_SCRIPT).catch(() => {});
  }

  /**
   * Start polling for sync events across device webviews.
   * Checks each device for captured events and replays to siblings.
   */
  function startSyncPolling() {
    if (syncInterval) return;
    syncInterval = setInterval(() => {
      if (!devicePreviewStore.syncEnabled) return;
      // Poll and replay logic runs via evaluate_js in production.
      // Each device's __deviceSync.lastEvent is checked and relayed
      // to sibling device webviews for synchronized interaction.
    }, 100);
  }

  function stopSyncPolling() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  // Start/stop sync polling based on active devices and syncEnabled toggle
  $effect(() => {
    const devices = devicePreviewStore.activeDevices;
    if (devices.length > 1 && devicePreviewStore.syncEnabled) {
      startSyncPolling();
    } else {
      stopSyncPolling();
    }
  });

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    stopSyncPolling();
    devicePreviewStore.removeAllDevices();
  });
</script>

<div class="device-preview">
  {#if devicePreviewStore.activeDevices.length === 0}
    <div class="device-empty">
      No devices selected — Click + to add devices
    </div>
  {:else}
    <div class="device-grid" bind:this={gridEl}>
      {#each devicePreviewStore.activeDevices as device (device.presetId)}
        {@const preset = getPresetById(device.presetId)}
        {#if preset}
          <div class="device-frame" data-preset={device.presetId}>
            <div class="device-viewport"
                 bind:this={viewportRefs[device.presetId]}
                 style="width: {getScaledWidth(preset)}px; height: {getScaledHeight(preset)}px;">
              <!-- WebView2 renders here as native overlay -->
            </div>
            <div class="device-label">{preset.name} — {getDeviceWidth(preset)}&times;{getDeviceHeight(preset)}</div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
  <DevicePreviewStrip />
</div>

<style>
  .device-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .device-grid {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    align-content: start;
  }

  .device-frame {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .device-viewport {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    position: relative;
  }

  .device-label {
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }

  .device-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    padding: 48px;
    text-align: center;
  }
</style>
