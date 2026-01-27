/**
 * Page snapshot system.
 * Three formats: ARIA (accessibility tree), AI (Playwright internal), Role (e1/e2 refs).
 */

const { getPageForTargetId, ensurePageState, storeRoleRefsForTarget } = require('./pw-session');
const { buildRoleSnapshotFromAriaSnapshot, getRoleSnapshotStats } = require('./role-refs');

/**
 * Take a snapshot of a page in the specified format.
 * @param {Object} opts
 * @param {string} opts.cdpUrl
 * @param {string} [opts.targetId]
 * @param {'aria'|'ai'|'role'} [opts.format='role']
 * @param {boolean} [opts.interactive] - Only interactive elements (role format)
 * @param {boolean} [opts.compact] - Remove unnamed structural elements (role format)
 * @param {number} [opts.maxDepth] - Max tree depth (role format)
 * @param {number} [opts.limit] - Max nodes (aria format)
 * @param {number} [opts.maxChars] - Max chars (ai format)
 * @param {string} [opts.selector] - CSS selector to scope snapshot
 * @param {string} [opts.frameSelector] - iframe selector
 * @returns {Promise<Object>}
 */
async function takeSnapshot(opts) {
    const format = opts.format || 'role';

    switch (format) {
        case 'aria':
            return await takeAriaSnapshot(opts);
        case 'ai':
            return await takeAiSnapshot(opts);
        case 'role':
        default:
            return await takeRoleSnapshot(opts);
    }
}

/**
 * ARIA snapshot: accessibility tree via Playwright CDP session.
 */
async function takeAriaSnapshot(opts) {
    const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 500)));
    const page = await getPageForTargetId({ cdpUrl: opts.cdpUrl, targetId: opts.targetId });
    ensurePageState(page);

    const session = await page.context().newCDPSession(page);
    try {
        await session.send('Accessibility.enable').catch(() => {});
        const res = await session.send('Accessibility.getFullAXTree');
        const nodes = Array.isArray(res?.nodes) ? res.nodes : [];

        // Format into flat list
        const { formatAriaSnapshot } = require('./cdp-client');
        const formatted = formatAriaSnapshot(nodes, limit);

        return {
            ok: true,
            format: 'aria',
            nodes: formatted,
            stats: { nodeCount: formatted.length }
        };
    } finally {
        await session.detach().catch(() => {});
    }
}

/**
 * AI snapshot: Playwright's internal _snapshotForAI() format.
 * This is optimized for LLM consumption with visual layout info.
 */
async function takeAiSnapshot(opts) {
    const page = await getPageForTargetId({ cdpUrl: opts.cdpUrl, targetId: opts.targetId });
    ensurePageState(page);

    if (!page._snapshotForAI) {
        throw new Error('Playwright _snapshotForAI is not available. Upgrade playwright-core to 1.50+.');
    }

    const result = await page._snapshotForAI({
        timeout: Math.max(500, Math.min(60000, Math.floor(opts.timeoutMs ?? 5000))),
        track: 'response'
    });

    let snapshot = String(result?.full ?? '');
    const maxChars = opts.maxChars;
    let truncated = false;

    if (typeof maxChars === 'number' && maxChars > 0 && snapshot.length > maxChars) {
        snapshot = `${snapshot.slice(0, maxChars)}\n\n[...TRUNCATED - page too large]`;
        truncated = true;
    }

    return {
        ok: true,
        format: 'ai',
        snapshot,
        truncated,
        stats: { chars: snapshot.length }
    };
}

/**
 * Role snapshot: ARIA tree with e1/e2/... refs for interactive elements.
 * This is the primary format for agent interaction.
 */
async function takeRoleSnapshot(opts) {
    const page = await getPageForTargetId({ cdpUrl: opts.cdpUrl, targetId: opts.targetId });
    ensurePageState(page);

    const frameSelector = (opts.frameSelector || '').trim();
    const selector = (opts.selector || '').trim();

    // Build locator for the scope
    const locator = frameSelector
        ? (selector
            ? page.frameLocator(frameSelector).locator(selector)
            : page.frameLocator(frameSelector).locator(':root'))
        : (selector
            ? page.locator(selector)
            : page.locator(':root'));

    // Get ARIA snapshot text from Playwright
    const ariaSnapshot = await locator.ariaSnapshot();
    const ariaText = String(ariaSnapshot ?? '');

    // Build role snapshot with refs
    const options = {
        interactive: opts.interactive,
        compact: opts.compact,
        maxDepth: opts.maxDepth
    };
    const built = buildRoleSnapshotFromAriaSnapshot(ariaText, options);

    // Cache refs
    storeRoleRefsForTarget({
        page,
        cdpUrl: opts.cdpUrl,
        targetId: opts.targetId,
        refs: built.refs,
        frameSelector: frameSelector || undefined,
        mode: 'role'
    });

    const stats = getRoleSnapshotStats(built.snapshot, built.refs);

    return {
        ok: true,
        format: 'role',
        snapshot: built.snapshot,
        refs: built.refs,
        stats
    };
}

module.exports = {
    takeSnapshot,
    takeAriaSnapshot,
    takeAiSnapshot,
    takeRoleSnapshot
};
