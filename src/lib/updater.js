/**
 * updater.js -- Auto-update checker using Tauri's built-in updater plugin.
 *
 * Checks for updates on app startup. If an update is available, logs it
 * and optionally downloads + installs it. Designed to be called once from
 * App.svelte's initialization.
 */

import { check } from '@tauri-apps/plugin-updater';

/**
 * Check for available updates and optionally install them.
 *
 * @param {Object} [options]
 * @param {boolean} [options.autoInstall=false] - Automatically download and install if update found.
 * @param {function} [options.onUpdateAvailable] - Callback when update is found: (version, body) => void
 * @param {function} [options.onUpToDate] - Callback when already on latest version.
 * @param {function} [options.onError] - Callback on error: (error) => void
 * @returns {Promise<{available: boolean, version?: string, body?: string}>}
 */
export async function checkForUpdates(options = {}) {
  const { autoInstall = false, onUpdateAvailable, onUpToDate, onError } = options;

  try {
    const update = await check();

    if (update) {
      console.log(`[updater] Update available: v${update.version}`);
      if (update.body) {
        console.log(`[updater] Release notes: ${update.body}`);
      }

      if (onUpdateAvailable) {
        onUpdateAvailable(update.version, update.body);
      }

      if (autoInstall) {
        console.log('[updater] Downloading and installing update...');
        await update.downloadAndInstall();
        console.log('[updater] Update installed. Restart required.');
      }

      return { available: true, version: update.version, body: update.body };
    } else {
      console.log('[updater] App is up to date.');
      if (onUpToDate) {
        onUpToDate();
      }
      return { available: false };
    }
  } catch (err) {
    console.warn('[updater] Failed to check for updates:', err);
    if (onError) {
      onError(err);
    }
    return { available: false };
  }
}
