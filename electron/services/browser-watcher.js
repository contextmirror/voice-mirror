/**
 * Browser request watcher service for Voice Mirror Electron.
 * Watches for browser requests from Claude via MCP.
 * Supports: search, fetch, and embedded webview browser control.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

/**
 * Create a browser watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {string} options.serperApiKey - Serper.dev API key for web search
 * @returns {Object} Browser watcher service instance
 */
function createBrowserWatcher(options = {}) {
    const { dataDir, serperApiKey, onActivity } = options;

    let watcher = null;
    let browserModule = null;
    let controllerModule = null;

    function getBrowserModule() {
        if (!browserModule) {
            browserModule = require('../browser');
            if (serperApiKey) {
                browserModule.setSerperApiKey(serperApiKey);
            }
        }
        return browserModule;
    }

    function getController() {
        if (!controllerModule) {
            controllerModule = require('../browser/browser-controller');
        }
        return controllerModule;
    }

    function start() {
        if (watcher) {
            console.log('[BrowserWatcher] Already running');
            return;
        }

        const { getDataDir } = require('./platform-paths');
        const contextMirrorDir = dataDir || getDataDir();
        const requestPath = path.join(contextMirrorDir, 'browser_request.json');
        const responsePath = path.join(contextMirrorDir, 'browser_response.json');

        let processing = false;

        async function processRequest() {
            if (processing) return;
            processing = true;
            try {
                let raw;
                try {
                    raw = await fsPromises.readFile(requestPath, 'utf-8');
                } catch {
                    return; // File doesn't exist or read error
                }

                const request = JSON.parse(raw);
                const requestTime = new Date(request.timestamp).getTime();
                const now = Date.now();

                // Delete request immediately to prevent duplicate processing
                try { await fsPromises.unlink(requestPath); } catch {}

                if (now - requestTime > 5000) return;

                console.log(`[BrowserWatcher] Request: ${request.action}`);
                if (onActivity) {
                    const toolMap = { search: 'browser_search', fetch: 'browser_fetch', navigate: 'browser_navigate', screenshot: 'browser_screenshot' };
                    onActivity(toolMap[request.action] || `browser_${request.action}`);
                }

                let result;
                const args = request.args || {};

                switch (request.action) {
                    case 'search':
                        result = await getBrowserModule().webSearch(args);
                        break;
                    case 'fetch':
                        result = await getBrowserModule().fetchUrl(args);
                        break;
                    case 'start':
                        result = await getController().ensureBrowserAvailable();
                        break;
                    case 'stop':
                        result = await getController().stopBrowser();
                        break;
                    case 'status':
                        result = await getController().getStatus();
                        break;
                    case 'navigate':
                        result = await getController().navigateTab(args.url);
                        break;
                    case 'screenshot':
                        result = await getController().screenshotTab(args);
                        break;
                    case 'snapshot':
                        result = await getController().snapshotTab(args);
                        break;
                    case 'act':
                        result = await getController().actOnTab(args.request || args);
                        break;
                    case 'tabs': {
                        // Webview is a single-tab browser — return current tab info
                        const status = await getController().getStatus();
                        result = {
                            ok: true,
                            tabs: status.url && status.url !== 'about:blank'
                                ? [{ targetId: 'webview', title: status.title || '', url: status.url }]
                                : []
                        };
                        break;
                    }
                    case 'open':
                        // Open = navigate to URL in the webview
                        result = await getController().navigateTab(args.url);
                        break;
                    case 'close_tab':
                        // Close = navigate to about:blank
                        result = await getController().stopBrowser();
                        break;
                    case 'focus':
                        // Single-tab webview — focus is a no-op
                        result = { ok: true, action: 'focus' };
                        break;
                    case 'console':
                        result = await getController().getConsoleLog();
                        break;
                    case 'cookies': {
                        const ctrl = getController();
                        switch (args.action) {
                            case 'list':   result = await ctrl.getCookies(args); break;
                            case 'set':    result = await ctrl.setCookie(args); break;
                            case 'delete': result = await ctrl.deleteCookies(args); break;
                            case 'clear':  result = await ctrl.clearCookies(); break;
                            default: result = { ok: false, error: `Unknown cookie action: ${args.action}` };
                        }
                        break;
                    }
                    case 'storage': {
                        const ctrl = getController();
                        switch (args.action) {
                            case 'get':    result = await ctrl.getStorage(args); break;
                            case 'set':    result = await ctrl.setStorage(args); break;
                            case 'delete': result = await ctrl.deleteStorage(args); break;
                            case 'clear':  result = await ctrl.clearStorage(args); break;
                            default: result = { ok: false, error: `Unknown storage action: ${args.action}` };
                        }
                        break;
                    }
                    default:
                        result = { success: false, error: `Unknown browser action: ${request.action}` };
                }

                await fsPromises.writeFile(responsePath, JSON.stringify({
                    ...result,
                    request_id: request.id,
                    timestamp: new Date().toISOString()
                }));

                console.log(`[BrowserWatcher] Response written for ${request.action}`);
            } catch (err) {
                console.error('[BrowserWatcher] Error:', err);
            } finally {
                processing = false;
            }
        }

        // Use fs.watch on the data directory instead of polling
        try {
            watcher = fs.watch(contextMirrorDir, (eventType, filename) => {
                if (filename === 'browser_request.json') {
                    processRequest();
                }
            });
            watcher.on('error', (err) => {
                console.error('[BrowserWatcher] fs.watch error, falling back to polling:', err.message);
                watcher = null;
                watcher = setInterval(() => processRequest(), 2000);
            });
        } catch (err) {
            console.error('[BrowserWatcher] fs.watch unavailable, using polling fallback:', err.message);
            watcher = setInterval(() => processRequest(), 2000);
        }

        console.log('[BrowserWatcher] Started');
    }

    function stop() {
        if (watcher) {
            if (typeof watcher.close === 'function') {
                watcher.close(); // fs.watch
            } else {
                clearInterval(watcher); // polling fallback
            }
            watcher = null;
            console.log('[BrowserWatcher] Stopped');
        }
    }

    async function closeBrowser() {
        try {
            const ctrl = getController();
            await ctrl.stopBrowser();
            console.log('[BrowserWatcher] Browser stopped');
        } catch (err) {
            console.error('[BrowserWatcher] Error closing browser:', err.message);
        }
    }

    function isRunning() {
        return watcher !== null;
    }

    return {
        start,
        stop,
        closeBrowser,
        isRunning
    };
}

module.exports = {
    createBrowserWatcher
};
