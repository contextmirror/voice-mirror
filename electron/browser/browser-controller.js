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

/** @type {{ active: Object|null, history: Array }} */
const dialogState = { active: null, history: [] };

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
 * Set up dialog event listener on CDP.
 * Call after debugger attach to subscribe to Page.javascriptDialogOpening/Closing.
 */
async function setupDialogListener() {
    try {
        await cdp.sendCommand('Page.enable');
    } catch { /* may already be enabled */ }

    cdp.onEvent('Page.javascriptDialogOpening', (params) => {
        dialogState.active = {
            type: params.type,         // 'alert', 'confirm', 'prompt', 'beforeunload'
            message: params.message,
            defaultPrompt: params.defaultPrompt || '',
            url: params.url || '',
            timestamp: Date.now()
        };
        console.log(`[browser-controller] Dialog opened: ${params.type} "${(params.message || '').slice(0, 80)}"`);
    });

    cdp.onEvent('Page.javascriptDialogClosed', () => {
        if (dialogState.active) {
            dialogState.history.push({ ...dialogState.active, closedAt: Date.now() });
            if (dialogState.history.length > 20) {
                dialogState.history = dialogState.history.slice(-20);
            }
        }
        dialogState.active = null;
    });
}

/**
 * Get the current dialog state.
 * @returns {{ active: Object|null, history: Array }}
 */
function getDialogState() {
    return dialogState;
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

    const result = {
        ok: true,
        driver: 'webview',
        running: attached && browserActive,
        attached,
        url,
        title
    };

    if (dialogState.active) {
        result.dialog = dialogState.active;
    }

    return result;
}

/**
 * Navigate the webview to a URL.
 * @param {string} url
 */
async function navigateTab(url) {
    // Block dangerous URL schemes — only allow http/https and about:blank
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') {
        return { ok: false, action: 'navigate', error: 'Only http/https URLs allowed' };
    }
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

// ============================================
// Cookie Operations
// ============================================

/**
 * Get cookies for current page or specific URL/domain.
 * @param {Object} opts - { url?, domain? }
 */
async function getCookies(opts = {}) {
    await ensureBrowserAvailable();
    await cdp.sendCommand('Network.enable').catch(() => {});
    const params = {};
    if (opts.url) params.urls = [opts.url];
    const result = await cdp.sendCommand('Network.getCookies', params);
    let cookies = result.cookies || [];
    if (opts.domain) {
        cookies = cookies.filter(c => c.domain.includes(opts.domain));
    }
    if (opts.name) {
        cookies = cookies.filter(c => c.name === opts.name);
    }
    return { ok: true, cookies };
}

/**
 * Set a cookie.
 * @param {Object} opts - { name, value, url?, domain?, path?, secure?, httpOnly?, sameSite? }
 */
async function setCookie(opts = {}) {
    await ensureBrowserAvailable();
    await cdp.sendCommand('Network.enable').catch(() => {});
    if (!opts.name) throw new Error('Cookie name is required');
    const params = {
        name: opts.name,
        value: opts.value ?? ''
    };
    if (opts.url) params.url = opts.url;
    if (opts.domain) params.domain = opts.domain;
    if (opts.path) params.path = opts.path;
    if (opts.secure != null) params.secure = opts.secure;
    if (opts.httpOnly != null) params.httpOnly = opts.httpOnly;
    if (opts.sameSite) params.sameSite = opts.sameSite;
    // If no url or domain, use current page URL
    if (!params.url && !params.domain) {
        params.url = await cdp.getUrl();
    }
    const result = await cdp.sendCommand('Network.setCookie', params);
    return { ok: true, success: result?.success !== false };
}

/**
 * Delete cookies matching filter.
 * @param {Object} opts - { name, url?, domain?, path? }
 */
async function deleteCookies(opts = {}) {
    await ensureBrowserAvailable();
    await cdp.sendCommand('Network.enable').catch(() => {});
    if (!opts.name) throw new Error('Cookie name is required');
    const params = { name: opts.name };
    if (opts.url) params.url = opts.url;
    if (opts.domain) params.domain = opts.domain;
    if (opts.path) params.path = opts.path;
    await cdp.sendCommand('Network.deleteCookies', params);
    return { ok: true };
}

/**
 * Clear all cookies.
 */
async function clearCookies() {
    await ensureBrowserAvailable();
    await cdp.sendCommand('Network.enable').catch(() => {});
    const result = await cdp.sendCommand('Network.getCookies', {});
    const cookies = result.cookies || [];
    for (const cookie of cookies) {
        await cdp.sendCommand('Network.deleteCookies', {
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path
        });
    }
    return { ok: true, deleted: cookies.length };
}

// ============================================
// Web Storage Operations
// ============================================

/**
 * Get web storage entries.
 * @param {Object} opts - { type: 'localStorage'|'sessionStorage', key? }
 */
async function getStorage(opts = {}) {
    await ensureBrowserAvailable();
    const storageType = opts.type || 'localStorage';
    if (storageType !== 'localStorage' && storageType !== 'sessionStorage') {
        throw new Error(`Invalid storage type: "${storageType}". Use "localStorage" or "sessionStorage".`);
    }
    if (opts.key) {
        const result = await cdp.evaluate(`window.${storageType}.getItem(${JSON.stringify(opts.key)})`);
        return { ok: true, key: opts.key, value: result?.result?.value ?? null };
    }
    const result = await cdp.evaluate(`(function() {
        var s = window.${storageType};
        var out = {};
        for (var i = 0; i < s.length; i++) {
            var k = s.key(i);
            out[k] = s.getItem(k);
        }
        return JSON.stringify(out);
    })()`);
    const entries = JSON.parse(result?.result?.value || '{}');
    return { ok: true, type: storageType, entries, count: Object.keys(entries).length };
}

/**
 * Set a web storage entry.
 * @param {Object} opts - { type: 'localStorage'|'sessionStorage', key, value }
 */
async function setStorage(opts = {}) {
    await ensureBrowserAvailable();
    const storageType = opts.type || 'localStorage';
    if (storageType !== 'localStorage' && storageType !== 'sessionStorage') {
        throw new Error(`Invalid storage type: "${storageType}". Use "localStorage" or "sessionStorage".`);
    }
    if (!opts.key) throw new Error('Storage key is required');
    await cdp.evaluate(`window.${storageType}.setItem(${JSON.stringify(opts.key)}, ${JSON.stringify(String(opts.value ?? ''))})`);
    return { ok: true, type: storageType, key: opts.key };
}

/**
 * Delete a web storage entry.
 * @param {Object} opts - { type: 'localStorage'|'sessionStorage', key }
 */
async function deleteStorage(opts = {}) {
    await ensureBrowserAvailable();
    const storageType = opts.type || 'localStorage';
    if (storageType !== 'localStorage' && storageType !== 'sessionStorage') {
        throw new Error(`Invalid storage type: "${storageType}". Use "localStorage" or "sessionStorage".`);
    }
    if (!opts.key) throw new Error('Storage key is required');
    await cdp.evaluate(`window.${storageType}.removeItem(${JSON.stringify(opts.key)})`);
    return { ok: true, type: storageType, key: opts.key };
}

/**
 * Clear all entries in a web storage.
 * @param {Object} opts - { type: 'localStorage'|'sessionStorage' }
 */
async function clearStorage(opts = {}) {
    await ensureBrowserAvailable();
    const storageType = opts.type || 'localStorage';
    if (storageType !== 'localStorage' && storageType !== 'sessionStorage') {
        throw new Error(`Invalid storage type: "${storageType}". Use "localStorage" or "sessionStorage".`);
    }
    await cdp.evaluate(`window.${storageType}.clear()`);
    return { ok: true, type: storageType };
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
    setupDialogListener,
    getDialogState,
    getCookies,
    setCookie,
    deleteCookies,
    clearCookies,
    getStorage,
    setStorage,
    deleteStorage,
    clearStorage
};
