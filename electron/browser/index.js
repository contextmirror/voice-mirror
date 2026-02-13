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
 */

// Web search
const {
    webSearch,
    setSerperApiKey,
} = require('./browser-search');

// URL fetching
const { fetchUrl } = require('./browser-fetch');

module.exports = {
    // Main API
    webSearch,
    fetchUrl,

    // Serper API configuration
    setSerperApiKey,
};
