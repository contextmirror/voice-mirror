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
 * Format timestamp as HH:MM:SS for log output.
 * @param {number|string|Date} ts
 * @returns {string}
 */
export function formatLogTime(ts) {
  return new Date(ts).toTimeString().slice(0, 8);
}

/**
 * Format timestamp as relative time (just now, Xm ago, Xh ago, Xd ago).
 * @param {number} ts - Epoch milliseconds
 * @returns {string}
 */
export function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Generate a unique ID.
 * @returns {string}
 */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Unwrap a Tauri IPC result that may be { data } or the value directly.
 * @param {*} result - The IPC result to unwrap
 * @param {*} [fallback=null] - Value to return if result is null/undefined
 * @returns {*} The unwrapped value
 */
export function unwrapResult(result, fallback = null) {
  if (result == null) return fallback;
  return result.data !== undefined ? result.data : result;
}

/**
 * Extract the filename (last segment) from a path string.
 * Handles both `/` and `\` separators.
 * @param {string} path
 * @returns {string}
 */
export function basename(path) {
  return path?.split(/[/\\]/).pop() || path;
}

/**
 * Copy the full OS path (with backslashes on Windows) to clipboard.
 * @param {string} relativePath
 * @param {string} [root]
 */
export function copyFullPath(relativePath, root) {
  const full = root ? `${root}/${relativePath}` : relativePath;
  navigator.clipboard.writeText(full.replace(/\//g, '\\'));
}

/**
 * Copy the relative path to clipboard.
 * @param {string} relativePath
 */
export function copyRelativePath(relativePath) {
  navigator.clipboard.writeText(relativePath);
}
