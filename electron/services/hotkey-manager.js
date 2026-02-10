/**
 * Bulletproof Global Hotkey Manager for Voice Mirror Electron.
 *
 * Dual-layer approach:
 *   1. uiohook-napi (OS-level input hooks — works on X11, Wayland, macOS, Windows)
 *   2. Electron globalShortcut (fallback, health-checked and auto-recovered)
 *
 * Both layers fire simultaneously → debounce deduplicates.
 * If one layer fails, the other catches the keypress.
 */

const { globalShortcut, powerMonitor } = require('electron');
const uiohookShared = require('./uiohook-shared');

// uiohook scan codes for modifier keys (left and right variants)
const MODIFIER_KEYCODES = {
    29: 'ctrl',    // Left Ctrl
    157: 'ctrl',   // Right Ctrl
    42: 'shift',   // Left Shift
    54: 'shift',   // Right Shift
    56: 'alt',     // Left Alt
    3640: 'alt',   // Right Alt (AltGr)
    3675: 'meta',  // Left Meta (Super/Cmd)
    3676: 'meta',  // Right Meta
};

// Map single-character key names to uiohook scan codes (US QWERTY layout)
const LETTER_KEYCODES = {
    a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35, i: 23,
    j: 36, k: 37, l: 38, m: 50, n: 49, o: 24, p: 25, q: 16, r: 19,
    s: 31, t: 20, u: 22, v: 47, w: 17, x: 45, y: 21, z: 44
};

const NUMBER_KEYCODES = {
    '0': 11, '1': 2, '2': 3, '3': 4, '4': 5,
    '5': 6, '6': 7, '7': 8, '8': 9, '9': 10
};

const NAMED_KEYCODES = {
    space: 57, enter: 28, return: 28, escape: 1, tab: 15,
    backspace: 14, delete: 111, insert: 110,
    up: 103, down: 108, left: 105, right: 106,
    arrowup: 103, arrowdown: 108, arrowleft: 105, arrowright: 106,
    home: 102, end: 107, pageup: 104, pagedown: 109,
    f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64,
    f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
    f13: 100, f14: 101, f15: 102,
    scrolllock: 70, pause: 119, capslock: 58, numlock: 69,
};

const DEBOUNCE_MS = 300;
const HEALTH_CHECK_INTERVAL_MS = 10000;
const RESUME_DELAY_MS = 2000;
const UNLOCK_DELAY_MS = 1000;

/**
 * Parse an Electron accelerator string into modifier flags + uiohook keycode.
 * e.g. "CommandOrControl+Shift+V" → { ctrl: true, shift: true, keycode: 47 }
 * On macOS, CommandOrControl maps to meta; on Linux/Windows to ctrl.
 *
 * @param {string} accelerator - Electron-style accelerator
 * @returns {{ modifiers: { ctrl: boolean, shift: boolean, alt: boolean, meta: boolean }, keycode: number|null }}
 */
function parseAccelerator(accelerator) {
    const isMac = process.platform === 'darwin';
    const parts = accelerator.split('+').map(p => p.trim());
    const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
    let keycode = null;

    for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === 'commandorcontrol' || lower === 'cmdorctrl') {
            if (isMac) modifiers.meta = true;
            else modifiers.ctrl = true;
        } else if (lower === 'control' || lower === 'ctrl') {
            modifiers.ctrl = true;
        } else if (lower === 'shift') {
            modifiers.shift = true;
        } else if (lower === 'alt' || lower === 'option') {
            modifiers.alt = true;
        } else if (lower === 'command' || lower === 'cmd' || lower === 'meta' || lower === 'super') {
            modifiers.meta = true;
        } else {
            // This is the main key
            if (NAMED_KEYCODES[lower] !== undefined) {
                keycode = NAMED_KEYCODES[lower];
            } else if (lower.length === 1 && LETTER_KEYCODES[lower]) {
                keycode = LETTER_KEYCODES[lower];
            } else if (lower.length === 1 && NUMBER_KEYCODES[lower] !== undefined) {
                keycode = NUMBER_KEYCODES[lower];
            }
        }
    }

    return { modifiers, keycode };
}

/**
 * Create a hotkey manager instance.
 * @param {Object} [options]
 * @param {Function} [options.log] - Logger function (category, message)
 * @returns {Object} Hotkey manager API
 */
function createHotkeyManager(options = {}) {
    const log = options.log || ((cat, msg) => console.log(`[${cat}]`, msg));

    // State: id → { accelerator, callback, parsed, uiohookActive, globalShortcutActive, lastTriggered }
    const bindings = new Map();

    // Current modifier state tracked via uiohook keydown/keyup
    const modifierState = { ctrl: false, shift: false, alt: false, meta: false };

    let healthCheckInterval = null;
    let uiohookListenersAttached = false;
    let initialized = false;

    // --- uiohook key event handlers ---

    function onKeyDown(e) {
        const mod = MODIFIER_KEYCODES[e.keycode];
        if (mod) {
            modifierState[mod] = true;
            return;
        }
        // Check all bindings for a match
        for (const [id, binding] of bindings) {
            if (!binding.parsed.keycode || binding.parsed.keycode !== e.keycode) continue;
            if (!modifiersMatch(binding.parsed.modifiers)) continue;
            fireBinding(binding, 'uiohook');
        }
    }

    function onKeyUp(e) {
        const mod = MODIFIER_KEYCODES[e.keycode];
        if (mod) {
            modifierState[mod] = false;
        }
    }

    function modifiersMatch(required) {
        return (
            required.ctrl === modifierState.ctrl &&
            required.shift === modifierState.shift &&
            required.alt === modifierState.alt &&
            required.meta === modifierState.meta
        );
    }

    function fireBinding(binding, source) {
        const now = Date.now();
        if (now - binding.lastTriggered < DEBOUNCE_MS) return;
        binding.lastTriggered = now;
        log('HOTKEY', `Triggered "${binding.id}" via ${source}`);
        try {
            binding.callback();
        } catch (err) {
            log('HOTKEY', `Error in callback for "${binding.id}": ${err.message}`);
        }
    }

    // --- uiohook setup ---

    function setupUiohook() {
        // Subscribe to restart events so we can reattach listeners
        uiohookShared.on('restarted', () => {
            log('HOTKEY', 'uiohook restarted — reattaching key listeners');
            uiohookListenersAttached = false;
            attachKeyListeners();
        });

        attachKeyListeners();
    }

    function attachKeyListeners() {
        if (uiohookListenersAttached) return;
        const hook = uiohookShared.getHook();
        if (!hook) return;

        hook.on('keydown', onKeyDown);
        hook.on('keyup', onKeyUp);
        uiohookListenersAttached = true;

        uiohookShared.ensureStarted();
        log('HOTKEY', 'uiohook key listeners attached');
    }

    // --- Electron globalShortcut layer ---

    function registerGlobalShortcut(binding) {
        try {
            const ok = globalShortcut.register(binding.accelerator, () => {
                fireBinding(binding, 'globalShortcut');
            });
            binding.globalShortcutActive = ok;
            return ok;
        } catch (err) {
            log('HOTKEY', `globalShortcut.register("${binding.accelerator}") threw: ${err.message}`);
            binding.globalShortcutActive = false;
            return false;
        }
    }

    function unregisterGlobalShortcut(accelerator) {
        try {
            globalShortcut.unregister(accelerator);
        } catch {
            // Ignore — may not have been registered
        }
    }

    // --- Health check: re-register globalShortcut if lost ---

    function startHealthCheck() {
        stopHealthCheck();
        healthCheckInterval = setInterval(() => {
            for (const [id, binding] of bindings) {
                const registered = globalShortcut.isRegistered(binding.accelerator);
                if (!registered) {
                    log('HOTKEY', `Health check: "${id}" lost globalShortcut registration, re-registering`);
                    registerGlobalShortcut(binding);
                }
            }
            // Also check if uiohook died and hasn't auto-recovered
            if (uiohookShared.isAvailable() && !uiohookShared.isStarted()) {
                log('HOTKEY', 'Health check: uiohook not started, forcing restart');
                uiohookShared.restart();
            }
        }, HEALTH_CHECK_INTERVAL_MS);
    }

    function stopHealthCheck() {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
        }
    }

    // --- Power/display recovery ---

    let _onResume = null;
    let _onUnlock = null;

    function setupPowerMonitor() {
        _onResume = () => {
            log('HOTKEY', 'System resumed from sleep — re-registering shortcuts in 2s');
            setTimeout(() => reRegisterAll(), RESUME_DELAY_MS);
        };
        _onUnlock = () => {
            log('HOTKEY', 'Screen unlocked — re-registering shortcuts in 1s');
            setTimeout(() => reRegisterAll(), UNLOCK_DELAY_MS);
        };
        powerMonitor.on('resume', _onResume);
        powerMonitor.on('unlock-screen', _onUnlock);
    }

    function reRegisterAll() {
        for (const [id, binding] of bindings) {
            unregisterGlobalShortcut(binding.accelerator);
            const ok = registerGlobalShortcut(binding);
            log('HOTKEY', `Re-registered "${id}": globalShortcut=${ok}`);
        }
    }

    // --- Public API ---

    /**
     * Initialize the hotkey manager. Call once after app is ready.
     */
    function init() {
        if (initialized) return;
        initialized = true;
        setupUiohook();
        setupPowerMonitor();
        startHealthCheck();
        log('HOTKEY', `Initialized (uiohook=${uiohookShared.isAvailable()}, platform=${process.platform})`);
    }

    /**
     * Register a global hotkey.
     * @param {string} id - Unique identifier (e.g. 'toggle-panel')
     * @param {string} accelerator - Electron accelerator string (e.g. 'CommandOrControl+Shift+V')
     * @param {Function} callback - Function to call when hotkey fires
     * @returns {boolean} true if at least one layer registered successfully
     */
    function register(id, accelerator, callback) {
        unregister(id);

        const parsed = parseAccelerator(accelerator);
        const binding = {
            id,
            accelerator,
            callback,
            parsed,
            uiohookActive: uiohookShared.isAvailable() && parsed.keycode !== null,
            globalShortcutActive: false,
            lastTriggered: 0,
        };

        bindings.set(id, binding);

        // Register globalShortcut layer
        registerGlobalShortcut(binding);

        const anyActive = binding.uiohookActive || binding.globalShortcutActive;
        log('HOTKEY', `Registered "${id}": ${accelerator} [uiohook=${binding.uiohookActive}, globalShortcut=${binding.globalShortcutActive}]`);

        if (!anyActive) {
            log('HOTKEY', `WARNING: "${id}" has no active layer! Hotkey will not work.`);
        }

        return anyActive;
    }

    /**
     * Unregister a hotkey by id.
     * @param {string} id
     */
    function unregister(id) {
        const binding = bindings.get(id);
        if (!binding) return;
        unregisterGlobalShortcut(binding.accelerator);
        bindings.delete(id);
    }

    /**
     * Update a binding's accelerator. Rolls back to old accelerator if new one fails.
     * @param {string} id
     * @param {string} newAccelerator
     * @param {Function} callback
     * @returns {boolean} true if new accelerator registered, false if rolled back
     */
    function updateBinding(id, newAccelerator, callback) {
        const old = bindings.get(id);
        const oldAccelerator = old?.accelerator;

        const ok = register(id, newAccelerator, callback);
        if (!ok && oldAccelerator && oldAccelerator !== newAccelerator) {
            log('HOTKEY', `Failed to register "${newAccelerator}", rolling back to "${oldAccelerator}"`);
            register(id, oldAccelerator, callback);
            return false;
        }
        return ok;
    }

    /**
     * Get a binding by id (for fallback checks).
     * @param {string} id
     * @returns {Object|undefined}
     */
    function getBinding(id) {
        return bindings.get(id);
    }

    /**
     * Destroy the hotkey manager. Call on app shutdown.
     */
    function destroy() {
        stopHealthCheck();
        // Remove powerMonitor listeners to prevent leaks
        if (_onResume) { powerMonitor.removeListener('resume', _onResume); _onResume = null; }
        if (_onUnlock) { powerMonitor.removeListener('unlock-screen', _onUnlock); _onUnlock = null; }
        for (const [id, binding] of bindings) {
            unregisterGlobalShortcut(binding.accelerator);
        }
        bindings.clear();
        initialized = false;
        log('HOTKEY', 'Destroyed');
    }

    return {
        init,
        register,
        unregister,
        updateBinding,
        reRegisterAll,
        getBinding,
        destroy,
    };
}

module.exports = { createHotkeyManager };
