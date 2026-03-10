/**
 * downloads.svelte.js -- Svelte 5 reactive store for browser download tracking.
 *
 * Listens for lens-download-started and lens-download-progress Tauri events,
 * maintains a list of download entries, and shows toast notifications on
 * completion.
 *
 * Usage:
 *   downloadsStore.init()    — load existing downloads, start listening
 *   downloadsStore.destroy() — unlisten
 */

import { listen } from '@tauri-apps/api/event';
import { lensGetDownloads, lensClearDownloads, lensOpenDownload, lensOpenDownloadFolder } from '../api.js';
import { toastStore } from './toast.svelte.js';

/**
 * @typedef {Object} DownloadEntry
 * @property {string} id - Unique download ID
 * @property {string} filename - File name (basename)
 * @property {string} path - Full file path on disk
 * @property {string} url - Source URL
 * @property {number} received_bytes - Bytes downloaded so far
 * @property {number} total_bytes - Total bytes (0 if unknown)
 * @property {string} state - 'in_progress' | 'completed' | 'failed' | 'interrupted'
 * @property {number} started_at - epoch millis
 */

function createDownloadsStore() {
  /** @type {DownloadEntry[]} */
  let downloads = $state([]);

  /** @type {(() => void)|null} */
  let unlistenStarted = null;
  /** @type {(() => void)|null} */
  let unlistenProgress = null;

  /**
   * Load existing downloads from the backend.
   */
  async function loadFromBackend() {
    try {
      const result = await lensGetDownloads();
      if (result?.data?.downloads) {
        downloads = result.data.downloads;
      }
    } catch (err) {
      console.warn('[downloads] Failed to load downloads:', err);
    }
  }

  /**
   * Initialize the store: load existing downloads and start listening for events.
   */
  async function init() {
    await loadFromBackend();

    // Clean up previous listeners
    if (unlistenStarted) { unlistenStarted(); unlistenStarted = null; }
    if (unlistenProgress) { unlistenProgress(); unlistenProgress = null; }

    // Listen for new downloads starting
    const startedFn = await listen('lens-download-started', (event) => {
      /** @type {DownloadEntry} */
      const entry = event.payload;
      if (!entry?.id) return;
      // Prepend so newest is first
      downloads = [entry, ...downloads.filter(d => d.id !== entry.id)];
    });

    // Listen for progress updates
    const progressFn = await listen('lens-download-progress', (event) => {
      const { id, received, total, state, path } = event.payload ?? {};
      if (!id) return;

      downloads = downloads.map(d => {
        if (d.id !== id) return d;
        const updated = {
          ...d,
          received_bytes: received ?? d.received_bytes,
          total_bytes: total ?? d.total_bytes,
          state: state ?? d.state,
          path: path ?? d.path,
        };
        return updated;
      });

      // Show toast when a download completes
      if (state === 'completed') {
        const entry = downloads.find(d => d.id === id);
        if (entry) {
          const entryPath = path ?? entry.path;
          toastStore.addToast({
            message: `Downloaded ${entry.filename}`,
            severity: 'success',
            duration: 5000,
            action: {
              label: 'Open',
              callback: () => lensOpenDownload(entryPath),
            },
          });
        }
      }
    });

    unlistenStarted = startedFn;
    unlistenProgress = progressFn;
  }

  /**
   * Stop listening for events.
   */
  function destroy() {
    if (unlistenStarted) { unlistenStarted(); unlistenStarted = null; }
    if (unlistenProgress) { unlistenProgress(); unlistenProgress = null; }
  }

  /**
   * Clear completed/failed/interrupted downloads from backend and local state.
   */
  async function clearCompleted() {
    try {
      await lensClearDownloads();
      downloads = downloads.filter(d => d.state === 'in_progress');
    } catch (err) {
      console.warn('[downloads] Failed to clear downloads:', err);
    }
  }

  /**
   * Open a downloaded file with the default system application.
   * @param {string} path
   */
  async function openFile(path) {
    try {
      await lensOpenDownload(path);
    } catch (err) {
      console.warn('[downloads] Failed to open file:', err);
    }
  }

  /**
   * Open the folder containing a downloaded file in Explorer.
   * @param {string} path
   */
  async function openFolder(path) {
    try {
      await lensOpenDownloadFolder(path);
    } catch (err) {
      console.warn('[downloads] Failed to open folder:', err);
    }
  }

  return {
    get downloads() { return downloads; },
    get activeCount() { return downloads.filter(d => d.state === 'in_progress').length; },
    init,
    destroy,
    clearCompleted,
    openFile,
    openFolder,
  };
}

export const downloadsStore = createDownloadsStore();
export default downloadsStore;
