/**
 * Browser controller — profile-scoped operations.
 * Manages browser lifecycle, tab CRUD, and coordinates between
 * chrome-launcher, pw-session, and extension-relay.
 */

const { loadConfig, resolveProfile, listProfileNames } = require('./config');
const { launchManagedChrome, stopManagedChrome, isCdpReady, isCdpHttpReachable } = require('./chrome-launcher');
const { getPageForTargetId, ensurePageState, getPageState, listPagesViaPlaywright, disconnectBrowser } = require('./pw-session');
const { createTargetViaCdp } = require('./cdp-client');
const { fetchJson, appendCdpPath, normalizeCdpWsUrl } = require('./cdp-helpers');
const { takeSnapshot } = require('./snapshot');
const { executeAction } = require('./actions');

/** @type {Map<string, import('./chrome-launcher').RunningChrome>} */
const runningBrowsers = new Map();

/** @type {Map<string, string>} */
const lastTargetIds = new Map();

/**
 * Get or create a profile context for browser operations.
 * @param {string} [profileName]
 * @returns {{profile: import('./config').ResolvedProfile, config: import('./config').BrowserConfig}}
 */
function resolveProfileContext(profileName) {
    const config = loadConfig();
    const profile = resolveProfile(config, profileName);
    if (!profile) {
        const available = listProfileNames(config).join(', ');
        throw new Error(`Profile "${profileName || config.defaultProfile}" not found. Available: ${available || '(none)'}`);
    }
    return { profile, config };
}

/**
 * Ensure the browser is running and reachable.
 */
async function ensureBrowserAvailable(profileName) {
    const { profile, config } = resolveProfileContext(profileName);

    if (profile.driver === 'extension') {
        // Extension mode: check if relay + extension are connected
        let relayModule;
        try { relayModule = require('./extension-relay'); } catch { /* not available yet */ }

        const httpReachable = await isCdpHttpReachable(profile.cdpUrl, 500);
        if (!httpReachable && relayModule) {
            await relayModule.ensureExtensionRelayServer({ cdpUrl: profile.cdpUrl });
            if (!(await isCdpHttpReachable(profile.cdpUrl, 1200))) {
                throw new Error(`Extension relay for profile "${profile.name}" is not reachable at ${profile.cdpUrl}.`);
            }
        }
        if (!(await isCdpReady(profile.cdpUrl, 600, 800))) {
            throw new Error(
                `Extension relay is running, but no tab is connected. ` +
                `Click the Voice Mirror Browser Relay extension icon on a tab to attach it.`
            );
        }
        return { ok: true, profile: profile.name, driver: 'extension' };
    }

    // Managed mode
    const httpReachable = await isCdpHttpReachable(profile.cdpUrl, 500);
    if (httpReachable) {
        if (await isCdpReady(profile.cdpUrl, 500, 800)) {
            return { ok: true, profile: profile.name, driver: 'managed', alreadyRunning: true };
        }
        // HTTP up but WS down — restart
        const existing = runningBrowsers.get(profile.name);
        if (existing) {
            await stopManagedChrome(existing);
            runningBrowsers.delete(profile.name);
        }
    }

    if (!runningBrowsers.has(profile.name)) {
        const running = await launchManagedChrome({ profile, config });
        runningBrowsers.set(profile.name, running);
        running.proc.on('exit', () => {
            if (runningBrowsers.get(profile.name) === running) {
                runningBrowsers.delete(profile.name);
            }
        });
    }

    return { ok: true, profile: profile.name, driver: 'managed' };
}

/**
 * Stop the browser for a profile.
 */
async function stopBrowser(profileName) {
    const { profile } = resolveProfileContext(profileName);

    if (profile.driver === 'extension') {
        try {
            const relayModule = require('./extension-relay');
            await relayModule.stopExtensionRelayServer({ cdpUrl: profile.cdpUrl });
        } catch { /* ignore */ }
        return { ok: true, stopped: true };
    }

    const running = runningBrowsers.get(profile.name);
    if (!running) return { ok: true, stopped: false, reason: 'not running' };

    await disconnectBrowser();
    await stopManagedChrome(running);
    runningBrowsers.delete(profile.name);
    return { ok: true, stopped: true };
}

/**
 * Get browser status.
 */
async function getStatus(profileName) {
    const { profile, config } = resolveProfileContext(profileName);
    const httpReachable = await isCdpHttpReachable(profile.cdpUrl, 300);
    const cdpReady = httpReachable ? await isCdpReady(profile.cdpUrl, 300, 500) : false;
    const running = runningBrowsers.has(profile.name);

    let tabCount = 0;
    if (cdpReady) {
        try {
            const tabs = await listTabs(profileName);
            tabCount = tabs.length;
        } catch { /* ignore */ }
    }

    return {
        ok: true,
        profile: profile.name,
        driver: profile.driver,
        running: running || httpReachable,
        cdpReady,
        cdpUrl: profile.cdpUrl,
        tabCount
    };
}

/**
 * List all open tabs.
 */
async function listTabs(profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);

    // Try Playwright persistent connection
    try {
        const pages = await listPagesViaPlaywright({ cdpUrl: profile.cdpUrl });
        if (pages.length > 0) return pages;
    } catch { /* fallback to CDP REST */ }

    // CDP REST fallback
    try {
        const raw = await fetchJson(appendCdpPath(profile.cdpUrl, '/json/list'), 1500);
        return (raw || [])
            .filter(t => t.type === 'page' || !t.type)
            .map(t => ({
                targetId: t.id || '',
                title: t.title || '',
                url: t.url || '',
                type: t.type || 'page'
            }))
            .filter(t => t.targetId);
    } catch (err) {
        throw new Error(`Failed to list tabs: ${err.message}`);
    }
}

/**
 * Open a new tab with URL.
 */
async function openTab(url, profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);

    // Try CDP createTarget first
    try {
        const { targetId } = await createTargetViaCdp({ cdpUrl: profile.cdpUrl, url });
        lastTargetIds.set(profile.name, targetId);

        // Wait for tab to appear
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const tabs = await listTabs(profileName).catch(() => []);
            const found = tabs.find(t => t.targetId === targetId);
            if (found) return found;
            await new Promise(r => setTimeout(r, 100));
        }
        return { targetId, title: '', url, type: 'page' };
    } catch { /* fallback */ }

    // Fallback: /json/new
    try {
        const endpoint = appendCdpPath(profile.cdpUrl, `/json/new?${encodeURIComponent(url)}`);
        const created = await fetchJson(endpoint, 1500);
        if (created?.id) {
            lastTargetIds.set(profile.name, created.id);
            return {
                targetId: created.id,
                title: created.title || '',
                url: created.url || url,
                type: created.type || 'page'
            };
        }
    } catch { /* ignore */ }

    throw new Error('Failed to open tab. Browser may not be responding.');
}

/**
 * Close a tab by targetId.
 */
async function closeTab(targetId, profileName) {
    const { profile } = resolveProfileContext(profileName);
    if (!targetId) throw new Error('targetId is required');

    try {
        await fetchJson(appendCdpPath(profile.cdpUrl, `/json/close/${targetId}`), 1500);
        return { ok: true, closed: targetId };
    } catch {
        throw new Error(`Failed to close tab ${targetId}`);
    }
}

/**
 * Focus/activate a tab.
 */
async function focusTab(targetId, profileName) {
    const { profile } = resolveProfileContext(profileName);
    if (!targetId) throw new Error('targetId is required');

    lastTargetIds.set(profile.name, targetId);
    try {
        await fetchJson(appendCdpPath(profile.cdpUrl, `/json/activate/${targetId}`), 1500);
        return { ok: true, focused: targetId };
    } catch {
        throw new Error(`Failed to focus tab ${targetId}`);
    }
}

/**
 * Navigate a tab to a URL.
 */
async function navigateTab(url, targetId, profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);
    const { navigateAction } = require('./actions');
    return await navigateAction({ cdpUrl: profile.cdpUrl, targetId, url });
}

/**
 * Get console logs for a tab.
 */
async function getConsoleLog(targetId, profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);
    const page = await getPageForTargetId({ cdpUrl: profile.cdpUrl, targetId });
    const state = getPageState(page);
    if (!state) return { ok: true, console: [], errors: [] };
    return {
        ok: true,
        console: state.console.slice(-50),
        errors: state.errors.slice(-20)
    };
}

/**
 * Take a page snapshot.
 */
async function snapshotTab(opts, profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);
    return await takeSnapshot({ ...opts, cdpUrl: profile.cdpUrl });
}

/**
 * Execute a browser action on a tab.
 */
async function actOnTab(request, targetId, profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);
    return await executeAction(request, { cdpUrl: profile.cdpUrl, targetId });
}

/**
 * Take a screenshot of a tab.
 */
async function screenshotTab(opts, profileName) {
    const { profile } = resolveProfileContext(profileName);
    await ensureBrowserAvailable(profileName);
    const { screenshotAction } = require('./actions');
    return await screenshotAction({ ...opts, cdpUrl: profile.cdpUrl });
}

/**
 * List all profiles with their status.
 */
async function listProfiles() {
    const config = loadConfig();
    const results = [];
    for (const name of listProfileNames(config)) {
        try {
            const status = await getStatus(name);
            results.push(status);
        } catch {
            results.push({ profile: name, running: false, cdpReady: false });
        }
    }
    return results;
}

module.exports = {
    ensureBrowserAvailable,
    stopBrowser,
    getStatus,
    listTabs,
    openTab,
    closeTab,
    focusTab,
    navigateTab,
    getConsoleLog,
    snapshotTab,
    actOnTab,
    screenshotTab,
    listProfiles
};
