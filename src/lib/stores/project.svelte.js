/**
 * project.svelte.js -- Svelte 5 reactive store for project management.
 *
 * Tracks project entries (path, name, color) and the active project index.
 * Persists to config backend via setConfig() directly — bypasses the reactive
 * configStore to avoid cascading effect re-triggers on project switch.
 */

import { setConfig, chatList, loadProjectIcons } from '../api.js';
import { unwrapResult } from '../utils.js';
import { saveCurrentState, restoreState, startAutoSave, stopAutoSave } from './workspace-state.svelte.js';
import { tabsStore } from './tabs.svelte.js';

/** 8-color palette for project badges, picked by hashing the folder name */
const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

/**
 * Simple hash to pick a color index from a string.
 * @param {string} str
 * @returns {number}
 */
function hashToIndex(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % COLOR_PALETTE.length;
}

function createProjectStore() {
  let entries = $state([]);
  let activeIndex = $state(0);
  let sessions = $state([]);
  let iconCache = $state({});
  let persistTimer = null;

  return {
    get entries() { return entries; },
    get activeIndex() { return activeIndex; },
    get sessions() { return sessions; },
    /** Map of icon filename → base64 data URL */
    get iconCache() { return iconCache; },

    /** The currently active project entry, or null if none */
    get activeProject() {
      return entries[activeIndex] || null;
    },

    /** Shorthand for the active project's root path, or null */
    get root() {
      return this.activeProject?.path || null;
    },

    /**
     * Initialize from loaded config.
     * @param {{ entries?: Array, activeIndex?: number }} config
     */
    init(config) {
      entries = config.entries || [];
      activeIndex = config.activeIndex || 0;
      if (activeIndex >= entries.length) {
        activeIndex = 0;
      }
      // Load sessions for the active project
      if (entries.length > 0) {
        this.loadSessions();
        this._loadIcons();
      }
    },

    /**
     * Add a new project by path.
     * Extracts the folder name and assigns a color from the palette.
     * @param {string} path
     */
    addProject(path) {
      // Extract folder name (last path segment)
      const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
      const color = COLOR_PALETTE[hashToIndex(name)];
      entries = [...entries, {
        path,
        name,
        color,
        preferredServerUrl: null,
        lastBrowserUrl: null,
        autoStartServer: null,
      }];
      activeIndex = entries.length - 1;
      this._persist();
      this.loadSessions();
    },

    /**
     * Remove a project by index.
     * @param {number} index
     */
    async removeProject(index) {
      if (index < 0 || index >= entries.length) return;
      const wasActive = index === activeIndex;
      entries = entries.filter((_, i) => i !== index);
      // Adjust activeIndex if needed
      if (entries.length === 0) {
        activeIndex = 0;
      } else if (activeIndex >= entries.length) {
        activeIndex = entries.length - 1;
      } else if (index < activeIndex) {
        activeIndex = activeIndex - 1;
      }
      this._persist();
      if (entries.length > 0) {
        this.loadSessions();
        // If the removed project was active, clear stale tabs and restore new active project
        if (wasActive) {
          stopAutoSave();
          tabsStore.closeAll();
          const newProject = entries[activeIndex];
          if (newProject) {
            await restoreState(newProject.path);
            startAutoSave(newProject.path);
          }
        }
      } else {
        sessions = [];
        stopAutoSave();
        tabsStore.closeAll();
      }
    },

    /**
     * Switch to a different project by index.
     * @param {number} index
     */
    async setActive(index) {
      if (index < 0 || index >= entries.length) return;
      // Save current project's state before switching
      const oldProject = entries[activeIndex];
      if (oldProject) {
        stopAutoSave();
        await saveCurrentState(oldProject.path);
      }
      // Clear old tabs immediately to prevent flash of stale content
      tabsStore.closeAll();
      activeIndex = index;
      this._persist();
      this.loadSessions();
      // Restore new project's state
      const newProject = entries[activeIndex];
      if (newProject) {
        await restoreState(newProject.path);
        startAutoSave(newProject.path);
      }
    },

    /**
     * Load chat sessions filtered by the active project's path.
     */
    async loadSessions() {
      try {
        const result = await chatList();
        const all = unwrapResult(result) || [];
        const list = Array.isArray(all) ? all : [];
        const project = entries[activeIndex];
        if (project) {
          sessions = list.filter((s) => s.projectPath === project.path);
        } else {
          sessions = [];
        }
      } catch (err) {
        console.error('[project] Failed to load sessions:', err);
        sessions = [];
      }
    },

    /**
     * Update a single field on a project entry by index.
     * @param {number} index
     * @param {string} field
     * @param {*} value
     */
    updateProjectField(index, field, value) {
      if (entries[index]) {
        entries[index][field] = value;
        this._persist();
      }
    },

    /**
     * Update a field on the currently active project.
     * @param {string} field
     * @param {*} value
     */
    updateActiveField(field, value) {
      if (activeIndex >= 0 && activeIndex < entries.length) {
        entries[activeIndex][field] = value;
        this._persist();
      }
    },

    /**
     * Persist current state to config backend.
     * Calls setConfig() directly (not updateConfig) to avoid replacing
     * configStore.value, which would re-trigger every config-dependent
     * effect (PTT keys, DOM handlers, etc.) on every project switch.
     * Debounced to batch rapid-fire calls during switch flows.
     */
    _persist() {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        setConfig({
          projects: {
            entries,
            activeIndex,
          },
        }).catch((err) => {
          console.error('[project] Failed to persist:', err);
        });
      }, 100);
    },

    /** Load icon data URLs for all entries that have icons. */
    async _loadIcons() {
      const filenames = [...new Set(entries
        .map(e => e.icon)
        .filter(Boolean))];
      if (filenames.length === 0) return;
      try {
        const result = await loadProjectIcons(filenames);
        const data = unwrapResult(result);
        if (data?.icons) {
          iconCache = { ...iconCache, ...data.icons };
        }
      } catch (err) {
        console.error('[project] Failed to load icons:', err);
      }
    },

    /** Cache an icon data URL by filename. */
    setIconCache(filename, dataUrl) {
      iconCache = { ...iconCache, [filename]: dataUrl };
    },

    /** Remove an icon from the cache. */
    removeIconCache(filename) {
      const next = { ...iconCache };
      delete next[filename];
      iconCache = next;
    },
  };
}

export const projectStore = createProjectStore();
