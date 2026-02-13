/**
 * log.js - Renderer-side structured logging utility.
 * Provides tagged, level-based logging for browser/renderer process files.
 */

/**
 * Create a tagged logger for renderer-side code.
 * @param {string} tag - Tag prefix (e.g., '[Chat]', '[Settings]')
 * @returns {Object} Logger with info, warn, error, debug methods
 */
export function createLog(tag) {
    return {
        info: (...args) => console.log(tag, ...args),
        warn: (...args) => console.warn(tag, ...args),
        error: (...args) => console.error(tag, ...args),
        debug: (...args) => {
            if (window.__VOICE_MIRROR_DEBUG) console.log('[DEBUG]', tag, ...args);
        }
    };
}
