/**
 * Voice Mirror Browser Module
 *
 * Embedded webview-based browser with CDP control.
 * Provides web search, URL fetching, and full browser automation.
 *
 * Usage:
 *   const browser = require('./browser');
 *
 *   // Web search (Serper API primary, webview fallback)
 *   const results = await browser.webSearch({ query: 'weather today' });
 *
 *   // Fetch URL content
 *   const content = await browser.fetchUrl({ url: 'https://example.com' });
 *
 *   // Browser control (snapshots, actions, screenshots)
 *   await browser.browserController.navigateTab('https://example.com');
 *   const snap = await browser.browserController.snapshotTab({ format: 'role' });
 */

// CDP adapter (webview debugger bridge)
const webviewCdp = require('./webview-cdp');

// Web search
const {
    webSearch,
    browserSearch,
    setSerperApiKey,
    getSerperApiKey,
} = require('./browser-search');

// Serper API (direct access)
const { searchSerper } = require('./serper-search');

// URL fetching
const { fetchUrl } = require('./browser-fetch');

// Browser control (webview-based)
const browserController = require('./browser-controller');

// Webview actions & snapshots
const webviewActions = require('./webview-actions');
const webviewSnapshot = require('./webview-snapshot');

// Role refs (accessibility tree parsing)
const roleRefs = require('./role-refs');

// Config
const config = require('./config');

module.exports = {
    // Main API
    webSearch,
    fetchUrl,

    // Serper API configuration
    setSerperApiKey,
    getSerperApiKey,
    searchSerper,

    // Search
    browserSearch,

    // CDP adapter
    webviewCdp,

    // Browser control
    browserController,
    browserConfig: config,
    browserActions: webviewActions,
    browserSnapshot: webviewSnapshot,
    roleRefs,
};
