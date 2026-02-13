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

const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
// Note: --ozone-platform=x11 is passed via CLI (package.json/launch.sh)
// to force XWayland on Linux. The Electron window is used for the expanded
// panel; the collapsed orb is rendered by wayland-orb (native layer-shell)
// when available, falling back to the Electron window on X11/non-Wayland.
const config = require('./config');
const { registerIpcHandlers } = require('./ipc');
// Note: claude-spawner and providers are now used via ai-manager service
const { createLogger } = require('./services/logger');
const { createHotkeyManager } = require('./services/hotkey-manager');
const uiohookShared = require('./services/uiohook-shared');
const { createPythonBackend, startDockerServices } = require('./services/python-backend');
const { createScreenCaptureWatcher } = require('./services/screen-capture-watcher');
const { createBrowserWatcher } = require('./services/browser-watcher');
const { createAIManager } = require('./services/ai-manager');
const { createInboxWatcher } = require('./services/inbox-watcher');
const { createPerfMonitor } = require('./services/perf-monitor');
const { createUpdateChecker } = require('./services/update-checker');
const { createTrayService } = require('./window/tray');
const { createWindowManager } = require('./window');
const { createWaylandOrb } = require('./services/wayland-orb');

// File logging - uses logger service
const logger = createLogger();

// Hotkey manager (dual-layer: uiohook + globalShortcut)
let hotkeyManager = null;

// Tray service
const trayService = createTrayService();

// Window manager (initialized after config is loaded)
let windowManager = null;

// Wayland overlay orb (native layer-shell, Linux/Wayland only)
let waylandOrb = null;

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

// Performance monitor service
let perfMonitor = null;

// Update checker service
let updateChecker = null;

// Handle EPIPE errors gracefully (happens when terminal pipe breaks)
process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') return; // Ignore broken pipe
    logger.error('[Main]', 'stdout error:', err);
});
process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') return;
    logger.error('[Main]', 'stderr error:', err);
});

// Platform detection (from config module)
const { isWindows, isMac, isLinux } = config;

let mainWindow = null;  // Reference to windowManager's window (for backward compatibility)
let appConfig = null;
let pythonReadyTimeout = null;
let startupPinger = null;
let aiStartupTimeout = null;
let aiReadyCheckInterval = null;

/** Send IPC to mainWindow only if it still exists and isn't destroyed. */
function safeSend(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// Window state - kept in sync with windowManager
let isExpanded = false;

// Helper functions that delegate to windowManager (for backward compatibility)
function getOrbSize() {
    return windowManager?.getCurrentOrbSize() || appConfig?.appearance?.orbSize || 64;
}

function expandPanel() {
    if (windowManager) {
        // Hide wayland orb when expanding to panel
        if (waylandOrb?.isReady()) {
            waylandOrb.hide();
        }
        // Ensure Electron window is visible before expanding
        mainWindow?.show();
        windowManager.expand();
        isExpanded = windowManager.getIsExpanded();
    }
}

function collapseToOrb() {
    if (windowManager) {
        windowManager.collapse();
        isExpanded = windowManager.getIsExpanded();
    }
    // When wayland orb is available, always hide the Electron window and
    // let the Rust binary be the only collapsed orb (no fallback).
    if (waylandOrb?.isAvailable()) {
        if (waylandOrb.isReady()) {
            waylandOrb.show();
        }
        mainWindow?.hide();
    }
}

/**
 * Map voice-event types to wayland-orb state names.
 */
function forwardVoiceEventToOrb(event) {
    if (!waylandOrb?.isReady()) return;
    const stateMap = {
        'idle': 'Idle',
        'recording': 'Recording',
        'speaking': 'Speaking',
        'thinking': 'Thinking',
        'processing': 'Thinking',
    };
    const orbState = stateMap[event.type];
    if (orbState) {
        waylandOrb.setState(orbState);
    }
}

// Create window via windowManager
function createWindow() {
    mainWindow = windowManager.create();
    isExpanded = false;

    // X button quits the app (minimize/orb buttons handle hide behavior)
    mainWindow.on('close', () => {
        app.isQuitting = true;
    });
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
            safeSend('open-settings');
        },
        onToggleVisibility: () => {
            if (isExpanded) {
                collapseToOrb();
            } else {
                mainWindow?.show();
                expandPanel();
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
        // Send periodic pings during startup to keep stdin pipe active
        // (Windows pipe buffering can block Python's stdout during imports)
        startupPinger = setInterval(() => {
            if (pythonBackend?.isRunning()) {
                sendToPython({ command: 'ping' });
            }
        }, 2000);
        // Set a 30-second timeout for Python ready event
        if (pythonReadyTimeout) clearTimeout(pythonReadyTimeout);
        pythonReadyTimeout = setTimeout(() => {
            clearInterval(startupPinger);
            startupPinger = null;
            logger.error('[Python]', 'Backend failed to start within 30 seconds, killing process');
            // Kill the stuck Python process
            if (pythonBackend?.isRunning()) {
                pythonBackend.kill();
            }
            safeSend('voice-event', {
                type: 'error',
                message: 'Python backend failed to start. Run "node cli/index.mjs setup" to fix.'
            });
            pythonReadyTimeout = null;
        }, 30000);
    }
}

async function sendImageToPython(imageData) {
    if (pythonBackend) {
        return pythonBackend.sendImage(imageData);
    }
    return { text: 'Python backend not initialized', error: 'not_initialized' };
}

// AI manager helper functions that delegate to aiManager service
function startAIProvider(cols, rows) {
    if (aiManager) {
        return aiManager.start(cols, rows);
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

function interruptAIProvider() {
    if (aiManager) return aiManager.interrupt();
    return false;
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

// Linux transparency workarounds
if (isLinux) {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('disable-gpu');  // Helps with transparency on some systems
}

// App lifecycle
app.whenReady().then(() => {
    // Initialize file logging
    logger.init();

    // Load configuration
    appConfig = config.loadConfig();
    if (appConfig.advanced?.debugMode) {
        logger.log('CONFIG', `Debug mode enabled`);
    }

    // Auto-detect API keys from environment variables
    const { detectApiKeys } = require('./services/provider-detector');
    const detectedKeys = detectApiKeys();
    const realKeys = Object.entries(detectedKeys).filter(([k]) => !k.startsWith('_'));
    if (realKeys.length > 0) {
        const currentKeys = appConfig.ai?.apiKeys || {};
        let updated = false;
        for (const [provider, key] of realKeys) {
            if (!currentKeys[provider]) {
                currentKeys[provider] = key;
                updated = true;
            }
        }
        if (updated) {
            appConfig = config.updateConfig({ ai: { apiKeys: currentKeys } });
            logger.info('[Config]', 'Auto-detected API keys:', realKeys.map(([k]) => k).join(', '));
        }
    }

    // Initialize window manager
    windowManager = createWindowManager({
        getConfig: () => appConfig,
        updateConfig: config.updateConfig,
        isLinux,
        startHidden: () => waylandOrb?.isAvailable() || false,
        onWindowStateChanged: () => {
            if (hotkeyManager) hotkeyManager.reRegisterAll();
            // Ensure uiohook is alive after window state change (for toggle hotkey)
            const uiohookShared = require('./services/uiohook-shared');
            if (uiohookShared.isAvailable() && !uiohookShared.isStarted()) {
                logger.info('[Voice Mirror]', 'uiohook not running after window state change, restarting');
                uiohookShared.restart();
            }
        }
    });

    // Initialize Python backend service
    pythonBackend = createPythonBackend({
        pythonDir: path.join(__dirname, '..', 'python'),
        dataDir: config.getDataDir(),
        isWindows,
        log: (level, msg) => logger.log(level, msg),
        getSenderName: () => (appConfig.user?.name || 'user').toLowerCase()
    });

    // --- Jarvis-style startup greeting ---
    function getTimePeriod() {
        const hour = new Date().getHours();
        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        return 'evening';
    }

    function getActivationHint() {
        const mode = appConfig?.behavior?.activationMode || 'wakeWord';
        switch (mode) {
            case 'pushToTalk': {
                const key = appConfig?.behavior?.pttKey || 'Space';
                return `Hold ${key} to talk.`;
            }
            case 'wakeWord': {
                const phrase = (appConfig?.wakeWord?.phrase || 'hey_claude')
                    .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `Say ${phrase} to begin.`;
            }
            default:
                return '';
        }
    }

    function doStartupGreeting() {
        if (!pythonBackend?.isRunning()) return;
        const hint = getActivationHint();

        // First-ever launch
        if (!appConfig.system?.firstLaunchDone) {
            pythonBackend.systemSpeak(`Welcome to Voice Mirror. ${hint}`);
            appConfig = config.updateConfig({ system: { ...appConfig.system, firstLaunchDone: true } });
            return; // Don't also do time greeting on first launch
        }

        // Greeting on every startup
        const period = getTimePeriod();
        const model = appConfig.ai?.model;
        const provider = appConfig.ai?.provider || 'claude';
        const displayName = model ? model.split(':')[0] : provider;
        const greeting = `Good ${period}. Voice Mirror online. ${displayName} standing by. ${hint}`;
        pythonBackend.systemSpeak(greeting);
    }

    // Set up Python backend event handler
    pythonBackend.onEvent((event) => {
        // Send voice events to renderer
        safeSend('voice-event', event);
        forwardVoiceEventToOrb(event);

        // Reset timeout on any loading progress (Python is alive, just loading)
        if (event.type === 'loading' && pythonReadyTimeout) {
            clearTimeout(pythonReadyTimeout);
            pythonReadyTimeout = setTimeout(() => {
                logger.error('[Python]', 'Backend failed to start within 30 seconds, killing process');
                if (pythonBackend?.isRunning()) {
                    pythonBackend.kill();
                }
                safeSend('voice-event', {
                    type: 'error',
                    message: 'Python backend failed to start. Run "node cli/index.mjs setup" to fix.'
                });
                pythonReadyTimeout = null;
            }, 30000);
        }

        // Startup greeting when Python backend is ready
        if (event.type === 'ready') {
            if (startupPinger) { clearInterval(startupPinger); startupPinger = null; }
            if (pythonReadyTimeout) { clearTimeout(pythonReadyTimeout); pythonReadyTimeout = null; }
            // Sync voice settings (TTS adapter/voice) but NOT activation mode
            // to avoid restarting the hotkey listener that's already running
            sendToPython({
                command: 'config_update',
                config: {
                    wakeWord: appConfig.wakeWord,
                    voice: appConfig.voice,
                    userName: appConfig.user?.name || null
                }
            });
            setTimeout(() => doStartupGreeting(), 2000);
        }

        // Handle chat messages from transcription/response events
        if (event.chatMessage) {
            safeSend('chat-message', event.chatMessage);
        }
    });

    // Track response IDs for deduplication
    pythonBackend.onResponseId((responseId) => {
        addDisplayedMessageId(responseId);
    });

    // Initialize screen capture watcher service
    screenCaptureWatcherService = createScreenCaptureWatcher({
        dataDir: config.getDataDir(),
        captureScreen: (options) => desktopCapturer.getSources(options),
        onActivity: (tool) => safeSend('tool-activity', { tool })
    });

    // Initialize browser watcher service
    browserWatcherService = createBrowserWatcher({
        dataDir: config.getDataDir(),
        onActivity: (tool) => safeSend('tool-activity', { tool })
    });

    // Initialize AI manager service

    aiManager = createAIManager({
        getConfig: () => appConfig,
        onOutput: (data) => {
            if (data.type === 'context-usage') {
                try {
                    safeSend('context-usage', JSON.parse(data.text));
                } catch { /* ignore parse errors */ }
                return;
            }
            safeSend('claude-terminal', data);
        },
        onVoiceEvent: (event) => {
            safeSend('voice-event', event);
            forwardVoiceEventToOrb(event);
        },
        onToolCall: (data) => {
            safeSend('tool-call', data);
        },
        onToolResult: (data) => {
            safeSend('tool-result', data);
        },
        onSystemSpeak: (text) => {
            pythonBackend?.systemSpeak(text);
        },
        getActivationHint,
        onProviderSwitch: () => {
            // Clear processed user messages when provider is switched
            if (inboxWatcherService) {
                inboxWatcherService.clearProcessedUserMessageIds();
            }
            logger.info('[Voice Mirror]', 'Cleared processed user message IDs for provider switch');
        }
    });

    // Initialize inbox watcher service
    inboxWatcherService = createInboxWatcher({
        dataDir: config.getDataDir(),
        getSenderName: () => (appConfig.user?.name || 'user').toLowerCase(),
        isClaudeRunning: () => aiManager?.isClaudeRunning() || false,
        getProvider: () => aiManager?.getProvider() || null,
        onClaudeMessage: (msg) => {
            safeSend('chat-message', msg);
        },
        onUserMessage: (msg) => {
            safeSend('chat-message', msg);
        },
        onAssistantMessage: (msg) => {
            safeSend('chat-message', msg);
        },
        onVoiceEvent: (event) => {
            safeSend('voice-event', event);
        },
        log: logger
    });

    // Register all IPC handlers
    registerIpcHandlers({
        getMainWindow: () => mainWindow,
        getAppConfig: () => appConfig,
        setAppConfig: (cfg) => { appConfig = cfg; },
        config,
        safeSend,
        expandPanel,
        collapseToOrb,
        getIsExpanded: () => isExpanded,
        getOrbSize,
        sendToPython,
        sendImageToPython,
        startPythonVoiceMirror,
        startAIProvider,
        stopAIProvider,
        interruptAIProvider,
        isAIProviderRunning,
        getAIManager: () => aiManager,
        getPythonBackend: () => pythonBackend,
        listAudioDevices: () => pythonBackend?.listAudioDevices() ?? Promise.resolve(null),
        getWaylandOrb: () => waylandOrb,
        getHotkeyManager: () => hotkeyManager,
        getInboxWatcherService: () => inboxWatcherService,
        getUpdateChecker: () => updateChecker,
        logger
    });

    // Initialize native Wayland overlay orb before creating window
    // so we know whether to start the Electron window hidden
    if (isLinux) {
        waylandOrb = createWaylandOrb({
            onExpandRequested: () => {
                if (isExpanded) {
                    collapseToOrb();
                } else {
                    expandPanel();
                }
            },
            onReady: () => {
                logger.info('[Voice Mirror]', 'Wayland overlay orb active — hiding Electron orb');
                if (!isExpanded && mainWindow) {
                    mainWindow.hide();
                }
            },
            onExit: (code) => {
                logger.info('[Voice Mirror]', 'Wayland orb exited (code:', code, ')');
            }
        });
    }

    createWindow();

    // Webview bridge: attach CDP debugger when <webview> connects
    const webviewCdp = require('./browser/webview-cdp');
    const browserController = require('./browser/browser-controller');

    mainWindow.webContents.on('did-attach-webview', (event, guestWebContents) => {
        logger.info('[Voice Mirror]', 'Webview attached, setting up CDP debugger');
        try {
            webviewCdp.attachDebugger(guestWebContents);

            // Set up dialog event listener for JS dialog handling
            browserController.setupDialogListener().catch(err => {
                logger.error('[Voice Mirror]', 'Dialog listener setup failed:', err.message);
            });

            // Track console messages from the webview
            guestWebContents.on('console-message', (e, level, message) => {
                browserController.trackConsoleMessage({ level, message, timestamp: Date.now() });
            });

            // Notify renderer of URL changes
            guestWebContents.on('did-navigate', (e, url) => {
                safeSend('browser-status', { url });
            });
            guestWebContents.on('did-navigate-in-page', (e, url, isMainFrame) => {
                if (isMainFrame) {
                    safeSend('browser-status', { url });
                }
            });
        } catch (err) {
            logger.error('[Voice Mirror]', 'Failed to attach webview debugger:', err.message);
        }
    });

    // Browser IPC handlers
    ipcMain.handle('browser-get-status', async () => {
        return browserController.getStatus();
    });

    ipcMain.handle('browser-pop-out', async () => {
        try {
            const status = await browserController.getStatus();
            if (status.url && status.url !== 'about:blank') {
                await shell.openExternal(status.url);
                return { ok: true, url: status.url };
            }
            return { ok: false, reason: 'no URL to open' };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    // Start the Wayland orb after window is created (needs to exist for expand)
    if (waylandOrb?.isAvailable()) {
        const savedOutput = appConfig?.overlay?.outputName || null;
        waylandOrb.start(savedOutput);
    }

    createTray();
    startScreenCaptureWatcher();
    startInboxWatcher();
    startBrowserRequestWatcher();

    // Initialize and start performance monitor
    perfMonitor = createPerfMonitor({
        dataDir: config.getDataDir(),
        safeSend
    });
    perfMonitor.start();

    // Toggle perf monitor from renderer
    ipcMain.on('toggle-perf-monitor', () => {
        // Renderer handles visibility; this is a no-op hook for future use
    });

    // Start diagnostic pipeline tracer
    try {
        const diagnosticWatcher = require('./services/diagnostic-watcher');
        diagnosticWatcher.start();
    } catch (err) {
        logger.info('[Diagnostic]', 'Watcher not started:', err.message);
    }

    // Initialize dual-layer hotkey manager (uiohook + globalShortcut)
    hotkeyManager = createHotkeyManager({ log: (cat, msg) => logger.log(cat, msg) });
    hotkeyManager.start();

    const toggleHotkey = appConfig?.behavior?.hotkey || 'CommandOrControl+Shift+V';
    hotkeyManager.register('toggle-panel', toggleHotkey, () => {
        logger.log('HOTKEY', 'Toggle panel triggered');
        if (isExpanded) {
            collapseToOrb();
        } else {
            expandPanel();
        }
    });

    const statsHotkey = appConfig?.behavior?.statsHotkey || 'CommandOrControl+Shift+M';
    hotkeyManager.register('toggle-stats', statsHotkey, () => {
        logger.log('HOTKEY', 'Toggle stats triggered');
        safeSend('toggle-stats-bar');
    });

    // Dictation key is handled by Python's GlobalHotkeyListener (same as PTT).
    // Hold-to-speak: press and hold to record, release to transcribe + paste.
    // Python captures key press/release globally and writes dictation_trigger.json.

    // PTT capture is handled entirely by Python's GlobalHotkeyListener (evdev/pynput).
    // Python captures key press/release globally regardless of window state and writes
    // ptt_trigger.json directly. Electron's uiohook PTT was unreliable when collapsed to orb.
    // Electron's uiohook is still used for the toggle hotkey (Ctrl+Shift+V) via hotkey-manager.

    // Update checker (git-based)
    updateChecker = createUpdateChecker({
        safeSend,
        log: (level, msg) => logger.log(level, msg),
        appDir: path.join(__dirname, '..')
    });
    updateChecker.start();

    // Start Docker services (SearXNG, n8n) if available
    startDockerServices();

    // Auto-start Voice Mirror (Python + AI provider) on app launch
    try {
        const providerName = appConfig?.ai?.provider || 'claude';
        logger.info('[Voice Mirror]', `Auto-starting Python and AI provider (${providerName})...`);

        // Ensure Ollama is running if it's the selected provider
        if (['ollama', 'lmstudio', 'jan'].includes(providerName)) {
            aiManager.ensureLocalLLMRunning();
        }

        // Write voice_settings.json BEFORE spawning Python so it loads correct TTS/STT config
        pythonBackend.syncVoiceSettings(appConfig);

        startPythonVoiceMirror();

        // Start AI provider after Python is ready, or after 5s fallback
        // (Python ready event fires in ~2-4s; this gives graceful degradation)
        let aiStarted = false;
        const doStartAI = () => {
            if (aiStarted) return;
            aiStarted = true;
            try {
                startAIProvider();
            } catch (err) {
                logger.error('[Voice Mirror]', 'Failed to start AI provider:', err.message);
            }
        };

        // Fallback: start AI after 5 seconds regardless
        aiStartupTimeout = setTimeout(doStartAI, 5000);

        // Watch for Python ready to start AI sooner
        aiReadyCheckInterval = setInterval(() => {
            // pythonReadyTimeout is set to null when Python sends 'ready'
            if (pythonReadyTimeout === null || !pythonBackend?.isRunning()) {
                clearInterval(aiReadyCheckInterval); aiReadyCheckInterval = null;
                clearTimeout(aiStartupTimeout); aiStartupTimeout = null;
                doStartAI();
            }
        }, 300);
    } catch (err) {
        logger.error('[Voice Mirror]', 'Auto-start failed:', err.message);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', async () => {
    app.isQuitting = true;
    logger.log('APP', 'Shutting down...');

    // Clean up startup timers
    if (aiStartupTimeout) { clearTimeout(aiStartupTimeout); aiStartupTimeout = null; }
    if (aiReadyCheckInterval) { clearInterval(aiReadyCheckInterval); aiReadyCheckInterval = null; }
    if (startupPinger) { clearInterval(startupPinger); startupPinger = null; }
    if (pythonReadyTimeout) { clearTimeout(pythonReadyTimeout); pythonReadyTimeout = null; }

    // Destroy hotkey manager (unregisters all shortcuts)
    if (hotkeyManager) {
        hotkeyManager.stop();
    }
    globalShortcut.unregisterAll();

    // Stop wayland orb
    if (waylandOrb) {
        waylandOrb.stop();
    }

    // Stop shared uiohook (after hotkey manager is done)
    uiohookShared.stop();

    // Stop update checker
    if (updateChecker) updateChecker.stop();

    // Stop watchers
    stopScreenCaptureWatcher();
    stopInboxWatcher();
    stopBrowserRequestWatcher();

    // Close browser (async)
    try { await closeBrowser(); } catch { /* ignore */ }

    // Stop AI provider
    stopAIProvider();

    // Stop Python gracefully (stop() sends command + waits 3s before kill)
    if (pythonBackend) {
        if (pythonBackend.isRunning()) {
            pythonBackend.stop();
        } else {
            pythonBackend.kill();
        }
    }

    // Close log file
    logger.close();
});
