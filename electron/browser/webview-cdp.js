/**
 * Webview CDP adapter.
 * Bridges Electron's webContents.debugger API to the CDP interface
 * used by the rest of the browser module.
 *
 * Replaces chrome-launcher + cdp-helpers + cdp-client for the embedded webview.
 */

const { createLogger } = require('../services/logger');
const logger = createLogger();

// Real Chrome User-Agent to avoid bot detection.
// Matches the Chromium version bundled with Electron 40.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/** @type {Electron.WebContents | null} */
let guestContents = null;

/** @type {boolean} */
let debuggerAttached = false;

/** @type {Map<string, Set<Function>>} */
const eventListeners = new Map();

/**
 * Attach the CDP debugger to a webview's webContents.
 * @param {Electron.WebContents} webContents - The webview's guest webContents
 */
function attachDebugger(webContents) {
    if (debuggerAttached && guestContents === webContents) return;

    // Detach previous if different
    if (debuggerAttached && guestContents) {
        try { guestContents.debugger.detach(); } catch {}
    }

    guestContents = webContents;

    try {
        guestContents.debugger.attach('1.3');
        debuggerAttached = true;
        logger.info('[webview-cdp]', 'Debugger attached');

        // Apply stealth measures to avoid bot detection (Google CAPTCHA etc.)
        applyStealthMeasures().catch(err => {
            logger.warn('[webview-cdp]', 'Stealth measures failed (non-fatal):', err.message);
        });
    } catch (err) {
        logger.error('[webview-cdp]', 'Failed to attach debugger:', err.message);
        debuggerAttached = false;
        throw err;
    }

    // Forward CDP events to listeners
    guestContents.debugger.on('message', (_event, method, params) => {
        const listeners = eventListeners.get(method);
        if (listeners) {
            for (const cb of listeners) {
                try { cb(params); } catch (e) {
                    logger.error('[webview-cdp]', `Event listener error for ${method}:`, e);
                }
            }
        }
    });

    guestContents.debugger.on('detach', (_event, reason) => {
        logger.info('[webview-cdp]', 'Debugger detached:', reason);
        debuggerAttached = false;
    });
}

/**
 * Apply stealth measures to make the webview look like a regular browser.
 * Hides automation signals that trigger CAPTCHAs on Google etc.
 */
async function applyStealthMeasures() {
    if (!debuggerAttached || !guestContents) return;

    const cmd = (method, params = {}) =>
        guestContents.debugger.sendCommand(method, params);

    // 1. Override User-Agent to hide "Electron" and "HeadlessChrome"
    await cmd('Network.setUserAgentOverride', {
        userAgent: CHROME_UA,
        acceptLanguage: 'en-US,en;q=0.9',
        platform: 'Win32'
    });

    // 2. Set the webview's actual UA string (affects JS navigator.userAgent)
    guestContents.setUserAgent(CHROME_UA);

    // 3. Inject stealth script on every new page
    await cmd('Page.enable');
    await cmd('Page.addScriptToEvaluateOnNewDocument', {
        source: `
            // Hide webdriver flag
            Object.defineProperty(navigator, 'webdriver', { get: () => false });

            // Fake plugins (headless Chrome has none)
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });

            // Fake languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });

            // Hide automation via Chrome runtime
            window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };

            // Fake permissions query
            const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
            if (origQuery) {
                window.navigator.permissions.query = (params) =>
                    params.name === 'notifications'
                        ? Promise.resolve({ state: Notification.permission })
                        : origQuery(params);
            }
        `
    });

    logger.info('[webview-cdp]', 'Stealth measures applied');
}

/**
 * Detach the CDP debugger.
 */
function detachDebugger() {
    if (guestContents && debuggerAttached) {
        try {
            guestContents.debugger.detach();
        } catch {}
        debuggerAttached = false;
        logger.info('[webview-cdp]', 'Debugger detached');
    }
}

/**
 * Check if debugger is attached and ready.
 * @returns {boolean}
 */
function isAttached() {
    return debuggerAttached && guestContents !== null;
}

/**
 * Get the raw webContents reference (for direct calls like loadURL).
 * @returns {Electron.WebContents | null}
 */
function getWebContents() {
    return guestContents;
}

/**
 * Send a CDP command via the debugger.
 * @param {string} method - CDP method (e.g. 'Page.navigate', 'DOM.getDocument')
 * @param {Object} [params={}] - CDP parameters
 * @returns {Promise<any>} CDP result
 */
async function sendCommand(method, params = {}) {
    if (!debuggerAttached || !guestContents) {
        throw new Error('[webview-cdp] Debugger not attached. Call attachDebugger() first.');
    }
    return await guestContents.debugger.sendCommand(method, params);
}

/**
 * Subscribe to a CDP event.
 * @param {string} method - CDP event name (e.g. 'Page.loadEventFired')
 * @param {Function} callback - Event handler
 */
function onEvent(method, callback) {
    if (!eventListeners.has(method)) {
        eventListeners.set(method, new Set());
    }
    eventListeners.get(method).add(callback);
}

// --- High-level page management ---

/**
 * Navigate the webview to a URL.
 * @param {string} url
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<void>}
 */
async function navigate(url, timeoutMs = 15000) {
    if (!guestContents) throw new Error('[webview-cdp] No webContents attached');

    // Use webContents.loadURL for more reliable navigation
    // (works even if CDP debugger has issues, handles redirects better)
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            resolve(); // Resolve on timeout rather than reject — page may still be usable
        }, timeoutMs);

        const onFinish = () => {
            clearTimeout(timer);
            guestContents.removeListener('did-finish-load', onFinish);
            guestContents.removeListener('did-fail-load', onFail);
            resolve();
        };

        const onFail = (_event, errorCode, errorDescription) => {
            if (errorCode === -3) return; // Aborted (normal for navigations)
            clearTimeout(timer);
            guestContents.removeListener('did-finish-load', onFinish);
            guestContents.removeListener('did-fail-load', onFail);
            reject(new Error(`Navigation failed: ${errorDescription} (code ${errorCode})`));
        };

        guestContents.once('did-finish-load', onFinish);
        guestContents.once('did-fail-load', onFail);

        guestContents.loadURL(url).catch(err => {
            clearTimeout(timer);
            guestContents.removeListener('did-finish-load', onFinish);
            guestContents.removeListener('did-fail-load', onFail);
            reject(err);
        });
    });
}

/**
 * Get current URL.
 * @returns {Promise<string>}
 */
async function getUrl() {
    if (!guestContents) return '';
    return guestContents.getURL();
}

/**
 * Get page title.
 * @returns {Promise<string>}
 */
async function getTitle() {
    if (!guestContents) return '';
    return guestContents.getTitle();
}

/**
 * Capture a screenshot.
 * @param {Object} [opts={}]
 * @param {'png'|'jpeg'} [opts.format='png']
 * @param {number} [opts.quality]
 * @param {boolean} [opts.fullPage]
 * @returns {Promise<Buffer>}
 */
async function captureScreenshot(opts = {}) {
    await sendCommand('Page.enable');

    let clip;
    if (opts.fullPage) {
        const metrics = await sendCommand('Page.getLayoutMetrics');
        const size = metrics?.cssContentSize || metrics?.contentSize;
        const width = Number(size?.width || 0);
        const height = Number(size?.height || 0);
        if (width > 0 && height > 0) {
            clip = { x: 0, y: 0, width, height, scale: 1 };
        }
    }

    const format = opts.format || 'png';
    const quality = format === 'jpeg'
        ? Math.max(0, Math.min(100, Math.round(opts.quality ?? 85)))
        : undefined;

    const result = await sendCommand('Page.captureScreenshot', {
        format,
        ...(quality !== undefined ? { quality } : {}),
        fromSurface: true,
        captureBeyondViewport: !!opts.fullPage,
        ...(clip ? { clip } : {})
    });

    const base64 = result?.data;
    if (!base64) throw new Error('Screenshot failed: missing data');
    return Buffer.from(base64, 'base64');
}

/**
 * Evaluate JavaScript in the page.
 * @param {string} expression
 * @param {Object} [options={}]
 * @param {boolean} [options.awaitPromise=false]
 * @param {boolean} [options.returnByValue=true]
 * @returns {Promise<{result: Object, exceptionDetails?: Object}>}
 */
async function evaluate(expression, options = {}) {
    await sendCommand('Runtime.enable').catch(() => {});
    const evaluated = await sendCommand('Runtime.evaluate', {
        expression,
        awaitPromise: Boolean(options.awaitPromise),
        returnByValue: options.returnByValue ?? true,
        userGesture: true,
        includeCommandLineAPI: true
    });

    const result = evaluated?.result;
    if (!result) throw new Error('CDP Runtime.evaluate returned no result');
    return { result, exceptionDetails: evaluated.exceptionDetails };
}

/**
 * Get the accessibility tree.
 * @returns {Promise<Array>} Raw AX tree nodes
 */
async function getAccessibilityTree() {
    await sendCommand('Accessibility.enable').catch(() => {});
    const res = await sendCommand('Accessibility.getFullAXTree');
    return Array.isArray(res?.nodes) ? res.nodes : [];
}

module.exports = {
    attachDebugger,
    detachDebugger,
    isAttached,
    getWebContents,
    sendCommand,
    onEvent,
    navigate,
    getUrl,
    getTitle,
    captureScreenshot,
    evaluate,
    getAccessibilityTree
};
