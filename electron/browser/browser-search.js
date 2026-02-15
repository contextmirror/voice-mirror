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

    // Try Google first, fall back to DuckDuckGo if CAPTCHA or no results
    const googleResult = await searchGoogle(query, maxResults);
    if (googleResult.ok) return googleResult;

    logger.info('[Browser Search]', `Google failed (${googleResult.error}), trying DuckDuckGo...`);
    const ddgResult = await searchDuckDuckGo(query, maxResults);
    if (ddgResult.ok) return ddgResult;

    return { ok: false, error: `Search failed on both Google and DuckDuckGo: ${googleResult.error}` };
}

/**
 * Search Google via the webview.
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Object>}
 */
async function searchGoogle(query, maxResults) {
    try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
        await cdp.navigate(searchUrl);
        await new Promise(r => setTimeout(r, 2500));

        // Check for CAPTCHA before extracting results
        const { result: urlResult } = await cdp.evaluate('window.location.href');
        const currentUrl = urlResult?.value || '';
        if (currentUrl.includes('/sorry/') || currentUrl.includes('captcha')) {
            return { ok: false, error: 'Google CAPTCHA detected' };
        }

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
        return { ok: false, error: `Google search error: ${err.message}` };
    }
}

/**
 * Search DuckDuckGo via the webview (fallback — no CAPTCHA).
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Object>}
 */
async function searchDuckDuckGo(query, maxResults) {
    try {
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`;
        await cdp.navigate(searchUrl);
        await new Promise(r => setTimeout(r, 3000));

        const { result } = await cdp.evaluate(`
            (function() {
                const items = [];
                // DuckDuckGo result selectors
                const articles = document.querySelectorAll('article[data-testid="result"]');
                for (const article of articles) {
                    if (items.length >= ${maxResults}) break;
                    const link = article.querySelector('a[data-testid="result-title-a"]');
                    const snippetEl = article.querySelector('div[data-result="snippet"] span, div[data-testid="result-snippet"]');
                    if (!link || !link.href) continue;
                    const url = link.href;
                    if (url.includes('duckduckgo.com')) continue;
                    const title = link.textContent?.trim() || '';
                    if (!title) continue;
                    const snippet = snippetEl?.textContent?.trim() || '';
                    items.push({ title, url, snippet });
                }
                // Fallback selector for older DDG layout
                if (items.length === 0) {
                    const links = document.querySelectorAll('.result__a, a.result-link');
                    for (const link of links) {
                        if (items.length >= ${maxResults}) break;
                        const url = link.href;
                        if (!url || url.includes('duckduckgo.com')) continue;
                        const title = link.textContent?.trim() || '';
                        if (!title) continue;
                        const parent = link.closest('.result, .nrn-react-div');
                        const snippet = parent?.querySelector('.result__snippet, .result-snippet')?.textContent?.trim() || '';
                        items.push({ title, url, snippet });
                    }
                }
                return items;
            })()
        `);

        const results = result?.value || [];
        if (results.length === 0) {
            return { ok: false, error: `No results from DuckDuckGo for "${query}"` };
        }

        logger.info('[Browser Search]', `DuckDuckGo: Found ${results.length} results`);
        return formatResults(query, results, 'DuckDuckGo');
    } catch (err) {
        return { ok: false, error: `DuckDuckGo search error: ${err.message}` };
    }
}

module.exports = {
    webSearch,
    browserSearch,
};
