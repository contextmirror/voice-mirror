/**
 * Voice Mirror Electron - Main Process
 *
 * Creates a transparent, always-on-top overlay window with:
 * - Floating orb (idle state)
 * - Expandable chat panel
 * - System tray integration
 *
 * NOTE: Uses Electron 40. Upgraded from Electron 28 on 2026-02-15.
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
const { createVoiceBackend, startDockerServices } = require('./services/voice-backend');
const { createScreenCaptureWatcher } = require('./services/screen-capture-watcher');
const { createBrowserWatcher } = require('./services/browser-watcher');
const { createAIManager } = require('./services/ai-manager');
const { createLogViewer } = require('./services/log-viewer');
const { createInboxWatcher } = require('./services/inbox-watcher');
const { createPerfMonitor } = require('./services/perf-monitor');
const { createUpdateChecker } = require('./services/update-checker');
const { createTrayService } = require('./window/tray');
const { createWindowManager } = require('./window');
const { createWaylandOrb } = require('./services/wayland-orb');

// Named timeout constants (avoids magic numbers in the main flow)
const VOICE_READY_TIMEOUT_MS = 30000;
const STARTUP_GREETING_DELAY_MS = 2000;
const AI_START_TIMEOUT_MS = 5000;

/*
 * Service Initialization Order (inside app.whenReady)
 * ───────────────────────────────────────────────────
 *  1. Logger initialized (file logging)
 *  2. Config loaded + API keys auto-detected from env
 *  3. Window manager created (not yet showing)
 *  4. Voice backend created (not yet spawned)
 *  5. Screen-capture, browser, AI-manager, inbox watchers created
 *  6. IPC handlers registered
 *  7. Wayland orb initialized (Linux only)
 *  8. Window created + late requires: webview-cdp, browser-controller
 *  9. Tray created; watchers started (screen-capture, inbox, browser)
 * 10. Perf monitor + diagnostic watcher started
 * 11. Hotkey manager started (globalShortcut)
 * 12. Update checker started
 * 13. Docker services started (SearXNG, n8n)
 * 14. Voice backend spawned (STT/TTS/VAD)
 * 15. AI provider started (after voice-core ready or 5 s fallback)
 *
 * Late requires (webview-cdp, browser-controller) exist because
 * they need the main BrowserWindow to exist before loading.
 */

// File logging - uses logger service
const logger = createLogger();

// Hotkey manager (globalShortcut + health-checked auto-recovery)
let hotkeyManager = null;

// Tray service
const trayService = createTrayService();

// Window manager (initialized after config is loaded)
let windowManager = null;

// Wayland overlay orb (native layer-shell, Linux/Wayland only)
let waylandOrb = null;

// Voice backend service (initialized after config is loaded)
let voiceBackend = null;

// Screen capture watcher service (initialized after app.whenReady)
let screenCaptureWatcherService = null;

// Browser watcher service (initialized after app.whenReady)
let browserWatcherService = null;

// AI manager service (initialized after config is loaded)
let aiManager = null;

// Inbox watcher service (initialized after config is loaded)
let inboxWatcherService = null;
let logViewer = null;

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
let voiceReadyTimeout = null;
let startupPinger = null;
let aiStartupTimeout = null;

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

    // Restore previous mode — if the user closed while in dashboard mode, re-expand
    // once the renderer is ready (so the state-change IPC arrives correctly).
    const savedExpanded = appConfig?.window?.expanded;
    if (savedExpanded) {
        mainWindow.webContents.once('did-finish-load', () => {
            expandPanel();
        });
    }
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

// Voice backend helper functions that delegate to voiceBackend service
function sendToVoiceBackend(command) {
    if (voiceBackend) {
        voiceBackend.send(command);
    }
}

function startVoiceBackendService() {
    if (voiceBackend) {
        voiceBackend.start();
        // Send periodic pings during startup to keep stdin pipe active
        startupPinger = setInterval(() => {
            if (voiceBackend?.isRunning()) {
                sendToVoiceBackend({ command: 'ping' });
            }
        }, 2000);
        // Set a timeout for voice-core ready event
        if (voiceReadyTimeout) clearTimeout(voiceReadyTimeout);
        voiceReadyTimeout = setTimeout(() => {
            clearInterval(startupPinger);
            startupPinger = null;
            logger.error('[Voice]', `Backend failed to start within ${VOICE_READY_TIMEOUT_MS / 1000} seconds, killing process`);
            if (voiceBackend?.isRunning()) {
                voiceBackend.kill();
            }
            safeSend('voice-event', {
                type: 'error',
                message: 'Voice backend failed to start. Build with: cd voice-core && cargo build --release'
            });
            voiceReadyTimeout = null;
        }, VOICE_READY_TIMEOUT_MS);
    }
}

async function sendImageToVoiceBackend(imageData) {
    if (voiceBackend) {
        return voiceBackend.sendImage(imageData);
    }
    return { text: 'Voice backend not initialized', error: 'not_initialized' };
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

function sendVoiceLoop() {
    if (aiManager) aiManager.sendVoiceLoop();
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

// Helper to add displayed message ID (for deduplication from voice backend)
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
app.whenReady().then(async () => {
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
        }
    });

    // Initialize voice backend service
    voiceBackend = createVoiceBackend({
        projectRoot: path.join(__dirname, '..'),
        dataDir: config.getDataDir(),
        isWindows,
        log: (level, msg) => logger.log(level, msg),
        getSenderName: () => (appConfig.user?.name || 'user').toLowerCase()
    });

    // --- Jarvis-style startup greeting ---
    let suppressNextGreeting = false;
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
        if (!voiceBackend?.isRunning()) return;
        if (appConfig.voice?.announceStartup === false) return;
        const hint = getActivationHint();

        // First-ever launch
        if (!appConfig.system?.firstLaunchDone) {
            voiceBackend.systemSpeak(`Welcome to Voice Mirror. ${hint}`);
            appConfig = config.updateConfig({ system: { ...appConfig.system, firstLaunchDone: true } });
            return; // Don't also do time greeting on first launch
        }

        // Greeting on every startup
        const period = getTimePeriod();
        const model = appConfig.ai?.model;
        const provider = appConfig.ai?.provider || 'claude';
        const displayName = model ? model.split(':')[0] : provider;
        const greeting = `Good ${period}. Voice Mirror online. ${displayName} standing by. ${hint}`;
        voiceBackend.systemSpeak(greeting);
    }

    // Set up voice backend event handler
    voiceBackend.onEvent((event) => {
        // Send voice events to renderer
        safeSend('voice-event', event);
        forwardVoiceEventToOrb(event);

        // Reset timeout on any loading progress (backend is alive, just loading)
        if (event.type === 'loading' && voiceReadyTimeout) {
            clearTimeout(voiceReadyTimeout);
            voiceReadyTimeout = setTimeout(() => {
                logger.error('[Voice]', `Backend failed to start within ${VOICE_READY_TIMEOUT_MS / 1000} seconds, killing process`);
                if (voiceBackend?.isRunning()) {
                    voiceBackend.kill();
                }
                safeSend('voice-event', {
                    type: 'error',
                    message: 'Voice backend failed to start. Build with: cd voice-core && cargo build --release'
                });
                voiceReadyTimeout = null;
            }, VOICE_READY_TIMEOUT_MS);
        }

        // Startup greeting when voice backend is ready
        if (event.type === 'ready') {
            if (startupPinger) { clearInterval(startupPinger); startupPinger = null; }
            if (voiceReadyTimeout) { clearTimeout(voiceReadyTimeout); voiceReadyTimeout = null; }
            // Sync voice settings (TTS adapter/voice) but NOT activation mode
            // to avoid restarting the hotkey listener that's already running
            sendToVoiceBackend({
                command: 'config_update',
                config: {
                    wakeWord: appConfig.wakeWord,
                    voice: appConfig.voice,
                    userName: appConfig.user?.name || null
                }
            });
            if (suppressNextGreeting) {
                suppressNextGreeting = false;
            } else {
                setTimeout(() => doStartupGreeting(), STARTUP_GREETING_DELAY_MS);
            }

            // Start AI provider directly now that voice backend is ready
            // (event-driven — replaces the old 300ms polling interval)
            if (aiStartupTimeout) { clearTimeout(aiStartupTimeout); aiStartupTimeout = null; }
            doStartAI();
        }

        // Handle chat messages from transcription/response events
        if (event.chatMessage) {
            safeSend('chat-message', event.chatMessage);
        }
    });

    // Track response IDs for deduplication
    voiceBackend.onResponseId((responseId) => {
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
            // Forward stream tokens to chat UI (separate channel from terminal)
            if (data.type === 'stream-token') {
                safeSend('chat-stream-token', { token: data.text });
                return;
            }
            if (data.type === 'stream-end') {
                safeSend('chat-stream-end', { text: data.text });
                return;
            }
            safeSend('claude-terminal', data);
        },
        onVoiceEvent: (event) => {
            safeSend('voice-event', event);
            forwardVoiceEventToOrb(event);
            // Update TUI voice status if active (only actual voice states)
            const voiceStates = ['idle', 'recording', 'speaking', 'thinking', 'processing'];
            if (aiManager && voiceStates.includes(event.type)) {
                const provider = aiManager.getProvider?.();
                if (provider?.tui) {
                    const labels = { idle: 'Idle', recording: 'Recording...', speaking: 'Speaking...', thinking: 'Thinking...', processing: 'Processing...' };
                    provider.tui.updateInfo('voiceStatus', labels[event.type] || event.type);
                }
            }
        },
        onToolCall: (data) => {
            safeSend('tool-call', data);
        },
        onToolResult: (data) => {
            safeSend('tool-result', data);
        },
        onSystemSpeak: (text) => {
            voiceBackend?.systemSpeak(text);
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

    // Register all IPC handlers (keep reference for _getLastTermDims access)
    const ipcCtx = {
        getMainWindow: () => mainWindow,
        getAppConfig: () => appConfig,
        setAppConfig: (cfg) => { appConfig = cfg; },
        config,
        safeSend,
        expandPanel,
        collapseToOrb,
        toggleMaximize: () => windowManager?.toggleMaximize(),
        getIsExpanded: () => isExpanded,
        getOrbSize,
        sendToVoiceBackend,
        sendImageToVoiceBackend,
        startVoiceBackendService,
        startAIProvider,
        stopAIProvider,
        interruptAIProvider,
        sendVoiceLoop,
        isAIProviderRunning,
        getAIManager: () => aiManager,
        getVoiceBackend: () => voiceBackend,
        suppressVoiceGreeting: () => { suppressNextGreeting = true; },
        listAudioDevices: () => voiceBackend?.listAudioDevices() ?? Promise.resolve(null),
        getWaylandOrb: () => waylandOrb,
        getHotkeyManager: () => hotkeyManager,
        getInboxWatcherService: () => inboxWatcherService,
        getUpdateChecker: () => updateChecker,
        logger,
        getLogViewer: () => logViewer,
    };
    registerIpcHandlers(ipcCtx);

    // Initialize log viewer service (creates window on demand, not at startup)
    logViewer = createLogViewer({
        logger,
        getMainWindow: () => mainWindow,
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

    mainWindow.webContents.on('did-attach-webview', async (event, guestWebContents) => {
        logger.info('[Voice Mirror]', 'Webview attached, setting up CDP debugger');
        try {
            webviewCdp.attachDebugger(guestWebContents);

            // Set up dialog event listener for JS dialog handling
            try {
                await browserController.setupDialogListener();
            } catch (err) {
                logger.error('[Voice Mirror]', 'Dialog listener setup failed:', err.message);
            }

            // Track console messages from the webview
            const onConsoleMessage = (event) => {
                browserController.trackConsoleMessage({ level: event.level, message: event.message, timestamp: Date.now() });
            };
            guestWebContents.on('console-message', onConsoleMessage);

            // Notify renderer of URL changes
            const onDidNavigate = (e, url) => {
                safeSend('browser-status', { url });
            };
            const onDidNavigateInPage = (e, url, isMainFrame) => {
                if (isMainFrame) {
                    safeSend('browser-status', { url });
                }
            };
            guestWebContents.on('did-navigate', onDidNavigate);
            guestWebContents.on('did-navigate-in-page', onDidNavigateInPage);

            // Clean up listeners when the guest webContents is destroyed
            // to prevent closures from preventing GC
            guestWebContents.once('destroyed', () => {
                guestWebContents.removeListener('console-message', onConsoleMessage);
                guestWebContents.removeListener('did-navigate', onDidNavigate);
                guestWebContents.removeListener('did-navigate-in-page', onDidNavigateInPage);
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
                return { success: true, url: status.url };
            }
            return { success: false, reason: 'no URL to open' };
        } catch (err) {
            return { success: false, error: err.message };
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

    // Initialize hotkey manager (globalShortcut with health-checked recovery)
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

    // Dictation key is handled by voice-core's global hotkey listener (same as PTT).
    // Hold-to-speak: press and hold to record, release to transcribe + paste.
    // Voice-core captures key press/release globally and writes dictation_trigger.json.

    // PTT capture is handled entirely by voice-core's global hotkey listener.
    // Voice-core captures key press/release globally regardless of window state and writes
    // ptt_trigger.json directly.

    // Update checker (electron-updater, GitHub Releases)
    updateChecker = createUpdateChecker({
        safeSend
    });
    updateChecker.start();

    // Start Docker services (SearXNG, n8n) if available
    startDockerServices();

    // Auto-start Voice Mirror (voice-core + AI provider) on app launch
    // doStartAI is hoisted so the voice backend 'ready' event handler can call it directly
    let aiStarted = false;
    const doStartAI = () => {
        if (aiStarted) return;
        aiStarted = true;
        try {
            // Use last known terminal dimensions so TUI renders at correct size
            const dims = ipcCtx._getLastTermDims ? ipcCtx._getLastTermDims() : {};
            startAIProvider(dims.cols, dims.rows);
        } catch (err) {
            logger.error('[Voice Mirror]', 'Failed to start AI provider:', err.message);
        }
    };

    try {
        const providerName = appConfig?.ai?.provider || 'claude';
        logger.info('[Voice Mirror]', `Auto-starting voice backend and AI provider (${providerName})...`);

        // Ensure Ollama is running if it's the selected provider
        if (['ollama', 'lmstudio', 'jan'].includes(providerName)) {
            aiManager.ensureLocalLLMRunning();
        }

        // Write voice_settings.json BEFORE spawning voice-core so it loads correct TTS/STT config
        await voiceBackend.syncVoiceSettings(appConfig);

        startVoiceBackendService();

        // Fallback: start AI after timeout if voice-core ready event hasn't fired
        aiStartupTimeout = setTimeout(doStartAI, AI_START_TIMEOUT_MS);
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
    if (startupPinger) { clearInterval(startupPinger); startupPinger = null; }
    if (voiceReadyTimeout) { clearTimeout(voiceReadyTimeout); voiceReadyTimeout = null; }

    // Destroy hotkey manager (unregisters all shortcuts)
    if (hotkeyManager) {
        hotkeyManager.stop();
    }
    globalShortcut.unregisterAll();

    // Stop wayland orb
    if (waylandOrb) {
        waylandOrb.stop();
    }

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

    // Stop voice backend gracefully (stop() sends command + waits 3s before kill)
    if (voiceBackend) {
        if (voiceBackend.isRunning()) {
            voiceBackend.stop();
        } else {
            voiceBackend.kill();
        }
    }

    // Close log file
    logger.close();
});
