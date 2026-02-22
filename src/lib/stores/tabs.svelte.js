/**
 * tabs.svelte.js -- Svelte 5 reactive store for editor tab management.
 *
 * Manages open tabs in Lens mode: browser tab (always present) + file tabs.
 * Supports preview tabs (single-click = temporary, edit = pinned).
 */

function createTabsStore() {
  // Browser tab is always present, cannot be closed
  let tabs = $state([{ id: 'browser', type: 'browser', title: 'Browser', preview: false, dirty: false }]);
  let activeTabId = $state('browser');

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || tabs[0]; },

    /**
     * Open a file in a tab. If already open, focus it.
     * Single-click creates a preview tab (replaces existing preview).
     * @param {{ name: string, path: string }} entry - FileTree entry
     */
    openFile(entry) {
      // If file is already open, just focus it
      const existing = tabs.find(t => t.path === entry.path);
      if (existing) {
        activeTabId = existing.id;
        return;
      }

      // Replace existing preview tab if there is one
      const previewIdx = tabs.findIndex(t => t.preview);
      const newTab = {
        id: entry.path,
        type: 'file',
        title: entry.name,
        path: entry.path,
        preview: true,
        dirty: false,
      };

      if (previewIdx !== -1) {
        tabs[previewIdx] = newTab;
      } else {
        tabs.push(newTab);
      }
      activeTabId = newTab.id;
    },

    /**
     * Open a diff view for a changed file. If already open, focus it.
     * @param {{ path: string, status: string }} change - Git change entry
     */
    openDiff(change) {
      const diffId = `diff:${change.path}`;

      // If diff is already open, just focus it
      const existing = tabs.find(t => t.id === diffId);
      if (existing) {
        activeTabId = existing.id;
        return;
      }

      // Extract filename for title
      const name = change.path.split(/[/\\]/).pop() || change.path;

      // Replace existing preview tab if there is one
      const previewIdx = tabs.findIndex(t => t.preview);
      const newTab = {
        id: diffId,
        type: 'diff',
        title: name,
        path: change.path,
        status: change.status,
        preview: true,
        dirty: false,
      };

      if (previewIdx !== -1) {
        tabs[previewIdx] = newTab;
      } else {
        tabs.push(newTab);
      }
      activeTabId = newTab.id;
    },

    /**
     * Pin a preview tab (make it permanent).
     */
    pinTab(id) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        tab.preview = false;
      }
    },

    /**
     * Close a tab. Cannot close the browser tab.
     * Switches to neighboring tab (prefer left, then right, then browser).
     */
    closeTab(id) {
      if (id === 'browser') return;
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      // If closing the active tab, pick a neighbor
      if (activeTabId === id) {
        if (idx > 0) {
          activeTabId = tabs[idx - 1].id;
        } else if (idx < tabs.length - 1) {
          activeTabId = tabs[idx + 1].id;
        } else {
          activeTabId = 'browser';
        }
      }

      tabs.splice(idx, 1);
    },

    /**
     * Set the active tab by ID.
     */
    setActive(id) {
      if (tabs.find(t => t.id === id)) {
        activeTabId = id;
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
     * Update a tab's title.
     */
    updateTitle(id, title) {
      const tab = tabs.find(t => t.id === id);
      if (tab) {
        tab.title = title;
      }
    },

    /**
     * Close all file tabs, keeping only the browser tab.
     */
    closeAll() {
      tabs.length = 0;
      tabs.push({ id: 'browser', type: 'browser', title: 'Browser', preview: false, dirty: false });
      activeTabId = 'browser';
    },

    /**
     * Close all tabs except the given one (and the browser tab).
     */
    closeOthers(id) {
      const keep = tabs.filter(t => t.id === id || t.id === 'browser');
      tabs.length = 0;
      tabs.push(...keep);
      if (!tabs.find(t => t.id === activeTabId)) {
        activeTabId = id;
      }
    },

    /**
     * Close all tabs to the right of the given tab.
     */
    closeToRight(id) {
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;
      const removed = tabs.splice(idx + 1).filter(t => t.id !== 'browser');
      // If the browser tab was after and got removed, it's still at position 0
      if (activeTabId && !tabs.find(t => t.id === activeTabId)) {
        activeTabId = id;
      }
    },
  };
}

export const tabsStore = createTabsStore();
