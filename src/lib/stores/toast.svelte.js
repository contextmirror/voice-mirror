/**
 * toast.js -- Svelte 5 reactive store for toast notifications.
 *
 * Manages a stack of toast messages with auto-dismiss and manual dismiss.
 * Severity levels: info, success, warning, error.
 */

import { uid } from '../utils.js';
import { configStore } from './config.svelte.js';

/**
 * @typedef {Object} Toast
 * @property {string} id - Unique toast ID
 * @property {string} message - Toast message text
 * @property {'info'|'success'|'warning'|'error'} severity - Visual style
 * @property {number} duration - Auto-dismiss duration in ms (0 = no auto-dismiss)
 * @property {{ label: string, callback: () => void }|null} action - Optional action button
 * @property {Array<{ label: string, callback: () => void }>|null} actions - Optional multiple action buttons
 * @property {string|null} key - Deduplication key
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

  /** Duration for toasts with multiple actions (gives user time to read and click) */
  const MULTI_ACTION_DURATION = 15000;

  /**
   * Add a toast notification.
   * @param {{ message: string, severity?: string, duration?: number, action?: { label: string, callback: () => void }|null, actions?: Array<{ label: string, callback: () => void }>|null, key?: string|null }} options
   * @returns {string} The toast ID
   */
  function addToast({
    message,
    severity = 'info',
    duration,
    action = null,
    actions = null,
    key = null,
  }) {
    // Respect the showToasts config setting (errors always shown)
    if (severity !== 'error' && configStore.value?.behavior?.showToasts === false) return null;

    // Deduplicate by key — dismiss existing toast with same key
    if (key) {
      const existing = toasts.find(t => t.key === key);
      if (existing) dismissToast(existing.id);
    }

    // Use longer duration for multi-action toasts unless explicitly set
    const effectiveDuration = duration !== undefined
      ? duration
      : (actions ? MULTI_ACTION_DURATION : DEFAULT_DURATION);

    const id = uid();
    const toast = {
      id,
      message,
      severity,
      duration: effectiveDuration,
      action,
      actions,
      key,
      createdAt: Date.now(),
    };

    // Trim oldest if over limit
    if (toasts.length >= MAX_TOASTS) {
      const oldest = toasts[0];
      dismissToast(oldest.id);
    }

    toasts = [...toasts, toast];
    scheduleDismiss(id, effectiveDuration);
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
