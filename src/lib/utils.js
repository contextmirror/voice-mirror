/**
 * utils.js -- Shared utility functions.
 */

/**
 * Deep merge two objects. Source values override target.
 * @param {Object} target
 * @param {Object} source
 * @returns {Object} Merged result (new object)
 */
export function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Format a timestamp for display.
 * @param {number|string|Date} timestamp
 * @returns {string} Formatted time string (e.g. "2:34 PM")
 */
export function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Generate a unique ID.
 * @returns {string}
 */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
