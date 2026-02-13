/**
 * System tray integration for Voice Mirror Electron.
 * Creates a tray icon with context menu for quick access.
 */

const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');

/**
 * Create a tray service instance.
 * @param {Object} options - Tray options
 * @param {string} options.iconPath - Path to tray icon (defaults to ../assets/tray-icon.png)
 * @returns {Object} Tray service instance
 */
function createTrayService(options = {}) {
    let tray = null;

    /**
     * Create the system tray with context menu.
     * @param {Object} callbacks - Callback functions
     * @param {Function} callbacks.onOpenPanel - Called when "Open Panel" is clicked
     * @param {Function} callbacks.onSettings - Called when "Settings" is clicked
     * @param {Function} callbacks.onToggleVisibility - Called when tray icon is clicked
     * @returns {Tray|null} The created tray instance or null if icon not found
     */
    function create(callbacks = {}) {
        const assetsDir = path.join(__dirname, '../../assets');

        try {
            let icon;
            if (process.platform === 'darwin') {
                // macOS: use Template images for light/dark menu bar
                icon = nativeImage.createFromPath(path.join(assetsDir, 'tray-iconTemplate.png'));
            } else {
                // Linux/Windows: use standard icon, Electron picks up @2x automatically
                icon = nativeImage.createFromPath(path.join(assetsDir, 'tray-icon.png'));
            }
            tray = new Tray(icon);
        } catch (e) {
            console.log('[Tray] Icon not found, skipping tray creation');
            return null;
        }

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Open Panel',
                accelerator: 'CommandOrControl+Shift+V',
                click: () => {
                    if (callbacks.onOpenPanel) {
                        callbacks.onOpenPanel();
                    }
                }
            },
            {
                label: 'Settings',
                click: () => {
                    if (callbacks.onSettings) {
                        callbacks.onSettings();
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setToolTip('Voice Mirror');
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
            if (callbacks.onToggleVisibility) {
                callbacks.onToggleVisibility();
            }
        });

        console.log('[Tray] System tray created');
        return tray;
    }

    return {
        create
    };
}

module.exports = {
    createTrayService
};
