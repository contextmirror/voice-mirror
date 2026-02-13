/**
 * Web search implementation for Voice Mirror.
 *
 * Navigates the embedded webview to Google and extracts results via CDP.
 */

const cdp = require('./webview-cdp');
const { formatResults } = require('./search-utils');
const { createLogger } = require('../services/logger');
const logger = createLogger();

/**
 * Search the web via the embedded webview.
 *
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @param {number} [args.max_results=5] - Maximum results to return
 * @returns {Promise<Object>} Search results
 */
async function webSearch(args = {}) {
    return await browserSearch(args);
}

/**
 * Webview-based search fallback.
 * Navigates the embedded webview to Google and extracts results via CDP.
 */
async function browserSearch(args = {}) {
    const { query, max_results = 5 } = args;

    if (!cdp.isAttached()) {
        return { ok: false, error: 'Browser not available. Open the Voice Mirror panel.' };
    }

    const maxResults = Math.min(Math.max(1, max_results), 10);

    try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
        await cdp.navigate(searchUrl);
        await new Promise(r => setTimeout(r, 2500));

        // Extract results via Runtime.evaluate
        const { result } = await cdp.evaluate(`
            (function() {
                const items = [];
                const h3Elements = document.querySelectorAll('h3');
                for (const h3 of h3Elements) {
                    if (items.length >= ${maxResults}) break;
                    const link = h3.closest('a');
                    if (!link || !link.href) continue;
                    const url = link.href;
                    if (url.includes('google.com/search') || url.includes('accounts.google')) continue;
                    const title = h3.textContent?.trim() || '';
                    if (!title) continue;
                    let snippet = '';
                    const container = h3.closest('div[data-hveid]') || h3.closest('div.g');
                    if (container) {
                        const spans = container.querySelectorAll('span, div, em');
                        for (const el of spans) {
                            const text = el.textContent?.trim() || '';
                            if (text.length > 40 && text.length < 400 && text !== title && !text.startsWith('http')) {
                                snippet = text;
                                break;
                            }
                        }
                    }
                    items.push({ title, url, snippet });
                }
                return items;
            })()
        `);

        const results = result?.value || [];
        if (results.length === 0) {
            return { ok: false, error: `No results from Google for "${query}"` };
        }

        logger.info('[Browser Search]', `Google: Found ${results.length} results`);
        return formatResults(query, results, 'Google');
    } catch (err) {
        logger.error('[Browser Search]', 'Webview error:', err.message);
        return { ok: false, error: `Search failed: ${err.message}` };
    }
}

module.exports = {
    webSearch,
    browserSearch,
};
