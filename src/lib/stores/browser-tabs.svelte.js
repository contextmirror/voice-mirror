/**
 * browser-tabs.svelte.js -- Svelte 5 reactive store for browser sub-tab management.
 *
 * Manages multiple WebView2 browser tabs inside the Lens preview panel.
 * Each tab has its own native WebView2 instance on the backend.
 */
import { lensCreateTab, lensCloseTab, lensSwitchTab } from '../api.js';

const MAX_TABS = 8;
let counter = 0;

function createBrowserTabsStore() {
  let tabs = $state([]);
  let activeTabId = $state(null);

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || null; },
    get canAddTab() { return tabs.length < MAX_TABS; },

    /**
     * Open a new browser tab. Creates a WebView2 on the backend.
     * @param {string} url - Initial URL
     * @param {{ x: number, y: number, width: number, height: number }|null} bounds - WebView2 position
     * @returns {Promise<string|null>} Tab ID or null on failure
     */
    async openTab(url = 'about:blank', bounds = null) {
      if (tabs.length >= MAX_TABS) return null;

      const id = `btab-${Date.now()}-${++counter}`;
      const tab = {
        id,
        url,
        inputUrl: url,
        title: 'New Tab',
        webviewLabel: null,
        loading: false,
      };

      tabs.push(tab);
      activeTabId = id;

      try {
        const x = bounds?.x ?? 0;
        const y = bounds?.y ?? 0;
        const width = bounds?.width ?? 800;
        const height = bounds?.height ?? 600;
        const result = await lensCreateTab(id, url, x, y, width, height);
        // Store the webview label returned from Rust (extract from IpcResponse)
        const t = tabs.find(t => t.id === id);
        if (t && result) {
          t.webviewLabel = result?.data?.label || result?.label || null;
        }
        return id;
      } catch (err) {
        console.error('[browser-tabs] Failed to create tab:', err);
        // Remove the tab on failure
        const idx = tabs.findIndex(t => t.id === id);
        if (idx !== -1) tabs.splice(idx, 1);
        // Restore active to previous or null
        if (activeTabId === id) {
          activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
        }
        return null;
      }
    },

    /**
     * Close a browser tab. Refuses if only 1 tab remains.
     * @param {string} id
     */
    async closeTab(id) {
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      // Determine the neighbor BEFORE removing (deterministic: prefer left, then right)
      let neighborId = null;
      if (activeTabId === id) {
        if (idx > 0) {
          neighborId = tabs[idx - 1].id;
        } else if (idx < tabs.length - 1) {
          neighborId = tabs[idx + 1].id;
        }
      }

      try {
        await lensCloseTab(id);
      } catch (err) {
        console.warn('[browser-tabs] Failed to close tab on backend:', err);
      }

      tabs.splice(idx, 1);

      // Switch to the neighbor on both frontend and backend
      if (neighborId) {
        activeTabId = neighborId;
        try {
          await lensSwitchTab(neighborId);
        } catch (err) {
          console.warn('[browser-tabs] Failed to switch after close:', err);
        }
      }
    },

    /**
     * Switch to a different browser tab.
     * @param {string} id
     */
    async switchTab(id) {
      if (id === activeTabId) return;
      if (!tabs.find(t => t.id === id)) return;

      try {
        await lensSwitchTab(id);
      } catch (err) {
        console.warn('[browser-tabs] Failed to switch tab on backend:', err);
        return;
      }

      activeTabId = id;
    },

    /**
     * Set active tab directly (from MCP-initiated tab switch, no backend call needed).
     * @param {string} id
     */
    setActiveTabDirect(id) {
      if (tabs.find(t => t.id === id)) {
        activeTabId = id;
      }
    },

    /**
     * Update a tab's URL (from navigation events).
     * @param {string} tabId
     * @param {string} url
     */
    setTabUrl(tabId, url) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = url;
        tab.inputUrl = url;
      }
    },

    /**
     * Update a tab's title.
     * @param {string} tabId
     * @param {string} title
     */
    setTabTitle(tabId, title) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.title = title;
      }
    },

    /**
     * Update a tab's loading state.
     * @param {string} tabId
     * @param {boolean} loading
     */
    setTabLoading(tabId, loading) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.loading = loading;
      }
    },

    /**
     * Update only the input URL (for URL bar typing, before navigation).
     * @param {string} tabId
     * @param {string} url
     */
    setTabInputUrl(tabId, url) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.inputUrl = url;
      }
    },

    /**
     * Clear all tabs. Called on component unmount.
     */
    clearAll() {
      tabs.length = 0;
      activeTabId = null;
    },

    /**
     * Get the active tab's webview label.
     * @returns {string|null}
     */
    getActiveWebviewLabel() {
      const tab = tabs.find(t => t.id === activeTabId);
      return tab?.webviewLabel || null;
    },
  };
}

export const browserTabsStore = createBrowserTabsStore();
