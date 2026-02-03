/**
 * Screen capture watcher service for Voice Mirror Electron.
 * Watches for screen capture requests from Claude via MCP and fulfills them.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { screen, nativeImage } = require('electron');

/**
 * Create a screen capture watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {Function} options.captureScreen - Function to capture screen (from desktopCapturer)
 * @returns {Object} Screen capture watcher service instance
 */
function createScreenCaptureWatcher(options = {}) {
    const { dataDir, captureScreen } = options;

    let watcher = null;

    /**
     * Start watching for screen capture requests.
     */
    function start() {
        if (watcher) {
            console.log('[ScreenCapture] Watcher already running');
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

                console.log('[ScreenCapture] Capture requested by Claude');

                if (!captureScreen) {
                    console.error('[ScreenCapture] No capture function provided');
                    await fsPromises.writeFile(responsePath, JSON.stringify({
                        success: false, error: 'Screen capture not available',
                        timestamp: new Date().toISOString()
                    }));
                    return;
                }

                // Get all displays from Electron's screen module
                const displays = screen.getAllDisplays();
                const primaryDisplay = screen.getPrimaryDisplay();
                console.log(`[ScreenCapture] Found ${displays.length} display(s): ${displays.map((d, i) => `[${i}] ${d.size.width}x${d.size.height} id=${d.id}${d.id === primaryDisplay.id ? ' (primary)' : ''}`).join(', ')}`);

                const sources = await captureScreen({
                    types: ['screen'],
                    thumbnailSize: { width: 1920, height: 1080 }
                });

                console.log(`[ScreenCapture] desktopCapturer returned ${sources.length} source(s): ${sources.map((s, i) => `[${i}] "${s.name}" display_id=${s.display_id}`).join(', ')}`);

                if (sources.length > 0) {
                    const requestedDisplay = request.display;
                    let source;

                    if (requestedDisplay === 'all' && sources.length > 1) {
                        // Stitch all displays into one image
                        // Calculate total canvas size from actual display bounds
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        for (const d of displays) {
                            minX = Math.min(minX, d.bounds.x);
                            minY = Math.min(minY, d.bounds.y);
                            maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
                            maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
                        }
                        const totalWidth = maxX - minX;
                        const totalHeight = maxY - minY;

                        // Scale factor to keep image manageable
                        const scale = Math.min(3840 / totalWidth, 2160 / totalHeight, 1);
                        const canvasWidth = Math.round(totalWidth * scale);
                        const canvasHeight = Math.round(totalHeight * scale);

                        // Create empty canvas
                        const canvas = nativeImage.createEmpty();
                        // For stitching we need to use a different approach since nativeImage
                        // doesn't have a canvas API. We'll capture each display individually
                        // at full res and save them as separate files, returning the primary.
                        // TODO: Implement proper stitching with sharp or canvas module
                        console.log('[ScreenCapture] Multi-display "all" requested, capturing primary display');
                        source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
                    } else {
                        // Select specific display
                        const displayIndex = parseInt(requestedDisplay, 10) || 0;

                        if (sources.length === 1) {
                            // Only one source returned - use it regardless of index
                            source = sources[0];
                        } else {
                            // Try to match by display_id from Electron's screen module
                            const targetDisplay = displays[displayIndex] || displays[0];
                            source = sources.find(s => s.display_id === String(targetDisplay.id));
                            if (!source) {
                                // Fallback to array index
                                source = sources[displayIndex] || sources[0];
                            }
                        }
                    }

                    console.log(`[ScreenCapture] Using source: "${source.name}" display_id=${source.display_id}`);
                    const dataUrl = source.thumbnail.toDataURL();

                    const imagePath = path.join(imagesDir, `capture-${Date.now()}.png`);
                    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                    const imageBuffer = Buffer.from(base64Data, 'base64');
                    await fsPromises.writeFile(imagePath, imageBuffer);

                    const thumbSize = source.thumbnail.getSize();
                    await fsPromises.writeFile(responsePath, JSON.stringify({
                        success: true, image_path: imagePath,
                        timestamp: new Date().toISOString(),
                        width: thumbSize.width, height: thumbSize.height,
                        displays_available: displays.length
                    }));

                    console.log('[ScreenCapture] Screenshot saved:', imagePath);

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
                        success: false, error: 'No displays available',
                        timestamp: new Date().toISOString()
                    }));
                }
            } catch (err) {
                console.error('[ScreenCapture] Error:', err);
            } finally {
                processing = false;
            }
        }

        // Use fs.watch on the data directory instead of polling
        try {
            watcher = fs.watch(contextMirrorDir, (eventType, filename) => {
                if (filename === 'screen_capture_request.json') {
                    processRequest();
                }
            });
            watcher.on('error', (err) => {
                console.error('[ScreenCapture] fs.watch error, falling back to polling:', err.message);
                watcher = null;
                // Fallback: poll at 2s instead of 500ms
                watcher = setInterval(() => processRequest(), 2000);
            });
        } catch (err) {
            console.error('[ScreenCapture] fs.watch unavailable, using polling fallback:', err.message);
            watcher = setInterval(() => processRequest(), 2000);
        }

        console.log('[ScreenCapture] Watcher started');
    }

    /**
     * Stop watching for screen capture requests.
     */
    function stop() {
        if (watcher) {
            if (typeof watcher.close === 'function') {
                watcher.close(); // fs.watch
            } else {
                clearInterval(watcher); // polling fallback
            }
            watcher = null;
            console.log('[ScreenCapture] Watcher stopped');
        }
    }

    /**
     * Check if watcher is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return watcher !== null;
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
