/**
 * device-preview.svelte.js -- Svelte 5 reactive store for device preview management.
 *
 * Manages multiple device preview WebView2 instances for responsive design testing.
 * Each device preview renders the current URL at a specific viewport size and DPR.
 */
import { getPresetById } from '../device-presets.js';
import { lensCreateDeviceWebview, lensCloseDeviceWebview, lensCloseAllDeviceWebviews } from '../api.js';
import { lensStore } from './lens.svelte.js';

const MAX_DEVICES = 3;

function createDevicePreviewStore() {
  let activeDevices = $state([]);
  let isOpen = $state(false);
  let orientation = $state('portrait');
  let syncEnabled = $state(true);
  let previewUrl = $state('');

  return {
    get activeDevices() { return activeDevices; },
    get isOpen() { return isOpen; },
    get orientation() { return orientation; },
    get syncEnabled() { return syncEnabled; },
    get previewUrl() { return previewUrl; },
    get canAddDevice() { return activeDevices.length < MAX_DEVICES; },
    get deviceCount() { return activeDevices.length; },

    /**
     * Open the device preview panel.
     */
    open() {
      isOpen = true;
    },

    /**
     * Close the device preview panel and remove all devices.
     */
    close() {
      isOpen = false;
      this.removeAllDevices();
    },

    /**
     * Toggle the device preview panel open/closed.
     */
    toggle() {
      if (isOpen) {
        this.close();
      } else {
        this.open();
      }
    },

    /**
     * Add a device preview. Validates limit and duplicates, creates a WebView2.
     * @param {string} presetId - Device preset ID from device-presets.js
     * @param {{ x: number, y: number, width: number, height: number }|null} bounds - WebView2 position
     * @returns {Promise<boolean>} Whether the device was added successfully
     */
    async addDevice(presetId) {
      if (activeDevices.length >= MAX_DEVICES) return false;

      // Reject duplicates
      if (activeDevices.some(d => d.presetId === presetId)) return false;

      const preset = getPresetById(presetId);
      if (!preset) return false;

      // Resolve URL: store URL > browser URL > fallback
      const url = previewUrl || lensStore.url || 'about:blank';

      const device = { presetId, webviewLabel: null };
      activeDevices.push(device);

      try {
        // Create with tiny initial size — will be repositioned by DevicePreview component
        // once the DOM placeholder is rendered and getBoundingClientRect() is available
        const result = await lensCreateDeviceWebview({
          presetId,
          url,
          width: 1,
          height: 1,
          x: -10,
          y: -10,
        });
        const d = activeDevices.find(d => d.presetId === presetId);
        if (d && result) {
          d.webviewLabel = result?.data?.label || result?.label || `device-${presetId}`;
        }
        // Force reactive update so DevicePreview's $effect re-runs and repositions
        activeDevices = [...activeDevices];
        return true;
      } catch (err) {
        console.error('[device-preview] Failed to create device webview:', err);
        const idx = activeDevices.findIndex(d => d.presetId === presetId);
        if (idx !== -1) activeDevices.splice(idx, 1);
        return false;
      }
    },

    /**
     * Remove a single device preview.
     * @param {string} presetId - Device preset ID to remove
     */
    async removeDevice(presetId) {
      const idx = activeDevices.findIndex(d => d.presetId === presetId);
      if (idx === -1) return;

      const device = activeDevices[idx];
      try {
        if (device.webviewLabel) {
          await lensCloseDeviceWebview(device.webviewLabel);
        }
      } catch (err) {
        console.warn('[device-preview] Failed to close device webview:', err);
      }

      activeDevices.splice(idx, 1);
    },

    /**
     * Remove all device previews.
     */
    async removeAllDevices() {
      try {
        await lensCloseAllDeviceWebviews();
      } catch (err) {
        console.warn('[device-preview] Failed to close all device webviews:', err);
      }
      activeDevices.length = 0;
    },

    /**
     * Toggle between portrait and landscape orientation.
     */
    toggleOrientation() {
      orientation = orientation === 'portrait' ? 'landscape' : 'portrait';
    },

    /**
     * Set the URL to preview across all devices.
     * @param {string} url
     */
    setPreviewUrl(url) {
      previewUrl = url;
    },

    /**
     * Toggle sync mode (whether all devices navigate together).
     */
    toggleSync() {
      syncEnabled = !syncEnabled;
    },
  };
}

export const devicePreviewStore = createDevicePreviewStore();
