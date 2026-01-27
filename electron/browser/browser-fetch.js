/**
 * URL content fetching for Voice Mirror headless browser.
 *
 * Provides:
 * - Fetch any URL and extract main content
 * - Handle JavaScript-rendered pages
 * - Clean extraction (remove nav, ads, scripts)
 * - Content truncation to prevent context overflow
 */

const { getPage } = require('./browser-session');
const {
    normalizeTimeoutMs,
    toAIFriendlyError,
    waitForRateLimit,
    truncateText,
} = require('./browser-utils');

// Maximum content length to return (8000 chars by default)
const DEFAULT_MAX_CONTENT_LENGTH = 8000;

/**
 * Fetch and extract content from a URL.
 *
 * @param {Object} args - Fetch arguments
 * @param {string} args.url - The URL to fetch
 * @param {number} [args.timeout=30000] - Timeout in milliseconds
 * @param {number} [args.max_length=8000] - Maximum content length
 * @param {boolean} [args.include_links=false] - Include links in output
 * @returns {Promise<Object>} Fetched content
 */
async function fetchUrl(args = {}) {
    const {
        url,
        timeout = 30000,
        max_length = DEFAULT_MAX_CONTENT_LENGTH,
        include_links = false,
    } = args;

    if (!url) {
        return {
            success: false,
            error: 'URL is required',
        };
    }

    // Validate URL
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return {
            success: false,
            error: `Invalid URL: ${url}`,
        };
    }

    // Rate limiting
    await waitForRateLimit();

    const normalizedTimeout = normalizeTimeoutMs(timeout, 30000);

    try {
        const page = await getPage();

        console.log(`[Browser Fetch] Loading: ${url}`);

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: normalizedTimeout,
        });

        // Wait a bit for JavaScript rendering
        await page.waitForTimeout(1500);

        // Try to wait for main content to appear
        try {
            await page.waitForSelector('main, article, .content, #content, .post, body', {
                timeout: 5000,
            });
        } catch {
            // Continue anyway
        }

        // Extract content
        const content = await page.evaluate((opts) => {
            const { includeLinks } = opts;

            // Remove unwanted elements
            const selectorsToRemove = [
                'script',
                'style',
                'noscript',
                'nav',
                'footer',
                'header',
                'aside',
                '.ad',
                '.ads',
                '.advertisement',
                '.sidebar',
                '.nav',
                '.navigation',
                '.menu',
                '.cookie',
                '.popup',
                '.modal',
                '.banner',
                '[role="navigation"]',
                '[role="banner"]',
                '[role="complementary"]',
                '[aria-hidden="true"]',
                'iframe',
                'svg',
            ];

            // Clone body to avoid modifying the actual page
            const clone = document.body.cloneNode(true);

            // Remove unwanted elements
            for (const selector of selectorsToRemove) {
                const elements = clone.querySelectorAll(selector);
                elements.forEach(el => el.remove());
            }

            // Find main content container
            const mainSelectors = [
                'main',
                'article',
                '[role="main"]',
                '.content',
                '#content',
                '.post',
                '.article',
                '.post-content',
                '.entry-content',
            ];

            let mainContent = null;
            for (const selector of mainSelectors) {
                mainContent = clone.querySelector(selector);
                if (mainContent) break;
            }

            // Fall back to body if no main content found
            const contentEl = mainContent || clone;

            // Extract text
            let text = contentEl.innerText || contentEl.textContent || '';

            // Clean up whitespace
            text = text
                .replace(/\n{3,}/g, '\n\n')  // Reduce multiple newlines
                .replace(/[ \t]+/g, ' ')      // Reduce multiple spaces
                .trim();

            // Optionally extract links
            let links = [];
            if (includeLinks) {
                const anchors = contentEl.querySelectorAll('a[href]');
                links = Array.from(anchors)
                    .map(a => ({
                        text: a.textContent?.trim() || '',
                        href: a.href,
                    }))
                    .filter(l => l.text && l.href && l.href.startsWith('http'))
                    .slice(0, 20);  // Limit to 20 links
            }

            return { text, links };
        }, { includeLinks: include_links });

        // Get page metadata
        const title = await page.title().catch(() => '');
        const finalUrl = page.url();

        // Truncate content
        const truncatedContent = truncateText(content.text, max_length);

        // Format result
        let result = truncatedContent;

        if (include_links && content.links.length > 0) {
            result += '\n\n---\nLinks:\n';
            result += content.links.map(l => `- ${l.text}: ${l.href}`).join('\n');
        }

        console.log(`[Browser Fetch] Extracted ${content.text.length} chars from ${finalUrl}`);

        return {
            success: true,
            result,
            title,
            url: finalUrl,
            content_length: content.text.length,
            truncated: content.text.length > max_length,
        };

    } catch (err) {
        const friendlyError = toAIFriendlyError(err, url);
        console.error('[Browser Fetch] Error:', friendlyError.message);
        return {
            success: false,
            error: friendlyError.message,
        };
    }
}

/**
 * Fetch a URL and return raw HTML (for debugging or advanced use).
 *
 * @param {Object} args - Fetch arguments
 * @param {string} args.url - The URL to fetch
 * @param {number} [args.timeout=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} Raw HTML content
 */
async function fetchHtml(args = {}) {
    const { url, timeout = 30000 } = args;

    if (!url) {
        return {
            success: false,
            error: 'URL is required',
        };
    }

    await waitForRateLimit();

    const normalizedTimeout = normalizeTimeoutMs(timeout, 30000);

    try {
        const page = await getPage();

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: normalizedTimeout,
        });

        const html = await page.content();
        const title = await page.title().catch(() => '');

        return {
            success: true,
            result: html,
            title,
            url: page.url(),
        };

    } catch (err) {
        const friendlyError = toAIFriendlyError(err, url);
        return {
            success: false,
            error: friendlyError.message,
        };
    }
}

module.exports = {
    fetchUrl,
    fetchHtml,
    DEFAULT_MAX_CONTENT_LENGTH,
};
