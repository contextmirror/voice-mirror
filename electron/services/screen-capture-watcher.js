/**
 * Screen capture watcher service for Voice Mirror Electron.
 * Watches for screen capture requests from Claude via MCP and fulfills them.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { screen, nativeImage } = require('electron');
const { execFile } = require('child_process');

/**
 * Capture a specific display on Windows using PowerShell + .NET GDI+.
 * This bypasses Electron's desktopCapturer which has a known bug where
 * multi-monitor setups return the same image for different displays.
 *
 * @param {number} displayIndex - Display index to capture
 * @param {string} outputPath - Path to save the PNG screenshot
 * @returns {Promise<boolean>} True if capture succeeded
 */
function captureDisplayWindows(displayIndex, outputPath) {
    if (process.platform !== 'win32') return Promise.resolve(false);

    return new Promise((resolve) => {
        // PowerShell script that uses .NET to capture a specific monitor
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$idx = ${displayIndex}
if ($idx -ge $screens.Length) { $idx = 0 }
$s = $screens[$idx]
$bmp = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($s.Bounds.Location, [System.Drawing.Point]::Empty, $s.Bounds.Size)
$bmp.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "$($s.Bounds.Width)x$($s.Bounds.Height)"
`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: 8000,
            windowsHide: true
        }, (err, stdout) => {
            if (err) {
                console.error('[ScreenCapture] Windows native capture failed:', err.message);
                resolve(false);
            } else {
                console.log(`[ScreenCapture] Windows native capture succeeded: display ${displayIndex}, ${stdout.trim()}`);
                resolve(true);
            }
        });
    });
}

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

                // Get all displays from Electron's screen module
                const displays = screen.getAllDisplays();
                const primaryDisplay = screen.getPrimaryDisplay();
                console.log(`[ScreenCapture] Found ${displays.length} display(s): ${displays.map((d, i) => `[${i}] ${d.size.width}x${d.size.height} id=${d.id}${d.id === primaryDisplay.id ? ' (primary)' : ''}`).join(', ')}`);

                const requestedDisplay = request.display;
                const displayIndex = (requestedDisplay === 'all') ? 0 : (parseInt(requestedDisplay, 10) || 0);
                const imagePath = path.join(imagesDir, `capture-${Date.now()}.png`);
                let captureSuccess = false;

                // On Windows with multiple displays, use native PowerShell capture
                // to avoid Electron desktopCapturer bug returning same image for all displays
                if (process.platform === 'win32' && displays.length > 1) {
                    console.log(`[ScreenCapture] Windows multi-monitor: trying native capture for display ${displayIndex}`);
                    captureSuccess = await captureDisplayWindows(displayIndex, imagePath);
                }

                if (!captureSuccess) {
                    // Fallback to Electron desktopCapturer
                    if (!captureScreen) {
                        console.error('[ScreenCapture] No capture function provided');
                        await fsPromises.writeFile(responsePath, JSON.stringify({
                            success: false, error: 'Screen capture not available',
                            timestamp: new Date().toISOString()
                        }));
                        return;
                    }

                    const sources = await captureScreen({
                        types: ['screen'],
                        thumbnailSize: { width: 1920, height: 1080 }
                    });

                    console.log(`[ScreenCapture] desktopCapturer returned ${sources.length} source(s): ${sources.map((s, i) => `[${i}] "${s.name}" display_id=${s.display_id}`).join(', ')}`);

                    if (sources.length > 0) {
                        let source;

                        if (requestedDisplay === 'all' && sources.length > 1) {
                            console.log('[ScreenCapture] Multi-display "all" requested, capturing primary display');
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

                        console.log(`[ScreenCapture] Using source: "${source.name}" display_id=${source.display_id}`);
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
                        success: false, error: 'No displays available for capture',
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
