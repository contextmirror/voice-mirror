/**
 * Browser utilities for Voice Mirror headless browser.
 *
 * Provides:
 * - Timeout normalization (clamp to safe bounds)
 * - AI-friendly error messages
 * - Anti-detection setup (webdriver flag, user-agent, viewport)
 * - Rate limiting helpers
 *
 * Patterns ported from clawdbot pw-tools-core.shared.ts
 */

// User agents for rotation (modern Chrome on different platforms)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// Rate limiting state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 2000; // 2 seconds between requests

/**
 * Normalize timeout to safe bounds.
 * Clamps between 500ms (min) and 120s (max).
 *
 * @param {number|undefined} timeoutMs - User-provided timeout
 * @param {number} fallback - Default timeout if not provided
 * @returns {number} Clamped timeout in milliseconds
 */
function normalizeTimeoutMs(timeoutMs, fallback = 30000) {
    return Math.max(500, Math.min(120000, timeoutMs ?? fallback));
}

/**
 * Convert Playwright/browser errors to AI-friendly messages.
 * Makes error messages actionable and understandable.
 *
 * @param {Error|unknown} error - The original error
 * @param {string} context - What was being attempted (URL, action, etc.)
 * @returns {Error} Error with AI-friendly message
 */
function toAIFriendlyError(error, context) {
    const message = error instanceof Error ? error.message : String(error);

    // Timeout errors
    if (message.includes('Timeout') || message.includes('timeout') || message.includes('Navigation timeout')) {
        return new Error(
            `Page load timeout for "${context}". The site may be slow, blocking automated access, or offline.`
        );
    }

    // Network errors
    if (message.includes('net::ERR_') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
        return new Error(
            `Network error accessing "${context}". Check your internet connection or the URL may be invalid.`
        );
    }

    // Blocked/CAPTCHA
    if (message.includes('blocked') || message.includes('403') || message.includes('captcha') || message.includes('CAPTCHA')) {
        return new Error(
            `Access blocked for "${context}". The site may have detected automated access. Try waiting a few minutes or use a different search query.`
        );
    }

    // SSL/Certificate errors
    if (message.includes('SSL') || message.includes('certificate') || message.includes('CERT_')) {
        return new Error(
            `SSL certificate error for "${context}". The site may have security issues.`
        );
    }

    // Element not found (for future browser_act)
    if (message.includes('strict mode violation')) {
        const countMatch = message.match(/resolved to (\d+) elements/);
        const count = countMatch ? countMatch[1] : 'multiple';
        return new Error(
            `Selector matched ${count} elements. Run a new snapshot to get updated refs.`
        );
    }

    if (message.includes('not visible') || message.includes('not interactable')) {
        return new Error(
            `Element not found or not visible. The page may have changed. Run a new snapshot.`
        );
    }

    // Return original error if no special handling
    return error instanceof Error ? error : new Error(message);
}

/**
 * Get a random user agent for anti-detection.
 *
 * @returns {string} A random user agent string
 */
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Set up anti-detection measures on a page.
 *
 * @param {import('playwright-core').Page} page - Playwright page object
 */
async function setupAntiDetect(page) {
    // Override webdriver detection
    await page.addInitScript(() => {
        // Remove webdriver flag
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });

        // Add plugins (empty array looks suspicious)
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });

        // Add languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });

        // Override permissions query
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });

    // Set realistic viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
}

/**
 * Wait for rate limiting if needed.
 * Ensures minimum interval between requests.
 *
 * @returns {Promise<void>}
 */
async function waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;

    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
        const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastRequestTime = Date.now();
}

/**
 * Reset rate limiting (for testing).
 */
function resetRateLimit() {
    lastRequestTime = 0;
}

/**
 * Truncate text to a maximum length with ellipsis.
 *
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 8000) {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '\n...(truncated)...';
}

module.exports = {
    normalizeTimeoutMs,
    toAIFriendlyError,
    getRandomUserAgent,
    setupAntiDetect,
    waitForRateLimit,
    resetRateLimit,
    truncateText,
    USER_AGENTS,
    MIN_REQUEST_INTERVAL_MS,
};
