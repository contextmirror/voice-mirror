/**
 * tabs.svelte.js -- Svelte 5 reactive store for editor tab management.
 *
 * Manages open file/diff tabs in Lens mode with multi-group support.
 * Each tab belongs to an editor group (groupId). Browser is no longer a tab --
 * it's a fixed UI element managed by LensWorkspace.
 * Supports preview tabs (single-click = temporary, edit = pinned).
 */

import { editorGroupsStore } from './editor-groups.svelte.js';
import { auditEditor } from '../audit-log.js';
import { basename } from '../utils.js';

/**
 * Show a native Save/Don't Save/Cancel dialog for a dirty tab.
 * Uses Tauri's message dialog with three buttons.
 * @param {string} filename
 * @returns {Promise<string>} 'Save', "Don't Save", or 'Cancel'
 */
async function showDirtyCloseDialog(filename) {
  try {
    const { message } = await import('@tauri-apps/plugin-dialog');
    const result = await message(
      `Do you want to save changes to ${filename}?`,
      {
        title: 'Save Changes',
        kind: 'warning',
        buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
      }
    );
    return result;
  } catch {
    // Fallback: no Tauri runtime (e.g. tests) — default to cancel
    return 'Cancel';
  }
}

function createTabsStore() {
  let tabs = $state([]);
  // activeTabId tracks the active tab in group 1 for backwards compatibility
  let activeTabId = $state(null);
  let untitledCounter = 0;
  let previewEnabled = $state(true);

  /** @type {{ path: string, line: number, character: number, endLine?: number, endCharacter?: number } | null} */
  let pendingCursorPosition = $state(null);

  /** @type {Array<{path: string, type: string, groupId: number, title: string, status?: string|null}>} */
  let closedTabs = $state([]);
  const MAX_CLOSED_TABS = 20;

  /**
   * Push a tab onto the closed-tab history (skips untitled files).
   * @param {{path: string, type: string, groupId: number, title: string, status?: string}} tab
   */
  function pushToClosedHistory(tab) {
    if (!tab.path.startsWith('untitled:')) {
      closedTabs.push({
        path: tab.path,
        type: tab.type,
        groupId: tab.groupId,
        title: tab.title,
        status: tab.status || null,
      });
      if (closedTabs.length > MAX_CLOSED_TABS) {
        closedTabs.shift();
      }
    }
  }

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || null; },
    get previewEnabled() { return previewEnabled; },

    /** Pending cursor position for cross-file navigation */
    get pendingCursorPosition() { return pendingCursorPosition; },

    /** Set a cursor position to navigate to after a file opens.
     *  Optional endLine/endCharacter create a selection range (for diagnostic highlighting). */
    setPendingCursor(path, line, character, endLine, endCharacter) {
      pendingCursorPosition = { path, line, character, endLine, endCharacter };
    },

    /** Clear pending cursor (called by FileEditor after applying) */
    clearPendingCursor() {
      pendingCursorPosition = null;
    },

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
      auditEditor('file-opened', { path: entry.path });
      const groupId = targetGroupId ?? editorGroupsStore.focusedGroupId;

      // If file is already open in the target group, just focus it
      const existingInGroup = tabs.find(t => t.path === entry.path && t.groupId === groupId);
      if (existingInGroup) {
        activeTabId = existingInGroup.id;
        editorGroupsStore.setActiveTabForGroup(groupId, existingInGroup.id);
        editorGroupsStore.setFocusedGroup(groupId);
        return;
      }

      // Replace existing preview tab in the target group if preview mode is on
      const previewIdx = previewEnabled ? tabs.findIndex(t => t.preview && t.groupId === groupId) : -1;
      // Use path as ID for group 1 (backwards compat), namespaced for other groups
      const tabId = groupId === 1 ? entry.path : `${entry.path}:g${groupId}`;
      const newTab = {
        id: tabId,
        type: 'file',
        title: entry.name,
        path: entry.path,
        groupId,
        preview: previewEnabled,
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
     * Create a new untitled file tab (like VS Code's Ctrl+N).
     * @param {number} [targetGroupId] - Group to open in (defaults to focused group)
     * @returns {string} The new tab's ID
     */
    createUntitled(targetGroupId) {
      const groupId = targetGroupId ?? editorGroupsStore.focusedGroupId;
      untitledCounter += 1;
      const name = `Untitled-${untitledCounter}`;
      const path = `untitled:${untitledCounter}`;
      const tabId = groupId === 1 ? path : `${path}:g${groupId}`;

      const newTab = {
        id: tabId,
        type: 'file',
        title: name,
        path,
        groupId,
        preview: false, // Untitled files are always pinned
        dirty: false,
      };

      tabs.push(newTab);
      activeTabId = tabId;
      editorGroupsStore.setActiveTabForGroup(groupId, tabId);
      editorGroupsStore.setFocusedGroup(groupId);
      return tabId;
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
      const name = basename(change.path);

      // Replace existing preview tab in the target group if preview mode is on
      const previewIdx = previewEnabled ? tabs.findIndex(t => t.preview && t.groupId === groupId) : -1;
      const tabId = groupId === 1 ? baseDiffId : `${baseDiffId}:g${groupId}`;
      const newTab = {
        id: tabId,
        type: 'diff',
        title: name,
        path: change.path,
        groupId,
        status: change.status,
        preview: previewEnabled,
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
      auditEditor('file-closed', { path: closedTab.path });
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

      // Push to closed tab history (skip untitled files)
      pushToClosedHistory(closedTab);

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
     * Close a tab with a save prompt if the tab has unsaved changes.
     * Shows a native dialog: Save / Don't Save / Cancel.
     * - Save: triggers command:save event, waits for save, then closes.
     * - Don't Save: closes without saving.
     * - Cancel: keeps the tab open.
     * @param {string} id - Tab ID to close
     * @returns {Promise<boolean>} true if tab was closed, false if cancelled
     */
    async requestClose(id) {
      const tab = tabs.find(t => t.id === id);
      if (!tab) return true;

      if (!tab.dirty) {
        this.closeTab(id);
        return true;
      }

      const result = await showDirtyCloseDialog(tab.title);

      if (result === 'Save' || result === 'Yes') {
        // Make this tab active so command:save targets the right editor
        this.setActive(id);
        // Dispatch save command and wait for dirty flag to clear
        window.dispatchEvent(new CustomEvent('command:save'));
        // Poll for dirty flag (save is async, usually completes in <100ms)
        const saved = await new Promise(resolve => {
          let attempts = 0;
          const check = () => {
            const t = tabs.find(t2 => t2.id === id);
            if (!t || !t.dirty) { resolve(true); return; }
            if (++attempts > 20) { resolve(false); return; }
            setTimeout(check, 50);
          };
          // Small initial delay for the save to start
          setTimeout(check, 50);
        });
        if (saved) {
          this.closeTab(id);
          return true;
        }
        // Save failed — keep tab open
        return false;
      } else if (result === "Don't Save" || result === 'No') {
        this.closeTab(id);
        return true;
      }

      // Cancel — keep tab open
      return false;
    },

    /**
     * Set the active tab by ID. Updates the tab's group focus as well.
     */
    setActive(id) {
      auditEditor('tab-switched', { path: id });
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
      // Record all tabs in closed history before clearing
      for (const tab of tabs) {
        pushToClosedHistory(tab);
      }
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

      // Record tabs being removed, then splice them out
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i].groupId === groupId && tabs[i].id !== id) {
          pushToClosedHistory(tabs[i]);
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

      // Record tabs being removed, then splice them out
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (toRemove.has(tabs[i].id)) {
          pushToClosedHistory(tabs[i]);
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

    /**
     * Toggle preview mode. When disabled, all new tabs open as pinned (permanent).
     */
    togglePreviewMode() {
      previewEnabled = !previewEnabled;
      // When disabling preview mode, pin all existing preview tabs
      if (!previewEnabled) {
        for (const tab of tabs) {
          if (tab.preview) tab.preview = false;
        }
      }
    },

    /** Whether there are closed tabs to reopen */
    get canReopenTab() { return closedTabs.length > 0; },

    /**
     * Reopen the most recently closed tab.
     * @returns {boolean} true if a tab was reopened
     */
    reopenClosedTab() {
      if (closedTabs.length === 0) return false;
      const entry = closedTabs.pop();
      // Check if group still exists, fall back to focused group
      const targetGroup = editorGroupsStore.allGroupIds.includes(entry.groupId)
        ? entry.groupId
        : editorGroupsStore.focusedGroupId;
      const name = basename(entry.path);
      if (entry.type === 'diff') {
        this.openDiff({ path: entry.path, status: entry.status || 'modified' }, targetGroup);
      } else {
        this.openFile({ name, path: entry.path }, targetGroup);
      }
      return true;
    },
  };
}

export const tabsStore = createTabsStore();
