/**
 * navigation.js -- Svelte 5 reactive store for navigation state.
 *
 * Manages the active view and sidebar collapsed state.
 * Persists sidebar state to config backend.
 */

import { updateConfig } from './config.svelte.js';

/** Valid view identifiers */
const VALID_VIEWS = ['chat', 'terminal', 'lens', 'settings'];

/** Valid app mode identifiers */
const VALID_MODES = ['mirror', 'lens'];

/**
 * Reactive navigation store.
 * Access state via navigationStore.activeView and navigationStore.sidebarCollapsed.
 */
function createNavigationStore() {
  let activeView = $state('chat');
  let sidebarCollapsed = $state(false);
  let appMode = $state('mirror');

  return {
    get activeView() { return activeView; },
    get sidebarCollapsed() { return sidebarCollapsed; },
    get appMode() { return appMode; },

    /**
     * Switch to a different view.
     * @param {'chat'|'terminal'|'lens'|'settings'} view
     */
    setView(view) {
      if (!VALID_VIEWS.includes(view)) {
        console.warn(`[navigation] Invalid view: ${view}`);
        return;
      }
      activeView = view;
    },

    /**
     * Toggle sidebar collapsed state and persist to config.
     */
    toggleSidebar() {
      sidebarCollapsed = !sidebarCollapsed;
      // Persist to backend (fire-and-forget)
      updateConfig({ sidebar: { collapsed: sidebarCollapsed } }).catch((err) => {
        console.error('[navigation] Failed to persist sidebar state:', err);
      });
    },

    /**
     * Initialize sidebar state from loaded config.
     * Call this after config is loaded.
     * @param {boolean} collapsed
     */
    initSidebarState(collapsed) {
      sidebarCollapsed = !!collapsed;
    },

    /**
     * Switch app mode and navigate to the appropriate view.
     * Persists the mode to config backend.
     * @param {'mirror'|'lens'} mode
     */
    setMode(mode) {
      if (!VALID_MODES.includes(mode)) {
        console.warn(`[navigation] Invalid mode: ${mode}`);
        return;
      }
      appMode = mode;
      if (mode === 'mirror') {
        activeView = 'chat';
      } else if (mode === 'lens') {
        activeView = 'lens';
      }
      updateConfig({ sidebar: { mode } }).catch((err) => {
        console.error('[navigation] Failed to persist mode:', err);
      });
    },

    /**
     * Initialize app mode from loaded config (no persistence).
     * @param {'mirror'|'lens'} mode
     */
    initMode(mode) {
      if (VALID_MODES.includes(mode)) {
        appMode = mode;
        if (mode === 'lens') {
          activeView = 'lens';
        }
      }
    },
  };
}

export const navigationStore = createNavigationStore();
export { VALID_VIEWS, VALID_MODES };
