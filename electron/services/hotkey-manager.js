/**
 * Global Hotkey Manager for Voice Mirror Electron.
 *
 * Uses Electron globalShortcut (RegisterHotKey on Windows) with
 * health-checked auto-recovery after sleep/unlock.
 *
 * PTT is handled separately by the voice backend.
 */

const { globalShortcut, powerMonitor } = require('electron');
const { createLogger } = require('./logger');
const _logger = createLogger();

const HEALTH_CHECK_INTERVAL_MS = 10000;
const RESUME_DELAY_MS = 2000;
const UNLOCK_DELAY_MS = 1000;

/**
 * Create a hotkey manager instance.
 * @param {Object} [options]
 * @param {Function} [options.log] - Logger function (category, message)
 * @returns {Object} Hotkey manager API
 */
function createHotkeyManager(options = {}) {
    const log = options.log || ((cat, msg) => _logger.info(`[${cat}]`, msg));

    // State: id → { accelerator, callback, globalShortcutActive, lastTriggered }
    const bindings = new Map();

    let healthCheckInterval = null;
    let initialized = false;

    // --- Electron globalShortcut layer ---

    function fireBinding(binding, source) {
        const now = Date.now();
        if (now - binding.lastTriggered < 300) return; // debounce
        binding.lastTriggered = now;
        log('HOTKEY', `Triggered "${binding.id}" via ${source}`);
        try {
            binding.callback();
        } catch (err) {
            log('HOTKEY', `Error in callback for "${binding.id}": ${err.message}`);
        }
    }

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
     * Start the hotkey manager. Call once after app is ready.
     */
    function start() {
        if (initialized) return;
        initialized = true;
        setupPowerMonitor();
        startHealthCheck();
        log('HOTKEY', `Initialized (platform=${process.platform})`);
    }

    /**
     * Register a global hotkey.
     * @param {string} id - Unique identifier (e.g. 'toggle-panel')
     * @param {string} accelerator - Electron accelerator string (e.g. 'CommandOrControl+Shift+V')
     * @param {Function} callback - Function to call when hotkey fires
     * @returns {boolean} true if registered successfully
     */
    function register(id, accelerator, callback) {
        unregister(id);

        const binding = {
            id,
            accelerator,
            callback,
            globalShortcutActive: false,
            lastTriggered: 0,
        };

        bindings.set(id, binding);
        registerGlobalShortcut(binding);

        log('HOTKEY', `Registered "${id}": ${accelerator} [globalShortcut=${binding.globalShortcutActive}]`);

        if (!binding.globalShortcutActive) {
            log('HOTKEY', `WARNING: "${id}" failed to register! Hotkey will not work.`);
        }

        return binding.globalShortcutActive;
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
     * Stop the hotkey manager. Call on app shutdown.
     */
    function stop() {
        stopHealthCheck();
        // Remove powerMonitor listeners to prevent leaks
        if (_onResume) { powerMonitor.removeListener('resume', _onResume); _onResume = null; }
        if (_onUnlock) { powerMonitor.removeListener('unlock-screen', _onUnlock); _onUnlock = null; }
        for (const [id, binding] of bindings) {
            unregisterGlobalShortcut(binding.accelerator);
        }
        bindings.clear();
        initialized = false;
        log('HOTKEY', 'Stopped');
    }

    /**
     * Check if the hotkey manager is running.
     * @returns {boolean}
     */
    function isRunning() {
        return initialized;
    }

    return {
        start,
        register,
        unregister,
        updateBinding,
        reRegisterAll,
        getBinding,
        stop,
        isRunning,
    };
}

module.exports = { createHotkeyManager };
