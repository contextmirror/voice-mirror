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
import { terminalSpawn, terminalKill, getConfig, setConfig } from '../api.js';
import { auditTerminal } from '../audit-log.js';
import { createLeaf, splitLeaf, removeLeaf, getAllInstanceIds, findLeaf, serialize, deserialize } from '../split-tree.js';

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
   * Create a group object with a splitTree and backward-compat instanceIds getter.
   * @param {string} id - group ID
   * @param {object} splitTree - root SplitNode
   * @returns {{ id: string, splitTree: object, readonly instanceIds: string[] }}
   */
  function createGroupObj(id, splitTree) {
    return {
      id,
      splitTree,
      get instanceIds() { return getAllInstanceIds(this.splitTree); },
    };
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

  // ---- Layout Persistence ----

  let saveTimeout = null;
  function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveLayout(), 500);
  }

  async function saveLayout() {
    try {
      const layoutData = {
        groups: groups.map(g => ({
          id: g.id,
          splitTree: serialize(g.splitTree),
          activeInstanceId: (activeGroupId === g.id) ? activeInstanceId : g.instanceIds[0] || null,
          instances: Object.fromEntries(
            g.instanceIds.map(instId => {
              const inst = instances[instId];
              return inst ? [instId, {
                title: inst.title,
                color: inst.color,
                icon: inst.icon,
                profileId: inst.profileId,
                type: inst.type || null,
              }] : null;
            }).filter(Boolean)
          ),
        })),
        activeGroupId,
      };
      await setConfig({ terminalLayout: layoutData });
    } catch (err) {
      console.error('[terminal-tabs] Failed to save layout:', err);
    }
  }

  async function restoreLayout() {
    try {
      const config = await getConfig();
      const layoutData = config?.terminalLayout;
      if (!layoutData || !Array.isArray(layoutData.groups) || layoutData.groups.length === 0) {
        return false; // No saved layout
      }

      // Track saved active instance per group (keyed by group ID)
      const savedActiveInstances = {};

      for (const savedGroup of layoutData.groups) {
        const tree = deserialize(savedGroup.splitTree);
        if (!tree) continue;

        const groupId = savedGroup.id || generateGroupId();
        const savedInstances = savedGroup.instances || {};
        const leafIds = getAllInstanceIds(tree);

        // Map old instance IDs to new shell IDs
        const idMap = {};
        for (const oldId of leafIds) {
          const savedInst = savedInstances[oldId] || {};
          try {
            let result = await terminalSpawn({ profileId: savedInst.profileId || 'default' });
            // If profile-specific spawn fails, retry with default
            if (!result?.success && savedInst.profileId && savedInst.profileId !== 'default') {
              console.warn('[terminal-tabs] Profile', savedInst.profileId, 'unavailable, falling back to default');
              result = await terminalSpawn({ profileId: 'default' });
            }
            if (result?.success && result?.data?.id) {
              const shellId = result.data.id;
              idMap[oldId] = shellId;
              instances = { ...instances, [shellId]: {
                id: shellId,
                groupId,
                title: savedInst.title || 'Terminal',
                profileId: savedInst.profileId || 'default',
                icon: savedInst.icon || null,
                color: savedInst.color || null,
                shellId,
                running: true,
                type: savedInst.type || undefined,
              }};
            }
          } catch (err) {
            console.warn('[terminal-tabs] Failed to restore instance:', err);
          }
        }

        // Remap tree instance IDs to new shell IDs
        function remapTree(node) {
          if (node.type === 'leaf') {
            const newId = idMap[node.instanceId];
            return newId ? { type: 'leaf', instanceId: newId } : null;
          }
          if (node.type === 'split') {
            const left = remapTree(node.children[0]);
            const right = remapTree(node.children[1]);
            if (!left && !right) return null;
            if (!left) return right;
            if (!right) return left;
            return { ...node, children: [left, right] };
          }
          return null;
        }

        const remappedTree = remapTree(tree);
        if (!remappedTree) continue;

        // Track remapped active instance for this group
        if (savedGroup.activeInstanceId && idMap[savedGroup.activeInstanceId]) {
          savedActiveInstances[groupId] = idMap[savedGroup.activeInstanceId];
        }

        // Adjust nextGroupNum to avoid collisions
        const num = parseInt(groupId.replace('group-', ''), 10);
        if (!isNaN(num) && num >= nextGroupNum) {
          nextGroupNum = num + 1;
        }

        groups = [...groups, createGroupObj(groupId, remappedTree)];
      }

      if (groups.length > 0) {
        // Restore active group
        const savedActiveGroupId = layoutData.activeGroupId;
        if (savedActiveGroupId && groups.find(g => g.id === savedActiveGroupId)) {
          activeGroupId = savedActiveGroupId;
        } else {
          activeGroupId = groups[0].id;
        }
        // Restore active instance (prefer saved, fall back to first)
        activeInstanceId = savedActiveInstances[activeGroupId]
          || groups.find(g => g.id === activeGroupId)?.instanceIds[0] || null;
        syncLegacyTabs();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[terminal-tabs] Failed to restore layout:', err);
      return false;
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

    // ---- Persistence ----
    saveLayout,
    restoreLayout,
    debouncedSave,

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
      auditTerminal('shell-created', { profileId: options.profileId || 'default' });
      try {
        const result = await terminalSpawn(options);
        if (!result?.success || !result?.data?.id) {
          console.error('[terminal-tabs] Failed to spawn terminal:', result?.error);
          return null;
        }
        const shellId = result.data.id;
        const profileName = result.data.profileName || null;
        const groupId = generateGroupId();
        const tabNum = nextTerminalNumber();
        // Use profile name for tab title when a profile was explicitly selected
        const title = profileName ? `${profileName} ${tabNum}` : `Terminal ${tabNum}`;

        const instance = {
          id: shellId,
          groupId,
          title,
          profileId: options.profileId || 'default',
          icon: null,
          color: null,
          shellId,
          running: true,
        };

        instances = { ...instances, [shellId]: instance };
        groups = [...groups, createGroupObj(groupId, createLeaf(shellId))];
        activeGroupId = groupId;
        activeInstanceId = shellId;

        syncLegacyTabs();
        debouncedSave();
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
     * @param {'horizontal'|'vertical'} [options.direction] - split direction (default: 'horizontal' = side-by-side)
     * @returns {Promise<string|null>} The instance ID, or null on failure.
     */
    async splitInstance(options = {}) {
      const direction = options.direction || 'horizontal';

      if (!activeGroupId) {
        // No active group -- create one instead
        const groupId = await this.addGroup(options);
        if (!groupId) return null;
        return activeInstanceId;
      }

      const groupIdx = groups.findIndex(g => g.id === activeGroupId);
      if (groupIdx === -1) return null;

      // Check if split would exceed depth before spawning a PTY
      const targetId = activeInstanceId || groups[groupIdx].instanceIds[0];
      if (!targetId) return null;

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

        // Use splitLeaf to insert into the split tree at the active instance's position
        const newTree = splitLeaf(groups[groupIdx].splitTree, targetId, shellId, direction);
        if (!newTree) {
          // Depth exceeded or target not found -- kill the spawned PTY
          console.warn('[terminal-tabs] Split depth exceeded, cannot split further');
          try { await terminalKill(shellId); } catch (_) {}
          return null;
        }

        instances = { ...instances, [shellId]: instance };
        groups[groupIdx].splitTree = newTree;
        groups = [...groups]; // trigger reactivity

        activeInstanceId = shellId;
        syncLegacyTabs();
        debouncedSave();
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

      // Remove instance from group's split tree using removeLeaf
      if (groupIdx !== -1) {
        const newTree = removeLeaf(groups[groupIdx].splitTree, instanceId);

        if (newTree === null) {
          // Last leaf removed -- remove the entire group
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
          groups[groupIdx].splitTree = newTree;
          groups = [...groups]; // trigger reactivity

          // Focus previous instance in group if we killed the active one
          if (activeInstanceId === instanceId) {
            const remainingIds = groups[groupIdx].instanceIds;
            activeInstanceId = remainingIds[0] || null;
          }
        }
      }

      // Remove instance from map
      const { [instanceId]: _, ...rest } = instances;
      instances = rest;

      syncLegacyTabs();
      debouncedSave();
    },

    /**
     * Unsplit a group: keep the active instance in the group, move all others
     * to their own new groups (preserving running terminals, like VS Code).
     * @param {string} groupId
     */
    unsplitGroup(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group || group.instanceIds.length <= 1) return;

      // Determine which instance to keep in the current group
      const keepId = (activeGroupId === groupId && activeInstanceId && group.instanceIds.includes(activeInstanceId))
        ? activeInstanceId
        : group.instanceIds[0];

      const toMove = group.instanceIds.filter(id => id !== keepId);

      // Move each displaced terminal to its own new group (don't kill!)
      const groupIdx = groups.findIndex(g => g.id === groupId);
      for (const id of toMove) {
        const inst = instances[id];
        if (inst) {
          const newGroupId = generateGroupId();
          inst.groupId = newGroupId;
          groups = [...groups, createGroupObj(newGroupId, createLeaf(id))];
        }
      }

      // Collapse the original group to a single leaf
      if (groupIdx !== -1) {
        groups[groupIdx].splitTree = createLeaf(keepId);
        groups = [...groups];
      }

      if (activeGroupId === groupId) {
        activeInstanceId = keepId;
      }

      instances = { ...instances }; // trigger reactivity for updated groupIds
      syncLegacyTabs();
      debouncedSave();
    },

    /**
     * Kill an entire group and all its instances.
     * If this is the last group, auto-creates a fresh terminal.
     * @param {string} groupId
     */
    async killGroup(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;

      // Kill all instances in the group
      for (const instId of [...group.instanceIds]) {
        const inst = instances[instId];
        if (inst?.shellId && inst.running) {
          try {
            await terminalKill(inst.shellId);
          } catch (err) {
            console.warn('[terminal-tabs] Failed to kill instance:', err);
          }
        }
        const { [instId]: _, ...rest } = instances;
        instances = rest;
      }

      // Remove the group
      const groupIdx = groups.findIndex(g => g.id === groupId);
      groups = groups.filter(g => g.id !== groupId);

      // Focus previous group
      if (activeGroupId === groupId) {
        if (groups.length > 0) {
          const prevIdx = Math.min(groupIdx, groups.length - 1);
          const prevGroup = groups[prevIdx > 0 ? prevIdx - 1 : 0] || groups[0];
          activeGroupId = prevGroup.id;
          activeInstanceId = prevGroup.instanceIds[0] || null;
        } else {
          activeGroupId = null;
          activeInstanceId = null;
        }
      }

      syncLegacyTabs();
      debouncedSave();

      // Auto-create fresh terminal if no groups left
      if (groups.length === 0) {
        await this.addGroup();
      }
    },

    /**
     * Switch the active group.
     * @param {string} groupId
     */
    setActiveGroup(groupId) {
      auditTerminal('group-switched', { groupId });
      const group = groups.find(g => g.id === groupId);
      if (!group) return;
      activeGroupId = groupId;
      // Focus first instance in group
      activeInstanceId = group.instanceIds[0] || null;
      syncLegacyTabs();
    },

    /**
     * Split a specific group (add instance to that group, not necessarily the active one).
     * @param {string} groupId
     * @param {Object} [options]
     * @param {'horizontal'|'vertical'} [options.direction] - split direction (default: 'horizontal')
     * @returns {Promise<string|null>} The new instance ID, or null on failure.
     */
    async splitGroup(groupId, options = {}) {
      const direction = options.direction || 'horizontal';
      const group = groups.find(g => g.id === groupId);
      if (!group) return null;

      // Determine which leaf to split (active instance in this group, or first)
      const targetId = (activeGroupId === groupId && activeInstanceId && findLeaf(group.splitTree, activeInstanceId))
        ? activeInstanceId
        : group.instanceIds[0];
      if (!targetId) return null;

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
          groupId,
          title: `Terminal ${tabNum}`,
          profileId: options.profileId || 'default',
          icon: null,
          color: null,
          shellId,
          running: true,
        };

        const groupIdx = groups.findIndex(g => g.id === groupId);
        if (groupIdx === -1) return null;

        const newTree = splitLeaf(groups[groupIdx].splitTree, targetId, shellId, direction);
        if (!newTree) {
          console.warn('[terminal-tabs] Split depth exceeded for group', groupId);
          try { await terminalKill(shellId); } catch (_) {}
          return null;
        }

        instances = { ...instances, [shellId]: instance };
        groups[groupIdx].splitTree = newTree;
        groups = [...groups];

        activeGroupId = groupId;
        activeInstanceId = shellId;
        syncLegacyTabs();
        debouncedSave();
        return shellId;
      } catch (err) {
        console.error('[terminal-tabs] Terminal split error:', err);
        return null;
      }
    },

    /**
     * Move an instance to a new position within or across groups.
     * For split-tree groups, this removes the instance from the source tree
     * and appends it as a horizontal split at the last leaf of the target tree.
     * @param {string} instanceId - The instance to move
     * @param {string} targetGroupId - The group to move into
     * @param {number} targetIndex - Position hint (used for ordering context)
     */
    moveInstance(instanceId, targetGroupId, targetIndex) {
      const instance = instances[instanceId];
      if (!instance) return;

      const sourceGroupId = instance.groupId;
      const sourceGroupIdx = groups.findIndex(g => g.id === sourceGroupId);
      const targetGroupIdx = groups.findIndex(g => g.id === targetGroupId);
      if (sourceGroupIdx === -1 || targetGroupIdx === -1) return;

      // Remove from source group's split tree
      const newSourceTree = removeLeaf(groups[sourceGroupIdx].splitTree, instanceId);

      if (sourceGroupId === targetGroupId) {
        // Same group -- remove and re-add via splitLeaf on last leaf
        if (newSourceTree === null) return; // can't reorder single leaf
        const targetIds = getAllInstanceIds(newSourceTree);
        const clampedIdx = Math.min(targetIndex, targetIds.length - 1);
        const targetLeafId = targetIds[clampedIdx] || targetIds[targetIds.length - 1];
        const reinserted = splitLeaf(newSourceTree, targetLeafId, instanceId, 'horizontal');
        if (reinserted) {
          groups[targetGroupIdx].splitTree = reinserted;
        } else {
          // Fallback: just put it back
          groups[targetGroupIdx].splitTree = newSourceTree;
        }
      } else {
        // Different group -- remove from source, add to target
        if (newSourceTree === null) {
          // Source group is now empty -- remove it
          groups = groups.filter(g => g.id !== sourceGroupId);
          // Recalculate target index after removal
          const newTargetIdx = groups.findIndex(g => g.id === targetGroupId);
          if (newTargetIdx === -1) return;
          // Add to target tree via splitLeaf on last leaf
          const targetIds = groups[newTargetIdx].instanceIds;
          const targetLeafId = targetIds[targetIds.length - 1];
          const newTargetTree = splitLeaf(groups[newTargetIdx].splitTree, targetLeafId, instanceId, 'horizontal');
          if (newTargetTree) {
            groups[newTargetIdx].splitTree = newTargetTree;
          }
        } else {
          groups[sourceGroupIdx].splitTree = newSourceTree;
          // Add to target tree
          const targetIds = groups[targetGroupIdx].instanceIds;
          const targetLeafId = targetIds[targetIds.length - 1];
          const newTargetTree = splitLeaf(groups[targetGroupIdx].splitTree, targetLeafId, instanceId, 'horizontal');
          if (newTargetTree) {
            groups[targetGroupIdx].splitTree = newTargetTree;
          }
        }

        // Update instance's groupId
        instance.groupId = targetGroupId;
        instances = { ...instances };
      }

      groups = [...groups]; // trigger reactivity
      syncLegacyTabs();
      debouncedSave();
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
        debouncedSave();
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
        debouncedSave();
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
        debouncedSave();
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
        groups = [...groups, createGroupObj(groupId, createLeaf(shellId))];
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
        debouncedSave();
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
      groups = [...groups, createGroupObj(groupId, createLeaf(shellId))];
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
      debouncedSave();
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
      auditTerminal('shell-exited', { shellId });
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
          groups = [...groups, createGroupObj(groupId, createLeaf(id))];
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
