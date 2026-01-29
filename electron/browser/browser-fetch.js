/**
 * URL content fetching via embedded webview.
 *
 * Navigates the webview to a URL and extracts main content via CDP.
 */

const cdp = require('./webview-cdp');

const DEFAULT_MAX_CONTENT_LENGTH = 8000;

/**
 * Fetch and extract content from a URL.
 *
 * @param {Object} args
 * @param {string} args.url - The URL to fetch
 * @param {number} [args.max_length=8000] - Maximum content length
 * @param {boolean} [args.include_links=false] - Include links in output
 * @returns {Promise<Object>} Fetched content
 */
async function fetchUrl(args = {}) {
    const { url, max_length = DEFAULT_MAX_CONTENT_LENGTH, include_links = false } = args;

    if (!url) {
        return { success: false, error: 'URL is required' };
    }

    try {
        new URL(url);
    } catch {
        return { success: false, error: `Invalid URL: ${url}` };
    }

    if (!cdp.isAttached()) {
        return { success: false, error: 'Browser not available. Open the Voice Mirror panel.' };
    }

    try {
        console.log(`[Browser Fetch] Loading: ${url}`);
        await cdp.navigate(url);
        await new Promise(r => setTimeout(r, 2000));

        // Extract content via Runtime.evaluate
        const { result } = await cdp.evaluate(`
            (function() {
                // Remove unwanted elements
                var selectorsToRemove = [
                    'script','style','noscript','nav','footer','header','aside',
                    '.ad','.ads','.advertisement','.sidebar','.nav','.navigation',
                    '.menu','.cookie','.popup','.modal','.banner',
                    '[role="navigation"]','[role="banner"]','[role="complementary"]',
                    '[aria-hidden="true"]','iframe','svg'
                ];
                var clone = document.body.cloneNode(true);
                selectorsToRemove.forEach(function(sel) {
                    clone.querySelectorAll(sel).forEach(function(el) { el.remove(); });
                });

                // Find main content
                var mainSelectors = ['main','article','[role="main"]','.content','#content','.post','.article'];
                var mainContent = null;
                for (var i = 0; i < mainSelectors.length; i++) {
                    mainContent = clone.querySelector(mainSelectors[i]);
                    if (mainContent) break;
                }
                var contentEl = mainContent || clone;
                var text = (contentEl.innerText || contentEl.textContent || '')
                    .replace(/\\n{3,}/g, '\\n\\n')
                    .replace(/[ \\t]+/g, ' ')
                    .trim();

                var links = [];
                if (${include_links ? 'true' : 'false'}) {
                    var anchors = contentEl.querySelectorAll('a[href]');
                    for (var j = 0; j < Math.min(anchors.length, 20); j++) {
                        var a = anchors[j];
                        var lt = (a.textContent || '').trim();
                        if (lt && a.href && a.href.startsWith('http')) {
                            links.push({ text: lt, href: a.href });
                        }
                    }
                }

                return { text: text, links: links, title: document.title || '' };
            })()
        `);

        const content = result?.value || { text: '', links: [], title: '' };
        const finalUrl = await cdp.getUrl();

        // Truncate
        const truncated = content.text.length > max_length;
        const resultText = truncated ? content.text.slice(0, max_length) + '\n\n...(content truncated)...' : content.text;

        let output = resultText;
        if (include_links && content.links.length > 0) {
            output += '\n\n---\nLinks:\n';
            output += content.links.map(l => `- ${l.text}: ${l.href}`).join('\n');
        }

        console.log(`[Browser Fetch] Extracted ${content.text.length} chars from ${finalUrl}`);

        return {
            success: true,
            result: output,
            title: content.title,
            url: finalUrl,
            content_length: content.text.length,
            truncated,
        };
    } catch (err) {
        console.error('[Browser Fetch] Error:', err.message);
        return { success: false, error: `Fetch failed: ${err.message}` };
    }
}

module.exports = {
    fetchUrl,
    DEFAULT_MAX_CONTENT_LENGTH,
};
