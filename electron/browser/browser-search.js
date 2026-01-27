/**
 * Web search implementation for Voice Mirror.
 *
 * Priority order:
 * 1. Serper.dev API (fast, reliable, if API key configured)
 * 2. Browser fallback (Bing, then Google)
 */

const { getPage } = require('./browser-session');
const { searchSerper } = require('./serper-search');
const {
    normalizeTimeoutMs,
    toAIFriendlyError,
    waitForRateLimit,
} = require('./browser-utils');

// Serper API key - hardcoded for now, can be overridden via setSerperApiKey()
// or SERPER_API_KEY environment variable
let serperApiKey = process.env.SERPER_API_KEY || '3adf77c61ddf98dff5ab2e3dd35b3eebc3409fa6';

/**
 * Set the Serper API key.
 *
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
 *
 * @returns {string|null}
 */
function getSerperApiKey() {
    return serperApiKey;
}

/**
 * Search the web.
 *
 * Uses Serper.dev API if configured, otherwise falls back to browser scraping.
 *
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @param {number} [args.max_results=5] - Maximum results to return
 * @param {number} [args.timeout=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} Search results
 */
async function webSearch(args = {}) {
    const {
        query,
        max_results = 5,
        timeout = 30000,
    } = args;

    if (!query) {
        return {
            success: false,
            error: 'Search query is required',
        };
    }

    const maxResults = Math.min(Math.max(1, max_results), 10);

    // Try Serper API first if configured
    if (serperApiKey) {
        console.log('[Browser Search] Using Serper API...');
        const serperResult = await searchSerper({
            query,
            apiKey: serperApiKey,
            max_results: maxResults,
            timeout: Math.min(timeout, 10000), // Serper is fast, 10s max
        });

        if (serperResult.success) {
            return serperResult;
        }

        console.log('[Browser Search] Serper failed:', serperResult.error);
        console.log('[Browser Search] Falling back to browser...');
    }

    // Fallback to browser scraping
    return await browserSearch(args);
}

/**
 * Browser-based search fallback.
 *
 * @param {Object} args
 * @returns {Promise<Object>}
 */
async function browserSearch(args = {}) {
    const {
        query,
        max_results = 5,
        timeout = 30000,
    } = args;

    // Rate limiting for browser
    await waitForRateLimit();

    const normalizedTimeout = normalizeTimeoutMs(timeout, 30000);
    const maxResults = Math.min(Math.max(1, max_results), 10);

    try {
        const page = await getPage();

        // Try Bing first (more lenient with headless browsers)
        console.log('[Browser Search] Trying Bing...');
        const bingResult = await searchBing(page, query, maxResults, normalizedTimeout);
        if (bingResult.success && bingResult.results && bingResult.results.length > 0) {
            return bingResult;
        }

        // Fallback to Google if Bing fails
        console.log('[Browser Search] Bing failed, trying Google...');
        return await searchGoogle(page, query, maxResults, normalizedTimeout);
    } catch (err) {
        const friendlyError = toAIFriendlyError(err, query);
        console.error('[Browser Search] Error:', friendlyError.message);
        return {
            success: false,
            error: friendlyError.message,
        };
    }
}

/**
 * Search using Bing.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} query
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function searchBing(page, query, maxResults, timeout) {
    console.log(`[Browser Search] Bing: "${query}"`);

    const randomDelay = 300 + Math.random() * 700;
    await page.waitForTimeout(randomDelay);

    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
    });

    await handleBingConsent(page);
    await page.waitForTimeout(1000 + Math.random() * 500);

    try {
        await page.waitForSelector('#b_results', { timeout: 5000 });
    } catch {
        console.log('[Browser Search] Bing: No results container found');
    }

    const results = await page.evaluate((max) => {
        const items = [];
        const resultElements = document.querySelectorAll('.b_algo');

        for (const el of resultElements) {
            if (items.length >= max) break;

            const titleEl = el.querySelector('h2 a');
            if (!titleEl) continue;

            const title = titleEl.textContent?.trim() || '';
            const url = titleEl.href;

            if (!title || !url) continue;
            if (url.includes('bing.com/') && !url.includes('bing.com/search')) continue;

            let snippet = '';
            const snippetEl = el.querySelector('.b_caption p') ||
                            el.querySelector('p') ||
                            el.querySelector('.b_algoSlug');
            if (snippetEl) {
                snippet = snippetEl.textContent?.trim() || '';
            }

            items.push({ title, url, snippet });
        }

        return items;
    }, maxResults);

    if (results.length === 0) {
        const debugInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            algoCount: document.querySelectorAll('.b_algo').length,
            bodyLength: document.body.innerText.length,
        }));
        console.log('[Browser Search] Bing: No results. Debug:', JSON.stringify(debugInfo));

        return {
            success: false,
            error: 'No results from Bing',
        };
    }

    console.log(`[Browser Search] Bing: Found ${results.length} results`);
    return formatResults(query, results, 'Bing');
}

/**
 * Handle Bing's cookie consent dialog.
 *
 * @param {import('playwright-core').Page} page
 */
async function handleBingConsent(page) {
    try {
        const buttonSelectors = [
            '#bnp_btn_accept',
            'button:has-text("Accept")',
            'button:has-text("Accept all")',
            'button:has-text("I agree")',
            '[aria-label*="Accept"]',
        ];

        for (const selector of buttonSelectors) {
            try {
                const button = page.locator(selector).first();
                if (await button.isVisible({ timeout: 500 })) {
                    console.log(`[Browser Search] Bing consent: ${selector}`);
                    await button.click();
                    await page.waitForTimeout(500);
                    return;
                }
            } catch {
                // Try next
            }
        }
    } catch {
        // No consent dialog
    }
}

/**
 * Search using Google.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} query
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function searchGoogle(page, query, maxResults, timeout) {
    console.log(`[Browser Search] Google: "${query}"`);

    const randomDelay = 500 + Math.random() * 1000;
    await page.waitForTimeout(randomDelay);

    const currentUrl = page.url();
    const needsSession = currentUrl === 'about:blank' ||
                        (!currentUrl.includes('google.com') && !currentUrl.includes('bing.com'));

    if (needsSession) {
        console.log('[Browser Search] Google: Establishing session...');
        await page.goto('https://www.google.com', {
            waitUntil: 'domcontentloaded',
            timeout,
        });
        await handleGoogleConsent(page);
        await page.waitForTimeout(500 + Math.random() * 500);
    }

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
    await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
    });

    await handleGoogleConsent(page);

    const blockStatus = await page.evaluate(() => {
        const text = document.body.textContent || '';
        const title = document.title || '';

        if (text.includes('unusual traffic') || text.includes('CAPTCHA')) {
            return 'captcha';
        }
        if (text.includes('Before you continue') && text.includes('cookies')) {
            return 'consent';
        }
        if (title.includes('Sorry') || text.includes('sorry')) {
            return 'blocked';
        }
        return 'ok';
    });

    if (blockStatus === 'captcha' || blockStatus === 'blocked') {
        console.log(`[Browser Search] Google: ${blockStatus} detected`);
        return {
            success: false,
            error: 'Google is blocking searches from this IP.',
        };
    } else if (blockStatus === 'consent') {
        await handleGoogleConsent(page);
        await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(1500 + Math.random() * 500);

    try {
        await page.waitForSelector('h3', { timeout: 5000 });
    } catch {
        console.log('[Browser Search] Google: No h3 elements found');
    }

    const results = await page.evaluate((max) => {
        const items = [];
        const h3Elements = document.querySelectorAll('h3');

        for (const h3 of h3Elements) {
            if (items.length >= max) break;

            const link = h3.closest('a');
            if (!link || !link.href) continue;

            const url = link.href;

            if (url.includes('google.com/search') ||
                url.includes('google.com/url') ||
                url.includes('accounts.google') ||
                url.includes('support.google') ||
                url.includes('policies.google')) {
                continue;
            }

            const title = h3.textContent?.trim() || '';
            if (!title) continue;

            let snippet = '';
            const container = h3.closest('div[data-hveid]') ||
                             h3.closest('div.g') ||
                             link.parentElement?.parentElement?.parentElement;

            if (container) {
                const textElements = container.querySelectorAll('span, div, em');
                for (const el of textElements) {
                    const text = el.textContent?.trim() || '';
                    if (text.length > 40 &&
                        text.length < 400 &&
                        text !== title &&
                        !text.includes(title) &&
                        !text.startsWith('http') &&
                        !text.includes('›')) {
                        snippet = text;
                        break;
                    }
                }
            }

            items.push({ title, url, snippet });
        }

        return items;
    }, maxResults);

    if (results.length === 0) {
        const debugInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            h3Count: document.querySelectorAll('h3').length,
            bodyLength: document.body.innerText.length,
        }));
        console.log('[Browser Search] Google: No results. Debug:', JSON.stringify(debugInfo));

        return {
            success: false,
            error: `No results from Google for "${query}"`,
        };
    }

    console.log(`[Browser Search] Google: Found ${results.length} results`);
    return formatResults(query, results, 'Google');
}

/**
 * Handle Google's cookie consent dialog.
 *
 * @param {import('playwright-core').Page} page
 */
async function handleGoogleConsent(page) {
    try {
        const buttonSelectors = [
            'button:has-text("Accept all")',
            'button:has-text("Accept")',
            'button:has-text("I agree")',
            'button:has-text("Agree")',
            'button:has-text("Akzeptieren")',
            'button:has-text("Accepter")',
            '[aria-label*="Accept"]',
            '#L2AGLb',
        ];

        for (const selector of buttonSelectors) {
            try {
                const button = page.locator(selector).first();
                if (await button.isVisible({ timeout: 1000 })) {
                    console.log(`[Browser Search] Google consent: ${selector}`);
                    await button.click();
                    await page.waitForTimeout(1000);
                    return;
                }
            } catch {
                // Try next
            }
        }
    } catch {
        // No consent dialog
    }
}

/**
 * Format search results for output.
 *
 * @param {string} query
 * @param {Array} results
 * @param {string} [engine='Web'] - Search engine name
 * @returns {Object}
 */
function formatResults(query, results, engine = 'Web') {
    const formatted = results.map((r, i) => {
        let entry = `${i + 1}. ${r.title}`;
        if (r.snippet) {
            entry += `\n   ${r.snippet}`;
        }
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
    searchBing,
    searchGoogle,
    setSerperApiKey,
    getSerperApiKey,
};
