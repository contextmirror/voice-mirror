/**
 * Web search tool handler.
 *
 * Uses headless browser (Playwright) for unlimited web searches.
 * Supports DuckDuckGo (default) and Google search engines.
 */

const browser = require('../../browser');

/**
 * Search the web using headless browser.
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.query - Search query
 * @param {string} args.engine - Search engine: 'duckduckgo' (default) or 'google'
 * @param {number} args.max_results - Maximum results (default: 5, max: 10)
 * @returns {Promise<Object>} Search results or error
 */
async function webSearch(args = {}) {
    return await browser.webSearch(args);
}

module.exports = { webSearch };
