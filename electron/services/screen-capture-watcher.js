/**
 * Screen capture watcher service for Voice Mirror Electron.
 * Watches for screen capture requests from Claude via MCP and fulfills them.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { screen, nativeImage } = require('electron');
const { captureDisplayWindows } = require('../lib/windows-screen-capture');
const { createJsonFileWatcher } = require('../lib/json-file-watcher');
const { createLogger } = require('./logger');
const logger = createLogger();

/**
 * Create a screen capture watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {Function} options.captureScreen - Function to capture screen (from desktopCapturer)
 * @returns {Object} Screen capture watcher service instance
 */
function createScreenCaptureWatcher(options = {}) {
    const { dataDir, captureScreen, onActivity } = options;

    let fileWatcher = null;

    /**
     * Start watching for screen capture requests.
     */
    function start() {
        if (fileWatcher) {
            logger.info('[ScreenCapture]', 'Watcher already running');
            return;
        }

        const { getDataDir } = require('./platform-paths');
        const contextMirrorDir = dataDir || getDataDir();
        const requestPath = path.join(contextMirrorDir, 'screen_capture_request.json');
        const responsePath = path.join(contextMirrorDir, 'screen_capture_response.json');
        const imagesDir = path.join(contextMirrorDir, 'images');

        // Ensure directories exist
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

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

                // Delete request immediately to prevent multiple captures
                try { await fsPromises.unlink(requestPath); } catch {}

                // Only process requests from the last 5 seconds
                if (now - requestTime > 5000) return;

                logger.info('[ScreenCapture]', 'Capture requested by Claude');
                if (onActivity) onActivity('capture_screen');

                // Get all displays from Electron's screen module
                const displays = screen.getAllDisplays();
                const primaryDisplay = screen.getPrimaryDisplay();
                logger.info('[ScreenCapture]', `Found ${displays.length} display(s): ${displays.map((d, i) => `[${i}] ${d.size.width}x${d.size.height} id=${d.id}${d.id === primaryDisplay.id ? ' (primary)' : ''}`).join(', ')}`);

                const requestedDisplay = request.display;
                const displayIndex = (requestedDisplay === 'all') ? 0 : (parseInt(requestedDisplay, 10) || 0);
                const imagePath = path.join(imagesDir, `capture-${Date.now()}.png`);
                let captureSuccess = false;

                // On Windows with multiple displays, use native PowerShell capture
                // to avoid Electron desktopCapturer bug returning same image for all displays
                if (process.platform === 'win32' && displays.length > 1) {
                    logger.info('[ScreenCapture]', `Windows multi-monitor: trying native capture for display ${displayIndex}`);
                    captureSuccess = await captureDisplayWindows(displayIndex, imagePath);
                }

                if (!captureSuccess) {
                    // Fallback to Electron desktopCapturer
                    if (!captureScreen) {
                        logger.error('[ScreenCapture]', 'No capture function provided');
                        await fsPromises.writeFile(responsePath, JSON.stringify({
                            success: false, error: 'Screen capture not available',
                            timestamp: new Date().toISOString()
                        }));
                        return;
                    }

                    let captureTimeout;
                    const sources = await Promise.race([
                        captureScreen({
                            types: ['screen'],
                            thumbnailSize: { width: 1920, height: 1080 }
                        }),
                        new Promise((_, reject) => {
                            captureTimeout = setTimeout(() => reject(new Error('Screen capture timed out after 30s')), 30000);
                        })
                    ]);
                    clearTimeout(captureTimeout);

                    logger.info('[ScreenCapture]', `desktopCapturer returned ${sources.length} source(s): ${sources.map((s, i) => `[${i}] "${s.name}" display_id=${s.display_id}`).join(', ')}`);

                    if (sources.length > 0) {
                        let source;

                        if (requestedDisplay === 'all' && sources.length > 1) {
                            logger.info('[ScreenCapture]', 'Multi-display "all" requested, capturing primary display');
                            source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
                        } else {
                            if (sources.length === 1) {
                                source = sources[0];
                            } else {
                                const targetDisplay = displays[displayIndex] || displays[0];
                                source = sources.find(s => s.display_id === String(targetDisplay.id));
                                if (!source) {
                                    source = sources[displayIndex] || sources[0];
                                }
                            }
                        }

                        logger.info('[ScreenCapture]', `Using source: "${source.name}" display_id=${source.display_id}`);
                        const dataUrl = source.thumbnail.toDataURL();
                        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                        const imageBuffer = Buffer.from(base64Data, 'base64');
                        await fsPromises.writeFile(imagePath, imageBuffer);
                        captureSuccess = true;
                    }
                }

                if (captureSuccess) {
                    // Read the saved image to get dimensions
                    const img = nativeImage.createFromPath(imagePath);
                    const imgSize = img.getSize();

                    await fsPromises.writeFile(responsePath, JSON.stringify({
                        success: true, image_path: imagePath,
                        timestamp: new Date().toISOString(),
                        width: imgSize.width, height: imgSize.height,
                        displays_available: displays.length
                    }));

                    logger.info('[ScreenCapture]', 'Screenshot saved:', imagePath);

                    // Also add to inbox so Claude can reference it
                    const inboxPath = path.join(contextMirrorDir, 'inbox.json');
                    let data = { messages: [] };
                    try {
                        const existing = await fsPromises.readFile(inboxPath, 'utf-8');
                        data = JSON.parse(existing);
                    } catch {}

                    data.messages.push({
                        id: `capture-${Date.now()}`,
                        from: 'system',
                        message: `Screenshot captured and saved to: ${imagePath}`,
                        timestamp: new Date().toISOString(),
                        read_by: [],
                        image_path: imagePath
                    });

                    await fsPromises.writeFile(inboxPath, JSON.stringify(data));
                } else {
                    await fsPromises.writeFile(responsePath, JSON.stringify({
                        success: false, error: 'No displays available for capture',
                        timestamp: new Date().toISOString()
                    }));
                }
            } catch (err) {
                logger.error('[ScreenCapture]', 'Error:', err);
                try {
                    await fsPromises.writeFile(responsePath, JSON.stringify({
                        success: false, error: err?.message || 'Screen capture failed',
                        timestamp: new Date().toISOString()
                    }));
                } catch { /* best-effort error response */ }
            } finally {
                processing = false;
            }
        }

        fileWatcher = createJsonFileWatcher({
            watchDir: contextMirrorDir,
            filename: 'screen_capture_request.json',
            onEvent: processRequest,
            label: 'ScreenCapture'
        });
        fileWatcher.start();
    }

    /**
     * Stop watching for screen capture requests.
     */
    function stop() {
        if (fileWatcher) {
            fileWatcher.stop();
            fileWatcher = null;
        }
    }

    /**
     * Check if watcher is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return fileWatcher !== null && fileWatcher.isRunning();
    }

    return {
        start,
        stop,
        isRunning
    };
}

module.exports = {
    createScreenCaptureWatcher
};
