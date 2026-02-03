/**
 * Screen capture handler: capture_screen
 */

const fs = require('fs');
const path = require('path');
const { HOME_DATA_DIR } = require('../paths');

/**
 * Clean up old screenshots, keeping only the most recent N
 */
function cleanupOldScreenshots(imagesDir, keepCount = 3) {
    try {
        if (!fs.existsSync(imagesDir)) return;

        const files = fs.readdirSync(imagesDir)
            .filter(f => f.endsWith('.png'))
            .map(f => ({
                name: f,
                path: path.join(imagesDir, f),
                mtime: fs.statSync(path.join(imagesDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > keepCount) {
            const toDelete = files.slice(keepCount);
            for (const file of toDelete) {
                fs.unlinkSync(file.path);
                console.error(`[capture_screen] Cleaned up old screenshot: ${file.name}`);
            }
        }
    } catch (err) {
        console.error(`[capture_screen] Cleanup error: ${err.message}`);
    }
}

/**
 * capture_screen - Request screenshot
 * Uses cosmic-screenshot on Cosmic desktop (bypasses permission dialog)
 * Falls back to Electron desktopCapturer on other platforms
 */
async function handleCaptureScreen(args) {
    const { execSync } = require('child_process');
    const imagesDir = path.join(HOME_DATA_DIR, 'images');

    // Ensure images directory exists
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Clean up old screenshots before capturing new one (keep last 5)
    cleanupOldScreenshots(imagesDir, 5);

    // Try cosmic-screenshot first (works on Pop!_OS Cosmic without permission dialog)
    try {
        const result = execSync(
            `cosmic-screenshot --interactive=false --modal=false --notify=false --save-dir="${imagesDir}"`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        if (result && fs.existsSync(result)) {
            return {
                content: [{
                    type: 'text',
                    text: `Screenshot captured and saved to: ${result}\n` +
                          `You can now analyze this image. The path is: ${result}`
                }]
            };
        }
    } catch (err) {
        console.error('[capture_screen] cosmic-screenshot failed, falling back to Electron:', err.message);
    }

    // Fallback: Request screenshot from Electron via file-based IPC
    const requestPath = path.join(HOME_DATA_DIR, 'screen_capture_request.json');
    const responsePath = path.join(HOME_DATA_DIR, 'screen_capture_response.json');

    // Delete old response file if exists
    if (fs.existsSync(responsePath)) {
        fs.unlinkSync(responsePath);
    }

    // Write request
    fs.writeFileSync(requestPath, JSON.stringify({
        display: args?.display != null ? args.display : 0,
        timestamp: new Date().toISOString()
    }, null, 2));

    // Wait for Electron to capture (up to 10 seconds)
    const startTime = Date.now();
    const timeoutMs = 10000;

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 200));

        if (fs.existsSync(responsePath)) {
            try {
                const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));

                if (response.success) {
                    const displaysInfo = response.displays_available > 1
                        ? `\n${response.displays_available} displays available. Use display parameter (0-${response.displays_available - 1}) to capture a different monitor.`
                        : '';
                    return {
                        content: [{
                            type: 'text',
                            text: `Screenshot captured and saved to: ${response.image_path}\n` +
                                  `You can now analyze this image. The path is: ${response.image_path}` +
                                  displaysInfo
                        }]
                    };
                } else {
                    return {
                        content: [{
                            type: 'text',
                            text: `Screenshot failed: ${response.error}`
                        }],
                        isError: true
                    };
                }
            } catch (err) {
                // Continue waiting
            }
        }
    }

    return {
        content: [{
            type: 'text',
            text: 'Screenshot request timed out. Is the Electron app running?'
        }],
        isError: true
    };
}

module.exports = { handleCaptureScreen };
