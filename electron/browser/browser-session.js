/**
 * Browser session management for Voice Mirror headless browser.
 *
 * Provides:
 * - Singleton Playwright browser instance (lazy-loaded)
 * - Persistent page reuse across requests
 * - Auto-reconnect on disconnect
 * - Graceful cleanup on app exit
 *
 * Patterns ported from clawdbot pw-session.ts
 */

const { getRandomUserAgent, setupAntiDetect } = require('./browser-utils');

// Singleton browser instance
let browserInstance = null;
let launchPromise = null;

// Reusable page for search/fetch operations
let cachedPage = null;

// Browser launch options for anti-detection
const LAUNCH_OPTIONS = {
    headless: true,
    args: [
        // Anti-detection
        '--disable-blink-features=AutomationControlled',
        // Performance
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Security (required for some Linux systems)
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Disable features that might leak automation detection
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
        // Reduce memory usage
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
    ],
};

/**
 * Get the singleton browser instance.
 * Lazy-loads Playwright and launches browser on first call.
 *
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function getBrowser() {
    if (browserInstance) {
        return browserInstance;
    }

    if (launchPromise) {
        return await launchPromise;
    }

    launchPromise = launchBrowser();

    try {
        browserInstance = await launchPromise;
        return browserInstance;
    } finally {
        launchPromise = null;
    }
}

/**
 * Launch a new browser instance with retry logic.
 *
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function launchBrowser() {
    // Lazy-load playwright-core to avoid startup cost if browser not needed
    const { chromium } = require('playwright-core');

    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            console.log(`[Browser] Launching browser (attempt ${attempt + 1}/3)...`);

            const browser = await chromium.launch(LAUNCH_OPTIONS);

            // Handle disconnection
            browser.on('disconnected', () => {
                console.log('[Browser] Browser disconnected');
                if (browserInstance === browser) {
                    browserInstance = null;
                    cachedPage = null;
                }
            });

            console.log('[Browser] Browser launched successfully');
            return browser;

        } catch (err) {
            lastError = err;
            console.error(`[Browser] Launch failed (attempt ${attempt + 1}):`, err.message);

            // Wait before retry
            const delay = 500 + attempt * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error('Failed to launch browser after 3 attempts');
}

/**
 * Get a reusable page for operations.
 * Creates a new page if needed, otherwise returns cached page.
 *
 * @param {Object} options - Page options
 * @param {boolean} options.fresh - Force create a new page
 * @returns {Promise<import('playwright-core').Page>}
 */
async function getPage(options = {}) {
    const { fresh = false } = options;

    // Return cached page if available and not requesting fresh
    if (cachedPage && !fresh) {
        try {
            // Check if page is still valid
            await cachedPage.evaluate(() => true);
            return cachedPage;
        } catch {
            // Page is stale, create new one
            cachedPage = null;
        }
    }

    const browser = await getBrowser();
    const context = browser.contexts()[0] || await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
    });

    const page = await context.newPage();

    // Set up anti-detection
    await setupAntiDetect(page);

    // Cache the page for reuse
    cachedPage = page;

    // Handle page close
    page.on('close', () => {
        if (cachedPage === page) {
            cachedPage = null;
        }
    });

    return page;
}

/**
 * Close the browser instance.
 * Should be called on app exit.
 */
async function closeBrowser() {
    const browser = browserInstance;
    browserInstance = null;
    cachedPage = null;

    if (!browser) {
        return;
    }

    try {
        console.log('[Browser] Closing browser...');
        await browser.close();
        console.log('[Browser] Browser closed');
    } catch (err) {
        console.error('[Browser] Error closing browser:', err.message);
    }
}

/**
 * Check if browser is currently running.
 *
 * @returns {boolean}
 */
function isBrowserRunning() {
    return browserInstance !== null;
}

/**
 * Check if browser connection is healthy.
 *
 * @returns {Promise<boolean>}
 */
async function isHealthy() {
    if (!browserInstance) {
        return false;
    }

    try {
        // Try to get contexts - will fail if disconnected
        browserInstance.contexts();
        return true;
    } catch {
        return false;
    }
}

/**
 * Restart the browser (close and reopen).
 *
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function restartBrowser() {
    await closeBrowser();
    return await getBrowser();
}

module.exports = {
    getBrowser,
    getPage,
    closeBrowser,
    isBrowserRunning,
    isHealthy,
    restartBrowser,
    LAUNCH_OPTIONS,
};
