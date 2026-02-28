/**
 * navigation-history.svelte.js -- Svelte 5 reactive store for editor navigation history.
 *
 * Tracks explicit navigation jumps (go-to-definition, go-to-line, find-references)
 * to enable Alt+Left (back) and Alt+Right (forward) navigation.
 * Does NOT track every cursor movement — only intentional jumps.
 */

const MAX_HISTORY = 50;

/**
 * @typedef {Object} NavLocation
 * @property {string} path - File path (project-relative)
 * @property {number} line - Zero-based line number
 * @property {number} character - Zero-based character offset
 * @property {number} groupId - Editor group ID
 */

function createNavigationHistoryStore() {
  /** @type {NavLocation[]} */
  let stack = $state([]);
  let currentIndex = $state(-1);

  return {
    get canGoBack() { return currentIndex > 0; },
    get canGoForward() { return currentIndex < stack.length - 1; },

    /**
     * Push a location onto the navigation stack.
     * Call this BEFORE performing a navigation jump (go-to-def, go-to-line, etc.)
     * to record the departure point.
     * @param {NavLocation} location
     */
    pushLocation(location) {
      if (!location?.path) return;

      // If not at the top of the stack, truncate forward history
      if (currentIndex < stack.length - 1) {
        stack.splice(currentIndex + 1);
      }

      // Deduplicate: skip if same position as top of stack
      const top = stack[stack.length - 1];
      if (top && top.path === location.path && top.line === location.line && top.character === location.character) {
        return;
      }

      stack.push({
        path: location.path,
        line: location.line,
        character: location.character,
        groupId: location.groupId,
      });

      // Trim if over limit
      if (stack.length > MAX_HISTORY) {
        stack.splice(0, stack.length - MAX_HISTORY);
      }

      currentIndex = stack.length - 1;
    },

    /**
     * Go back in navigation history.
     * @returns {NavLocation|null} The location to navigate to, or null if at start
     */
    goBack() {
      if (currentIndex <= 0) return null;
      currentIndex -= 1;
      return { ...stack[currentIndex] };
    },

    /**
     * Go forward in navigation history.
     * @returns {NavLocation|null} The location to navigate to, or null if at end
     */
    goForward() {
      if (currentIndex >= stack.length - 1) return null;
      currentIndex += 1;
      return { ...stack[currentIndex] };
    },

    /** Clear all history. */
    clear() {
      stack.length = 0;
      currentIndex = -1;
    },
  };
}

export const navigationHistoryStore = createNavigationHistoryStore();
