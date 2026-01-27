/**
 * Playwright persistent session management.
 * Maintains a singleton Browser connected via CDP, tracks page state
 * (console, errors, network), and resolves pages by targetId.
 */

const { chromium } = require('playwright-core');
const { getChromeWebSocketUrl } = require('./cdp-helpers');

// --- Types ---

/**
 * @typedef {Object} BrowserConsoleMessage
 * @property {string} type
 * @property {string} text
 * @property {string} timestamp
 * @property {Object} [location]
 */

/**
 * @typedef {Object} BrowserPageError
 * @property {string} message
 * @property {string} [name]
 * @property {string} [stack]
 * @property {string} timestamp
 */

/**
 * @typedef {Object} BrowserNetworkRequest
 * @property {string} id
 * @property {string} timestamp
 * @property {string} method
 * @property {string} url
 * @property {string} [resourceType]
 * @property {number} [status]
 * @property {boolean} [ok]
 * @property {string} [failureText]
 */

/**
 * @typedef {Object} PageState
 * @property {BrowserConsoleMessage[]} console
 * @property {BrowserPageError[]} errors
 * @property {BrowserNetworkRequest[]} requests
 * @property {Object} [roleRefs] - e1/e2 refs from last snapshot
 * @property {'role'|'aria'} [roleRefsMode]
 * @property {string} [roleRefsFrameSelector]
 */

// --- Singletons ---

const pageStates = new WeakMap();
const observedPages = new WeakSet();

/** @type {{browser: import('playwright-core').Browser, cdpUrl: string} | null} */
let cached = null;
/** @type {Promise<{browser: import('playwright-core').Browser, cdpUrl: string}> | null} */
let connecting = null;

// Role refs cache: keyed by `${cdpUrl}::${targetId}`, LRU max 50
const roleRefsByTarget = new Map();
const MAX_ROLE_REFS_CACHE = 50;

const MAX_CONSOLE = 500;
const MAX_ERRORS = 200;
const MAX_REQUESTS = 500;

// --- Connection ---

function normalizeCdpUrl(raw) {
    return raw.replace(/\/$/, '');
}

/**
 * Connect to a browser via CDP. Singleton with retry.
 * @param {string} cdpUrl
 * @returns {Promise<{browser: import('playwright-core').Browser, cdpUrl: string}>}
 */
async function connectBrowser(cdpUrl) {
    const normalized = normalizeCdpUrl(cdpUrl);
    if (cached?.cdpUrl === normalized) return cached;
    if (connecting) return await connecting;

    const connectWithRetry = async () => {
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const timeout = 5000 + attempt * 2000;
                const wsUrl = await getChromeWebSocketUrl(normalized, timeout).catch(() => null);
                const endpoint = wsUrl || normalized;
                const browser = await chromium.connectOverCDP(endpoint, { timeout });
                const connected = { browser, cdpUrl: normalized };
                cached = connected;

                // Observe all existing pages
                for (const ctx of browser.contexts()) {
                    for (const page of ctx.pages()) ensurePageState(page);
                    ctx.on('page', page => ensurePageState(page));
                }

                browser.on('disconnected', () => {
                    if (cached?.browser === browser) cached = null;
                });

                return connected;
            } catch (err) {
                lastErr = err;
                await new Promise(r => setTimeout(r, 250 + attempt * 250));
            }
        }
        throw lastErr || new Error('CDP connect failed');
    };

    connecting = connectWithRetry().finally(() => { connecting = null; });
    return await connecting;
}

// --- Page State ---

/**
 * Initialize page state tracking (console, errors, network).
 * Safe to call multiple times — only installs listeners once.
 * @param {import('playwright-core').Page} page
 * @returns {PageState}
 */
function ensurePageState(page) {
    const existing = pageStates.get(page);
    if (existing) return existing;

    const state = {
        console: [],
        errors: [],
        requests: [],
        _requestIds: new WeakMap(),
        _nextRequestId: 0
    };
    pageStates.set(page, state);

    if (!observedPages.has(page)) {
        observedPages.add(page);

        page.on('console', (msg) => {
            state.console.push({
                type: msg.type(),
                text: msg.text(),
                timestamp: new Date().toISOString(),
                location: msg.location()
            });
            if (state.console.length > MAX_CONSOLE) state.console.shift();
        });

        page.on('pageerror', (err) => {
            state.errors.push({
                message: err?.message ? String(err.message) : String(err),
                name: err?.name ? String(err.name) : undefined,
                stack: err?.stack ? String(err.stack) : undefined,
                timestamp: new Date().toISOString()
            });
            if (state.errors.length > MAX_ERRORS) state.errors.shift();
        });

        page.on('request', (req) => {
            state._nextRequestId++;
            const id = `r${state._nextRequestId}`;
            state._requestIds.set(req, id);
            state.requests.push({
                id,
                timestamp: new Date().toISOString(),
                method: req.method(),
                url: req.url(),
                resourceType: req.resourceType()
            });
            if (state.requests.length > MAX_REQUESTS) state.requests.shift();
        });

        page.on('response', (resp) => {
            const req = resp.request();
            const id = state._requestIds.get(req);
            if (!id) return;
            const rec = state.requests.findLast(r => r.id === id);
            if (!rec) return;
            rec.status = resp.status();
            rec.ok = resp.ok();
        });

        page.on('requestfailed', (req) => {
            const id = state._requestIds.get(req);
            if (!id) return;
            const rec = state.requests.findLast(r => r.id === id);
            if (!rec) return;
            rec.failureText = req.failure()?.errorText;
            rec.ok = false;
        });

        page.on('close', () => {
            pageStates.delete(page);
            observedPages.delete(page);
        });
    }

    return state;
}

/**
 * Get page state (console, errors, network) for a page.
 * @param {import('playwright-core').Page} page
 * @returns {PageState|null}
 */
function getPageState(page) {
    return pageStates.get(page) || null;
}

// --- Page Resolution ---

/**
 * Get all pages from a browser.
 * @param {import('playwright-core').Browser} browser
 * @returns {import('playwright-core').Page[]}
 */
function getAllPages(browser) {
    return browser.contexts().flatMap(c => c.pages());
}

/**
 * Get a page's CDP targetId.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string|null>}
 */
async function pageTargetId(page) {
    const session = await page.context().newCDPSession(page);
    try {
        const info = await session.send('Target.getTargetInfo');
        return String(info?.targetInfo?.targetId || '').trim() || null;
    } finally {
        await session.detach().catch(() => {});
    }
}

/**
 * Find a page by targetId, or return the first page if no targetId given.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @returns {Promise<import('playwright-core').Page>}
 */
async function getPageForTargetId(opts) {
    const { browser } = await connectBrowser(opts.cdpUrl);
    const pages = getAllPages(browser);
    if (!pages.length) throw new Error('No pages available in the connected browser.');
    if (!opts.targetId) return pages[0];

    for (const page of pages) {
        const tid = await pageTargetId(page).catch(() => null);
        if (tid && tid === opts.targetId) return page;
    }

    // Fallback: if only one page, use it
    if (pages.length === 1) return pages[0];
    throw new Error('tab not found');
}

// --- Role Refs Caching ---

function roleRefsKey(cdpUrl, targetId) {
    return `${normalizeCdpUrl(cdpUrl)}::${targetId}`;
}

/**
 * Store role refs for a target at both page-level and target-level cache.
 * @param {Object} opts
 * @param {import('playwright-core').Page} opts.page
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @param {Object} opts.refs
 * @param {string} [opts.frameSelector]
 * @param {'role'|'aria'} opts.mode
 */
function storeRoleRefsForTarget(opts) {
    const state = ensurePageState(opts.page);
    state.roleRefs = opts.refs;
    state.roleRefsFrameSelector = opts.frameSelector;
    state.roleRefsMode = opts.mode;

    if (!opts.targetId?.trim()) return;
    const key = roleRefsKey(opts.cdpUrl, opts.targetId);
    roleRefsByTarget.set(key, {
        refs: opts.refs,
        frameSelector: opts.frameSelector,
        mode: opts.mode
    });
    // LRU eviction
    while (roleRefsByTarget.size > MAX_ROLE_REFS_CACHE) {
        const first = roleRefsByTarget.keys().next();
        if (first.done) break;
        roleRefsByTarget.delete(first.value);
    }
}

/**
 * Restore cached role refs for a target into the page state.
 * Used when Playwright returns a different Page object for the same target.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @param {import('playwright-core').Page} opts.page
 */
function restoreRoleRefsForTarget(opts) {
    const targetId = opts.targetId?.trim() || '';
    if (!targetId) return;
    const entry = roleRefsByTarget.get(roleRefsKey(opts.cdpUrl, targetId));
    if (!entry) return;
    const state = ensurePageState(opts.page);
    if (state.roleRefs) return; // Already has refs
    state.roleRefs = entry.refs;
    state.roleRefsFrameSelector = entry.frameSelector;
    state.roleRefsMode = entry.mode;
}

// --- Listing ---

/**
 * List all pages via the persistent Playwright connection.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @returns {Promise<Array<{targetId: string, title: string, url: string, type: string}>>}
 */
async function listPagesViaPlaywright(opts) {
    const { browser } = await connectBrowser(opts.cdpUrl);
    const pages = getAllPages(browser);
    const results = [];

    for (const page of pages) {
        const tid = await pageTargetId(page).catch(() => null);
        if (tid) {
            results.push({
                targetId: tid,
                title: await page.title().catch(() => ''),
                url: page.url(),
                type: 'page'
            });
        }
    }
    return results;
}

/**
 * Disconnect the cached Playwright browser connection.
 */
async function disconnectBrowser() {
    const cur = cached;
    cached = null;
    if (!cur) return;
    await cur.browser.close().catch(() => {});
}

module.exports = {
    connectBrowser,
    ensurePageState,
    getPageState,
    getPageForTargetId,
    pageTargetId,
    getAllPages,
    storeRoleRefsForTarget,
    restoreRoleRefsForTarget,
    listPagesViaPlaywright,
    disconnectBrowser
};
