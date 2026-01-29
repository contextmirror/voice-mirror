/**
 * Web search implementation for Voice Mirror.
 *
 * Priority order:
 * 1. Serper.dev API (fast, reliable, if API key configured)
 * 2. Webview fallback (navigate embedded browser to search engine)
 */

const cdp = require('./webview-cdp');
const { searchSerper } = require('./serper-search');

// Serper API key
let serperApiKey = process.env.SERPER_API_KEY || '3adf77c61ddf98dff5ab2e3dd35b3eebc3409fa6';

/**
 * Set the Serper API key.
 * @param {string} apiKey
 */
function setSerperApiKey(apiKey) {
    serperApiKey = apiKey;
    if (apiKey) {
        console.log('[Browser Search] Serper API key configured');
    }
}

/**
 * Get current Serper API key.
 * @returns {string|null}
 */
function getSerperApiKey() {
    return serperApiKey;
}

/**
 * Search the web.
 *
 * Uses Serper.dev API if configured, otherwise falls back to webview scraping.
 *
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @param {number} [args.max_results=5] - Maximum results to return
 * @param {number} [args.timeout=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} Search results
 */
async function webSearch(args = {}) {
    const { query, max_results = 5, timeout = 30000 } = args;

    if (!query) {
        return { success: false, error: 'Search query is required' };
    }

    const maxResults = Math.min(Math.max(1, max_results), 10);

    // Try Serper API first
    if (serperApiKey) {
        console.log('[Browser Search] Using Serper API...');
        const serperResult = await searchSerper({
            query,
            apiKey: serperApiKey,
            max_results: maxResults,
            timeout: Math.min(timeout, 10000),
        });

        if (serperResult.success) {
            return serperResult;
        }

        console.log('[Browser Search] Serper failed:', serperResult.error);
        console.log('[Browser Search] Falling back to webview...');
    }

    // Fallback: navigate webview to Google and scrape results
    return await browserSearch(args);
}

/**
 * Webview-based search fallback.
 * Navigates the embedded webview to Google and extracts results via CDP.
 */
async function browserSearch(args = {}) {
    const { query, max_results = 5 } = args;

    if (!cdp.isAttached()) {
        return { success: false, error: 'Browser not available. Open the Voice Mirror panel.' };
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
            return { success: false, error: `No results from Google for "${query}"` };
        }

        console.log(`[Browser Search] Google: Found ${results.length} results`);
        return formatResults(query, results, 'Google');
    } catch (err) {
        console.error('[Browser Search] Webview error:', err.message);
        return { success: false, error: `Search failed: ${err.message}` };
    }
}

/**
 * Format search results for output.
 */
function formatResults(query, results, engine = 'Web') {
    const formatted = results.map((r, i) => {
        let entry = `${i + 1}. ${r.title}`;
        if (r.snippet) entry += `\n   ${r.snippet}`;
        entry += `\n   URL: ${r.url}`;
        return entry;
    }).join('\n\n');

    return {
        success: true,
        result: `${engine} results for "${query}":\n\n${formatted}`,
        results: results.map(r => ({
            title: r.title,
            snippet: r.snippet,
            url: r.url,
        })),
    };
}

module.exports = {
    webSearch,
    browserSearch,
    setSerperApiKey,
    getSerperApiKey,
};
