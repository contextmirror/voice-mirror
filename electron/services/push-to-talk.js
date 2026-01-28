/**
 * Push-to-Talk (PTT) service for Voice Mirror Electron.
 * Handles PTT key registration using uiohook-napi for mouse buttons
 * or globalShortcut for keyboard shortcuts.
 */

// Try to load uiohook-napi (optional dependency)
let uIOhook = null;
let UiohookKey = null;
try {
    const uiohookModule = require('uiohook-napi');
    uIOhook = uiohookModule.uIOhook;
    UiohookKey = uiohookModule.UiohookKey;
    console.log('[Push-to-Talk] uiohook-napi loaded successfully');
} catch (err) {
    console.warn('[Push-to-Talk] uiohook-napi not available, PTT will use keyboard shortcuts only:', err.message);
}

/**
 * Create a push-to-talk service instance.
 * @param {Object} options - PTT options
 * @param {Object} options.globalShortcut - Electron globalShortcut module
 * @returns {Object} PTT service instance
 */
function createPushToTalk(options = {}) {
    const { globalShortcut } = options;

    // Internal state
    let pttKey = null;
    let pttActive = false;  // Currently holding PTT key
    let uiohookStarted = false;
    let onStartRecording = null;
    let onStopRecording = null;

    /**
     * Map PTT key config to uiohook button/key codes.
     * Mouse buttons: 1=left, 2=right, 3=middle, 4=side1 (back), 5=side2 (forward)
     * @param {string} key - Key configuration string
     * @returns {Object} Parsed key info { type: 'mouse'|'keyboard'|'shortcut', button?: number, keycode?: number, key?: string }
     */
    function parsePttKey(key) {
        const keyLower = key.toLowerCase();

        // Mouse buttons
        if (keyLower === 'mousebutton4' || keyLower === 'mouse4' || keyLower === 'xbutton1') {
            return { type: 'mouse', button: 4 };
        }
        if (keyLower === 'mousebutton5' || keyLower === 'mouse5' || keyLower === 'xbutton2') {
            return { type: 'mouse', button: 5 };
        }
        if (keyLower === 'mousebutton3' || keyLower === 'mouse3' || keyLower === 'middleclick') {
            return { type: 'mouse', button: 3 };
        }
        // Generic mouse button (MouseButton6, MouseButton7, etc.)
        const mouseMatch = keyLower.match(/^mousebutton(\d+)$/);
        if (mouseMatch) {
            return { type: 'mouse', button: parseInt(mouseMatch[1]) };
        }

        // Keyboard keys - map common names to uiohook keycodes
        // See: https://github.com/aspect-build/uiohook-napi/blob/main/lib/keycodes.ts
        const keyMap = {
            'space': 57,
            'f13': 100,
            'f14': 101,
            'f15': 102,
            'scrolllock': 70,
            'pause': 119,
            'insert': 110,
            'home': 102,
            'pageup': 104,
            'delete': 111,
            'end': 107,
            'pagedown': 109,
            'capslock': 58,
            'numlock': 69,
        };

        if (keyMap[keyLower]) {
            return { type: 'keyboard', keycode: keyMap[keyLower] };
        }

        // Single character keys (a-z, 0-9)
        if (keyLower.length === 1) {
            const char = keyLower.charCodeAt(0);
            // a-z: keycodes 30-55 roughly (a=30, b=48, etc. - uiohook uses scan codes)
            // This is approximate - uiohook uses hardware scan codes
            if (char >= 97 && char <= 122) {
                // Rough mapping - may need adjustment per keyboard layout
                const letterMap = { a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35, i: 23, j: 36, k: 37, l: 38, m: 50, n: 49, o: 24, p: 25, q: 16, r: 19, s: 31, t: 20, u: 22, v: 47, w: 17, x: 45, y: 21, z: 44 };
                if (letterMap[keyLower]) {
                    return { type: 'keyboard', keycode: letterMap[keyLower] };
                }
            }
            // 0-9: keycodes 11, 2-10
            if (char >= 48 && char <= 57) {
                const numMap = { '0': 11, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10 };
                if (numMap[keyLower]) {
                    return { type: 'keyboard', keycode: numMap[keyLower] };
                }
            }
        }

        // Fallback: try to use globalShortcut for modifier combos
        return { type: 'shortcut', key: key };
    }

    /**
     * Register push-to-talk with uiohook (supports mouse buttons).
     * When held, starts recording. When released, stops.
     * @param {string} key - Key to register (e.g., 'MouseButton4', 'Space', 'F13')
     * @param {Object} callbacks - Callback functions
     * @param {Function} callbacks.onStart - Called when PTT key is pressed
     * @param {Function} callbacks.onStop - Called when PTT key is released
     */
    function register(key, callbacks = {}) {
        unregister();  // Clear any existing

        onStartRecording = callbacks.onStart || (() => {});
        onStopRecording = callbacks.onStop || (() => {});

        pttKey = parsePttKey(key);
        console.log(`[Push-to-Talk] PTT key parsed:`, pttKey);

        if (!uIOhook) {
            // Fallback to globalShortcut for keyboard shortcuts only
            if ((pttKey.type === 'shortcut' || pttKey.type === 'keyboard') && globalShortcut) {
                console.log('[Push-to-Talk] uiohook not available, using globalShortcut fallback');
                const electronKey = key.replace(/ \+ /g, '+');
                try {
                    globalShortcut.register(electronKey, () => {
                        if (!pttActive) {
                            pttActive = true;
                            console.log('[Push-to-Talk] Start recording (shortcut)');
                            onStartRecording();
                        }
                    });
                    console.log(`[Push-to-Talk] Registered via globalShortcut: ${electronKey}`);
                } catch (err) {
                    console.error('[Push-to-Talk] Registration error:', err);
                }
            } else {
                console.error('[Push-to-Talk] Mouse button PTT requires uiohook-napi. Run: npm install uiohook-napi');
            }
            return;
        }

        // Use uiohook for proper key down/up detection
        if (!uiohookStarted) {
            // Set up event handlers
            uIOhook.on('mousedown', (e) => {
                if (pttKey?.type === 'mouse' && e.button === pttKey.button && !pttActive) {
                    pttActive = true;
                    console.log(`[Push-to-Talk] Start recording (mouse button ${e.button})`);
                    onStartRecording();
                }
            });

            uIOhook.on('mouseup', (e) => {
                if (pttKey?.type === 'mouse' && e.button === pttKey.button && pttActive) {
                    pttActive = false;
                    console.log(`[Push-to-Talk] Stop recording (mouse button ${e.button})`);
                    onStopRecording();
                }
            });

            uIOhook.on('keydown', (e) => {
                if (pttKey?.type === 'keyboard' && e.keycode === pttKey.keycode && !pttActive) {
                    pttActive = true;
                    console.log(`[Push-to-Talk] Start recording (keycode ${e.keycode})`);
                    onStartRecording();
                }
            });

            uIOhook.on('keyup', (e) => {
                if (pttKey?.type === 'keyboard' && e.keycode === pttKey.keycode && pttActive) {
                    pttActive = false;
                    console.log(`[Push-to-Talk] Stop recording (keycode ${e.keycode})`);
                    onStopRecording();
                }
            });

            // Start the hook
            try {
                uIOhook.start();
                uiohookStarted = true;
                console.log('[Push-to-Talk] uiohook started');
            } catch (err) {
                console.error('[Push-to-Talk] Failed to start uiohook:', err);
            }
        }

        console.log(`[Push-to-Talk] Registered: ${key} (${pttKey.type})`);
    }

    /**
     * Unregister push-to-talk.
     */
    function unregister() {
        if (pttKey) {
            if (pttKey.type === 'shortcut' && globalShortcut) {
                try {
                    globalShortcut.unregister(pttKey.key);
                } catch (err) {
                    // Ignore errors during unregister
                }
            }
            console.log(`[Push-to-Talk] Unregistered`);
            pttKey = null;
            pttActive = false;
        }
        // Note: We don't stop uiohook here as it may be reused
    }

    /**
     * Stop uiohook completely (for app shutdown).
     */
    function stop() {
        unregister();
        if (uIOhook && uiohookStarted) {
            try {
                uIOhook.stop();
                uiohookStarted = false;
                console.log('[Push-to-Talk] uiohook stopped');
                return true;
            } catch (err) {
                // Ignore errors during cleanup
                return false;
            }
        }
        return false;
    }

    /**
     * Check if PTT is currently active (key held down).
     * @returns {boolean} True if PTT key is being held
     */
    function isActive() {
        return pttActive;
    }

    /**
     * Check if uiohook is available.
     * @returns {boolean} True if uiohook-napi is loaded
     */
    function isUiohookAvailable() {
        return uIOhook !== null;
    }

    /**
     * Get the current PTT key configuration.
     * @returns {Object|null} Parsed PTT key info or null if not registered
     */
    function getKey() {
        return pttKey;
    }

    return {
        register,
        unregister,
        stop,
        isActive,
        isUiohookAvailable,
        getKey,
        parsePttKey
    };
}

module.exports = {
    createPushToTalk
};
