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
    { id: 'ai', type: 'ai', title: 'Voice Agent', shellId: null, running: true }
  ]);
  let activeTabId = $state('ai');
  let hiddenTabs = $state([]);

  /**
   * Find the next available shell number, filling gaps.
   * If Shell 1 and Shell 3 exist, returns 2.
   */
  function nextShellNumber() {
    const existing = new Set(
      tabs.filter(t => t.type === 'shell').map(t => {
        const match = t.title.match(/^Shell (\d+)$/);
        return match ? parseInt(match[1]) : null;
      }).filter(n => n !== null)
    );
    let num = 1;
    while (existing.has(num)) num++;
    return num;
  }

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || tabs[0]; },
    get hiddenTabs() { return hiddenTabs; },

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
     * Cycle to the next tab (wraps around).
     */
    nextTab() {
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx === -1) return;
      activeTabId = tabs[(idx + 1) % tabs.length].id;
    },

    /**
     * Cycle to the previous tab (wraps around).
     */
    prevTab() {
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx === -1) return;
      activeTabId = tabs[idx === 0 ? tabs.length - 1 : idx - 1].id;
    },

    /**
     * Move a tab to before another tab. AI tab cannot be moved.
     * Uses tab IDs (not indices) so the operation is correct after splice.
     * @param {string} id - Tab ID to move
     * @param {string|null} beforeId - Insert before this tab, or null to append
     */
    moveTab(id, beforeId) {
      if (id === 'ai' || id === beforeId) return;
      const fromIndex = tabs.findIndex(t => t.id === id);
      if (fromIndex === -1) return;

      const [tab] = tabs.splice(fromIndex, 1);

      if (beforeId === null) {
        tabs.push(tab);
      } else {
        const toIndex = tabs.findIndex(t => t.id === beforeId);
        if (toIndex <= 0) {
          // Can't insert before AI tab — put at index 1
          tabs.splice(1, 0, tab);
        } else if (toIndex === -1) {
          tabs.push(tab);
        } else {
          tabs.splice(toIndex, 0, tab);
        }
      }
    },

    /**
     * Add a new shell tab. Spawns a PTY on the backend.
     * Uses smart numbering that fills gaps (e.g. Shell 1, Shell 3 → next is Shell 2).
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
        const tabNum = nextShellNumber();
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
     * Add a dev-server tab. Unlike shell tabs, this takes a pre-spawned shellId.
     * @param {{ shellId: string, title?: string, projectPath: string, framework?: string, port?: number }} options
     */
    addDevServerTab({ shellId, title, projectPath, framework, port }) {
      tabs.push({
        id: shellId,
        type: 'dev-server',
        title: title || `${framework || 'Dev'} :${port || '?'}`,
        shellId,
        running: true,
        projectPath,
        framework: framework || null,
        port: port || null,
      });
      activeTabId = shellId;
    },

    /**
     * Find a dev-server tab by project path.
     * @param {string} projectPath
     * @returns {Object|null}
     */
    getDevServerTab(projectPath) {
      return tabs.find(t => t.type === 'dev-server' && t.projectPath === projectPath) || null;
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

    /**
     * Hide a tab -- removes from visible tabs but keeps the process alive.
     * Used by dev-server manager to hide terminal tabs when server is running in background.
     * @param {string} id
     */
    hideTab(id) {
      if (id === 'ai') return;
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      const [tab] = tabs.splice(idx, 1);
      hiddenTabs.push(tab);

      // Switch active tab to neighbor
      if (activeTabId === id) {
        if (idx > 0 && tabs[idx - 1]) {
          activeTabId = tabs[idx - 1].id;
        } else if (tabs[idx]) {
          activeTabId = tabs[idx].id;
        } else {
          activeTabId = 'ai';
        }
      }
    },

    /**
     * Unhide a tab -- moves it from hiddenTabs back to visible tabs.
     * @param {string} id
     */
    unhideTab(id) {
      const idx = hiddenTabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      const [tab] = hiddenTabs.splice(idx, 1);
      tabs.push(tab);
      activeTabId = tab.id;
    },

    /**
     * Find a dev-server tab by its shell ID (checks both visible and hidden tabs).
     * @param {string} shellId
     * @returns {Object|null}
     */
    getDevServerTabByShellId(shellId) {
      return tabs.find(t => t.type === 'dev-server' && t.shellId === shellId)
        || hiddenTabs.find(t => t.type === 'dev-server' && t.shellId === shellId)
        || null;
    },
  };
}

export const terminalTabsStore = createTerminalTabsStore();
