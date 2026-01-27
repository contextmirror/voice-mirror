/**
 * System tray integration for Voice Mirror Electron.
 * Creates a tray icon with context menu for quick access.
 */

const { Tray, Menu, app } = require('electron');
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
        const iconPath = options.iconPath || path.join(__dirname, '../../assets/tray-icon.png');

        try {
            tray = new Tray(iconPath);
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

    /**
     * Destroy the tray icon.
     */
    function destroy() {
        if (tray) {
            tray.destroy();
            tray = null;
            console.log('[Tray] System tray destroyed');
        }
    }

    /**
     * Get the tray instance.
     * @returns {Tray|null} The tray instance or null
     */
    function getTray() {
        return tray;
    }

    /**
     * Update the tray tooltip.
     * @param {string} tooltip - New tooltip text
     */
    function setTooltip(tooltip) {
        if (tray) {
            tray.setToolTip(tooltip);
        }
    }

    return {
        create,
        destroy,
        getTray,
        setTooltip
    };
}

module.exports = {
    createTrayService
};
