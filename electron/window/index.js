/**
 * Window management service for Voice Mirror Electron.
 * Handles the main overlay window - creation, expand/collapse, positioning.
 */

const { BrowserWindow, screen } = require('electron');
const { execSync, execFileSync } = require('child_process');
const path = require('path');

/**
 * Create a window manager service instance.
 * @param {Object} options - Window manager options
 * @param {Function} options.getConfig - Function to get current app config
 * @param {Function} options.updateConfig - Function to update app config
 * @param {boolean} options.isLinux - Whether running on Linux
 * @returns {Object} Window manager service instance
 */
function createWindowManager(options = {}) {
    const { getConfig, updateConfig, isLinux, startHidden, onWindowStateChanged } = options;

    let mainWindow = null;
    let isExpanded = false;
    let overlayInterval = null;
    let x11WindowId = null;

    /**
     * Get orb size from config.
     * @returns {number} Orb size in pixels
     */
    function getOrbSize() {
        const config = getConfig();
        return config?.appearance?.orbSize || 64;
    }

    /**
     * Get panel width from config.
     * @returns {number} Panel width in pixels
     */
    function getPanelWidth() {
        const config = getConfig();
        return config?.appearance?.panelWidth || 400;
    }

    /**
     * Get panel height from config.
     * @returns {number} Panel height in pixels
     */
    function getPanelHeight() {
        const config = getConfig();
        return config?.appearance?.panelHeight || 500;
    }

    /**
     * Create the main overlay window.
     * @returns {BrowserWindow} The created window
     */
    function create() {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const orbSize = getOrbSize();
        const config = getConfig();

        // Use saved position from config, or default to bottom-right
        const savedX = config?.window?.orbX;
        const savedY = config?.window?.orbY;
        const startX = savedX !== null && savedX !== undefined ? savedX : screenWidth - orbSize - 20;
        const startY = savedY !== null && savedY !== undefined ? savedY : screenHeight - orbSize - 100;

        mainWindow = new BrowserWindow({
            width: orbSize,
            height: orbSize,
            x: startX,
            y: startY,
            show: !(typeof startHidden === 'function' ? startHidden() : startHidden),
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            hasShadow: false,
            icon: path.join(__dirname, '..', '..', 'assets', 'icon-256.png'),
            backgroundColor: '#00000000',  // Fully transparent background
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                webviewTag: true,
                preload: path.join(__dirname, '..', 'preload.js')
            }
        });

        // Set highest always-on-top level for overlay behavior
        mainWindow.setAlwaysOnTop(true, 'screen-saver');

        // On Linux, try to enable transparency
        if (isLinux) {
            mainWindow.setBackgroundColor('#00000000');
        }

        // Load the overlay HTML
        mainWindow.loadFile(path.join(__dirname, '..', 'overlay.html'));

        // Make transparent areas click-through
        mainWindow.setIgnoreMouseEvents(false);

        // On Linux/Wayland: set X11 window type to DOCK so COSMIC keeps it on top
        if (isLinux) {
            mainWindow.once('show', () => {
                setupX11Overlay();
            });
        }

        // Re-assert always-on-top when window loses focus (Wayland workaround)
        mainWindow.on('blur', () => {
            if (!isExpanded && mainWindow) {
                raiseWindow();
            }
        });

        // Periodic overlay enforcement for Wayland (re-assert every 2s when collapsed)
        startOverlayEnforcer();

        // Save position when window is moved (only when collapsed to orb)
        mainWindow.on('moved', () => {
            if (!isExpanded) {
                const [x, y] = mainWindow.getPosition();
                updateConfig({ window: { orbX: x, orbY: y } });
            }
        });

        console.log('[Window] Main window created');
        return mainWindow;
    }

    /**
     * Find and store the X11 window ID, set DOCK type, and configure overlay.
     * COSMIC/Wayland doesn't support _NET_WM_STATE_ABOVE, so we use
     * DOCK type + periodic xdotool raise as a workaround.
     */
    function setupX11Overlay() {
        if (process.platform !== 'linux') {
            // X11 overlay only applies to Linux; macOS/Windows use Electron's built-in always-on-top
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
            }
            return;
        }
        try {
            const title = mainWindow.getTitle() || 'Voice Mirror';
            const windowId = execFileSync('xdotool', ['search', '--name', title], {
                encoding: 'utf8', timeout: 3000
            }).trim().split('\n')[0];
            if (windowId && /^\d+$/.test(windowId)) {
                x11WindowId = windowId;
                // Set ABOVE state hint (works on X11 DEs like GNOME/KDE)
                execFileSync('xprop', [
                    '-id', windowId, '-f', '_NET_WM_STATE', '32a',
                    '-set', '_NET_WM_STATE', '_NET_WM_STATE_ABOVE'
                ], { timeout: 3000 });
                console.log('[Window] X11 overlay configured (id:', windowId, ')');
            }
        } catch (e) {
            console.log('[Window] Could not configure X11 overlay:', e.message);
        }
    }

    /**
     * Raise the window to the top of the X11 stacking order.
     */
    function raiseWindow() {
        if (process.platform === 'linux' && x11WindowId) {
            try {
                execFileSync('xdotool', ['windowraise', x11WindowId], { timeout: 1000, stdio: 'ignore' });
            } catch (e) {
                // Silently fail — window may have been recreated
            }
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
        }
    }

    /**
     * Start periodic always-on-top enforcement (Wayland workaround).
     * Uses xdotool windowraise + Electron setAlwaysOnTop every 2s.
     */
    function startOverlayEnforcer() {
        stopOverlayEnforcer();
        overlayInterval = setInterval(() => {
            if (mainWindow && !isExpanded && !mainWindow.isDestroyed()) {
                raiseWindow();
            }
        }, 2000);
    }

    /**
     * Stop periodic overlay enforcement.
     */
    function stopOverlayEnforcer() {
        if (overlayInterval) {
            clearInterval(overlayInterval);
            overlayInterval = null;
        }
    }

    /**
     * Expand the window to full panel.
     */
    function expand() {
        if (!mainWindow || isExpanded) return;

        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const panelWidth = getPanelWidth();
        const panelHeight = getPanelHeight();

        isExpanded = true;
        stopOverlayEnforcer();

        // Send state change first
        mainWindow.webContents.send('state-change', { expanded: true });

        // Then resize and enable resizing
        setTimeout(() => {
            mainWindow.setResizable(true);
            mainWindow.setMinimumSize(300, 400);
            mainWindow.setContentSize(panelWidth, panelHeight);
            mainWindow.setPosition(
                screenWidth - panelWidth - 20,
                screenHeight - panelHeight - 50
            );
            mainWindow.setSkipTaskbar(false);
            mainWindow.setAlwaysOnTop(false);  // Allow other windows to cover when expanded
            mainWindow.focus();
            console.log('[Window] Expanded to panel:', panelWidth, 'x', panelHeight);
            // Re-register hotkeys after compositor settles
            if (onWindowStateChanged) setTimeout(onWindowStateChanged, 150);
        }, 50);
    }

    /**
     * Collapse the window to orb.
     */
    function collapse() {
        if (!mainWindow || !isExpanded) return;

        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const orbSize = getOrbSize();
        const config = getConfig();

        // Save current panel size before collapsing
        const [currentWidth, currentHeight] = mainWindow.getContentSize();
        if (currentWidth > orbSize && currentHeight > orbSize) {
            updateConfig({
                appearance: {
                    panelWidth: currentWidth,
                    panelHeight: currentHeight
                }
            });
        }

        // Restore to saved position or default
        const savedX = config?.window?.orbX;
        const savedY = config?.window?.orbY;
        const restoreX = savedX !== null && savedX !== undefined ? savedX : screenWidth - orbSize - 20;
        const restoreY = savedY !== null && savedY !== undefined ? savedY : screenHeight - orbSize - 100;

        isExpanded = false;
        startOverlayEnforcer();

        // Send state change first so UI updates
        mainWindow.webContents.send('state-change', { expanded: false });

        // Small delay then resize (helps with Wayland/Cosmic)
        setTimeout(() => {
            mainWindow.setResizable(false);
            mainWindow.setContentSize(orbSize, orbSize);
            mainWindow.setPosition(restoreX, restoreY);
            mainWindow.setSkipTaskbar(true);
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            console.log('[Window] Collapsed to orb:', orbSize, 'x', orbSize);
            // Re-register hotkeys after compositor settles
            if (onWindowStateChanged) setTimeout(onWindowStateChanged, 150);
        }, 50);
    }

    /**
     * Toggle between expanded and collapsed states.
     * @returns {boolean} New expanded state
     */
    function toggle() {
        if (isExpanded) {
            collapse();
        } else {
            expand();
        }
        return isExpanded;
    }

    /**
     * Get the main window instance.
     * @returns {BrowserWindow|null} The main window or null
     */
    function getWindow() {
        return mainWindow;
    }

    /**
     * Check if the window is expanded.
     * @returns {boolean} True if expanded
     */
    function getIsExpanded() {
        return isExpanded;
    }

    /**
     * Get the current orb size.
     * @returns {number} Orb size in pixels
     */
    function getCurrentOrbSize() {
        return getOrbSize();
    }

    /**
     * Show the window.
     */
    function show() {
        mainWindow?.show();
    }

    /**
     * Hide the window.
     */
    function hide() {
        mainWindow?.hide();
    }

    /**
     * Check if window is visible.
     * @returns {boolean} True if visible
     */
    function isVisible() {
        return mainWindow?.isVisible() || false;
    }

    /**
     * Get window position.
     * @returns {Object} { x, y } position
     */
    function getPosition() {
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            return { x, y };
        }
        return { x: 0, y: 0 };
    }

    /**
     * Set window position.
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    function setPosition(x, y) {
        if (mainWindow) {
            mainWindow.setPosition(Math.round(x), Math.round(y));
        }
    }

    /**
     * Get window bounds.
     * @returns {Object} Window bounds { x, y, width, height }
     */
    function getBounds() {
        return mainWindow?.getBounds() || { x: 0, y: 0, width: 0, height: 0 };
    }

    /**
     * Set window bounds.
     * @param {Object} bounds - { x, y, width, height }
     */
    function setBounds(bounds) {
        if (mainWindow) {
            mainWindow.setBounds({
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: bounds.width,
                height: bounds.height
            });
        }
    }

    /**
     * Send a message to the renderer via webContents.
     * @param {string} channel - IPC channel name
     * @param {...any} args - Arguments to send
     */
    function send(channel, ...args) {
        mainWindow?.webContents.send(channel, ...args);
    }

    return {
        create,
        expand,
        collapse,
        toggle,
        getWindow,
        getIsExpanded,
        getCurrentOrbSize,
        show,
        hide,
        isVisible,
        getPosition,
        setPosition,
        getBounds,
        setBounds,
        send
    };
}

module.exports = {
    createWindowManager
};
