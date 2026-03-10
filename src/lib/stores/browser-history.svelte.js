/**
 * browser-history.svelte.js -- Svelte 5 reactive store for browser history.
 *
 * Persists navigation history to %APPDATA%/voice-mirror/browser-history.json
 * via Tauri commands. Entries are newest-first (prepend order).
 *
 * Usage:
 *   browserHistoryStore.init()    — load from disk, start listening for events
 *   browserHistoryStore.destroy() — unlisten
 */

import { listen } from '@tauri-apps/api/event';
import { lensAddHistoryEntry, lensGetHistory, lensClearHistory, lensDeleteHistoryEntry } from '../api.js';
import { browserTabsStore } from './browser-tabs.svelte.js';

/**
 * @typedef {Object} HistoryEntry
 * @property {string} url
 * @property {string} title
 * @property {number} timestamp - epoch millis
 */

function createBrowserHistoryStore() {
  /** @type {HistoryEntry[]} */
  let entries = $state([]);
  let loading = $state(false);

  /** @type {(() => void)|null} */
  let unlistenFn = null;

  /** @type {Map<string, number>} url -> pending setTimeout id */
  const pendingTitleTimers = new Map();

  async function loadFromBackend() {
    try {
      const result = await lensGetHistory();
      if (result?.data?.entries) {
        entries = result.data.entries;
      }
    } catch (err) {
      console.warn('[browser-history] Failed to load history:', err);
    }
  }

  /**
   * Initialize the store: load from disk and start listening for lens-history-entry events.
   */
  async function init() {
    await loadFromBackend();

    // Unlisten any previous listener
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }

    const unlisten = await listen('lens-history-entry', (event) => {
      const url = event.payload?.url;
      if (!url || url === 'about:blank') return;

      // Cancel any existing pending timer for this URL
      if (pendingTitleTimers.has(url)) {
        clearTimeout(pendingTitleTimers.get(url));
      }

      // Wait 500ms for the title to be populated via lens-title-changed
      const timerId = setTimeout(async () => {
        pendingTitleTimers.delete(url);
        const title = browserTabsStore.activeTab?.title || '';
        try {
          await lensAddHistoryEntry(url, title);
          await loadFromBackend();
        } catch (err) {
          console.warn('[browser-history] Failed to add entry:', err);
        }
      }, 500);

      pendingTitleTimers.set(url, timerId);
    });

    unlistenFn = unlisten;
  }

  /**
   * Stop listening for events and cancel pending timers.
   */
  function destroy() {
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
    for (const id of pendingTitleTimers.values()) {
      clearTimeout(id);
    }
    pendingTitleTimers.clear();
  }

  /**
   * Clear all history entries.
   */
  async function clearAll() {
    loading = true;
    try {
      await lensClearHistory();
      entries = [];
    } catch (err) {
      console.warn('[browser-history] Failed to clear history:', err);
    } finally {
      loading = false;
    }
  }

  /**
   * Delete a single entry by timestamp.
   * @param {number} timestamp
   */
  async function deleteEntry(timestamp) {
    try {
      await lensDeleteHistoryEntry(timestamp);
      entries = entries.filter(e => e.timestamp !== timestamp);
    } catch (err) {
      console.warn('[browser-history] Failed to delete entry:', err);
    }
  }

  /**
   * Return entries grouped into Today / Yesterday / Older buckets.
   * @returns {{ today: HistoryEntry[], yesterday: HistoryEntry[], older: HistoryEntry[] }}
   */
  function getGrouped() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    const today = [];
    const yesterday = [];
    const older = [];

    for (const entry of entries) {
      if (entry.timestamp >= todayStart) {
        today.push(entry);
      } else if (entry.timestamp >= yesterdayStart) {
        yesterday.push(entry);
      } else {
        older.push(entry);
      }
    }

    return { today, yesterday, older };
  }

  /**
   * Filter entries by a query string (matches url or title, case-insensitive).
   * @param {string} query
   * @returns {HistoryEntry[]}
   */
  function filter(query) {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter(e =>
      e.url?.toLowerCase().includes(q) || e.title?.toLowerCase().includes(q)
    );
  }

  return {
    get entries() { return entries; },
    get loading() { return loading; },
    init,
    destroy,
    clearAll,
    deleteEntry,
    getGrouped,
    filter,
  };
}

export const browserHistoryStore = createBrowserHistoryStore();
export default browserHistoryStore;
