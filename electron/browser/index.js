/**
 * Voice Mirror Headless Browser Module
 *
 * Provides web search and URL fetching capabilities.
 * Uses Serper.dev API for search (if configured), with browser fallback.
 *
 * Usage:
 *   const browser = require('./browser');
 *
 *   // Configure Serper API key (optional, enables fast API search)
 *   browser.setSerperApiKey('your-api-key');
 *
 *   // Web search (uses Serper if configured, otherwise browser)
 *   const results = await browser.webSearch({ query: 'weather today' });
 *
 *   // Fetch URL content
 *   const content = await browser.fetchUrl({ url: 'https://example.com' });
 *
 *   // Cleanup on exit
 *   await browser.closeBrowser();
 */

// Session management
const {
    getBrowser,
    getPage,
    closeBrowser,
    isBrowserRunning,
    isHealthy,
    restartBrowser,
} = require('./browser-session');

// Web search
const {
    webSearch,
    browserSearch,
    searchBing,
    searchGoogle,
    setSerperApiKey,
    getSerperApiKey,
} = require('./browser-search');

// Serper API (direct access)
const { searchSerper } = require('./serper-search');

// URL fetching
const {
    fetchUrl,
    fetchHtml,
} = require('./browser-fetch');

// Utilities
const {
    normalizeTimeoutMs,
    toAIFriendlyError,
    setupAntiDetect,
    waitForRateLimit,
    resetRateLimit,
    truncateText,
} = require('./browser-utils');

// Browser control system (CDP + Playwright + snapshots + actions)
const browserController = require('./browser-controller');
const config = require('./config');
const snapshot = require('./snapshot');
const actions = require('./actions');

module.exports = {
    // Main API
    webSearch,
    fetchUrl,

    // Serper API configuration
    setSerperApiKey,
    getSerperApiKey,
    searchSerper,

    // Session management (headless search/fetch)
    getBrowser,
    getPage,
    closeBrowser,
    isBrowserRunning,
    isHealthy,
    restartBrowser,

    // Additional search functions
    browserSearch,
    searchBing,
    searchGoogle,

    // Additional fetch functions
    fetchHtml,

    // Utilities (for advanced use)
    normalizeTimeoutMs,
    toAIFriendlyError,
    setupAntiDetect,
    waitForRateLimit,
    resetRateLimit,
    truncateText,

    // Browser control (CDP agent browser)
    browserController,
    browserConfig: config,
    browserSnapshot: snapshot,
    browserActions: actions,
};
