/**
 * navigation.js -- Svelte 5 reactive store for navigation state.
 *
 * Manages the active view and sidebar collapsed state.
 * Persists sidebar state to config backend.
 */

import { updateConfig } from './config.svelte.js';

/** Valid view identifiers */
const VALID_VIEWS = ['chat', 'terminal', 'browser', 'settings'];

/**
 * Reactive navigation store.
 * Access state via navigationStore.activeView and navigationStore.sidebarCollapsed.
 */
function createNavigationStore() {
  let activeView = $state('chat');
  let sidebarCollapsed = $state(false);

  return {
    get activeView() { return activeView; },
    get sidebarCollapsed() { return sidebarCollapsed; },

    /**
     * Switch to a different view.
     * @param {'chat'|'terminal'|'browser'|'settings'} view
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
  };
}

export const navigationStore = createNavigationStore();
export { VALID_VIEWS };
