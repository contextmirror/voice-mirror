/**
 * terminal-tabs.svelte.js -- Svelte 5 reactive store for terminal tab management.
 *
 * Supports a VS Code-style group/instance model:
 * - Groups contain 1+ instances (splits within a single tab)
 * - Each instance maps to a PTY session on the backend
 * - The "AI" tab is always present, unclosable, managed separately
 *
 * Backward-compatible: legacy methods (addTerminalTab, closeTab, etc.)
 * still work and delegate to the new group/instance model.
 */
import { terminalSpawn, terminalKill } from '../api.js';

function createTerminalTabsStore() {
  // AI tab is always present, cannot be closed
  let tabs = $state([
    { id: 'ai', type: 'ai', title: 'Voice Agent', shellId: null, running: true }
  ]);
  let activeTabId = $state('ai');
  let hiddenTabs = $state([]);

  // ---- Group/Instance Model ----

  /** @type {Array<{ id: string, instanceIds: string[] }>} */
  let groups = $state([]);

  /** @type {Record<string, { id: string, groupId: string, title: string, profileId: string, icon: string|null, color: string|null, shellId: string, running: boolean, type?: string, projectPath?: string, framework?: string|null, port?: number|null }>} */
  let instances = $state({});

  /** @type {string|null} */
  let activeGroupId = $state(null);

  /** @type {string|null} */
  let activeInstanceId = $state(null);

  let nextGroupNum = 1;

  function generateGroupId() {
    return `group-${nextGroupNum++}`;
  }

  /**
   * Find the next available terminal number, filling gaps.
   * If Terminal 1 and Terminal 3 exist, returns 2.
   */
  function nextTerminalNumber() {
    // Scan only active instances -- the single source of truth for terminal numbers.
    // Legacy tabs are derived from instances via syncLegacyTabs(), so checking
    // them separately would double-count and risk stale entries blocking reuse.
    const existing = new Set(
      Object.values(instances).map(inst => {
        const match = inst.title.match(/^Terminal (\d+)$/);
        return match ? parseInt(match[1]) : null;
      }).filter(n => n !== null)
    );
    let num = 1;
    while (existing.has(num)) num++;
    return num;
  }

  /**
   * Sync legacy tabs array with group/instance state.
   * Ensures backward compatibility -- legacy code sees a flat tabs array.
   */
  function syncLegacyTabs() {
    // Rebuild tabs from groups + instances (keep AI tab first, then groups)
    const aiTab = { id: 'ai', type: 'ai', title: 'Voice Agent', shellId: null, running: true };
    const groupTabs = groups.map(g => {
      // Use the first instance's data for the legacy tab representation
      const firstInstance = instances[g.instanceIds[0]];
      if (!firstInstance) return null;
      return {
        id: firstInstance.id,
        type: firstInstance.type || 'terminal',
        title: firstInstance.title,
        shellId: firstInstance.shellId,
        running: firstInstance.running,
        projectPath: firstInstance.projectPath,
        framework: firstInstance.framework,
        port: firstInstance.port,
      };
    }).filter(Boolean);
    tabs = [aiTab, ...groupTabs];
    // Keep activeTabId in sync
    if (activeInstanceId) {
      activeTabId = activeInstanceId;
    }
  }

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || tabs[0]; },
    get hiddenTabs() { return hiddenTabs; },

    // ---- Group/Instance Getters ----
    get groups() { return groups; },
    get activeGroupId() { return activeGroupId; },
    get activeInstanceId() { return activeInstanceId; },
    get activeGroup() { return groups.find(g => g.id === activeGroupId) || null; },
    get activeInstance() { return activeInstanceId ? instances[activeInstanceId] || null : null; },

    /**
     * Get an instance by ID.
     * @param {string} id
     * @returns {Object|null}
     */
    getInstance(id) {
      return instances[id] || null;
    },

    /**
     * Get all instances for a group.
     * @param {string} groupId
     * @returns {Array<Object>}
     */
    getInstancesForGroup(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group) return [];
      return group.instanceIds.map(id => instances[id]).filter(Boolean);
    },

    // ---- Group/Instance Methods ----

    /**
     * Create a new terminal group with 1 instance. Spawns a PTY.
     * @param {Object} [options]
     * @param {number} [options.cols]
     * @param {number} [options.rows]
     * @param {string} [options.cwd]
     * @param {string} [options.profileId]
     * @returns {Promise<string|null>} The group ID, or null on failure.
     */
    async addGroup(options = {}) {
      try {
        const result = await terminalSpawn(options);
        if (!result?.success || !result?.data?.id) {
          console.error('[terminal-tabs] Failed to spawn terminal:', result?.error);
          return null;
        }
        const shellId = result.data.id;
        const groupId = generateGroupId();
        const tabNum = nextTerminalNumber();

        const instance = {
          id: shellId,
          groupId,
          title: `Terminal ${tabNum}`,
          profileId: options.profileId || 'default',
          icon: null,
          color: null,
          shellId,
          running: true,
        };

        instances = { ...instances, [shellId]: instance };
        groups = [...groups, { id: groupId, instanceIds: [shellId] }];
        activeGroupId = groupId;
        activeInstanceId = shellId;

        syncLegacyTabs();
        return groupId;
      } catch (err) {
        console.error('[terminal-tabs] Terminal spawn error:', err);
        return null;
      }
    },

    /**
     * Add a new instance (split) to the active group. Spawns a PTY.
     * @param {Object} [options]
     * @param {number} [options.cols]
     * @param {number} [options.rows]
     * @param {string} [options.cwd]
     * @param {string} [options.profileId]
     * @returns {Promise<string|null>} The instance ID, or null on failure.
     */
    async splitInstance(options = {}) {
      if (!activeGroupId) {
        // No active group -- create one instead
        const groupId = await this.addGroup(options);
        if (!groupId) return null;
        return activeInstanceId;
      }

      try {
        const result = await terminalSpawn(options);
        if (!result?.success || !result?.data?.id) {
          console.error('[terminal-tabs] Failed to spawn terminal for split:', result?.error);
          return null;
        }
        const shellId = result.data.id;
        const tabNum = nextTerminalNumber();

        const instance = {
          id: shellId,
          groupId: activeGroupId,
          title: `Terminal ${tabNum}`,
          profileId: options.profileId || 'default',
          icon: null,
          color: null,
          shellId,
          running: true,
        };

        instances = { ...instances, [shellId]: instance };

        // Add to active group's instanceIds
        const groupIdx = groups.findIndex(g => g.id === activeGroupId);
        if (groupIdx !== -1) {
          groups[groupIdx].instanceIds = [...groups[groupIdx].instanceIds, shellId];
          groups = [...groups]; // trigger reactivity
        }

        activeInstanceId = shellId;
        syncLegacyTabs();
        return shellId;
      } catch (err) {
        console.error('[terminal-tabs] Terminal split error:', err);
        return null;
      }
    },

    /**
     * Kill a specific terminal instance.
     * Removes from its group; if group becomes empty, removes the group.
     * @param {string} instanceId
     */
    async killInstance(instanceId) {
      const instance = instances[instanceId];
      if (!instance) return;

      // Kill the backend PTY
      if (instance.shellId && instance.running) {
        try {
          await terminalKill(instance.shellId);
        } catch (err) {
          console.warn('[terminal-tabs] Failed to kill terminal:', err);
        }
      }

      const groupId = instance.groupId;
      const groupIdx = groups.findIndex(g => g.id === groupId);

      // Remove instance from group
      if (groupIdx !== -1) {
        const newInstanceIds = groups[groupIdx].instanceIds.filter(id => id !== instanceId);

        if (newInstanceIds.length === 0) {
          // Group is now empty -- remove it
          groups = groups.filter(g => g.id !== groupId);

          // Focus previous group or null
          if (activeGroupId === groupId) {
            if (groups.length > 0) {
              const prevGroupIdx = Math.min(groupIdx, groups.length - 1);
              const prevGroup = groups[prevGroupIdx > 0 ? prevGroupIdx - 1 : 0] || groups[0];
              activeGroupId = prevGroup.id;
              activeInstanceId = prevGroup.instanceIds[0] || null;
            } else {
              activeGroupId = null;
              activeInstanceId = null;
            }
          }
        } else {
          groups[groupIdx].instanceIds = newInstanceIds;
          groups = [...groups]; // trigger reactivity

          // Focus previous instance in group if we killed the active one
          if (activeInstanceId === instanceId) {
            const prevIdx = Math.max(0, groups[groupIdx]?.instanceIds?.indexOf?.(instanceId) ?? 0);
            const focusIdx = Math.min(prevIdx, newInstanceIds.length - 1);
            activeInstanceId = newInstanceIds[focusIdx] || newInstanceIds[0] || null;
          }
        }
      }

      // Remove instance from map
      const { [instanceId]: _, ...rest } = instances;
      instances = rest;

      syncLegacyTabs();
    },

    /**
     * Keep only the active instance in a group, kill all others.
     * @param {string} groupId
     */
    async unsplitGroup(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;

      // Determine which instance to keep (active in group, or first)
      const keepId = (activeGroupId === groupId && activeInstanceId && group.instanceIds.includes(activeInstanceId))
        ? activeInstanceId
        : group.instanceIds[0];

      const toKill = group.instanceIds.filter(id => id !== keepId);

      for (const id of toKill) {
        const inst = instances[id];
        if (inst?.shellId && inst.running) {
          try {
            await terminalKill(inst.shellId);
          } catch (err) {
            console.warn('[terminal-tabs] Failed to kill split instance:', err);
          }
        }
        const { [id]: _, ...rest } = instances;
        instances = rest;
      }

      // Update group to only have the kept instance
      const groupIdx = groups.findIndex(g => g.id === groupId);
      if (groupIdx !== -1) {
        groups[groupIdx].instanceIds = [keepId];
        groups = [...groups];
      }

      if (activeGroupId === groupId) {
        activeInstanceId = keepId;
      }

      syncLegacyTabs();
    },

    /**
     * Switch the active group.
     * @param {string} groupId
     */
    setActiveGroup(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;
      activeGroupId = groupId;
      // Focus first instance in group
      activeInstanceId = group.instanceIds[0] || null;
      syncLegacyTabs();
    },

    /**
     * Focus a specific instance (sets both activeGroupId and activeInstanceId).
     * @param {string} instanceId
     */
    focusInstance(instanceId) {
      const instance = instances[instanceId];
      if (!instance) return;
      activeGroupId = instance.groupId;
      activeInstanceId = instanceId;
      syncLegacyTabs();
    },

    /**
     * Move focus to the previous pane within the active group (wraps around).
     */
    focusPreviousPane() {
      const group = groups.find(g => g.id === activeGroupId);
      if (!group || group.instanceIds.length <= 1) return;
      const idx = group.instanceIds.indexOf(activeInstanceId);
      if (idx === -1) return;
      const prevIdx = idx === 0 ? group.instanceIds.length - 1 : idx - 1;
      activeInstanceId = group.instanceIds[prevIdx];
    },

    /**
     * Move focus to the next pane within the active group (wraps around).
     */
    focusNextPane() {
      const group = groups.find(g => g.id === activeGroupId);
      if (!group || group.instanceIds.length <= 1) return;
      const idx = group.instanceIds.indexOf(activeInstanceId);
      if (idx === -1) return;
      const nextIdx = (idx + 1) % group.instanceIds.length;
      activeInstanceId = group.instanceIds[nextIdx];
    },

    /**
     * Rename a terminal instance.
     * @param {string} instanceId
     * @param {string} title
     */
    renameInstance(instanceId, title) {
      const instance = instances[instanceId];
      if (instance) {
        instance.title = title;
        instances = { ...instances }; // trigger reactivity
        syncLegacyTabs();
      }
    },

    /**
     * Set the tab color for an instance.
     * @param {string} instanceId
     * @param {string|null} color
     */
    setInstanceColor(instanceId, color) {
      const instance = instances[instanceId];
      if (instance) {
        instance.color = color;
        instances = { ...instances };
      }
    },

    /**
     * Set the tab icon for an instance.
     * @param {string} instanceId
     * @param {string|null} icon
     */
    setInstanceIcon(instanceId, icon) {
      const instance = instances[instanceId];
      if (instance) {
        instance.icon = icon;
        instances = { ...instances };
      }
    },

    // ---- Legacy Methods (Backward Compatibility) ----

    /**
     * Set the active terminal tab.
     * @param {string} id
     */
    setActive(id) {
      if (id === 'ai') {
        activeTabId = 'ai';
        return;
      }
      // Check if id matches an instance
      const instance = instances[id];
      if (instance) {
        activeGroupId = instance.groupId;
        activeInstanceId = id;
        activeTabId = id;
        return;
      }
      if (tabs.find(t => t.id === id)) {
        activeTabId = id;
      }
    },

    /**
     * Cycle to the next group (wraps around).
     */
    nextTab() {
      if (groups.length === 0) return;
      const idx = groups.findIndex(g => g.id === activeGroupId);
      if (idx === -1) {
        activeGroupId = groups[0].id;
        activeInstanceId = groups[0].instanceIds[0] || null;
      } else {
        const nextIdx = (idx + 1) % groups.length;
        activeGroupId = groups[nextIdx].id;
        activeInstanceId = groups[nextIdx].instanceIds[0] || null;
      }
      syncLegacyTabs();
    },

    /**
     * Cycle to the previous group (wraps around).
     */
    prevTab() {
      if (groups.length === 0) return;
      const idx = groups.findIndex(g => g.id === activeGroupId);
      if (idx === -1) {
        activeGroupId = groups[groups.length - 1].id;
        activeInstanceId = groups[groups.length - 1].instanceIds[0] || null;
      } else {
        const prevIdx = idx === 0 ? groups.length - 1 : idx - 1;
        activeGroupId = groups[prevIdx].id;
        activeInstanceId = groups[prevIdx].instanceIds[0] || null;
      }
      syncLegacyTabs();
    },

    /**
     * Move a tab to before another tab. AI tab cannot be moved.
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
          tabs.splice(1, 0, tab);
        } else if (toIndex === -1) {
          tabs.push(tab);
        } else {
          tabs.splice(toIndex, 0, tab);
        }
      }
    },

    /**
     * Add a new terminal tab. Spawns a PTY on the backend.
     * Backward-compatible wrapper around addGroup().
     * @param {Object} [options]
     * @param {number} [options.cols]
     * @param {number} [options.rows]
     * @param {string} [options.cwd]
     * @returns {Promise<string|null>} The tab ID (instance ID), or null on failure.
     */
    async addTerminalTab(options = {}) {
      try {
        const result = await terminalSpawn(options);
        if (!result?.success || !result?.data?.id) {
          console.error('[terminal-tabs] Failed to spawn terminal:', result?.error);
          return null;
        }
        const shellId = result.data.id;
        const groupId = generateGroupId();
        const tabNum = nextTerminalNumber();

        const instance = {
          id: shellId,
          groupId,
          title: `Terminal ${tabNum}`,
          profileId: options.profileId || 'default',
          icon: null,
          color: null,
          shellId,
          running: true,
        };

        instances = { ...instances, [shellId]: instance };
        groups = [...groups, { id: groupId, instanceIds: [shellId] }];
        activeGroupId = groupId;
        activeInstanceId = shellId;

        // Also add to legacy tabs array
        const tab = {
          id: shellId,
          type: 'terminal',
          title: `Terminal ${tabNum}`,
          shellId,
          running: true,
        };
        tabs.push(tab);
        activeTabId = tab.id;
        return tab.id;
      } catch (err) {
        console.error('[terminal-tabs] Terminal spawn error:', err);
        return null;
      }
    },

    /**
     * Add a dev-server tab. Unlike shell tabs, this takes a pre-spawned shellId.
     * Also creates group/instance entries for the new model.
     * @param {{ shellId: string, title?: string, projectPath: string, framework?: string, port?: number }} options
     */
    addDevServerTab({ shellId, title, projectPath, framework, port }) {
      const tabTitle = title || `${framework || 'Dev'} :${port || '?'}`;
      const groupId = generateGroupId();

      // Create instance
      const instance = {
        id: shellId,
        groupId,
        title: tabTitle,
        profileId: 'default',
        icon: null,
        color: null,
        shellId,
        running: true,
        type: 'dev-server',
        projectPath,
        framework: framework || null,
        port: port || null,
      };

      instances = { ...instances, [shellId]: instance };
      groups = [...groups, { id: groupId, instanceIds: [shellId] }];
      activeGroupId = groupId;
      activeInstanceId = shellId;

      // Legacy tab
      tabs.push({
        id: shellId,
        type: 'dev-server',
        title: tabTitle,
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
     * Searches both legacy tabs and instances.
     * @param {string} projectPath
     * @returns {Object|null}
     */
    getDevServerTab(projectPath) {
      // Check instances first (new model)
      for (const inst of Object.values(instances)) {
        if (inst.type === 'dev-server' && inst.projectPath === projectPath) {
          return inst;
        }
      }
      return tabs.find(t => t.type === 'dev-server' && t.projectPath === projectPath) || null;
    },

    /**
     * Close a terminal tab. Cannot close the AI tab.
     * Backward-compatible wrapper around killInstance().
     * @param {string} id
     */
    async closeTab(id) {
      if (id === 'ai') return;

      // Try new model first
      const instance = instances[id];
      if (instance) {
        await this.killInstance(id);
        return;
      }

      // Legacy fallback
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      const tab = tabs[idx];

      if (tab.shellId && tab.running) {
        try {
          await terminalKill(tab.shellId);
        } catch (err) {
          console.warn('[terminal-tabs] Failed to kill terminal:', err);
        }
      }

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
      // Update instance if it exists
      const instance = Object.values(instances).find(inst => inst.shellId === shellId);
      if (instance) {
        instance.running = false;
        instances = { ...instances };
      }
      // Also update legacy tab
      const tab = tabs.find(t => t.shellId === shellId);
      if (tab) {
        tab.running = false;
      }
    },

    /**
     * Rename a tab (backward compat -- wraps renameInstance).
     * @param {string} id
     * @param {string} title
     */
    renameTab(id, title) {
      // Try instance first
      if (instances[id]) {
        this.renameInstance(id, title);
        return;
      }
      // Legacy fallback
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

      // Also hide from groups (but keep instance alive)
      const instance = instances[id];
      if (instance) {
        const groupIdx = groups.findIndex(g => g.id === instance.groupId);
        if (groupIdx !== -1) {
          groups = groups.filter(g => g.id !== instance.groupId);
          if (activeGroupId === instance.groupId) {
            if (groups.length > 0) {
              activeGroupId = groups[0].id;
              activeInstanceId = groups[0].instanceIds[0] || null;
            } else {
              activeGroupId = null;
              activeInstanceId = null;
            }
          }
        }
      }

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

      // Restore group if instance exists
      const instance = instances[id];
      if (instance) {
        // Re-add group
        const groupId = instance.groupId;
        if (!groups.find(g => g.id === groupId)) {
          groups = [...groups, { id: groupId, instanceIds: [id] }];
        }
        activeGroupId = groupId;
        activeInstanceId = id;
      }
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
