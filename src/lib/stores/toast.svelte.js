/**
 * toast.js -- Svelte 5 reactive store for toast notifications.
 *
 * Manages a stack of toast messages with auto-dismiss and manual dismiss.
 * Severity levels: info, success, warning, error.
 */

import { uid } from '../utils.js';

/**
 * @typedef {Object} Toast
 * @property {string} id - Unique toast ID
 * @property {string} message - Toast message text
 * @property {'info'|'success'|'warning'|'error'} severity - Visual style
 * @property {number} duration - Auto-dismiss duration in ms (0 = no auto-dismiss)
 * @property {{ label: string, callback: () => void }|null} action - Optional action button
 * @property {number} createdAt - Creation timestamp
 */

const DEFAULT_DURATION = 5000;
const MAX_TOASTS = 5;

function createToastStore() {
  let toasts = $state([]);

  /** @type {Map<string, number>} Active dismiss timers */
  const timers = new Map();

  /**
   * Schedule auto-dismiss for a toast.
   * @param {string} id
   * @param {number} duration
   */
  function scheduleDismiss(id, duration) {
    if (duration <= 0) return;
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, duration);
    timers.set(id, timer);
  }

  /**
   * Add a toast notification.
   * @param {{ message: string, severity?: string, duration?: number, action?: { label: string, callback: () => void } }} options
   * @returns {string} The toast ID
   */
  function addToast({
    message,
    severity = 'info',
    duration = DEFAULT_DURATION,
    action = null,
  }) {
    const id = uid();
    const toast = {
      id,
      message,
      severity,
      duration,
      action,
      createdAt: Date.now(),
    };

    // Trim oldest if over limit
    if (toasts.length >= MAX_TOASTS) {
      const oldest = toasts[0];
      dismissToast(oldest.id);
    }

    toasts = [...toasts, toast];
    scheduleDismiss(id, duration);
    return id;
  }

  /**
   * Dismiss (remove) a toast by ID.
   * @param {string} id
   */
  function dismissToast(id) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    toasts = toasts.filter((t) => t.id !== id);
  }

  /**
   * Dismiss all toasts.
   */
  function dismissAll() {
    for (const [, timer] of timers) {
      clearTimeout(timer);
    }
    timers.clear();
    toasts = [];
  }

  return {
    get toasts() { return toasts; },
    addToast,
    dismissToast,
    dismissAll,
  };
}

export const toastStore = createToastStore();
