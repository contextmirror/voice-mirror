/**
 * IPC handlers for configuration management.
 * Handles: get-config, set-config, reset-config, get-platform-info,
 *          set-overlay-opacity, list-overlay-outputs, get-theme-list,
 *          theme-export, theme-import, font-upload, font-add, font-remove,
 *          font-list, font-get-data-url
 */

const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const fontManager = require('../services/font-manager');
const { CLI_PROVIDERS } = require('../constants');

/**
 * Register config-related IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerConfigHandlers(ctx, validators) {
    // Initialize font manager with the config directory
    fontManager.init(ctx.config.getConfigDir());

    // Track last known terminal dimensions for PTY spawning on provider switch
    let lastTermCols = 120;
    let lastTermRows = 30;

    /**
     * Expose a setter so the ai module can update last known terminal dimensions.
     * Attached to ctx so other IPC modules can access it.
     */
    ctx._setLastTermDims = (cols, rows) => {
        lastTermCols = cols;
        lastTermRows = rows;
    };
    ctx._getLastTermDims = () => ({ cols: lastTermCols, rows: lastTermRows });

    ipcMain.handle('get-config', () => {
        return ctx.config.loadConfig();
    });

    ipcMain.handle('set-config', async (event, updates) => {
        const v = validators['set-config'](updates);
        if (!v.valid) {
            ctx.logger.warn('[Config]', 'Rejected invalid update:', v.error);
            return ctx.getAppConfig();
        }
        updates = v.value;
        const appConfig = ctx.getAppConfig();
        const oldProvider = appConfig?.ai?.provider;
        const oldModel = appConfig?.ai?.model;
        if (updates.ai) {
            ctx.logger.info('[Config]', `AI update: provider=${oldProvider}->${updates.ai.provider}, model=${oldModel}->${updates.ai.model}`);
        }
        const oldHotkey = appConfig?.behavior?.hotkey;
        const oldStatsHotkey = appConfig?.behavior?.statsHotkey;
        const oldActivationMode = appConfig?.behavior?.activationMode;
        const oldPttKey = appConfig?.behavior?.pttKey;
        const oldDictationKey = appConfig?.behavior?.dictationKey;
        const oldOutputName = appConfig?.overlay?.outputName || null;
        const oldVoice = appConfig?.voice;
        const oldWakeWord = appConfig?.wakeWord;

        const newConfig = await ctx.config.updateConfigAsync(updates);
        ctx.setAppConfig(newConfig);

        // Auto-restart AI provider if provider, model, or context length changed
        // Fire-and-forget so the IPC response returns immediately (no mouse lag)
        if (updates.ai) {
            const newProvider = newConfig.ai?.provider;
            const newModel = newConfig.ai?.model;
            const newContextLength = newConfig.ai?.contextLength;
            const oldContextLength = appConfig?.ai?.contextLength;
            const providerChanged = oldProvider !== newProvider;
            const modelChanged = oldModel !== newModel;
            const contextLengthChanged = oldContextLength !== newContextLength;

            if (providerChanged || modelChanged || contextLengthChanged) {
                const wasRunning = ctx.isAIProviderRunning();
                ctx.logger.info('[Config]', `Provider/model changed: ${oldProvider}/${oldModel} -> ${newProvider}/${newModel} (was running: ${wasRunning})`);

                // Schedule provider switch asynchronously — don't block IPC response
                setImmediate(async () => {
                    try {
                        if (wasRunning) {
                            ctx.stopAIProvider();
                            const isCLI = CLI_PROVIDERS.includes(oldProvider);
                            await new Promise(resolve => setTimeout(resolve, isCLI ? 1500 : 500));
                        }
                        // Pass last known terminal dimensions so the PTY spawns
                        // at the correct size (avoids garbled TUI on first render)
                        ctx.startAIProvider(lastTermCols, lastTermRows);
                        ctx.logger.info('[Config]', `New provider started: ${newProvider} (${lastTermCols}x${lastTermRows})`);
                    } catch (err) {
                        ctx.logger.error('[Config]', 'Provider switch error:', err.message);
                    }
                });
            }
        }

        // Re-register global shortcut if hotkey changed (with rollback on failure)
        const hotkeyManager = ctx.getHotkeyManager();
        if (updates.behavior?.hotkey && updates.behavior.hotkey !== oldHotkey && hotkeyManager) {
            const toggleCallback = () => {
                if (ctx.getIsExpanded()) ctx.collapseToOrb();
                else ctx.expandPanel();
            };
            const ok = hotkeyManager.updateBinding('toggle-panel', updates.behavior.hotkey, toggleCallback);
            if (!ok) {
                // Rollback already happened in updateBinding; revert config too
                ctx.logger.log('HOTKEY', `Reverted config hotkey to "${oldHotkey}"`);
                const reverted = await ctx.config.updateConfigAsync({ behavior: { hotkey: oldHotkey } });
                ctx.setAppConfig(reverted);
                // Also fix the local reference for the return value
                reverted.behavior.hotkey = oldHotkey;
                return reverted;
            }
        }

        // Re-register stats hotkey if changed
        if (updates.behavior?.statsHotkey && updates.behavior.statsHotkey !== oldStatsHotkey && hotkeyManager) {
            const statsCallback = () => {
                ctx.logger.log('HOTKEY', 'Toggle stats triggered');
                ctx.safeSend('toggle-stats-bar');
            };
            const ok = hotkeyManager.updateBinding('toggle-stats', updates.behavior.statsHotkey, statsCallback);
            if (!ok) {
                ctx.logger.log('HOTKEY', `Reverted config statsHotkey to "${oldStatsHotkey}"`);
                const reverted = await ctx.config.updateConfigAsync({ behavior: { statsHotkey: oldStatsHotkey } });
                ctx.setAppConfig(reverted);
                reverted.behavior.statsHotkey = oldStatsHotkey;
                return reverted;
            }
        }

        // Dictation key is handled by Python's GlobalHotkeyListener (forwarded via config_update below)

        // Forward overlay output change to wayland orb (only if actually changed)
        const waylandOrb = ctx.getWaylandOrb();
        if (updates.overlay?.outputName !== undefined && waylandOrb?.isReady()) {
            const newOutput = updates.overlay.outputName || null;
            const oldOutput = oldOutputName;
            if (newOutput !== oldOutput) {
                waylandOrb.setOutput(newOutput);
            }
        }

        // Notify Python backend of config changes (only if voice-related settings changed)
        const activationModeChanged = updates.behavior?.activationMode !== undefined && updates.behavior.activationMode !== oldActivationMode;
        const pttKeyChanged = updates.behavior?.pttKey !== undefined && updates.behavior.pttKey !== oldPttKey;
        const dictationKeyChanged = updates.behavior?.dictationKey !== undefined && updates.behavior.dictationKey !== oldDictationKey;
        const userNameChanged = updates.user?.name !== undefined;
        const voiceSettingsChanged = activationModeChanged || pttKeyChanged || dictationKeyChanged || userNameChanged ||
            (updates.wakeWord && JSON.stringify(updates.wakeWord) !== JSON.stringify(oldWakeWord)) ||
            (updates.voice && JSON.stringify(updates.voice) !== JSON.stringify(oldVoice));
        if (voiceSettingsChanged && ctx.getPythonBackend()?.isRunning()) {
            const currentConfig = ctx.getAppConfig();
            ctx.sendToPython({
                command: 'config_update',
                config: {
                    activationMode: currentConfig.behavior?.activationMode,
                    pttKey: currentConfig.behavior?.pttKey,
                    dictationKey: currentConfig.behavior?.dictationKey,
                    wakeWord: currentConfig.wakeWord,
                    voice: currentConfig.voice,
                    userName: currentConfig.user?.name || null
                }
            });
        }

        // Handle start-with-system toggle
        if (updates.behavior?.startWithSystem !== undefined) {
            const oldStartWithSystem = appConfig?.behavior?.startWithSystem || false;
            if (updates.behavior.startWithSystem !== oldStartWithSystem) {
                try {
                    app.setLoginItemSettings({ openAtLogin: updates.behavior.startWithSystem });
                    ctx.logger.info('[Config]', `Start with system: ${updates.behavior.startWithSystem}`);
                } catch (err) {
                    ctx.logger.error('[Config]', 'Failed to set login item:', err.message);
                }
            }
        }

        return ctx.getAppConfig();
    });

    // Overlay output list
    ipcMain.handle('list-overlay-outputs', async () => {
        const waylandOrb = ctx.getWaylandOrb();
        if (waylandOrb?.isReady()) {
            const outputs = await waylandOrb.listOutputs();
            return { success: true, data: outputs };
        }
        return { success: true, data: [] };
    });

    // File picker for custom model files (e.g. Piper .onnx voices)
    ipcMain.handle('browse-model-file', async (_event, fileType) => {
        const filters = {
            piper: [{ name: 'Piper Voice Models', extensions: ['onnx'] }]
        };
        const { canceled, filePaths } = await dialog.showOpenDialog(ctx.getMainWindow(), {
            title: 'Select Model File',
            filters: filters[fileType] || [{ name: 'Model Files', extensions: ['onnx', 'bin', 'pt'] }],
            properties: ['openFile']
        });
        if (canceled || !filePaths?.length) return { success: false };
        return { success: true, data: filePaths[0] };
    });

    // Check if a Python pip package is installed in the venv
    ipcMain.handle('check-pip-package', async (_event, packageName) => {
        if (typeof packageName !== 'string' || packageName.length > 100) {
            return { success: false, error: 'Invalid package name' };
        }
        try {
            const pythonDir = path.join(__dirname, '..', '..', 'python');
            const isWindows = process.platform === 'win32';
            const venvPython = isWindows
                ? path.join(pythonDir, '.venv', 'Scripts', 'python.exe')
                : path.join(pythonDir, '.venv', 'bin', 'python');
            // Use pip show to check by package distribution name (handles name mismatches
            // like piper-tts installing as "piper" module)
            return await new Promise((resolve) => {
                execFile(venvPython, ['-m', 'pip', 'show', packageName], { timeout: 15000 }, (err) => {
                    resolve({ success: true, installed: !err });
                });
            });
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Install a pip package into the Python venv
    ipcMain.handle('install-pip-package', async (_event, packageName) => {
        if (typeof packageName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(packageName) || packageName.length > 100) {
            return { success: false, error: 'Invalid package name' };
        }
        try {
            const pythonDir = path.join(__dirname, '..', '..', 'python');
            const isWindows = process.platform === 'win32';
            const venvPython = isWindows
                ? path.join(pythonDir, '.venv', 'Scripts', 'python.exe')
                : path.join(pythonDir, '.venv', 'bin', 'python');
            ctx.logger.info('[Config]', `Installing pip package: ${packageName}`);
            return await new Promise((resolve) => {
                execFile(venvPython, ['-m', 'pip', 'install', packageName], { timeout: 120000 }, (err, stdout, stderr) => {
                    if (err) {
                        ctx.logger.error('[Config]', `pip install ${packageName} failed:`, stderr || err.message);
                        resolve({ success: false, error: stderr || err.message });
                    } else {
                        ctx.logger.info('[Config]', `pip install ${packageName} succeeded`);
                        resolve({ success: true });
                    }
                });
            });
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('reset-config', () => {
        const newConfig = ctx.config.resetConfig();
        ctx.setAppConfig(newConfig);
        return newConfig;
    });

    ipcMain.handle('get-platform-info', () => {
        return { success: true, data: ctx.config.getPlatformPaths() };
    });

    // Theme export — save theme JSON to file
    ipcMain.handle('theme-export', async (_event, themeData) => {
        try {
            const win = ctx.getMainWindow();
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Export Theme',
                defaultPath: `${(themeData.name || 'theme').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
                filters: [{ name: 'Theme Files', extensions: ['json'] }]
            });
            if (canceled || !filePath) return { success: false, error: 'Cancelled' };
            fs.writeFileSync(filePath, JSON.stringify(themeData, null, 2), 'utf-8');
            return { success: true, filePath };
        } catch (err) {
            ctx.logger.error('[Theme]', 'Export failed:', err);
            return { success: false, error: err.message };
        }
    });

    // Theme import — read theme JSON from file
    ipcMain.handle('theme-import', async () => {
        try {
            const win = ctx.getMainWindow();
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                title: 'Import Theme',
                filters: [{ name: 'Theme Files', extensions: ['json'] }],
                properties: ['openFile']
            });
            if (canceled || !filePaths || filePaths.length === 0) return { success: false, error: 'Cancelled' };
            const raw = fs.readFileSync(filePaths[0], 'utf-8');
            const data = JSON.parse(raw);
            return { success: true, data };
        } catch (err) {
            ctx.logger.error('[Theme]', 'Import failed:', err);
            return { success: false, error: err.message };
        }
    });

    // ========== Custom Font Management ==========

    ipcMain.handle('font-upload', async () => {
        const win = ctx.getMainWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Upload Font',
            filters: [{ name: 'Font Files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
            properties: ['openFile']
        });
        if (canceled || !filePaths?.length) return { success: false, error: 'Cancelled' };
        return { success: true, filePath: filePaths[0] };
    });

    ipcMain.handle('font-add', async (_event, filePath, type) => {
        if (type !== 'ui' && type !== 'mono') return { success: false, error: 'type must be "ui" or "mono"' };
        if (typeof filePath !== 'string' || filePath.length > 1024) return { success: false, error: 'Invalid file path' };
        try { return await fontManager.addFont(filePath, type); }
        catch (err) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('font-remove', async (_event, fontId) => {
        if (typeof fontId !== 'string' || fontId.length > 20) return { success: false, error: 'Invalid font ID' };
        try { return await fontManager.removeFont(fontId); }
        catch (err) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('font-list', () => ({ success: true, data: fontManager.listFonts() }));

    ipcMain.handle('font-get-data-url', async (_event, fontId) => {
        if (typeof fontId !== 'string' || fontId.length > 20) return { success: false, error: 'Invalid font ID' };
        try {
            const fontPath = fontManager.getFontFilePath(fontId);
            if (!fontPath) return { success: false, error: 'Font not found' };
            const buffer = fs.readFileSync(fontPath);
            const entry = fontManager.listFonts().find(f => f.id === fontId);
            const mimeMap = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
            const dataUrl = `data:${mimeMap[entry.format] || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
            return { success: true, dataUrl, familyName: entry.familyName, format: entry.format };
        } catch (err) { return { success: false, error: err.message }; }
    });
}

module.exports = { registerConfigHandlers };
