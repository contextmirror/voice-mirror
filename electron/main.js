/**
 * Voice Mirror Electron - Main Process
 *
 * Creates a transparent, always-on-top overlay window with:
 * - Floating orb (idle state)
 * - Expandable chat panel
 * - System tray integration
 *
 * NOTE: Uses Electron 28. The basic window works - tested 2026-01-24.
 */

const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
// Note: claude-spawner and providers are now used via ai-manager service
const { createLogger } = require('./services/logger');
const { createPushToTalk } = require('./services/push-to-talk');
const { createPythonBackend, startDockerServices } = require('./services/python-backend');
const { createScreenCaptureWatcher } = require('./services/screen-capture-watcher');
const { createBrowserWatcher } = require('./services/browser-watcher');
const { createAIManager } = require('./services/ai-manager');
const { createInboxWatcher } = require('./services/inbox-watcher');
const { createTrayService } = require('./window/tray');
const { createWindowManager } = require('./window');

// File logging - uses logger service
const logger = createLogger();

// Push-to-talk service (initialized after app.whenReady with globalShortcut)
let pttService = null;

// Tray service
const trayService = createTrayService();

// Window manager (initialized after config is loaded)
let windowManager = null;

// Python backend service (initialized after config is loaded)
let pythonBackend = null;

// Screen capture watcher service (initialized after app.whenReady)
let screenCaptureWatcherService = null;

// Browser watcher service (initialized after app.whenReady)
let browserWatcherService = null;

// AI manager service (initialized after config is loaded)
let aiManager = null;

// Inbox watcher service (initialized after config is loaded)
let inboxWatcherService = null;

// Handle EPIPE errors gracefully (happens when terminal pipe breaks)
process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') return; // Ignore broken pipe
    console.error('stdout error:', err);
});
process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') return;
    console.error('stderr error:', err);
});

// Platform detection (from config module)
const { isWindows, isMac, isLinux } = config;

let mainWindow = null;  // Reference to windowManager's window (for backward compatibility)
let appConfig = null;

// Window state - kept in sync with windowManager
let isExpanded = false;

// Helper functions that delegate to windowManager (for backward compatibility)
function getOrbSize() {
    return windowManager?.getCurrentOrbSize() || appConfig?.appearance?.orbSize || 64;
}

function expandPanel() {
    if (windowManager) {
        windowManager.expand();
        isExpanded = windowManager.getIsExpanded();
    }
}

function collapseToOrb() {
    if (windowManager) {
        windowManager.collapse();
        isExpanded = windowManager.getIsExpanded();
    }
}

// Create window via windowManager
function createWindow() {
    mainWindow = windowManager.create();
    isExpanded = false;
}

function createTray() {
    trayService.create({
        onOpenPanel: () => {
            mainWindow?.show();
            if (!isExpanded) {
                expandPanel();
            }
        },
        onSettings: () => {
            mainWindow?.show();
            if (!isExpanded) {
                expandPanel();
            }
            // Send event to open settings panel in the UI
            mainWindow?.webContents.send('open-settings');
        },
        onToggleVisibility: () => {
            if (mainWindow?.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow?.show();
            }
        }
    });
}

// Python backend helper functions that delegate to pythonBackend service
function sendToPython(command) {
    if (pythonBackend) {
        pythonBackend.send(command);
    }
}

function startPythonVoiceMirror() {
    if (pythonBackend) {
        pythonBackend.start();
    }
}

async function sendImageToPython(imageData) {
    if (pythonBackend) {
        return pythonBackend.sendImage(imageData);
    }
    return { text: 'Python backend not initialized', error: 'not_initialized' };
}

// AI manager helper functions that delegate to aiManager service
function startAIProvider() {
    if (aiManager) {
        return aiManager.start();
    }
    return false;
}

function stopAIProvider() {
    if (aiManager) {
        return aiManager.stop();
    }
    return false;
}

function isAIProviderRunning() {
    return aiManager?.isRunning() || false;
}

function sendAIInput(text) {
    if (aiManager) {
        return aiManager.sendTextInput(text);
    }
    return false;
}

// Helper to check if Claude is running (for backward compatibility in IPC handlers)
function isClaudeRunning() {
    return aiManager?.isClaudeRunning() || false;
}

// Helper to check if Claude CLI is available
function isClaudeAvailable() {
    return aiManager?.isClaudeAvailable() || false;
}

// Inbox watcher helper functions that delegate to inboxWatcherService
function startInboxWatcher() {
    if (inboxWatcherService) {
        inboxWatcherService.start();
    }
}

function stopInboxWatcher() {
    if (inboxWatcherService) {
        inboxWatcherService.stop();
    }
}

// Helper to add displayed message ID (for deduplication from Python backend)
function addDisplayedMessageId(id) {
    if (inboxWatcherService) {
        inboxWatcherService.addDisplayedMessageId(id);
    }
}

// Serper.dev API key for web search
const SERPER_API_KEY = process.env.SERPER_API_KEY || '3adf77c61ddf98dff5ab2e3dd35b3eebc3409fa6';

// Screen capture and browser watcher helper functions
function startScreenCaptureWatcher() {
    if (screenCaptureWatcherService) {
        screenCaptureWatcherService.start();
    }
}

function stopScreenCaptureWatcher() {
    if (screenCaptureWatcherService) {
        screenCaptureWatcherService.stop();
    }
}

function startBrowserRequestWatcher() {
    if (browserWatcherService) {
        browserWatcherService.start();
    }
}

function stopBrowserRequestWatcher() {
    if (browserWatcherService) {
        browserWatcherService.stop();
    }
}

async function closeBrowser() {
    if (browserWatcherService) {
        await browserWatcherService.closeBrowser();
    }
}

// Push-to-talk helper functions that use the pttService
function registerPushToTalk(key) {
    if (!pttService) return;
    pttService.register(key, {
        onStart: () => {
            sendToPython({ command: 'start_recording' });
            mainWindow?.webContents.send('voice-event', { type: 'recording' });
        },
        onStop: () => {
            sendToPython({ command: 'stop_recording' });
            mainWindow?.webContents.send('voice-event', { type: 'idle' });
        }
    });
}

function unregisterPushToTalk() {
    if (pttService) {
        pttService.unregister();
    }
}

// Linux transparency workarounds
if (isLinux) {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('disable-gpu');  // Helps with transparency on some systems
}

// App lifecycle
app.whenReady().then(() => {
    // Initialize file logging
    logger.init();

    // Initialize push-to-talk service (needs globalShortcut from app.whenReady)
    pttService = createPushToTalk({ globalShortcut });

    // Load configuration
    appConfig = config.loadConfig();
    if (appConfig.advanced?.debugMode) {
        logger.log('CONFIG', `Debug mode enabled`);
    }

    // Initialize window manager
    windowManager = createWindowManager({
        getConfig: () => appConfig,
        updateConfig: config.updateConfig,
        isLinux
    });

    // Initialize Python backend service
    pythonBackend = createPythonBackend({
        pythonDir: path.join(__dirname, '..', 'python'),
        dataDir: path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data'),
        isWindows,
        log: (level, msg) => logger.log(level, msg)
    });

    // Set up Python backend event handler
    pythonBackend.onEvent((event) => {
        // Send voice events to renderer
        mainWindow?.webContents.send('voice-event', event);

        // Handle chat messages from transcription/response events
        if (event.chatMessage) {
            mainWindow?.webContents.send('chat-message', event.chatMessage);
        }
    });

    // Track response IDs for deduplication
    pythonBackend.onResponseId((responseId) => {
        addDisplayedMessageId(responseId);
    });

    // Initialize screen capture watcher service
    screenCaptureWatcherService = createScreenCaptureWatcher({
        dataDir: path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data'),
        captureScreen: (options) => desktopCapturer.getSources(options)
    });

    // Initialize browser watcher service
    browserWatcherService = createBrowserWatcher({
        dataDir: path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data'),
        serperApiKey: SERPER_API_KEY
    });

    // Initialize AI manager service
    aiManager = createAIManager({
        getConfig: () => appConfig,
        onOutput: (data) => {
            mainWindow?.webContents.send('claude-terminal', data);
        },
        onVoiceEvent: (event) => {
            mainWindow?.webContents.send('voice-event', event);
        },
        onToolCall: (data) => {
            mainWindow?.webContents.send('tool-call', data);
        },
        onToolResult: (data) => {
            mainWindow?.webContents.send('tool-result', data);
        },
        onProviderSwitch: () => {
            // Clear processed user messages when provider is switched
            if (inboxWatcherService) {
                inboxWatcherService.clearProcessedUserMessageIds();
            }
            console.log('[Voice Mirror] Cleared processed user message IDs for provider switch');
        }
    });

    // Initialize inbox watcher service
    inboxWatcherService = createInboxWatcher({
        dataDir: path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data'),
        isClaudeRunning: () => aiManager?.isClaudeRunning() || false,
        getProvider: () => aiManager?.getProvider() || null,
        onClaudeMessage: (msg) => {
            mainWindow?.webContents.send('chat-message', msg);
        },
        onUserMessage: (msg) => {
            mainWindow?.webContents.send('chat-message', msg);
        },
        onAssistantMessage: (msg) => {
            mainWindow?.webContents.send('chat-message', msg);
        },
        onVoiceEvent: (event) => {
            mainWindow?.webContents.send('voice-event', event);
        },
        log: logger
    });

    // Dev logging from renderer → vmr.log
    ipcMain.on('devlog', (_event, category, action, data) => {
        logger.devlog(category, action, data || {});
    });

    // Register IPC handlers
    ipcMain.handle('toggle-expand', () => {
        if (isExpanded) {
            collapseToOrb();
        } else {
            expandPanel();
        }
        return isExpanded;
    });

    ipcMain.handle('capture-screen', async () => {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });

        if (sources.length > 0) {
            return sources[0].thumbnail.toDataURL();
        }
        return null;
    });

    ipcMain.handle('get-state', () => {
        return { expanded: isExpanded };
    });

    // Window dragging handlers (for custom orb drag without -webkit-app-region)
    ipcMain.handle('get-window-position', () => {
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            return { x, y };
        }
        return { x: 0, y: 0 };
    });

    ipcMain.handle('set-window-position', (event, x, y) => {
        if (mainWindow) {
            mainWindow.setPosition(Math.round(x), Math.round(y));
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
    let preDragBounds = null;

    ipcMain.handle('start-drag-capture', () => {
        if (!mainWindow || isExpanded) return { success: false };

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
        if (!mainWindow || isExpanded) return { success: false };

        // Restore to orb size at new position
        const orbSize = getOrbSize();
        mainWindow.setBounds({
            x: Math.round(newX),
            y: Math.round(newY),
            width: orbSize,
            height: orbSize
        });

        // Save new position
        config.updateConfig({ window: { orbX: Math.round(newX), orbY: Math.round(newY) } });

        preDragBounds = null;
        console.log('[Voice Mirror] Drag capture ended at', newX, newY);
        return { success: true };
    });

    // Open external URLs in default browser
    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (err) {
            console.error('[Voice Mirror] Failed to open external URL:', err);
            return { success: false, error: err.message };
        }
    });

    // Config IPC handlers (for settings UI)
    ipcMain.handle('get-config', () => {
        return config.loadConfig();
    });

    ipcMain.handle('set-config', (event, updates) => {
        const oldHotkey = appConfig?.behavior?.hotkey;
        const oldPttKey = appConfig?.behavior?.pttKey;

        appConfig = config.updateConfig(updates);

        // Re-register global shortcut if hotkey changed
        if (updates.behavior?.hotkey && updates.behavior.hotkey !== oldHotkey) {
            globalShortcut.unregister(oldHotkey);
            const newShortcut = updates.behavior.hotkey;
            const registered = globalShortcut.register(newShortcut, () => {
                console.log('[Voice Mirror] Global shortcut triggered');
                if (isExpanded) {
                    collapseToOrb();
                } else {
                    expandPanel();
                }
            });
            console.log(`[Voice Mirror] Re-registered shortcut: ${newShortcut} (${registered ? 'success' : 'failed'})`);
        }

        // Handle push-to-talk key registration
        if (updates.behavior?.activationMode === 'pushToTalk') {
            registerPushToTalk(updates.behavior?.pttKey || 'Space');
        } else if (oldPttKey) {
            unregisterPushToTalk();
        }

        // Notify Python backend of config changes
        if (pythonBackend?.isRunning()) {
            sendToPython({
                command: 'config_update',
                config: {
                    activationMode: updates.behavior?.activationMode,
                    wakeWord: updates.wakeWord,
                    voice: updates.voice
                }
            });
        }

        return appConfig;
    });

    ipcMain.handle('reset-config', () => {
        appConfig = config.resetConfig();
        return appConfig;
    });

    ipcMain.handle('get-platform-info', () => {
        return config.getPlatformPaths();
    });

    // Image handling - send to Python backend
    ipcMain.handle('send-image', async (event, imageData) => {
        return sendImageToPython(imageData);
    });

    // Python backend communication
    ipcMain.handle('send-query', (event, query) => {
        sendToPython({ command: 'query', text: query.text, image: query.image });
        return { sent: true };
    });

    ipcMain.handle('set-voice-mode', (event, mode) => {
        sendToPython({ command: 'set_mode', mode: mode });
        return { sent: true };
    });

    ipcMain.handle('get-python-status', () => {
        return {
            running: pythonBackend?.isRunning() || false,
            pid: pythonBackend?.getProcess()?.pid
        };
    });

    ipcMain.handle('start-python', () => {
        if (!pythonBackend?.isRunning()) {
            startPythonVoiceMirror();
            return { started: true };
        }
        return { started: false, reason: 'already running' };
    });

    ipcMain.handle('stop-python', () => {
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
            return { stopped: true };
        }
        return { stopped: false, reason: 'not running' };
    });

    // Call mode handlers (always listening, no wake word)
    ipcMain.handle('set-call-mode', (event, active) => {
        const callPath = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data', 'voice_call.json');

        // Ensure directory exists
        const dir = path.dirname(callPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(callPath, JSON.stringify({ active: active }, null, 2));
        console.log(`[Voice Mirror] Call mode: ${active ? 'ON' : 'OFF'}`);

        mainWindow?.webContents.send('voice-event', {
            type: active ? 'call_active' : 'idle',
            callMode: active
        });

        return { callMode: active };
    });

    ipcMain.handle('get-call-mode', () => {
        const callPath = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data', 'voice_call.json');

        try {
            if (fs.existsSync(callPath)) {
                const data = JSON.parse(fs.readFileSync(callPath, 'utf-8'));
                return { active: data.active || false };
            }
        } catch {}

        return { active: false };
    });

    // AI Provider backend IPC handlers (routes to Claude PTY or OpenAI-compatible API)
    ipcMain.handle('start-claude', () => {
        if (!isAIProviderRunning()) {
            const started = startAIProvider();
            return { started };
        }
        return { started: false, reason: 'already running' };
    });

    ipcMain.handle('stop-claude', () => {
        if (isAIProviderRunning()) {
            stopAIProvider();
            return { stopped: true };
        }
        return { stopped: false, reason: 'not running' };
    });

    ipcMain.handle('get-claude-status', () => {
        const providerType = appConfig?.ai?.provider || 'claude';
        return {
            running: isAIProviderRunning(),
            mode: providerType === 'claude' ? 'pty' : 'api',
            provider: providerType
        };
    });

    // PTY input/resize handlers for xterm.js
    // Routes to Claude PTY or OpenAI-compatible provider based on config
    ipcMain.handle('claude-pty-input', (event, data) => {
        const providerType = appConfig?.ai?.provider || 'claude';

        if (providerType === 'claude') {
            // Claude uses PTY - send raw input via aiManager
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
                        mainWindow?.webContents.send('claude-terminal', {
                            type: 'stdout',
                            text: '\b \b'
                        });
                    }
                } else if (data.charCodeAt(0) >= 32 || data === '\t') {
                    // Printable characters - accumulate and echo
                    provider._inputBuffer = (provider._inputBuffer || '') + data;
                    // Echo to terminal
                    mainWindow?.webContents.send('claude-terminal', {
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
        const providerType = appConfig?.ai?.provider || 'claude';

        if (providerType === 'claude' && aiManager) {
            aiManager.resize(cols, rows);
            return { resized: true };
        }
        // Non-PTY providers don't need resize handling
        return { resized: false, reason: providerType === 'claude' ? 'not running' : 'not PTY' };
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

    ipcMain.handle('ai-set-provider', (event, providerId, model) => {
        // Update config with new provider
        appConfig = config.updateConfig({
            ai: {
                provider: providerId,
                model: model || null
            }
        });
        console.log(`[Voice Mirror] AI provider set to: ${providerId}${model ? ' (' + model + ')' : ''}`);
        return { success: true, provider: providerId, model };
    });

    ipcMain.handle('ai-get-provider', () => {
        return {
            provider: appConfig?.ai?.provider || 'claude',
            model: appConfig?.ai?.model || null,
            autoDetect: appConfig?.ai?.autoDetect !== false
        };
    });

    // Start both Voice + AI provider together
    ipcMain.handle('start-all', () => {
        if (!pythonBackend?.isRunning()) startPythonVoiceMirror();
        if (!isAIProviderRunning()) startAIProvider();
        return { started: true };
    });

    ipcMain.handle('stop-all', () => {
        if (pythonBackend?.isRunning()) {
            pythonBackend.stop();
        }
        stopAIProvider();
        return { stopped: true };
    });

    createWindow();
    createTray();
    startScreenCaptureWatcher();
    startInboxWatcher();
    startBrowserRequestWatcher();

    // Register global shortcut to toggle panel (Ctrl+Shift+V)
    const shortcut = 'CommandOrControl+Shift+V';
    const registered = globalShortcut.register(shortcut, () => {
        console.log('[Voice Mirror] Global shortcut triggered');
        if (isExpanded) {
            collapseToOrb();
        } else {
            expandPanel();
        }
    });

    if (registered) {
        console.log(`[Voice Mirror] Global shortcut registered: ${shortcut}`);
    } else {
        console.log(`[Voice Mirror] Failed to register shortcut: ${shortcut}`);
    }

    // Register PTT keybind from saved config on startup
    if (appConfig?.behavior?.activationMode === 'pushToTalk' && appConfig?.behavior?.pttKey) {
        console.log('[Voice Mirror] Registering PTT key from saved config:', appConfig.behavior.pttKey);
        registerPushToTalk(appConfig.behavior.pttKey);
    }

    // Start Docker services (SearXNG, n8n) if available
    startDockerServices();

    // Auto-start Voice Mirror (Python + AI provider) on app launch
    try {
        const providerName = appConfig?.ai?.provider || 'claude';
        console.log(`[Voice Mirror] Auto-starting Python and AI provider (${providerName})...`);
        startPythonVoiceMirror();

        // Small delay to let Python initialize before starting AI provider
        setTimeout(() => {
            try {
                startAIProvider();
            } catch (err) {
                console.error('[Voice Mirror] Failed to start AI provider:', err.message);
            }
        }, 2000);
    } catch (err) {
        console.error('[Voice Mirror] Auto-start failed:', err.message);
    }
});

app.on('window-all-closed', () => {
    // Clean up Python process
    if (pythonBackend) {
        pythonBackend.kill();
    }

    // Stop AI provider (Claude PTY or OpenAI-compatible)
    stopAIProvider();

    // Stop all watchers
    stopScreenCaptureWatcher();
    stopInboxWatcher();
    stopBrowserRequestWatcher();

    // Close browser
    closeBrowser();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', () => {
    logger.log('APP', 'Shutting down...');

    // Unregister all shortcuts
    globalShortcut.unregisterAll();

    // Stop push-to-talk service
    if (pttService && pttService.stop()) {
        logger.log('APP', 'PTT service stopped');
    }

    // Stop watchers
    stopScreenCaptureWatcher();
    stopInboxWatcher();
    stopBrowserRequestWatcher();

    // Close browser
    closeBrowser();

    if (pythonBackend) {
        pythonBackend.kill();
    }

    // Stop AI provider (Claude PTY or OpenAI-compatible)
    stopAIProvider();

    // Close log file
    logger.close();
});
