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

const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

// Note: --ozone-platform=x11 is passed via CLI (package.json/launch.sh)
// to force XWayland on Linux. The Electron window is used for the expanded
// panel; the collapsed orb is rendered by wayland-orb (native layer-shell)
// when available, falling back to the Electron window on X11/non-Wayland.
const config = require('./config');
const { registerIpcHandlers } = require('./ipc-handlers');
// CLI agent providers that use PTY mode (terminal-based)
const CLI_PROVIDERS = ['claude', 'codex', 'gemini-cli'];
// Note: claude-spawner and providers are now used via ai-manager service
const { createLogger } = require('./services/logger');
const { createPushToTalk } = require('./services/push-to-talk');
const { createHotkeyManager } = require('./services/hotkey-manager');
const uiohookShared = require('./services/uiohook-shared');
const { createPythonBackend, startDockerServices } = require('./services/python-backend');
const { createScreenCaptureWatcher } = require('./services/screen-capture-watcher');
const { createBrowserWatcher } = require('./services/browser-watcher');
const { createAIManager } = require('./services/ai-manager');
const { createInboxWatcher } = require('./services/inbox-watcher');
const { createPerfMonitor } = require('./services/perf-monitor');
const { createTrayService } = require('./window/tray');
const { createWindowManager } = require('./window');
const { createWaylandOrb } = require('./services/wayland-orb');

// File logging - uses logger service
const logger = createLogger();

// Push-to-talk service (initialized after app.whenReady with globalShortcut)
let pttService = null;

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
        'call_active': 'Recording'
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

    // Intercept close to hide to tray instead of quitting
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
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

/**
 * Ensure a local LLM server (Ollama) is running before the AI provider starts.
 * On Windows, Ollama may not auto-start if installed to a custom directory.
 */
function ensureLocalLLMRunning(providerName, config) {
    if (providerName !== 'ollama') return;

    const { execSync, spawn: spawnDetached } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    // Check if Ollama is already responding
    try {
        const endpoint = config?.ai?.endpoints?.ollama || 'http://127.0.0.1:11434';
        // Quick sync check — just see if the port is open
        require('net').createConnection({ port: new URL(endpoint).port || 11434, host: '127.0.0.1' })
            .on('connect', function() { this.destroy(); })
            .on('error', () => {
                // Not running — try to start it
                console.log('[Ollama] Not running, attempting to start...');
                startOllamaServer(config);
            });
    } catch {
        startOllamaServer(config);
    }
}

async function startOllamaServer(config) {
    const { spawn: spawnDetached, execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const path = require('path');
    const fs = require('fs');

    // Find ollama executable (async to avoid blocking main thread)
    let ollamaPath = null;
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execFileAsync(cmd, ['ollama'], { encoding: 'utf8' });
        ollamaPath = stdout.trim().split('\n')[0];
    } catch {
        // Not on PATH — check common locations
        const candidates = [];
        if (process.platform === 'win32') {
            candidates.push(
                path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
                path.join(path.dirname(path.dirname(__dirname)), 'Ollama', 'ollama.exe')
            );
            if (process.env.OLLAMA_MODELS) {
                candidates.push(path.join(path.dirname(process.env.OLLAMA_MODELS), 'ollama.exe'));
            }
        } else if (process.platform === 'darwin') {
            candidates.push(
                '/usr/local/bin/ollama',
                path.join(os.homedir(), '.ollama', 'ollama'),
                '/Applications/Ollama.app/Contents/Resources/ollama'
            );
        } else {
            candidates.push(
                '/usr/local/bin/ollama',
                '/usr/bin/ollama',
                path.join(os.homedir(), '.ollama', 'ollama')
            );
        }
        for (const c of candidates) {
            if (fs.existsSync(c)) { ollamaPath = c; break; }
        }
    }

    if (!ollamaPath) {
        console.log('[Ollama] Could not find ollama executable');
        return;
    }

    console.log(`[Ollama] Starting server: ${ollamaPath}`);
    const env = { ...process.env };
    // Preserve OLLAMA_MODELS if set (custom model directory)
    const proc = spawnDetached(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        env
    });
    proc.unref();
}

/**
 * Write Electron's voice config to voice_settings.json so Python reads correct settings on startup.
 */
async function syncVoiceSettingsToFile(cfg) {
    try {
        const fsP = fs.promises;
        const dataDir = config.getDataDir();
        await fsP.mkdir(dataDir, { recursive: true });
        const settingsPath = path.join(dataDir, 'voice_settings.json');

        // Read existing settings to preserve location/timezone
        let existing = {};
        try {
            existing = JSON.parse(await fsP.readFile(settingsPath, 'utf-8'));
        } catch { /* ignore parse errors or missing file */ }

        // Merge Electron voice config into settings
        const voice = cfg?.voice || {};
        const updates = {};
        if (voice.ttsAdapter) updates.tts_adapter = voice.ttsAdapter;
        if (voice.ttsVoice) updates.tts_voice = voice.ttsVoice;
        if (voice.ttsModelSize) updates.tts_model_size = voice.ttsModelSize;
        if (voice.sttModel) updates.stt_adapter = voice.sttModel;

        const merged = { ...existing, ...updates };
        await fsP.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
        console.log('[Voice Mirror] Synced voice settings to', settingsPath);
    } catch (err) {
        console.error('[Voice Mirror] Failed to sync voice settings:', err.message);
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
            console.error('[Python] Backend failed to start within 30 seconds, killing process');
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
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
if (!SERPER_API_KEY) console.warn('[Main] SERPER_API_KEY not set - web search will be unavailable');

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
        isLinux,
        startHidden: () => waylandOrb?.isAvailable() || false,
        onWindowStateChanged: () => {
            if (hotkeyManager) hotkeyManager.reRegisterAll();
            // Ensure uiohook is alive after window state change (for toggle hotkey)
            const uiohookShared = require('./services/uiohook-shared');
            if (uiohookShared.isAvailable() && !uiohookShared.isStarted()) {
                console.log('[Voice Mirror] uiohook not running after window state change, restarting');
                uiohookShared.restart();
            }
        }
    });

    // Initialize Python backend service
    pythonBackend = createPythonBackend({
        pythonDir: path.join(__dirname, '..', 'python'),
        dataDir: config.getDataDir(),
        isWindows,
        log: (level, msg) => logger.log(level, msg)
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
            case 'callMode':
                return 'Listening.';
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
                console.error('[Python] Backend failed to start within 30 seconds, killing process');
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
                    voice: appConfig.voice
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
        captureScreen: (options) => desktopCapturer.getSources(options)
    });

    // Initialize browser watcher service
    browserWatcherService = createBrowserWatcher({
        dataDir: config.getDataDir(),
        serperApiKey: SERPER_API_KEY
    });

    // Initialize AI manager service

    aiManager = createAIManager({
        getConfig: () => appConfig,
        onOutput: (data) => {
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
            console.log('[Voice Mirror] Cleared processed user message IDs for provider switch');
        }
    });

    // Initialize inbox watcher service
    inboxWatcherService = createInboxWatcher({
        dataDir: config.getDataDir(),
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
        isAIProviderRunning,
        getAIManager: () => aiManager,
        getPythonBackend: () => pythonBackend,
        listAudioDevices: () => pythonBackend?.listAudioDevices() ?? Promise.resolve(null),
        getWaylandOrb: () => waylandOrb,
        getHotkeyManager: () => hotkeyManager,
        getInboxWatcherService: () => inboxWatcherService,
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
                console.log('[Voice Mirror] Wayland overlay orb active — hiding Electron orb');
                if (!isExpanded && mainWindow) {
                    mainWindow.hide();
                }
            },
            onExit: (code) => {
                console.log('[Voice Mirror] Wayland orb exited (code:', code, ')');
            }
        });
    }

    createWindow();

    // Webview bridge: attach CDP debugger when <webview> connects
    const webviewCdp = require('./browser/webview-cdp');
    const browserController = require('./browser/browser-controller');

    mainWindow.webContents.on('did-attach-webview', (event, guestWebContents) => {
        console.log('[Voice Mirror] Webview attached, setting up CDP debugger');
        try {
            webviewCdp.attachDebugger(guestWebContents);

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
            console.error('[Voice Mirror] Failed to attach webview debugger:', err.message);
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
        console.log('[Diagnostic] Watcher not started:', err.message);
    }

    // Initialize dual-layer hotkey manager (uiohook + globalShortcut)
    hotkeyManager = createHotkeyManager({ log: (cat, msg) => logger.log(cat, msg) });
    hotkeyManager.init();

    const toggleHotkey = appConfig?.behavior?.hotkey || 'CommandOrControl+Shift+V';
    hotkeyManager.register('toggle-panel', toggleHotkey, () => {
        logger.log('HOTKEY', 'Toggle panel triggered');
        if (isExpanded) {
            collapseToOrb();
        } else {
            expandPanel();
        }
    });

    // PTT capture is handled entirely by Python's GlobalHotkeyListener (evdev/pynput).
    // Python captures key press/release globally regardless of window state and writes
    // ptt_trigger.json directly. Electron's uiohook PTT was unreliable when collapsed to orb.
    // Electron's uiohook is still used for the toggle hotkey (Ctrl+Shift+V) via hotkey-manager.

    // Start Docker services (SearXNG, n8n) if available
    startDockerServices();

    // Auto-start Voice Mirror (Python + AI provider) on app launch
    try {
        const providerName = appConfig?.ai?.provider || 'claude';
        console.log(`[Voice Mirror] Auto-starting Python and AI provider (${providerName})...`);

        // Ensure Ollama is running if it's the selected provider
        if (['ollama', 'lmstudio', 'jan'].includes(providerName)) {
            ensureLocalLLMRunning(providerName, appConfig);
        }

        // Write voice_settings.json BEFORE spawning Python so it loads correct TTS/STT config
        syncVoiceSettingsToFile(appConfig);

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
                console.error('[Voice Mirror] Failed to start AI provider:', err.message);
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
        console.error('[Voice Mirror] Auto-start failed:', err.message);
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
        hotkeyManager.destroy();
    }
    globalShortcut.unregisterAll();

    // Stop wayland orb
    if (waylandOrb) {
        waylandOrb.stop();
    }

    // Stop push-to-talk service
    if (pttService) {
        pttService.stop();
        logger.log('APP', 'PTT service stopped');
    }

    // Stop shared uiohook (after PTT and hotkey manager are done)
    uiohookShared.stop();

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
