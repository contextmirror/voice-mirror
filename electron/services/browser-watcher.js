/**
 * Browser request watcher service for Voice Mirror Electron.
 * Watches for browser requests from Claude via MCP.
 * Supports: search, fetch, and embedded webview browser control.
 */

const fs = require('fs');
const path = require('path');

/**
 * Create a browser watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {string} options.serperApiKey - Serper.dev API key for web search
 * @returns {Object} Browser watcher service instance
 */
function createBrowserWatcher(options = {}) {
    const { dataDir, serperApiKey } = options;

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

        const contextMirrorDir = dataDir || path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'voice-mirror-electron', 'data');
        const requestPath = path.join(contextMirrorDir, 'browser_request.json');
        const responsePath = path.join(contextMirrorDir, 'browser_response.json');

        watcher = setInterval(async () => {
            try {
                if (!fs.existsSync(requestPath)) return;

                const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
                const requestTime = new Date(request.timestamp).getTime();
                const now = Date.now();

                if (now - requestTime > 5000) {
                    fs.unlinkSync(requestPath);
                    return;
                }

                fs.unlinkSync(requestPath);

                console.log(`[BrowserWatcher] Request: ${request.action}`);

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
                    case 'console':
                        result = await getController().getConsoleLog();
                        break;
                    default:
                        result = { success: false, error: `Unknown browser action: ${request.action}` };
                }

                fs.writeFileSync(responsePath, JSON.stringify({
                    ...result,
                    request_id: request.id,
                    timestamp: new Date().toISOString()
                }, null, 2));

                console.log(`[BrowserWatcher] Response written for ${request.action}`);

            } catch (err) {
                console.error('[BrowserWatcher] Error:', err);
            }
        }, 500);

        console.log('[BrowserWatcher] Started');
    }

    function stop() {
        if (watcher) {
            clearInterval(watcher);
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
