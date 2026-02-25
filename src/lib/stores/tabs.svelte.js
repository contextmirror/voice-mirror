/**
 * tabs.svelte.js -- Svelte 5 reactive store for editor tab management.
 *
 * Manages open file/diff tabs in Lens mode with multi-group support.
 * Each tab belongs to an editor group (groupId). Browser is no longer a tab --
 * it's a fixed UI element managed by LensWorkspace.
 * Supports preview tabs (single-click = temporary, edit = pinned).
 */

import { editorGroupsStore } from './editor-groups.svelte.js';

function createTabsStore() {
  let tabs = $state([]);
  // activeTabId tracks the active tab in group 1 for backwards compatibility
  let activeTabId = $state(null);

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || null; },

    /**
     * Get all tabs belonging to a specific group.
     * @param {number} groupId
     * @returns {Array} Tabs in this group
     */
    getTabsForGroup(groupId) {
      return tabs.filter(t => t.groupId === groupId);
    },

    /**
     * Get the active tab for a specific group.
     * @param {number} groupId
     * @returns {object|null} The active tab, or null
     */
    getActiveTabForGroup(groupId) {
      const tabId = editorGroupsStore.getActiveTabForGroup(groupId);
      if (tabId === null) return null;
      return tabs.find(t => t.id === tabId) || null;
    },

    /**
     * Open a file in a tab. If already open, focus it.
     * Single-click creates a preview tab (replaces existing preview in the target group).
     * @param {{ name: string, path: string, readOnly?: boolean, external?: boolean }} entry - FileTree entry
     * @param {number} [targetGroupId] - Group to open in (defaults to focused group)
     */
    openFile(entry, targetGroupId) {
      const groupId = targetGroupId ?? editorGroupsStore.focusedGroupId;

      // If file is already open in the target group, just focus it
      const existingInGroup = tabs.find(t => t.path === entry.path && t.groupId === groupId);
      if (existingInGroup) {
        activeTabId = existingInGroup.id;
        editorGroupsStore.setActiveTabForGroup(groupId, existingInGroup.id);
        editorGroupsStore.setFocusedGroup(groupId);
        return;
      }

      // Replace existing preview tab in the target group if there is one
      const previewIdx = tabs.findIndex(t => t.preview && t.groupId === groupId);
      // Use path as ID for group 1 (backwards compat), namespaced for other groups
      const tabId = groupId === 1 ? entry.path : `${entry.path}:g${groupId}`;
      const newTab = {
        id: tabId,
        type: 'file',
        title: entry.name,
        path: entry.path,
        groupId,
        preview: true,
        dirty: false,
        readOnly: entry.readOnly || false,
        external: entry.external || false,
      };

      if (previewIdx !== -1) {
        tabs[previewIdx] = newTab;
      } else {
        tabs.push(newTab);
      }
      activeTabId = tabId;
      editorGroupsStore.setActiveTabForGroup(groupId, tabId);
      editorGroupsStore.setFocusedGroup(groupId);
    },

    /**
     * Open a file in a new split pane to the side.
     * @param {{ name: string, path: string, readOnly?: boolean, external?: boolean }} entry
     * @param {'horizontal'|'vertical'} [direction='horizontal']
     */
    openFileToSide(entry, direction = 'horizontal') {
      const currentGroupId = editorGroupsStore.focusedGroupId;
      const newGroupId = editorGroupsStore.splitGroup(currentGroupId, direction);
      this.openFile(entry, newGroupId);
    },

    /**
     * Open a diff view for a changed file. If already open, focus it.
     * @param {{ path: string, status: string }} change - Git change entry
     * @param {number} [targetGroupId] - Group to open in (defaults to focused group)
     */
    openDiff(change, targetGroupId) {
      const groupId = targetGroupId ?? editorGroupsStore.focusedGroupId;
      const baseDiffId = `diff:${change.path}`;

      // If diff is already open in the target group, just focus it
      const existingInGroup = tabs.find(t => t.path === change.path && t.type === 'diff' && t.groupId === groupId);
      if (existingInGroup) {
        activeTabId = existingInGroup.id;
        editorGroupsStore.setActiveTabForGroup(groupId, existingInGroup.id);
        editorGroupsStore.setFocusedGroup(groupId);
        return;
      }

      // Extract filename for title
      const name = change.path.split(/[/\\]/).pop() || change.path;

      // Replace existing preview tab in the target group
      const previewIdx = tabs.findIndex(t => t.preview && t.groupId === groupId);
      const tabId = groupId === 1 ? baseDiffId : `${baseDiffId}:g${groupId}`;
      const newTab = {
        id: tabId,
        type: 'diff',
        title: name,
        path: change.path,
        groupId,
        status: change.status,
        preview: true,
        dirty: false,
        diffStats: null,
      };

      if (previewIdx !== -1) {
        tabs[previewIdx] = newTab;
      } else {
        tabs.push(newTab);
      }
      activeTabId = tabId;
      editorGroupsStore.setActiveTabForGroup(groupId, tabId);
      editorGroupsStore.setFocusedGroup(groupId);
    },

    /**
     * Pin a preview tab (make it permanent).
     */
    pinTab(id) {
      // Try exact ID match first, then fall back to path match in focused group
      let tab = tabs.find(t => t.id === id);
      if (!tab) {
        tab = tabs.find(t => t.path === id && t.groupId === editorGroupsStore.focusedGroupId);
      }
      if (tab) {
        tab.preview = false;
      }
    },

    /**
     * Close a tab. If it's the last tab in a group, close the group.
     * Switches to neighboring tab within the same group.
     */
    closeTab(id) {
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      const closedTab = tabs[idx];
      const groupId = closedTab.groupId;
      const groupTabs = tabs.filter(t => t.groupId === groupId);

      // If closing the active tab for this group, pick a neighbor within the group
      const activeForGroup = editorGroupsStore.getActiveTabForGroup(groupId);
      if (activeForGroup === id) {
        const groupIdx = groupTabs.findIndex(t => t.id === id);
        let nextActiveId = null;
        if (groupTabs.length > 1) {
          if (groupIdx > 0) {
            nextActiveId = groupTabs[groupIdx - 1].id;
          } else {
            nextActiveId = groupTabs[groupIdx + 1].id;
          }
        }
        editorGroupsStore.setActiveTabForGroup(groupId, nextActiveId);
        if (groupId === editorGroupsStore.focusedGroupId) {
          activeTabId = nextActiveId;
        }
      }

      tabs.splice(idx, 1);

      // If this group has no more tabs, close the group (if it's not the last one)
      const remainingGroupTabs = tabs.filter(t => t.groupId === groupId);
      if (remainingGroupTabs.length === 0 && editorGroupsStore.groupCount > 1) {
        const siblingGroupId = editorGroupsStore.closeGroup(groupId);
        if (siblingGroupId !== null) {
          // Update activeTabId to the sibling group's active tab
          activeTabId = editorGroupsStore.getActiveTabForGroup(siblingGroupId);
        }
      }
    },

    /**
     * Set the active tab by ID. Updates the tab's group focus as well.
     */
    setActive(id) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        activeTabId = id;
        editorGroupsStore.setActiveTabForGroup(tab.groupId, id);
        editorGroupsStore.setFocusedGroup(tab.groupId);
      }
    },

    /**
     * Move a tab to a different group.
     * @param {string} tabId
     * @param {number} targetGroupId
     * @param {number} [index] - Optional insertion index within the target group's tabs
     */
    moveTab(tabId, targetGroupId, index) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;

      const sourceGroupId = tab.groupId;
      tab.groupId = targetGroupId;

      // If an index is specified, reposition within target group tabs
      if (index !== undefined) {
        const tabIdx = tabs.indexOf(tab);
        tabs.splice(tabIdx, 1);
        // Find the insertion point among tabs of the target group
        const targetTabs = tabs.filter(t => t.groupId === targetGroupId);
        if (index >= targetTabs.length) {
          tabs.push(tab);
        } else {
          const insertBefore = targetTabs[index];
          const insertIdx = tabs.indexOf(insertBefore);
          tabs.splice(insertIdx, 0, tab);
        }
      }

      // Update active tab for target group
      editorGroupsStore.setActiveTabForGroup(targetGroupId, tabId);
      editorGroupsStore.setFocusedGroup(targetGroupId);
      activeTabId = tabId;

      // Check if source group is now empty
      const sourceRemaining = tabs.filter(t => t.groupId === sourceGroupId);
      if (sourceRemaining.length === 0 && editorGroupsStore.groupCount > 1) {
        // Pick a new active for source before closing
        editorGroupsStore.setActiveTabForGroup(sourceGroupId, null);
        editorGroupsStore.closeGroup(sourceGroupId);
      } else if (sourceRemaining.length > 0) {
        // If the moved tab was active in the source group, pick a replacement
        const sourceActive = editorGroupsStore.getActiveTabForGroup(sourceGroupId);
        if (sourceActive === tabId) {
          editorGroupsStore.setActiveTabForGroup(sourceGroupId, sourceRemaining[0].id);
        }
      }
    },

    /**
     * Reorder a tab within its group (swap position in the tabs array).
     * @param {string} tabId
     * @param {number} newIndex - New index within the group's tabs
     */
    reorderTab(tabId, newIndex) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;

      const groupTabs = tabs.filter(t => t.groupId === tab.groupId);
      const currentGroupIdx = groupTabs.findIndex(t => t.id === tabId);
      if (currentGroupIdx === newIndex) return;

      // Remove from current position
      const tabIdx = tabs.indexOf(tab);
      tabs.splice(tabIdx, 1);

      // Find target position in the flat array
      const updatedGroupTabs = tabs.filter(t => t.groupId === tab.groupId);
      const clampedIndex = Math.min(newIndex, updatedGroupTabs.length);
      if (clampedIndex >= updatedGroupTabs.length) {
        // Insert after the last tab in this group
        const lastInGroup = updatedGroupTabs[updatedGroupTabs.length - 1];
        const insertIdx = lastInGroup ? tabs.indexOf(lastInGroup) + 1 : tabs.length;
        tabs.splice(insertIdx, 0, tab);
      } else {
        const insertBefore = updatedGroupTabs[clampedIndex];
        const insertIdx = tabs.indexOf(insertBefore);
        tabs.splice(insertIdx, 0, tab);
      }
    },

    /**
     * Mark a tab as dirty (modified) or clean.
     */
    setDirty(id, dirty) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        tab.dirty = dirty;
      }
    },

    /**
     * Set diff stats (additions/deletions) on a diff tab.
     */
    setDiffStats(id, stats) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        tab.diffStats = stats;
      }
    },

    /**
     * Update a tab's title.
     */
    updateTitle(id, title) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        tab.title = title;
      }
    },

    /**
     * Close all tabs and reset editor groups.
     */
    closeAll() {
      tabs.length = 0;
      activeTabId = null;
      editorGroupsStore.reset();
    },

    /**
     * Close all tabs in the same group except the given one.
     */
    closeOthers(id) {
      const tab = tabs.find(t => t.id === id);
      if (!tab) return;
      const groupId = tab.groupId;

      // Remove other tabs in the same group
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i].groupId === groupId && tabs[i].id !== id) {
          tabs.splice(i, 1);
        }
      }

      editorGroupsStore.setActiveTabForGroup(groupId, id);
      if (groupId === editorGroupsStore.focusedGroupId) {
        activeTabId = id;
      }
    },

    /**
     * Close all tabs to the right of the given tab within its group.
     */
    closeToRight(id) {
      const tab = tabs.find(t => t.id === id);
      if (!tab) return;
      const groupId = tab.groupId;
      const groupTabs = tabs.filter(t => t.groupId === groupId);
      const groupIdx = groupTabs.findIndex(t => t.id === id);
      if (groupIdx === -1) return;

      // Get IDs of tabs to the right in this group
      const toRemove = new Set(groupTabs.slice(groupIdx + 1).map(t => t.id));

      for (let i = tabs.length - 1; i >= 0; i--) {
        if (toRemove.has(tabs[i].id)) {
          tabs.splice(i, 1);
        }
      }

      // If active tab was removed, switch to the given tab
      const activeForGroup = editorGroupsStore.getActiveTabForGroup(groupId);
      if (activeForGroup && toRemove.has(activeForGroup)) {
        editorGroupsStore.setActiveTabForGroup(groupId, id);
        if (groupId === editorGroupsStore.focusedGroupId) {
          activeTabId = id;
        }
      }
    },
  };
}

export const tabsStore = createTabsStore();
