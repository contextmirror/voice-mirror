/**
 * terminal-tabs.svelte.js -- Svelte 5 reactive store for terminal tab management.
 *
 * Manages terminal tabs in the bottom panel: AI tab (always present, unclosable)
 * + shell tabs (user-created, closable).
 *
 * The AI tab uses the existing ai-output event system.
 * Shell tabs use the shell-output event system with session IDs.
 */
import { shellSpawn, shellKill } from '../api.js';

function createTerminalTabsStore() {
  // AI tab is always present, cannot be closed
  let tabs = $state([
    { id: 'ai', type: 'ai', title: 'Agent', shellId: null, running: true }
  ]);
  let activeTabId = $state('ai');

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || tabs[0]; },

    /**
     * Set the active terminal tab.
     * @param {string} id
     */
    setActive(id) {
      if (tabs.find(t => t.id === id)) {
        activeTabId = id;
      }
    },

    /**
     * Add a new shell tab. Spawns a PTY on the backend.
     * @param {Object} [options]
     * @param {number} [options.cols]
     * @param {number} [options.rows]
     * @param {string} [options.cwd]
     * @returns {Promise<string|null>} The tab ID, or null on failure.
     */
    async addShellTab(options = {}) {
      try {
        const result = await shellSpawn(options);
        if (!result?.success || !result?.data?.id) {
          console.error('[terminal-tabs] Failed to spawn shell:', result?.error);
          return null;
        }
        const shellId = result.data.id;
        const tabNum = tabs.filter(t => t.type === 'shell').length + 1;
        const tab = {
          id: shellId,
          type: 'shell',
          title: `Shell ${tabNum}`,
          shellId,
          running: true,
        };
        tabs.push(tab);
        activeTabId = tab.id;
        return tab.id;
      } catch (err) {
        console.error('[terminal-tabs] Shell spawn error:', err);
        return null;
      }
    },

    /**
     * Close a shell tab. Cannot close the AI tab.
     * Kills the backend PTY process.
     * @param {string} id
     */
    async closeTab(id) {
      if (id === 'ai') return;
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      const tab = tabs[idx];

      // Kill the backend PTY
      if (tab.shellId && tab.running) {
        try {
          await shellKill(tab.shellId);
        } catch (err) {
          console.warn('[terminal-tabs] Failed to kill shell:', err);
        }
      }

      // Switch to neighbor tab before removing
      if (activeTabId === id) {
        if (idx > 0) {
          activeTabId = tabs[idx - 1].id;
        } else if (idx < tabs.length - 1) {
          activeTabId = tabs[idx + 1].id;
        } else {
          activeTabId = 'ai';
        }
      }

      tabs.splice(idx, 1);
    },

    /**
     * Mark a shell tab as exited (process ended).
     * Keeps the tab visible so user can see scrollback, but marks it dead.
     * @param {string} shellId
     */
    markExited(shellId) {
      const tab = tabs.find(t => t.shellId === shellId);
      if (tab) {
        tab.running = false;
      }
    },

    /**
     * Rename a tab.
     * @param {string} id
     * @param {string} title
     */
    renameTab(id, title) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        tab.title = title;
      }
    },
  };
}

export const terminalTabsStore = createTerminalTabsStore();
