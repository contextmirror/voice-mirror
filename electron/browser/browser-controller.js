/**
 * Browser controller — webview-based operations.
 * Manages embedded webview lifecycle, snapshots, and actions
 * using CDP via webContents.debugger (no external Chrome).
 */

const cdp = require('./webview-cdp');
const { takeSnapshot } = require('./webview-snapshot');
const { executeAction, screenshotAction } = require('./webview-actions');

/** @type {{ console: Array, errors: Array }} */
const consoleState = { console: [], errors: [] };

/** @type {boolean} */
let browserActive = false;

/**
 * Ensure the browser (webview) is ready.
 * The webview must be attached via main process before tools can use it.
 * @returns {{ ok: boolean, driver: string }}
 */
async function ensureBrowserAvailable() {
    if (!cdp.isAttached()) {
        throw new Error('Browser not available. The embedded webview is not connected. Open the Voice Mirror panel to activate the browser.');
    }
    browserActive = true;
    return { ok: true, driver: 'webview' };
}

/**
 * Stop the browser — navigate to about:blank.
 */
async function stopBrowser() {
    if (!cdp.isAttached()) {
        return { ok: true, stopped: false, reason: 'not attached' };
    }

    try {
        const wc = cdp.getWebContents();
        if (wc) {
            wc.loadURL('about:blank');
        }
    } catch { /* ignore */ }

    browserActive = false;
    consoleState.console = [];
    consoleState.errors = [];

    return { ok: true, stopped: true };
}

/**
 * Get browser status.
 */
async function getStatus() {
    const attached = cdp.isAttached();
    let url = '';
    let title = '';

    if (attached) {
        try {
            url = await cdp.getUrl();
            title = await cdp.getTitle();
        } catch { /* ignore */ }
    }

    return {
        ok: true,
        driver: 'webview',
        running: attached && browserActive,
        attached,
        url,
        title
    };
}

/**
 * Navigate the webview to a URL.
 * @param {string} url
 */
async function navigateTab(url) {
    await ensureBrowserAvailable();
    await cdp.navigate(url);
    const currentUrl = await cdp.getUrl();
    return { ok: true, action: 'navigate', url: currentUrl };
}

/**
 * Get console logs (from tracked state).
 */
async function getConsoleLog() {
    return {
        ok: true,
        console: consoleState.console.slice(-50),
        errors: consoleState.errors.slice(-20)
    };
}

/**
 * Take a page snapshot.
 */
async function snapshotTab(opts = {}) {
    await ensureBrowserAvailable();
    return await takeSnapshot(opts);
}

/**
 * Execute a browser action.
 */
async function actOnTab(request) {
    await ensureBrowserAvailable();
    return await executeAction(request);
}

/**
 * Take a screenshot.
 */
async function screenshotTab(opts = {}) {
    await ensureBrowserAvailable();
    return await screenshotAction(opts);
}

/**
 * Add a console message to tracked state.
 * Called from main process when webview emits console messages.
 */
function trackConsoleMessage(msg) {
    consoleState.console.push(msg);
    if (consoleState.console.length > 500) {
        consoleState.console = consoleState.console.slice(-500);
    }
}

/**
 * Add an error to tracked state.
 */
function trackError(err) {
    consoleState.errors.push(err);
    if (consoleState.errors.length > 200) {
        consoleState.errors = consoleState.errors.slice(-200);
    }
}

/**
 * Check if browser is currently active.
 */
function isActive() {
    return browserActive && cdp.isAttached();
}

module.exports = {
    ensureBrowserAvailable,
    stopBrowser,
    getStatus,
    navigateTab,
    getConsoleLog,
    snapshotTab,
    actOnTab,
    screenshotTab,
    trackConsoleMessage,
    trackError,
    isActive
};
