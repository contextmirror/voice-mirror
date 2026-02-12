/**
 * IPC handler registrations for Voice Mirror Electron.
 * Extracted from main.js to reduce file size and improve testability.
 */

const { app, ipcMain, dialog, desktopCapturer, screen, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { validators } = require('./ipc-validators');
const fontManager = require('./font-manager');
const CLI_PROVIDERS = ['claude', 'opencode'];

/**
 * Capture a specific display on Windows using PowerShell + .NET GDI+.
 * Bypasses Electron's desktopCapturer bug where multi-monitor returns same image.
 * @param {number} displayIndex - Display index to capture
 * @param {string} outputPath - Path to save the PNG screenshot
 * @returns {Promise<boolean>} True if capture succeeded
 */
function captureDisplayWindows(displayIndex, outputPath) {
    if (process.platform !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
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
`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: 8000, windowsHide: true
        }, (err) => {
            if (err) {
                console.error('[IPC] Windows native capture failed:', err.message);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

/**
 * Register all IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Function} ctx.getMainWindow - Get main window reference
 * @param {Function} ctx.getAppConfig - Get current app config
 * @param {Function} ctx.setAppConfig - Set app config (mutates the outer variable)
 * @param {Object} ctx.config - Config module (loadConfig, updateConfig, etc.)
 * @param {Function} ctx.safeSend - Safe IPC send to renderer
 * @param {Function} ctx.expandPanel - Expand panel
 * @param {Function} ctx.collapseToOrb - Collapse to orb
 * @param {Function} ctx.getIsExpanded - Get expanded state
 * @param {Function} ctx.getOrbSize - Get orb size
 * @param {Function} ctx.sendToPython - Send command to Python
 * @param {Function} ctx.sendImageToPython - Send image to Python
 * @param {Function} ctx.startPythonVoiceMirror - Start Python
 * @param {Function} ctx.startAIProvider - Start AI provider
 * @param {Function} ctx.stopAIProvider - Stop AI provider
 * @param {Function} ctx.isAIProviderRunning - Check if AI running
 * @param {Function} ctx.getAIManager - Get AI manager
 * @param {Function} ctx.getPythonBackend - Get Python backend
 * @param {Function} ctx.getWaylandOrb - Get wayland orb
 * @param {Function} ctx.getHotkeyManager - Get hotkey manager
 * @param {Function} ctx.getInboxWatcherService - Get inbox watcher
 * @param {Object} ctx.logger - Logger
 */
function registerIpcHandlers(ctx) {
    // Initialize font manager with the config directory
    fontManager.init(ctx.config.getConfigDir());

    // Local state for drag capture
    let preDragBounds = null;

    // Track last known terminal dimensions for PTY spawning on provider switch
    let lastTermCols = 120;
    let lastTermRows = 30;

    // Dev logging from renderer -> vmr.log
    ipcMain.on('devlog', (_event, category, action, data) => {
        ctx.logger.devlog(category, action, data || {});
    });

    // Hotkey fallback from renderer — only honored when primary layers both failed
    ipcMain.on('hotkey-fallback', (event, id) => {
        const hotkeyManager = ctx.getHotkeyManager();
        if (!hotkeyManager) return;
        const binding = hotkeyManager.getBinding(id);
        if (binding && !binding.uiohookActive && !binding.globalShortcutActive) {
            ctx.logger.log('HOTKEY', `Fallback triggered for "${id}" from renderer`);
            binding.callback();
        }
    });

    ipcMain.handle('toggle-expand', () => {
        if (ctx.getIsExpanded()) {
            ctx.collapseToOrb();
        } else {
            ctx.expandPanel();
        }
        return ctx.getIsExpanded();
    });

    ipcMain.handle('get-screens', async () => {
        const displays = screen.getAllDisplays();
        const primary = screen.getPrimaryDisplay();

        // On Windows multi-monitor, use native PowerShell capture for accurate thumbnails
        // (Electron desktopCapturer returns same image for all displays)
        if (process.platform === 'win32' && displays.length > 1) {
            const tmpDir = app.getPath('temp');
            const results = [];
            for (let i = 0; i < displays.length; i++) {
                const d = displays[i];
                const isPrimary = d.id === primary.id;
                const tmpPath = path.join(tmpDir, `vm-thumb-${i}.png`);
                const ok = await captureDisplayWindows(i, tmpPath);
                let thumbnail = '';
                if (ok && fs.existsSync(tmpPath)) {
                    const img = nativeImage.createFromPath(tmpPath);
                    thumbnail = img.resize({ width: 320 }).toDataURL();
                    try { fs.unlinkSync(tmpPath); } catch {}
                }
                results.push({
                    id: `display:${i}`,
                    name: `Screen ${i + 1} (${d.size.width}x${d.size.height})${isPrimary ? ' - Primary' : ''}`,
                    thumbnail
                });
            }
            return results;
        }

        // Fallback: use desktopCapturer
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 320, height: 180 }
        });
        return sources.map((s, i) => ({
            id: s.id,
            name: s.name || `Screen ${i + 1}`,
            thumbnail: s.thumbnail.toDataURL()
        }));
    });

    ipcMain.handle('capture-screen', async (_event, sourceId) => {
        // Windows native capture for multi-monitor (display:N format from get-screens)
        if (process.platform === 'win32' && typeof sourceId === 'string' && sourceId.startsWith('display:')) {
            const displayIndex = parseInt(sourceId.split(':')[1], 10) || 0;
            const tmpPath = path.join(app.getPath('temp'), `vm-capture-${Date.now()}.png`);
            const ok = await captureDisplayWindows(displayIndex, tmpPath);
            if (ok && fs.existsSync(tmpPath)) {
                const img = nativeImage.createFromPath(tmpPath);
                const dataUrl = img.toDataURL();
                try { fs.unlinkSync(tmpPath); } catch {}
                return dataUrl;
            }
        }

        // Fallback: use desktopCapturer
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        const source = sourceId
            ? sources.find(s => s.id === sourceId) || sources[0]
            : sources[0];
        return source ? source.thumbnail.toDataURL() : null;
    });

    ipcMain.handle('supports-vision', () => {
        const aiManager = ctx.getAIManager();
        // Claude Code always supports vision via MCP screen capture
        if (aiManager && aiManager.isClaudeRunning()) return true;
        const provider = aiManager && aiManager.getProvider();
        if (provider && provider.supportsVision) return provider.supportsVision();
        return false;
    });

    ipcMain.handle('get-state', () => {
        return { expanded: ctx.getIsExpanded() };
    });

    // Window control handlers
    ipcMain.handle('minimize-window', () => {
        ctx.getMainWindow()?.minimize();
    });

    ipcMain.handle('quit-app', () => {
        const { app } = require('electron');
        app.isQuitting = true;
        app.quit();
    });

    // Window dragging handlers (for custom orb drag without -webkit-app-region)
    ipcMain.handle('get-window-position', () => {
        const mainWindow = ctx.getMainWindow();
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            return { x, y };
        }
        return { x: 0, y: 0 };
    });

    ipcMain.handle('set-window-position', (event, x, y) => {
        const v = validators['set-window-position'](x, y);
        if (!v.valid) return { success: false, error: v.error };
        const mainWindow = ctx.getMainWindow();
        if (mainWindow) {
            mainWindow.setPosition(v.value.x, v.value.y);
            return { success: true };
        }
        return { success: false };
    });

    // Get cursor position (for drag - mouse leaves small window)
    ipcMain.handle('get-cursor-position', () => {
        const point = screen.getCursorScreenPoint();
        return { x: point.x, y: point.y };
    });

    // Drag capture: temporarily expand window to catch mouse events
    // When orb is 64x64, mouse leaves immediately - this fixes that
    ipcMain.handle('start-drag-capture', () => {
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || ctx.getIsExpanded()) return { success: false };

        // Save current bounds
        preDragBounds = mainWindow.getBounds();

        // Expand to large capture area centered on orb
        const captureSize = 800;
        const offsetX = (captureSize - preDragBounds.width) / 2;
        const offsetY = (captureSize - preDragBounds.height) / 2;

        mainWindow.setBounds({
            x: Math.round(preDragBounds.x - offsetX),
            y: Math.round(preDragBounds.y - offsetY),
            width: captureSize,
            height: captureSize
        });

        console.log('[Voice Mirror] Drag capture started');
        return { success: true, originalBounds: preDragBounds };
    });

    ipcMain.handle('stop-drag-capture', (event, newX, newY) => {
        const v = validators['stop-drag-capture'](newX, newY);
        if (!v.valid) return { success: false, error: v.error };
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || ctx.getIsExpanded()) return { success: false };

        // Restore to orb size at new position
        const orbSize = ctx.getOrbSize();
        mainWindow.setBounds({
            x: v.value.newX,
            y: v.value.newY,
            width: orbSize,
            height: orbSize
        });

        // Save new position (async, don't block drag end)
        ctx.config.updateConfigAsync({ window: { orbX: v.value.newX, orbY: v.value.newY } });

        preDragBounds = null;
        console.log('[Voice Mirror] Drag capture ended at', newX, newY);
        return { success: true };
    });

    // Open external URLs in default browser
    ipcMain.handle('open-external', async (event, url) => {
        const v = validators['open-external'](url);
        if (!v.valid) return { success: false, error: v.error };
        try {
            await shell.openExternal(v.value);
            return { success: true };
        } catch (err) {
            console.error('[Voice Mirror] Failed to open external URL:', err);
            return { success: false, error: err.message };
        }
    });

    // Config IPC handlers (for settings UI)
    ipcMain.handle('get-config', () => {
        return ctx.config.loadConfig();
    });

    ipcMain.handle('set-config', async (event, updates) => {
        const v = validators['set-config'](updates);
        if (!v.valid) {
            console.warn('[Config] Rejected invalid update:', v.error);
            return ctx.getAppConfig();
        }
        updates = v.value;
        const appConfig = ctx.getAppConfig();
        const oldProvider = appConfig?.ai?.provider;
        const oldModel = appConfig?.ai?.model;
        if (updates.ai) {
            console.log(`[Config] AI update: provider=${oldProvider}->${updates.ai.provider}, model=${oldModel}->${updates.ai.model}`);
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
                console.log(`[Config] Provider/model changed: ${oldProvider}/${oldModel} -> ${newProvider}/${newModel} (was running: ${wasRunning})`);

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
                        console.log(`[Config] New provider started: ${newProvider} (${lastTermCols}x${lastTermRows})`);
                    } catch (err) {
                        console.error(`[Config] Provider switch error:`, err.message);
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
                    console.log(`[Config] Start with system: ${updates.behavior.startWithSystem}`);
                } catch (err) {
                    console.error('[Config] Failed to set login item:', err.message);
                }
            }
        }

        return ctx.getAppConfig();
    });

    // Overlay output list
    ipcMain.handle('list-overlay-outputs', async () => {
        const waylandOrb = ctx.getWaylandOrb();
        if (waylandOrb?.isReady()) {
            return await waylandOrb.listOutputs();
        }
        return [];
    });

    ipcMain.handle('reset-config', () => {
        const newConfig = ctx.config.resetConfig();
        ctx.setAppConfig(newConfig);
        return newConfig;
    });

    ipcMain.handle('get-platform-info', () => {
        return ctx.config.getPlatformPaths();
    });

    // Audio device enumeration (asks Python backend)
    ipcMain.handle('list-audio-devices', async () => {
        return ctx.listAudioDevices ? ctx.listAudioDevices() : null;
    });

    // Detect API keys from environment (returns provider names only, not keys)
    ipcMain.handle('get-detected-keys', () => {
        const { detectApiKeys } = require('./services/provider-detector');
        const detected = detectApiKeys();
        // Return only provider names that have keys — never send actual keys to renderer
        return Object.keys(detected).filter(k => !k.startsWith('_'));
    });

    // CLI availability check
    ipcMain.handle('check-cli-available', (_event, command) => {
        if (typeof command !== 'string' || command.length > 50) {
            return { available: false, error: 'Invalid command' };
        }
        const { isCLIAvailable } = require('./cli-spawner');
        return { available: isCLIAvailable(command) };
    });

    // CLI install via npm global
    ipcMain.handle('install-cli', async (_event, packageName) => {
        const ALLOWED_PACKAGES = { opencode: 'opencode-ai' };

        if (typeof packageName !== 'string' || !ALLOWED_PACKAGES[packageName]) {
            return { success: false, error: `Package "${packageName}" is not allowed` };
        }

        const npmPackage = ALLOWED_PACKAGES[packageName];
        const { execFile } = require('child_process');
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

        return new Promise((resolve) => {
            execFile(npmCmd, ['install', '-g', npmPackage], {
                timeout: 120000,
                windowsHide: true,
                env: { ...process.env }
            }, (err, _stdout, stderr) => {
                if (err) {
                    console.error(`[CLI Install] Failed to install ${npmPackage}:`, err.message);
                    resolve({ success: false, error: err.message, stderr: stderr?.slice(0, 500) });
                } else {
                    console.log(`[CLI Install] Successfully installed ${npmPackage}`);
                    resolve({ success: true });
                }
            });
        });
    });

    // Image handling - send to Python backend
    ipcMain.handle('send-image', async (event, imageData) => {
        const v = validators['send-image'](imageData);
        if (!v.valid) return { error: v.error };
        return ctx.sendImageToPython(v.value);
    });

    // Python backend communication
    ipcMain.handle('send-query', (event, query) => {
        const v = validators['send-query'](query);
        if (!v.valid) return { sent: false, error: v.error };
        ctx.sendToPython({ command: 'query', text: v.value.text, image: v.value.image });
        return { sent: true };
    });

    ipcMain.handle('set-voice-mode', (event, mode) => {
        const v = validators['set-voice-mode'](mode);
        if (!v.valid) return { sent: false, error: v.error };
        ctx.sendToPython({ command: 'set_mode', mode: v.value });
        return { sent: true };
    });

    ipcMain.handle('get-python-status', () => {
        const pythonBackend = ctx.getPythonBackend();
        return {
            running: pythonBackend?.isRunning() || false,
            pid: pythonBackend?.getProcess()?.pid
        };
    });

    ipcMain.handle('start-python', () => {
        if (!ctx.getPythonBackend()?.isRunning()) {
            ctx.startPythonVoiceMirror();
            return { started: true };
        }
        return { started: false, reason: 'already running' };
    });

    ipcMain.handle('stop-python', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
            return { stopped: true };
        }
        return { stopped: false, reason: 'not running' };
    });

    // Manual restart (resets retry counter for user-initiated recovery)
    ipcMain.handle('python-restart', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend) {
            pythonBackend.restart();
            return { restarting: true };
        }
        return { restarting: false, reason: 'backend not initialized' };
    });

    // AI Provider backend IPC handlers (routes to Claude PTY or OpenAI-compatible API)
    ipcMain.handle('start-claude', (event, cols, rows) => {
        if (!ctx.isAIProviderRunning()) {
            const started = ctx.startAIProvider(cols, rows);
            return { started };
        }
        return { started: false, reason: 'already running' };
    });

    ipcMain.handle('stop-claude', () => {
        if (ctx.isAIProviderRunning()) {
            ctx.stopAIProvider();
            return { stopped: true };
        }
        return { stopped: false, reason: 'not running' };
    });

    ipcMain.handle('interrupt-ai', () => {
        const interrupted = ctx.interruptAIProvider?.() || false;
        return { interrupted };
    });

    ipcMain.handle('get-claude-status', () => {
        const providerType = ctx.getAppConfig()?.ai?.provider || 'claude';
        return {
            running: ctx.isAIProviderRunning(),
            mode: CLI_PROVIDERS.includes(providerType) ? 'pty' : 'api',
            provider: providerType
        };
    });

    // PTY input/resize handlers for terminal
    // Routes to Claude PTY or OpenAI-compatible provider based on config
    ipcMain.handle('claude-pty-input', (event, data) => {
        const v = validators['claude-pty-input'](data);
        if (!v.valid) return { sent: false, error: v.error };
        data = v.value;
        const providerType = ctx.getAppConfig()?.ai?.provider || 'claude';
        const aiManager = ctx.getAIManager();

        if (CLI_PROVIDERS.includes(providerType)) {
            // CLI providers use PTY - send raw input via aiManager
            if (aiManager && aiManager.sendRawInputData(data)) {
                return { sent: true };
            }
        } else {
            // OpenAI-compatible providers - accumulate input and send on Enter
            const provider = aiManager?.getProvider();
            if (provider && provider.isRunning()) {
                // Check if Enter key was pressed (CR or LF)
                if (data === '\r' || data === '\n') {
                    // Send accumulated input
                    if (provider._inputBuffer && provider._inputBuffer.trim()) {
                        provider.sendInput(provider._inputBuffer.trim());
                        provider._inputBuffer = '';
                    }
                } else if (data === '\x7f' || data === '\b') {
                    // Backspace - remove last character
                    if (provider._inputBuffer) {
                        provider._inputBuffer = provider._inputBuffer.slice(0, -1);
                        // Echo backspace to terminal
                        ctx.safeSend('claude-terminal', {
                            type: 'stdout',
                            text: '\b \b'
                        });
                    }
                } else if (data.charCodeAt(0) >= 32 || data === '\t') {
                    // Printable characters - accumulate and echo
                    provider._inputBuffer = (provider._inputBuffer || '') + data;
                    // Echo to terminal
                    ctx.safeSend('claude-terminal', {
                        type: 'stdout',
                        text: data
                    });
                }
                return { sent: true };
            }
        }
        return { sent: false, reason: 'not running' };
    });

    ipcMain.handle('claude-pty-resize', (event, cols, rows) => {
        const v = validators['claude-pty-resize'](cols, rows);
        if (!v.valid) return { resized: false, error: v.error };

        // Always track dimensions so provider switches can use correct size
        lastTermCols = v.value.cols;
        lastTermRows = v.value.rows;

        const providerType = ctx.getAppConfig()?.ai?.provider || 'claude';
        const aiManager = ctx.getAIManager();

        if (CLI_PROVIDERS.includes(providerType) && aiManager) {
            aiManager.resize(v.value.cols, v.value.rows);
            return { resized: true };
        }
        return { resized: false, reason: CLI_PROVIDERS.includes(providerType) ? 'not running' : 'not PTY' };
    });

    // AI Provider IPC handlers
    ipcMain.handle('ai-scan-providers', async () => {
        const { providerDetector } = require('./services/provider-detector');
        const results = await providerDetector.scanAll();
        return results;
    });

    ipcMain.handle('ai-get-providers', async () => {
        const { providerDetector } = require('./services/provider-detector');
        return providerDetector.getCachedStatus();
    });

    ipcMain.handle('ai-set-provider', async (event, providerId, model) => {
        const v = validators['ai-set-provider'](providerId, model);
        if (!v.valid) return { success: false, error: v.error };
        const newConfig = await ctx.config.updateConfigAsync({
            ai: {
                provider: v.value.providerId,
                model: v.value.model
            }
        });
        ctx.setAppConfig(newConfig);
        console.log(`[Voice Mirror] AI provider set to: ${v.value.providerId}${v.value.model ? ' (' + v.value.model + ')' : ''}`);
        return { success: true, provider: v.value.providerId, model: v.value.model };
    });

    ipcMain.handle('ai-get-provider', () => {
        const appConfig = ctx.getAppConfig();
        return {
            provider: appConfig?.ai?.provider || 'claude',
            model: appConfig?.ai?.model || null,
            autoDetect: appConfig?.ai?.autoDetect !== false
        };
    });

    // Start both Voice + AI provider together
    ipcMain.handle('start-all', () => {
        if (!ctx.getPythonBackend()?.isRunning()) ctx.startPythonVoiceMirror();
        if (!ctx.isAIProviderRunning()) ctx.startAIProvider();
        return { started: true };
    });

    ipcMain.handle('stop-all', () => {
        const pythonBackend = ctx.getPythonBackend();
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
        }
        ctx.stopAIProvider();
        return { stopped: true };
    });

    // ========== Chat History Persistence ==========
    const chatsDir = path.join(app.getPath('userData'), 'chats');

    ipcMain.handle('chat-list', async () => {
        try {
            if (!fs.existsSync(chatsDir)) return [];
            const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));
            const chats = [];
            for (const file of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(chatsDir, file), 'utf-8'));
                    chats.push({
                        id: data.id,
                        name: data.name || 'Untitled',
                        created: data.created,
                        updated: data.updated,
                        messageCount: (data.messages || []).length,
                    });
                } catch { /* skip corrupt files */ }
            }
            chats.sort((a, b) => new Date(b.updated) - new Date(a.updated));
            return chats;
        } catch (err) {
            console.error('[Chat] Failed to list chats:', err);
            return [];
        }
    });

    ipcMain.handle('chat-load', async (_event, id) => {
        try {
            const filePath = path.join(chatsDir, `${id}.json`);
            if (!fs.existsSync(filePath)) return null;
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (err) {
            console.error('[Chat] Failed to load chat:', err);
            return null;
        }
    });

    ipcMain.handle('chat-save', async (_event, chat) => {
        try {
            if (!chat || !chat.id) return { success: false, error: 'Invalid chat data' };
            if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
            const filePath = path.join(chatsDir, `${chat.id}.json`);
            chat.updated = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            console.error('[Chat] Failed to save chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-delete', async (_event, id) => {
        try {
            const filePath = path.join(chatsDir, `${id}.json`);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return { success: true };
        } catch (err) {
            console.error('[Chat] Failed to delete chat:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat-rename', async (_event, id, name) => {
        try {
            const filePath = path.join(chatsDir, `${id}.json`);
            if (!fs.existsSync(filePath)) return { success: false, error: 'Chat not found' };
            const chat = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            chat.name = name;
            chat.updated = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
            return { success: true };
        } catch (err) {
            console.error('[Chat] Failed to rename chat:', err);
            return { success: false, error: err.message };
        }
    });

    // Update checker
    ipcMain.handle('apply-update', async () => {
        const checker = ctx.getUpdateChecker?.();
        if (checker) {
            return await checker.applyUpdate();
        }
        return { success: false, error: 'Update checker not initialized' };
    });

    // App relaunch (used after updates)
    ipcMain.handle('app-relaunch', () => {
        app.relaunch();
        app.exit(0);
    });

    // Theme export — save theme JSON to file
    ipcMain.handle('theme-export', async (_event, themeData) => {
        try {
            const win = ctx.getWindow?.();
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Export Theme',
                defaultPath: `${(themeData.name || 'theme').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
                filters: [{ name: 'Theme Files', extensions: ['json'] }]
            });
            if (canceled || !filePath) return { success: false, error: 'Cancelled' };
            fs.writeFileSync(filePath, JSON.stringify(themeData, null, 2), 'utf-8');
            return { success: true, filePath };
        } catch (err) {
            console.error('[Theme] Export failed:', err);
            return { success: false, error: err.message };
        }
    });

    // Theme import — read theme JSON from file
    ipcMain.handle('theme-import', async () => {
        try {
            const win = ctx.getWindow?.();
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
            console.error('[Theme] Import failed:', err);
            return { success: false, error: err.message };
        }
    });

    // ========== Custom Font Management ==========

    ipcMain.handle('font-upload', async () => {
        const win = ctx.getWindow?.();
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

    ipcMain.handle('font-list', () => fontManager.listFonts());

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

module.exports = { registerIpcHandlers };
