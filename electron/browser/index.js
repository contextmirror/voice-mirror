/**
 * Voice Mirror Browser Module
 *
 * Embedded webview-based browser with CDP control.
 * Provides web search, URL fetching, and full browser automation.
 *
 * Usage:
 *   const browser = require('./browser');
 *
 *   // Web search (webview-based Google scraping)
 *   const results = await browser.webSearch({ query: 'weather today' });
 *
 *   // Fetch URL content
 *   const content = await browser.fetchUrl({ url: 'https://example.com' });
 *
 *   // Browser controller (navigation, snapshots, actions, cookies, storage)
 *   const status = await browser.getStatus();
 *
 *   // CDP debugger attachment (call from main process after webview attach)
 *   browser.attachDebugger(guestWebContents);
 */

// Web search
const { webSearch } = require('./browser-search');

// URL fetching
const { fetchUrl } = require('./browser-fetch');

// Browser controller — used by main.js, browser-watcher, tools/handlers
const {
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
    clearStorage,
} = require('./browser-controller');

// Webview CDP — attachDebugger used by main.js after webview connects
const { attachDebugger } = require('./webview-cdp');

module.exports = {
    // Search & fetch
    webSearch,
    fetchUrl,

    // Browser controller
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
    clearStorage,

    // CDP debugger
    attachDebugger,
};
