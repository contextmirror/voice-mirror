/**
 * project.svelte.js -- Svelte 5 reactive store for project management.
 *
 * Tracks project entries (path, name, color) and the active project index.
 * Persists to config backend via updateConfig().
 */

import { updateConfig } from './config.svelte.js';
import { chatList } from '../api.js';

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

  return {
    get entries() { return entries; },
    get activeIndex() { return activeIndex; },
    get sessions() { return sessions; },

    /** The currently active project entry, or null if none */
    get activeProject() {
      return entries[activeIndex] || null;
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
      entries = [...entries, { path, name, color }];
      activeIndex = entries.length - 1;
      this._persist();
      this.loadSessions();
    },

    /**
     * Remove a project by index.
     * @param {number} index
     */
    removeProject(index) {
      if (index < 0 || index >= entries.length) return;
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
      } else {
        sessions = [];
      }
    },

    /**
     * Switch to a different project by index.
     * @param {number} index
     */
    setActive(index) {
      if (index < 0 || index >= entries.length) return;
      activeIndex = index;
      this._persist();
      this.loadSessions();
    },

    /**
     * Load chat sessions filtered by the active project's path.
     */
    async loadSessions() {
      try {
        const result = await chatList();
        const all = result?.data || result || [];
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

    /** Persist current state to config backend */
    _persist() {
      updateConfig({
        projects: {
          entries,
          activeIndex,
        },
      }).catch((err) => {
        console.error('[project] Failed to persist:', err);
      });
    },
  };
}

export const projectStore = createProjectStore();
