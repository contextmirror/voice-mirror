/**
 * workspace-state.svelte.js -- Orchestrator for per-project workspace persistence.
 *
 * Collects state from tabs, editor-groups, and layout stores.
 * Saves on project switch, app close, and 60s debounce timer.
 * Restores on app startup and project switch.
 */

import { tabsStore } from './tabs.svelte.js';
import { editorGroupsStore } from './editor-groups.svelte.js';
import { layoutStore } from './layout.svelte.js';
import { saveWorkspaceState, loadWorkspaceState } from '../api.js';
import { unwrapResult } from '../utils.js';

const STATE_VERSION = 1;
const AUTO_SAVE_DELAY = 60_000; // 60 seconds

let autoSaveTimer = null;
let currentProjectPath = null;

/**
 * Emit a DOM event to tell all mounted FileEditors to write their
 * cursor/scroll state onto their tab objects via tabsStore.updateTabMeta().
 */
function captureEditorState() {
  window.dispatchEvent(new CustomEvent('workspace-state:capture'));
}

/**
 * Collect the full workspace state from all stores.
 * @returns {Object} Serializable state JSON
 */
function collectState() {
  return {
    version: STATE_VERSION,
    tabs: tabsStore.serialize(),
    activeTabId: tabsStore.activeTabId || null,
    groups: editorGroupsStore.serialize(),
    layout: layoutStore.serialize(),
  };
}

/**
 * Save the current workspace state for a project.
 * @param {string} projectPath - Absolute project path
 */
export async function saveCurrentState(projectPath) {
  if (!projectPath) return;
  try {
    captureEditorState();
    // Small delay to let FileEditors respond to the capture event
    await new Promise(r => setTimeout(r, 10));
    const state = collectState();
    await saveWorkspaceState(projectPath, state);
  } catch (err) {
    console.warn('[workspace-state] Failed to save:', err);
  }
}

/**
 * Restore workspace state for a project.
 * @param {string} projectPath - Absolute project path
 */
export async function restoreState(projectPath) {
  if (!projectPath) return;
  try {
    const result = await loadWorkspaceState(projectPath);
    const data = unwrapResult(result);
    if (!data || data.version == null) {
      // No saved state — start fresh (close any leftover tabs)
      tabsStore.closeAll();
      return;
    }

    // Restore order matters: groups first (creates group IDs),
    // then tabs (assigns to groups), then layout
    editorGroupsStore.restore(data.groups);
    tabsStore.restore(data.tabs);
    layoutStore.restore(data.layout);

    // Restore active tab (uses tab ID for multi-group correctness)
    if (data.activeTabId) {
      tabsStore.setActiveQuiet(data.activeTabId);
    } else if (data.activeTabPath) {
      // Backwards compat with older state files that used path
      const activeTab = tabsStore.tabs.find(t => t.path === data.activeTabPath);
      if (activeTab) {
        tabsStore.setActiveQuiet(activeTab.id);
      }
    }
  } catch (err) {
    console.warn('[workspace-state] Failed to restore:', err);
  }
}

/**
 * Start listening for auto-save. Call notifyChange() whenever
 * tab/split/layout state changes to trigger a debounced save.
 * @param {string} projectPath
 */
export function startAutoSave(projectPath) {
  stopAutoSave();
  currentProjectPath = projectPath;
}

/**
 * Stop the auto-save timer and clear the project path.
 */
export function stopAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  currentProjectPath = null;
}

/**
 * Notify that workspace state has changed. Debounces saves —
 * resets the 60s timer on each call, fires after 60s of no changes.
 */
export function notifyChange() {
  if (!currentProjectPath) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (currentProjectPath) {
      saveCurrentState(currentProjectPath);
    }
  }, AUTO_SAVE_DELAY);
}
