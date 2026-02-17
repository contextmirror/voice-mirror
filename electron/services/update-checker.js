/**
 * Auto-update service using electron-updater (GitHub Releases).
 * Notifies user when an update is available; user chooses to download + install.
 * Update notifications appear in the sidebar banner (not chat toasts).
 */

const { app } = require('electron');
const { createLogger } = require('./logger');
const log = createLogger();

function createUpdateChecker(options = {}) {
    const { safeSend } = options;
    let checkInterval = null;
    let startupTimeout = null;

    // In dev mode (not packaged), skip update checks entirely
    if (!app.isPackaged) {
        log.info('[Update]', 'Running in dev mode — update checks disabled');
        return {
            start() {},
            stop() {},
            check() { return Promise.resolve(null); },
            applyUpdate() { return Promise.resolve({ success: false, error: 'Updates disabled in dev mode' }); }
        };
    }

    const { autoUpdater } = require('electron-updater');

    // Configure electron-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    // Wire up autoUpdater events to IPC messages
    autoUpdater.on('update-available', (info) => {
        log.info('[Update]', `Update available: v${info.version}`);
        if (safeSend) {
            safeSend('update-available', {
                version: info.version,
                releaseNotes: info.releaseNotes || null
            });
        }
    });

    autoUpdater.on('download-progress', (progress) => {
        if (safeSend) {
            safeSend('update-status', {
                status: 'downloading',
                percent: Math.round(progress.percent)
            });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Update]', `Update downloaded: v${info.version}`);
        if (safeSend) {
            safeSend('update-status', {
                status: 'ready',
                needsRestart: true,
                version: info.version
            });
        }
    });

    autoUpdater.on('error', (err) => {
        log.error('[Update]', `Update error: ${err.message}`);
        if (safeSend) {
            safeSend('update-status', {
                status: 'error',
                error: err.message
            });
        }
    });

    async function check() {
        try {
            const result = await autoUpdater.checkForUpdates();
            return result;
        } catch (err) {
            log.warn('[Update]', `Update check failed: ${err.message}`);
            return null;
        }
    }

    async function applyUpdate() {
        try {
            log.info('[Update]', 'Starting update download...');
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (err) {
            log.error('[Update]', `Download failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    function start(intervalMs = 3600000) {
        // Initial check after 15s delay (let app finish starting up)
        startupTimeout = setTimeout(() => check(), 15000);
        // Periodic checks
        checkInterval = setInterval(() => check(), intervalMs);
    }

    function stop() {
        if (startupTimeout) {
            clearTimeout(startupTimeout);
            startupTimeout = null;
        }
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
    }

    return { start, stop, check, applyUpdate };
}

module.exports = { createUpdateChecker };
