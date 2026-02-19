/**
 * shortcuts.js -- Svelte 5 reactive store for keyboard shortcuts.
 *
 * Manages global hotkey registration via Tauri's global-shortcut plugin
 * and dispatches actions when shortcuts fire. Also handles in-app keyboard
 * shortcuts (Ctrl+N, Ctrl+T, Ctrl+,, Escape) via DOM keydown listeners.
 */

import { listen } from '@tauri-apps/api/event';
import {
  registerShortcut,
  unregisterShortcut,
  unregisterAllShortcuts,
} from '../api.js';
import { navigationStore } from './navigation.svelte.js';
import { overlayStore } from './overlay.svelte.js';

// ============ Default Shortcuts ============

/**
 * Default global shortcut definitions.
 * These require the Tauri global-shortcut plugin.
 *
 * Each entry maps a shortcut ID to its default key combination
 * and the action to invoke when triggered.
 */
export const DEFAULT_GLOBAL_SHORTCUTS = {
  'toggle-voice': {
    keys: 'Ctrl+Shift+Space',
    label: 'Toggle voice recording',
    category: 'global',
  },
  'toggle-mute': {
    keys: 'Ctrl+Shift+M',
    label: 'Toggle mute',
    category: 'global',
  },
  'toggle-overlay': {
    keys: 'Ctrl+Shift+O',
    label: 'Toggle overlay mode',
    category: 'global',
  },
  'toggle-window': {
    keys: 'Ctrl+Shift+H',
    label: 'Show/hide window',
    category: 'global',
  },
  'stats-dashboard': {
    keys: 'Ctrl+Shift+M',
    label: 'Toggle stats dashboard',
    category: 'global',
  },
};

/**
 * In-app shortcuts handled via DOM keydown events.
 * These do NOT require global registration.
 */
export const IN_APP_SHORTCUTS = {
  'open-settings': {
    keys: 'Ctrl+,',
    label: 'Open settings',
    category: 'in-app',
  },
  'new-chat': {
    keys: 'Ctrl+N',
    label: 'New chat',
    category: 'in-app',
  },
  'switch-terminal': {
    keys: 'Ctrl+T',
    label: 'Switch to terminal',
    category: 'in-app',
  },
  'close-panel': {
    keys: 'Escape',
    label: 'Close current panel/modal',
    category: 'in-app',
  },
};

// ============ Action Handlers ============

/**
 * Map of shortcut IDs to action functions dispatched on key PRESS.
 * Functions can be overridden via setActionHandler().
 */
const actionHandlers = {
  // Global shortcuts -- stubbed by default; real implementations are set
  // by the app after voice/window services are initialized.
  'toggle-voice': () => {
    console.log('[shortcuts] toggle-voice pressed (no handler set)');
  },
  'toggle-mute': () => {
    console.log('[shortcuts] toggle-mute triggered (no handler set)');
  },
  'toggle-overlay': () => {
    overlayStore.toggleOverlay();
  },
  'toggle-window': () => {
    console.log('[shortcuts] toggle-window triggered (no handler set)');
  },
  'stats-dashboard': () => {
    console.log('[shortcuts] stats-dashboard triggered (no handler set)');
  },

  // In-app shortcuts -- wired to navigation store (press only)
  'open-settings': () => {
    navigationStore.setView('settings');
  },
  'new-chat': () => {
    navigationStore.setView('chat');
    // Dispatch a custom DOM event that ChatPanel can listen for
    window.dispatchEvent(new CustomEvent('shortcut:new-chat'));
  },
  'switch-terminal': () => {
    navigationStore.setView('terminal');
  },
  'close-panel': () => {
    // If settings is open, go back to chat; otherwise do nothing
    if (navigationStore.activeView === 'settings') {
      navigationStore.setView('chat');
    }
    // Dispatch for modal handling
    window.dispatchEvent(new CustomEvent('shortcut:close-panel'));
  },
};

/**
 * Map of shortcut IDs to action functions dispatched on key RELEASE.
 * Used for PTT mode where press = start recording, release = stop.
 */
const releaseHandlers = {};

// ============ Store ============

function createShortcutsStore() {
  /** Map of shortcut ID -> { keys, label, category, active } */
  let bindings = $state({});
  let initialized = $state(false);
  let error = $state(null);

  /** Tauri event unlisten function */
  let unlistenEvent = null;

  return {
    get bindings() { return bindings; },
    get initialized() { return initialized; },
    get error() { return error; },

    /**
     * Initialize shortcuts from config and register global hotkeys.
     * Call this after config is loaded.
     *
     * @param {Object} shortcutsConfig - The `shortcuts` section from config.
     */
    async init(shortcutsConfig) {
      if (initialized) return;

      // Build bindings from config, falling back to defaults
      const configMap = shortcutsConfig || {};
      const newBindings = {};

      // Global shortcuts
      for (const [id, def] of Object.entries(DEFAULT_GLOBAL_SHORTCUTS)) {
        // Config key is camelCase version of the ID (e.g. "toggle-voice" -> "toggleVoice")
        const configKey = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const keys = configMap[configKey] || def.keys;
        newBindings[id] = {
          keys,
          label: def.label,
          category: def.category,
          active: false,
        };
      }

      // In-app shortcuts (not configurable via config currently, but tracked)
      for (const [id, def] of Object.entries(IN_APP_SHORTCUTS)) {
        newBindings[id] = {
          keys: def.keys,
          label: def.label,
          category: def.category,
          active: true, // Always active (DOM-based)
        };
      }

      bindings = newBindings;

      // Listen for Tauri shortcut press and release events
      let unlistenPress = null;
      let unlistenRelease = null;
      try {
        unlistenPress = await listen('shortcut-pressed', (event) => {
          const { id } = event.payload;
          console.log('[shortcuts] Global shortcut pressed:', id);
          const handler = actionHandlers[id];
          if (handler) {
            handler();
          } else {
            console.warn('[shortcuts] No press handler for shortcut:', id);
          }
        });

        unlistenRelease = await listen('shortcut-released', (event) => {
          const { id } = event.payload;
          console.log('[shortcuts] Global shortcut released:', id);
          const handler = releaseHandlers[id];
          if (handler) {
            handler();
          }
          // No warning for missing release handlers — most shortcuts don't use them
        });

        unlistenEvent = () => {
          if (unlistenPress) unlistenPress();
          if (unlistenRelease) unlistenRelease();
        };
      } catch (err) {
        console.error('[shortcuts] Failed to listen for shortcut events:', err);
        error = String(err);
      }

      // Register global shortcuts with the backend
      for (const [id, binding] of Object.entries(newBindings)) {
        if (binding.category !== 'global') continue;
        try {
          const result = await registerShortcut(id, binding.keys);
          if (result && result.success !== false) {
            bindings[id] = { ...bindings[id], active: true };
          } else {
            console.warn(`[shortcuts] Failed to register ${id}:`, result?.error);
          }
        } catch (err) {
          console.warn(`[shortcuts] Failed to register ${id}:`, err);
        }
      }

      initialized = true;
      console.log('[shortcuts] Initialized with', Object.keys(newBindings).length, 'shortcuts');
    },

    /**
     * Re-bind a shortcut to a new key combination.
     * Unregisters the old global shortcut and registers the new one.
     *
     * @param {string} id - Shortcut ID.
     * @param {string} newKeys - New key combination string.
     */
    async rebind(id, newKeys) {
      const binding = bindings[id];
      if (!binding) {
        console.warn('[shortcuts] Cannot rebind unknown shortcut:', id);
        return { success: false, error: 'Unknown shortcut' };
      }

      const oldKeys = binding.keys;

      // For global shortcuts, unregister old and register new
      if (binding.category === 'global') {
        try {
          await unregisterShortcut(id);
        } catch (err) {
          console.warn(`[shortcuts] Failed to unregister old binding for ${id}:`, err);
        }

        try {
          const result = await registerShortcut(id, newKeys);
          if (result && result.success !== false) {
            bindings[id] = { ...binding, keys: newKeys, active: true };
            return { success: true };
          } else {
            // Restore old binding
            await registerShortcut(id, oldKeys).catch(() => {});
            bindings[id] = { ...binding, active: true };
            return { success: false, error: result?.error || 'Registration failed' };
          }
        } catch (err) {
          // Restore old binding
          await registerShortcut(id, oldKeys).catch(() => {});
          bindings[id] = { ...binding, active: true };
          return { success: false, error: String(err) };
        }
      }

      // In-app shortcuts just update the binding (DOM matching is handled elsewhere)
      bindings[id] = { ...binding, keys: newKeys };
      return { success: true };
    },

    /**
     * Clean up all global shortcuts and event listeners.
     * Call this when the app is shutting down.
     */
    async destroy() {
      if (unlistenEvent) {
        unlistenEvent();
        unlistenEvent = null;
      }

      try {
        await unregisterAllShortcuts();
      } catch (err) {
        console.warn('[shortcuts] Failed to unregister all shortcuts:', err);
      }

      // Mark all global shortcuts as inactive
      for (const [id, binding] of Object.entries(bindings)) {
        if (binding.category === 'global') {
          bindings[id] = { ...binding, active: false };
        }
      }

      initialized = false;
    },
  };
}

export const shortcutsStore = createShortcutsStore();

// ============ Action Handler Registration ============

/**
 * Set or override an action handler for a shortcut ID.
 * Call this from the app to wire up real implementations
 * (e.g. connect "toggle-voice" to the voice engine).
 *
 * @param {string} id - Shortcut ID.
 * @param {Function} handler - Action function to call when the shortcut fires.
 */
export function setActionHandler(id, handler) {
  if (typeof handler !== 'function') {
    console.warn('[shortcuts] Handler must be a function for:', id);
    return;
  }
  actionHandlers[id] = handler;
}

/**
 * Set or override a RELEASE handler for a shortcut ID.
 * Used for push-to-talk where key release stops recording.
 *
 * @param {string} id - Shortcut ID.
 * @param {Function} handler - Action function to call when the shortcut is released.
 */
export function setReleaseHandler(id, handler) {
  if (typeof handler !== 'function') {
    console.warn('[shortcuts] Release handler must be a function for:', id);
    return;
  }
  releaseHandlers[id] = handler;
}

/**
 * Get the current action handler for a shortcut ID.
 * @param {string} id
 * @returns {Function|undefined}
 */
export function getActionHandler(id) {
  return actionHandlers[id];
}

// ============ In-App Keyboard Handler ============

/**
 * Set up DOM keydown listener for in-app shortcuts.
 * Returns a cleanup function to remove the listener.
 *
 * This should be called once from App.svelte's $effect.
 */
export function setupInAppShortcuts() {
  function handleKeydown(event) {
    // Don't intercept shortcuts when user is typing in an input/textarea
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) {
      // Only allow Escape in input fields
      if (event.key !== 'Escape') return;
    }

    const ctrl = event.ctrlKey || event.metaKey;

    // Ctrl+, -> Open settings
    if (ctrl && event.key === ',') {
      event.preventDefault();
      actionHandlers['open-settings']?.();
      return;
    }

    // Ctrl+N -> New chat
    if (ctrl && event.key === 'n') {
      event.preventDefault();
      actionHandlers['new-chat']?.();
      return;
    }

    // Ctrl+T -> Switch to terminal
    if (ctrl && event.key === 't') {
      event.preventDefault();
      actionHandlers['switch-terminal']?.();
      return;
    }

    // Escape -> Close panel/modal
    if (event.key === 'Escape') {
      event.preventDefault();
      actionHandlers['close-panel']?.();
      return;
    }
  }

  window.addEventListener('keydown', handleKeydown);

  return () => {
    window.removeEventListener('keydown', handleKeydown);
  };
}
