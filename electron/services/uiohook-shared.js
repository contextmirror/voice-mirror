/**
 * Shared uiohook-napi singleton.
 *
 * Both push-to-talk and hotkey-manager need uiohook, but calling
 * uIOhook.start() twice crashes. This module ensures a single instance.
 *
 * Includes health monitoring: canary listeners track last event time,
 * and a 10s interval restarts uiohook if no events seen for 30s.
 * Emits 'restarted' so consumers can reattach their listeners.
 */

const { EventEmitter } = require('events');
const emitter = new EventEmitter();

let uIOhook = null;
let UiohookKey = null;
let started = false;
let loadError = null;

// Health monitoring state
let lastEventSeen = 0;
let healthInterval = null;
let canaryAttached = false;

const HEALTH_INTERVAL_MS = 10000;   // Check every 10s
const STALE_THRESHOLD_MS = 120000;  // 120s with no events = likely dead (avoid false restarts)

// Try to load uiohook-napi once
try {
    const mod = require('uiohook-napi');
    uIOhook = mod.uIOhook;
    UiohookKey = mod.UiohookKey;
    console.log('[uiohook-shared] uiohook-napi loaded successfully');
} catch (err) {
    loadError = err;
    console.warn('[uiohook-shared] uiohook-napi not available:', err.message);
}

/**
 * Attach canary listeners that update lastEventSeen on any input.
 * Used by the health monitor to detect if uiohook is alive.
 */
function attachCanary() {
    if (canaryAttached || !uIOhook) return;
    const touch = () => { lastEventSeen = Date.now(); };
    uIOhook.on('keydown', touch);
    uIOhook.on('keyup', touch);
    uIOhook.on('mousedown', touch);
    uIOhook.on('mouseup', touch);
    uIOhook.on('mousemove', touch);
    canaryAttached = true;
}

/**
 * Start the health monitor interval.
 */
function startHealthMonitor() {
    if (healthInterval) return;
    healthInterval = setInterval(() => {
        if (!started) return;
        const elapsed = Date.now() - lastEventSeen;
        if (elapsed > STALE_THRESHOLD_MS) {
            console.warn(`[uiohook-shared] No input events for ${Math.round(elapsed / 1000)}s — restarting`);
            restart();
        }
    }, HEALTH_INTERVAL_MS);
}

/**
 * Ensure uiohook is started. Safe to call multiple times.
 * @returns {boolean} true if running
 */
function ensureStarted() {
    if (!uIOhook) return false;
    if (started) return true;
    try {
        uIOhook.start();
        started = true;
        lastEventSeen = Date.now();
        attachCanary();
        startHealthMonitor();
        console.log('[uiohook-shared] uiohook started');
        return true;
    } catch (err) {
        console.error('[uiohook-shared] Failed to start uiohook:', err);
        started = false;
        return false;
    }
}

/**
 * Restart uiohook: stop, clear all listeners, start fresh, notify consumers.
 * @returns {boolean} true if restart succeeded
 */
function restart() {
    console.log('[uiohook-shared] Restarting uiohook...');
    try { uIOhook.stop(); } catch {}
    started = false;
    canaryAttached = false;
    uIOhook.removeAllListeners();

    const ok = ensureStarted();
    if (ok) {
        console.log('[uiohook-shared] Restart successful, notifying consumers');
        emitter.emit('restarted');
    } else {
        console.error('[uiohook-shared] Restart failed');
    }
    return ok;
}

/**
 * Stop uiohook. Call only on app shutdown.
 */
function stop() {
    if (healthInterval) {
        clearInterval(healthInterval);
        healthInterval = null;
    }
    if (uIOhook && started) {
        try {
            uIOhook.stop();
            started = false;
            canaryAttached = false;
            console.log('[uiohook-shared] uiohook stopped');
        } catch (err) {
            // Ignore errors during cleanup
        }
    }
}

/** @returns {Object|null} The uIOhook instance or null */
function getHook() { return uIOhook; }

/** @returns {Object|null} UiohookKey enum or null */
function getKey() { return UiohookKey; }

/** @returns {boolean} Whether uiohook-napi loaded successfully */
function isAvailable() { return uIOhook !== null; }

/** @returns {boolean} Whether uiohook is currently running */
function isStarted() { return started; }

module.exports = {
    ensureStarted, stop, restart,
    getHook, getKey, isAvailable, isStarted,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter)
};
