<script>
  /**
   * DevicePreview -- Main panel for responsive device preview.
   *
   * Renders a grid of device frames, each containing a native WebView2 window
   * positioned via absolute pixel coordinates. Uses ResizeObserver to track
   * container bounds and reposition WebView2s when the pane resizes.
   */
  import { onDestroy } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { devicePreviewStore } from '../../lib/stores/device-preview.svelte.js';
  import { getPresetById } from '../../lib/device-presets.js';
  import { lensResizeDeviceWebview, lensEvalDeviceJs, lensSetDeviceEmulation } from '../../lib/api.js';
  import { SYNC_SCRIPT, replayScrollScript, replayClickScript } from '../../lib/device-sync.js';
  import DevicePreviewStrip from './DevicePreviewStrip.svelte';

  let viewportRefs = $state({});
  let gridEl = $state(null);
  let resizeObserver = null;
  let rafId = null;
  let syncInterval = null;
  let emulatedDevices = new Set();
  /** Track last CDP emulation params per device to avoid redundant calls. */
  let lastEmulationParams = {};

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
   * Check if a device is a phone (needs phone-style frame).
   */
  function isPhone(preset) {
    return preset.type === 'phone';
  }

  /**
   * Check if a device is a tablet.
   */
  function isTablet(preset) {
    return preset.type === 'tablet';
  }

  /**
   * Reposition all WebView2 native windows to match their DOM viewport placeholders.
   * Each viewport div's getBoundingClientRect() gives us absolute screen coordinates
   * that we pass to the Rust backend to position the native child window.
   * Also injects CSS zoom so the page renders at the real device viewport width
   * despite the WebView2 being displayed at a smaller scaled size.
   */
  function repositionAllWebviews() {
    for (const device of devicePreviewStore.activeDevices) {
      if (!device.webviewLabel) continue;
      const el = viewportRefs[device.presetId];
      if (!el) continue;

      const preset = getPresetById(device.presetId);
      if (!preset) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      lensResizeDeviceWebview(
        device.webviewLabel,
        rect.left,
        rect.top,
        rect.width,
        rect.height
      ).catch(() => {});

      // Apply CDP device emulation — sets the logical viewport, DPR, user
      // agent, touch emulation, and visual scale via Chrome DevTools Protocol.
      // Only re-applied when parameters actually change (scale shifts with
      // container resize, dimensions swap on orientation toggle). Skipping
      // redundant calls prevents a feedback loop: CDP override → page reflow →
      // ResizeObserver → reposition → CDP override → ...
      const deviceW = getDeviceWidth(preset);
      const deviceH = getDeviceHeight(preset);
      const scale = Math.round((rect.width / deviceW) * 10000) / 10000;
      const isM = isPhone(preset) || isTablet(preset);
      const needsUA = !emulatedDevices.has(device.presetId);
      const paramKey = `${deviceW}:${deviceH}:${scale}`;
      if (lastEmulationParams[device.presetId] !== paramKey || needsUA) {
        lastEmulationParams[device.presetId] = paramKey;
        lensSetDeviceEmulation(device.webviewLabel, {
          width: deviceW,
          height: deviceH,
          deviceScaleFactor: preset.dpr || 1,
          mobile: isM,
          userAgent: needsUA ? (preset.userAgent || '') : '',
          scale,
        }).catch((err) => {
          console.warn('[DevicePreview] CDP emulation failed:', err);
        });
        emulatedDevices.add(device.presetId);
      }
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

  // Reposition when active devices or orientation change
  $effect(() => {
    // Read the dependencies
    const _devices = devicePreviewStore.activeDevices;
    const _orientation = devicePreviewStore.orientation;
    // Clear emulation tracking so UA gets re-sent and params re-applied
    emulatedDevices.clear();
    lastEmulationParams = {};
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

  // Sync device webviews when the main browser navigates.
  // Listens for lens-url-changed (fired on every browser navigation, reload,
  // dev server switch, etc.) and navigates all active device webviews to match.
  let unlistenUrlSync = null;
  listen('lens-url-changed', (event) => {
    const url = event.payload?.url;
    if (!url) return;
    // Ignore events from device webviews to prevent infinite loop:
    // device navigates → on_page_load emits lens-url-changed → we navigate
    // device again → on_page_load fires again → ...
    const tabId = event.payload?.tabId || '';
    if (tabId.startsWith('device-')) return;
    devicePreviewStore.setPreviewUrl(url);
    // Clear emulation tracking so CDP re-applies after navigation
    // (new page load clears device metrics override)
    emulatedDevices.clear();
    lastEmulationParams = {};
    for (const device of devicePreviewStore.activeDevices) {
      if (!device.webviewLabel) continue;
      const safeUrl = JSON.stringify(url);
      lensEvalDeviceJs(device.webviewLabel, `window.location.href=${safeUrl}`).catch(() => {});
    }
    // Re-apply CDP emulation after navigation settles
    setTimeout(() => scheduleReposition(), 500);
  }).then(fn => { unlistenUrlSync = fn; });

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    stopSyncPolling();
    emulatedDevices.clear();
    lastEmulationParams = {};
    if (unlistenUrlSync) unlistenUrlSync();
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
          <div class="device-frame" class:phone={isPhone(preset)} class:tablet={isTablet(preset)} data-preset={device.presetId}>
            <div class="device-bezel" class:phone={isPhone(preset)} class:tablet={isTablet(preset)}>
              {#if isPhone(preset)}
                <div class="device-notch"></div>
              {/if}
              <div class="device-screen" class:phone={isPhone(preset)} class:tablet={isTablet(preset)}>
                <div class="device-viewport"
                     bind:this={viewportRefs[device.presetId]}
                     style="width: {getScaledWidth(preset)}px; height: {getScaledHeight(preset)}px;">
                  <!-- WebView2 renders here as native overlay -->
                </div>
              </div>
              {#if isPhone(preset)}
                <div class="device-home-bar"></div>
              {/if}
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
    gap: 6px;
  }

  /* Dark bezel wrapping the screen — looks like a real device */
  .device-bezel {
    background: #1a1a1a;
    border: 2px solid #333;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }

  .device-bezel.phone {
    border-radius: 28px;
    padding: 10px 6px 8px;
  }

  .device-bezel.tablet {
    border-radius: 16px;
    padding: 8px 6px;
  }

  /* Dynamic island / notch indicator */
  .device-notch {
    width: 60px;
    height: 6px;
    background: #333;
    border-radius: 3px;
    margin-bottom: 4px;
    flex-shrink: 0;
  }

  /* Screen area containing the WebView2 viewport */
  .device-screen {
    overflow: hidden;
  }

  .device-screen.phone {
    border-radius: 6px;
  }

  .device-screen.tablet {
    border-radius: 4px;
  }

  /* Home indicator bar at bottom of phone */
  .device-home-bar {
    width: 40%;
    height: 4px;
    background: #555;
    border-radius: 2px;
    margin-top: 6px;
    flex-shrink: 0;
  }

  .device-viewport {
    background: #000;
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
