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

const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const { spawnClaude, stopClaude, sendInput, sendRawInput, sendInputWhenReady, isClaudeRunning, isClaudeReady, configureMCPServer, isClaudeAvailable, resizePty } = require('./claude-spawner');
const { createProvider } = require('./providers');

// File logging - writes to vmr.log in config data directory
let logFile = null;
let logFilePath = null;

function initLogFile() {
    try {
        const dataDir = app.getPath('home') + '/.config/voice-mirror-electron/data';
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        logFilePath = path.join(dataDir, 'vmr.log');
        // Truncate log file on startup (keep it fresh each session)
        logFile = fs.createWriteStream(logFilePath, { flags: 'w' });
        writeLog('APP', 'Voice Mirror started');
    } catch (err) {
        console.error('Failed to init log file:', err);
    }
}

// ANSI color codes for logs
const Colors = {
    RESET: '\x1b[0m',
    DIM: '\x1b[2m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',
};

// Log level styles: [color, icon]
const LOG_STYLES = {
    'APP': [Colors.GREEN, '⚡'],
    'CONFIG': [Colors.YELLOW, '⚙'],
    'PYTHON': [Colors.MAGENTA, '🐍'],
    'CLAUDE': [Colors.BLUE, '🤖'],
    'EVENT': [Colors.CYAN, '→'],
    'ERROR': [Colors.RED, '✗'],
    'LOG': [Colors.WHITE, '•'],
};

function writeLog(level, message) {
    const now = new Date();
    const timestamp = now.toTimeString().slice(0, 8); // HH:MM:SS
    const [color, icon] = LOG_STYLES[level] || [Colors.WHITE, '•'];

    // Color-coded log line
    const logLine = `${Colors.DIM}[${timestamp}]${Colors.RESET} ${color}${icon} ${message}${Colors.RESET}`;

    // Write to console
    if (level === 'ERROR') {
        console.error(logLine);
    } else {
        console.log(logLine);
    }

    // Write to file
    if (logFile) {
        logFile.write(logLine + '\n');
    }
}

function closeLogFile() {
    if (logFile) {
        logFile.end();
        logFile = null;
    }
}

// uiohook for global mouse/keyboard hooks (PTT support)
let uIOhook = null;
let UiohookKey = null;
try {
    const uiohookModule = require('uiohook-napi');
    uIOhook = uiohookModule.uIOhook;
    UiohookKey = uiohookModule.UiohookKey;
    console.log('[Voice Mirror] uiohook-napi loaded successfully');
} catch (err) {
    console.warn('[Voice Mirror] uiohook-napi not available, PTT will use keyboard shortcuts only:', err.message);
}

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

/**
 * Get the Python executable path for the virtual environment.
 * Handles Windows vs Unix path differences.
 */
function getPythonExecutable(basePath) {
    const venvPath = path.join(basePath, '.venv');

    if (isWindows) {
        // Windows: .venv/Scripts/python.exe
        return path.join(venvPath, 'Scripts', 'python.exe');
    }
    // Linux/macOS: .venv/bin/python
    return path.join(venvPath, 'bin', 'python');
}

/**
 * Check if a file exists (cross-platform).
 */
function fileExists(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

let mainWindow = null;
let tray = null;
let pythonProcess = null;
let appConfig = null;
let activeProvider = null;  // Current AI provider instance (Claude PTY or OpenAI-compatible)

// Window state
let isExpanded = false;

// Get dimensions from config (with fallbacks)
function getOrbSize() {
    return appConfig?.appearance?.orbSize || 64;
}
function getPanelWidth() {
    // Reload config to get latest saved size
    const currentConfig = config.loadConfig();
    return currentConfig?.appearance?.panelWidth || 400;
}
function getPanelHeight() {
    // Reload config to get latest saved size
    const currentConfig = config.loadConfig();
    return currentConfig?.appearance?.panelHeight || 500;
}

function createWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const orbSize = getOrbSize();

    // Use saved position from config, or default to bottom-right
    const savedX = appConfig?.window?.orbX;
    const savedY = appConfig?.window?.orbY;
    const startX = savedX !== null && savedX !== undefined ? savedX : screenWidth - orbSize - 20;
    const startY = savedY !== null && savedY !== undefined ? savedY : screenHeight - orbSize - 100;

    mainWindow = new BrowserWindow({
        width: orbSize,
        height: orbSize,
        x: startX,
        y: startY,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        backgroundColor: '#00000000',  // Fully transparent background
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // On Linux, try to enable transparency
    if (isLinux) {
        mainWindow.setBackgroundColor('#00000000');
    }

    // Load the overlay HTML
    mainWindow.loadFile(path.join(__dirname, 'overlay.html'));

    // Make transparent areas click-through
    mainWindow.setIgnoreMouseEvents(false);

    // Window blur handling removed - user requested panel stays open
    // until manually closed via right-click or collapse button

    // Save position when window is moved (only when collapsed to orb)
    mainWindow.on('moved', () => {
        if (!isExpanded) {
            const [x, y] = mainWindow.getPosition();
            config.updateConfig({ window: { orbX: x, orbY: y } });
        }
    });
}

function expandPanel() {
    if (!mainWindow || isExpanded) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const panelWidth = getPanelWidth();
    const panelHeight = getPanelHeight();

    isExpanded = true;

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
        console.log('[Voice Mirror] Expanded to panel:', panelWidth, 'x', panelHeight);
    }, 50);
}

function collapseToOrb() {
    if (!mainWindow || !isExpanded) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const orbSize = getOrbSize();

    // Save current panel size before collapsing
    const [currentWidth, currentHeight] = mainWindow.getContentSize();
    if (currentWidth > orbSize && currentHeight > orbSize) {
        config.updateConfig({
            appearance: {
                panelWidth: currentWidth,
                panelHeight: currentHeight
            }
        });
    }

    // Restore to saved position or default
    const savedX = appConfig?.window?.orbX;
    const savedY = appConfig?.window?.orbY;
    const restoreX = savedX !== null && savedX !== undefined ? savedX : screenWidth - orbSize - 20;
    const restoreY = savedY !== null && savedY !== undefined ? savedY : screenHeight - orbSize - 100;

    isExpanded = false;

    // Send state change first so UI updates
    mainWindow.webContents.send('state-change', { expanded: false });

    // Small delay then resize (helps with Wayland/Cosmic)
    setTimeout(() => {
        mainWindow.setResizable(false);
        mainWindow.setContentSize(orbSize, orbSize);
        mainWindow.setPosition(restoreX, restoreY);
        console.log('[Voice Mirror] Collapsed to orb:', orbSize, 'x', orbSize);
    }, 50);
}

function createTray() {
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');

    try {
        tray = new Tray(iconPath);
    } catch (e) {
        console.log('Tray icon not found, skipping tray creation');
        return;
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Panel',
            accelerator: 'CommandOrControl+Shift+V',
            click: () => {
                mainWindow?.show();
                if (!isExpanded) {
                    expandPanel();
                }
            }
        },
        {
            label: 'Settings',
            click: () => {
                mainWindow?.show();
                if (!isExpanded) {
                    expandPanel();
                }
                // Send event to open settings panel in the UI
                mainWindow?.webContents.send('open-settings');
            }
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setToolTip('Voice Mirror');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow?.show();
        }
    });
}

/**
 * Handle JSON events from Python electron_bridge.py
 */
function handlePythonEvent(event) {
    const { event: eventType, data } = event;

    switch (eventType) {
        case 'starting':
            console.log('[Voice Mirror] Python bridge starting...');
            mainWindow?.webContents.send('voice-event', { type: 'starting' });
            break;

        case 'ready':
            console.log('[Voice Mirror] Python backend ready');
            mainWindow?.webContents.send('voice-event', { type: 'ready' });
            break;

        case 'wake_word':
            mainWindow?.webContents.send('voice-event', {
                type: 'wake',
                model: data.model,
                score: data.score
            });
            break;

        case 'recording_start':
            mainWindow?.webContents.send('voice-event', {
                type: 'recording',
                subtype: data.type || 'normal'
            });
            break;

        case 'recording_stop':
            mainWindow?.webContents.send('voice-event', { type: 'processing' });
            break;

        case 'listening':
            mainWindow?.webContents.send('voice-event', { type: 'idle' });
            break;

        case 'transcription':
            mainWindow?.webContents.send('voice-event', {
                type: 'transcription',
                text: data.text
            });
            // Also add to chat as user message
            mainWindow?.webContents.send('chat-message', {
                role: 'user',
                text: data.text
            });
            break;

        case 'processing':
            mainWindow?.webContents.send('voice-event', {
                type: 'thinking',
                source: data.source
            });
            break;

        case 'response':
            mainWindow?.webContents.send('voice-event', { type: 'speaking' });
            // Generate a unique ID for this response to prevent duplicates
            const responseId = `resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            displayedMessageIds.add(responseId);
            mainWindow?.webContents.send('chat-message', {
                role: 'assistant',
                text: data.text,
                source: data.source,
                id: responseId
            });
            break;

        case 'speaking_start':
            mainWindow?.webContents.send('voice-event', {
                type: 'speaking',
                text: data.text
            });
            break;

        case 'speaking_end':
            mainWindow?.webContents.send('voice-event', { type: 'idle' });
            break;

        case 'call_start':
            mainWindow?.webContents.send('voice-event', { type: 'call_active' });
            break;

        case 'call_end':
            mainWindow?.webContents.send('voice-event', { type: 'idle' });
            break;

        case 'mode_change':
            mainWindow?.webContents.send('voice-event', {
                type: 'mode_change',
                mode: data.mode
            });
            break;

        case 'error':
            console.error('[Voice Mirror] Error:', data.message);
            mainWindow?.webContents.send('voice-event', {
                type: 'error',
                message: data.message
            });
            break;

        case 'pong':
            console.log('[Voice Mirror] Pong received');
            break;

        case 'sent_to_inbox':
            // Message successfully sent to Claude inbox - no action needed
            break;

        default:
            console.log('[Voice Mirror] Unknown event:', eventType, data);
    }
}

/**
 * Send a command to Python backend via stdin
 */
function sendToPython(command) {
    if (pythonProcess && pythonProcess.stdin) {
        const json = JSON.stringify(command);
        pythonProcess.stdin.write(json + '\n');
        console.log('[Voice Mirror] Sent command:', command.command);
    } else {
        console.error('[Voice Mirror] Cannot send command - Python not running');
    }
}

/**
 * Start required Docker services (SearXNG, n8n) in the background.
 * These are needed for local LLM tool support.
 */
function startDockerServices() {
    const { execSync } = require('child_process');

    // Docker containers to start (name -> description)
    const services = {
        'searxng': 'SearXNG (web search)',
        'n8n': 'n8n (workflow automation)'
    };

    for (const [containerName, description] of Object.entries(services)) {
        try {
            // Check if container exists
            const exists = execSync(`docker ps -a --format "{{.Names}}" | grep -q "^${containerName}$" && echo "yes" || echo "no"`, {
                encoding: 'utf-8',
                timeout: 5000
            }).trim();

            if (exists === 'yes') {
                // Check if it's running
                const running = execSync(`docker ps --format "{{.Names}}" | grep -q "^${containerName}$" && echo "yes" || echo "no"`, {
                    encoding: 'utf-8',
                    timeout: 5000
                }).trim();

                if (running !== 'yes') {
                    console.log(`[Voice Mirror] Starting ${description}...`);
                    execSync(`docker start ${containerName}`, { timeout: 10000 });
                    console.log(`[Voice Mirror] ✓ ${description} started`);
                }
            }
        } catch (err) {
            // Silently ignore - Docker might not be installed or container doesn't exist
            // This is optional functionality
        }
    }
}

function startPythonVoiceMirror() {
    // Path to local Python backend (standalone - no external dependencies)
    const pythonPath = path.join(__dirname, '..', 'python');
    const venvPython = getPythonExecutable(pythonPath);

    // Verify Python executable exists before spawning
    if (!fileExists(venvPython)) {
        console.error('[Voice Mirror] Python executable not found:', venvPython);
        console.error('[Voice Mirror] Please run: cd python && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt');
        mainWindow?.webContents.send('voice-event', {
            type: 'error',
            message: 'Python venv not found. Set up the python folder venv.'
        });
        return;
    }

    // Check if electron_bridge.py exists
    const bridgeScript = path.join(pythonPath, 'electron_bridge.py');
    const scriptToRun = fileExists(bridgeScript) ? 'electron_bridge.py' : 'voice_agent.py';

    writeLog('PYTHON', `Starting ${scriptToRun}`);

    // Platform-specific spawn options
    const spawnOptions = {
        cwd: pythonPath,
        env: { ...process.env },
        shell: isWindows
    };

    pythonProcess = spawn(venvPython, [scriptToRun], spawnOptions);

    // Buffer for incomplete JSON lines
    let stdoutBuffer = '';

    pythonProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();

        // Process complete lines
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            if (!line.trim()) continue;

            // Try to parse as JSON event from electron_bridge.py
            try {
                const event = JSON.parse(line);
                if (event.event) {
                    // Don't log here - Python already logs events to the file
                    handlePythonEvent(event);
                    continue;
                }
            } catch (e) {
                // Not JSON, handle as legacy text output
            }

            // Legacy text parsing (for voice_agent.py without bridge)
            console.log('[Voice Mirror]', line);
            if (line.includes('Wake word detected')) {
                mainWindow?.webContents.send('voice-event', { type: 'wake' });
            } else if (line.includes('Recording')) {
                mainWindow?.webContents.send('voice-event', { type: 'recording' });
            } else if (line.includes('Speaking')) {
                mainWindow?.webContents.send('voice-event', { type: 'speaking' });
            } else if (line.includes('Listening')) {
                mainWindow?.webContents.send('voice-event', { type: 'idle' });
            }
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error('[Voice Mirror Error]', data.toString());
    });

    pythonProcess.on('close', (code) => {
        console.log(`[Voice Mirror] Python process exited with code ${code}`);
        pythonProcess = null;
        mainWindow?.webContents.send('voice-event', { type: 'disconnected' });
    });
}

/**
 * Send image to Python backend for Claude vision processing.
 * Falls back to saving image and creating an MCP inbox message if Python isn't running.
 */
async function sendImageToPython(imageData) {
    const { base64, filename } = imageData;

    // Extract just the base64 data (remove data:image/png;base64, prefix)
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

    if (pythonProcess && pythonProcess.stdin) {
        // Send JSON command to Python via stdin
        const command = JSON.stringify({
            type: 'image',
            data: base64Data,
            filename: filename,
            prompt: imageData.prompt || "What's in this image?"
        });

        pythonProcess.stdin.write(command + '\n');

        // Response will come via inbox watcher - don't show inline "waiting" message
        console.log('[Voice Mirror] Image sent to Python backend');
        return { sent: true };
    } else {
        // Save image and create proper MCP inbox message
        const contextMirrorDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
        const imagesDir = path.join(contextMirrorDir, 'images');
        const imagePath = path.join(imagesDir, `screenshot-${Date.now()}.png`);

        try {
            // Ensure directories exist
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }

            // Write image to file
            const imageBuffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(imagePath, imageBuffer);

            console.log('[Voice Mirror] Image saved to:', imagePath);

            // Create proper MCP inbox message (matching Context Mirror format)
            const inboxPath = path.join(contextMirrorDir, 'inbox.json');

            let data = { messages: [] };
            if (fs.existsSync(inboxPath)) {
                try {
                    data = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
                    if (!data.messages) data.messages = [];
                } catch (e) {
                    data = { messages: [] };
                }
            }

            // Use proper message format (from, message, timestamp, etc.)
            const newMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                from: 'nathan',  // Voice user
                message: `Please analyze this screenshot: ${imagePath}`,
                timestamp: new Date().toISOString(),
                read_by: [],
                thread_id: `voice-${Date.now()}`,
                image_path: imagePath  // Extra field for image
            };

            data.messages.push(newMessage);

            // Keep last 100 messages
            if (data.messages.length > 100) {
                data.messages = data.messages.slice(-100);
            }

            fs.writeFileSync(inboxPath, JSON.stringify(data, null, 2));

            // Also create trigger file to notify watchers
            const triggerPath = path.join(contextMirrorDir, 'claude_message_trigger.json');
            fs.writeFileSync(triggerPath, JSON.stringify({
                from: 'nathan',
                messageId: newMessage.id,
                timestamp: newMessage.timestamp,
                has_image: true,
                image_path: imagePath
            }, null, 2));

            console.log('[Voice Mirror] Image message sent to inbox');

            return {
                text: `Screenshot sent to Claude for analysis`,
                imagePath: imagePath
            };
        } catch (err) {
            console.error('[Voice Mirror] Failed to save image:', err);
            return { text: 'Failed to process image.', error: err.message };
        }
    }
}

/**
 * Start Claude Code with Voice Mirror MCP tools.
 * Spawns a real PTY terminal running Claude Code.
 * Claude will use claude_listen MCP tool to wait for voice messages.
 */
function startClaudeCode() {
    if (isClaudeRunning()) {
        console.log('[Voice Mirror] Claude already running');
        return;
    }

    console.log('[Voice Mirror] Starting Claude Code PTY...');

    // Check if Claude CLI is available
    if (!isClaudeAvailable()) {
        console.error('[Voice Mirror] Claude CLI not found!');
        mainWindow?.webContents.send('claude-terminal', {
            type: 'stderr',
            text: '[Claude Code] Not found - install with: npm install -g @anthropic-ai/claude-code\n'
        });
        return;
    }

    // Spawn Claude in a real PTY terminal
    const pty = spawnClaude({
        onOutput: (data) => {
            // Forward PTY output to the UI terminal
            mainWindow?.webContents.send('claude-terminal', {
                type: 'stdout',
                text: data
            });
        },
        onExit: (code) => {
            console.log('[Voice Mirror] Claude PTY exited with code:', code);
            mainWindow?.webContents.send('claude-terminal', {
                type: 'exit',
                code: code
            });
            mainWindow?.webContents.send('voice-event', {
                type: 'claude_disconnected'
            });
        },
        cols: 120,
        rows: 30
    });

    if (pty) {
        mainWindow?.webContents.send('claude-terminal', {
            type: 'start',
            text: '[Claude Code] PTY terminal started\n'
        });
        mainWindow?.webContents.send('voice-event', {
            type: 'claude_connected',
            provider: 'claude',
            providerName: 'Claude Code',
            model: null
        });
        console.log('[Voice Mirror] Claude PTY started');

        // Wait for Claude TUI to be ready, then send voice mode command
        const voicePrompt = 'Use claude_listen to wait for voice input from nathan, then reply with claude_send. Loop forever.\n';
        sendInputWhenReady(voicePrompt, 20000)
            .then(() => {
                console.log('[Voice Mirror] Voice mode command sent successfully');
            })
            .catch((err) => {
                console.error('[Voice Mirror] Failed to send voice mode command:', err.message);
                // Fallback: try sending anyway after a delay
                setTimeout(() => {
                    if (isClaudeRunning()) {
                        sendInput(voicePrompt + '\r');
                        console.log('[Voice Mirror] Sent voice mode command (fallback)');
                    }
                }, 8000);
            });
    } else {
        mainWindow?.webContents.send('claude-terminal', {
            type: 'stderr',
            text: '[Claude Code] Failed to start PTY\n'
        });
    }
}

/**
 * Stop Claude Code PTY process.
 */
function stopClaudeCode() {
    if (isClaudeRunning()) {
        stopClaude();
        console.log('[Voice Mirror] Claude Code PTY stopped');
        mainWindow?.webContents.send('voice-event', {
            type: 'claude_disconnected'
        });
    }
}

/**
 * Start AI provider based on config.
 * Routes to Claude Code PTY or OpenAI-compatible API provider.
 */
function startAIProvider() {
    const providerType = appConfig?.ai?.provider || 'claude';
    const model = appConfig?.ai?.model || null;

    // NOTE: Don't clear processedUserMessageIds here - it's seeded at startup
    // and clearing would cause old inbox messages to be re-forwarded.
    // Only clear when explicitly switching providers via config_update handler.

    console.log(`[Voice Mirror] Starting AI provider: ${providerType}${model ? ' (' + model + ')' : ''}`);

    // Check if already running
    if (providerType === 'claude') {
        // Claude uses the existing PTY-based system
        if (isClaudeRunning()) {
            console.log('[Voice Mirror] Claude already running');
            return false;
        }
        startClaudeCode();
        return true;
    }

    // For non-Claude providers, use the OpenAI-compatible provider
    if (activeProvider && activeProvider.isRunning()) {
        console.log(`[Voice Mirror] ${providerType} already running`);
        return false;
    }

    // Get provider config (endpoints, API keys)
    const endpoints = appConfig?.ai?.endpoints || {};
    const apiKeys = appConfig?.ai?.apiKeys || {};

    // Map provider type to alternative API key names (check both)
    const apiKeyAltMap = {
        gemini: 'google',  // gemini keys can be under 'gemini' or 'google'
        grok: 'xai'        // grok keys can be under 'grok' or 'xai'
    };
    const altKeyName = apiKeyAltMap[providerType];

    // Try provider name first, then alternative name, then env var
    const apiKey = apiKeys[providerType] ||
                   (altKeyName && apiKeys[altKeyName]) ||
                   process.env[`${providerType.toUpperCase()}_API_KEY`] ||
                   (altKeyName && process.env[`${altKeyName.toUpperCase()}_API_KEY`]) ||
                   undefined;

    // Create provider instance
    activeProvider = createProvider(providerType, {
        model: model,
        baseUrl: endpoints[providerType] || undefined,
        apiKey: apiKey
    });

    // Set up output handlers
    activeProvider.on('output', (data) => {
        mainWindow?.webContents.send('claude-terminal', {
            type: data.type,
            text: data.text
        });
    });

    // Set up tool callbacks for local providers
    if (activeProvider.setToolCallbacks) {
        activeProvider.setToolCallbacks(
            // onToolCall - when a tool is being executed
            (data) => {
                console.log(`[Voice Mirror] Tool call: ${data.tool}`);
                mainWindow?.webContents.send('tool-call', {
                    tool: data.tool,
                    args: data.args,
                    iteration: data.iteration
                });
            },
            // onToolResult - when a tool execution completes
            (data) => {
                console.log(`[Voice Mirror] Tool result: ${data.tool} - ${data.success ? 'success' : 'failed'}`);
                mainWindow?.webContents.send('tool-result', {
                    tool: data.tool,
                    success: data.success,
                    result: data.result
                });
            }
        );
    }

    // Start the provider
    activeProvider.spawn().then(() => {
        mainWindow?.webContents.send('claude-terminal', {
            type: 'start',
            text: `[${activeProvider.getDisplayName()}] Ready\n`
        });
        mainWindow?.webContents.send('voice-event', {
            type: 'claude_connected',
            provider: providerType,
            providerName: activeProvider.getDisplayName(),
            model: model
        });

        // Log if tools are enabled
        if (activeProvider.supportsTools && activeProvider.supportsTools()) {
            console.log(`[Voice Mirror] Tool support enabled for ${providerType}`);
        }
    }).catch((err) => {
        console.error(`[Voice Mirror] Failed to start ${providerType}:`, err);
        mainWindow?.webContents.send('claude-terminal', {
            type: 'stderr',
            text: `[Error] Failed to start ${providerType}: ${err.message}\n`
        });
    });

    return true;
}

/**
 * Stop the active AI provider.
 * Stops whatever is actually running, not based on config.
 */
function stopAIProvider() {
    let stopped = false;

    // Always try to stop Claude PTY if it's running
    if (isClaudeRunning()) {
        stopClaudeCode();
        stopped = true;
        console.log('[Voice Mirror] Stopped Claude Code PTY');
    }

    // Also stop OpenAI-compatible provider if running
    if (activeProvider && activeProvider.isRunning()) {
        const name = activeProvider.getDisplayName();
        activeProvider.stop();
        activeProvider = null;
        console.log(`[Voice Mirror] Stopped ${name}`);
        stopped = true;
    }

    if (stopped) {
        // Clear processed user messages when provider is stopped (e.g., when switching providers)
        // This ensures the new provider doesn't skip messages that the old one already handled
        processedUserMessageIds.clear();
        console.log('[Voice Mirror] Cleared processed user message IDs for provider switch');

        mainWindow?.webContents.send('voice-event', {
            type: 'claude_disconnected'
        });
    }

    return stopped;
}

/**
 * Check if AI provider is running.
 * Checks what's actually running, not based on config.
 */
function isAIProviderRunning() {
    // Check if Claude PTY is running
    if (isClaudeRunning()) {
        return true;
    }

    // Check if OpenAI-compatible provider is running
    if (activeProvider && activeProvider.isRunning()) {
        return true;
    }

    return false;
}

/**
 * Send input to the active AI provider.
 */
function sendAIInput(text) {
    const providerType = appConfig?.ai?.provider || 'claude';

    if (providerType === 'claude') {
        // Claude uses PTY input
        if (isClaudeRunning()) {
            sendInput(text);
            return true;
        }
        return false;
    }

    // OpenAI-compatible providers use sendInput method
    if (activeProvider && activeProvider.isRunning()) {
        activeProvider.sendInput(text);
        return true;
    }

    return false;
}

/**
 * Watch for Claude messages in the MCP inbox.
 * Claude sends responses via claude_send MCP tool - we display them in the UI.
 * Note: Claude uses claude_listen to get voice messages directly (PTY mode).
 */
let inboxWatcher = null;
let displayedMessageIds = new Set();  // Track messages already shown in UI
let processedUserMessageIds = new Set();  // Track user messages already forwarded to non-Claude providers

function startInboxWatcher() {
    const dataDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
    const inboxPath = path.join(dataDir, 'inbox.json');

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Seed displayedMessageIds with existing messages to avoid showing stale history
    // Also seed processedUserMessageIds to avoid re-forwarding old messages to non-Claude providers
    // Only NEW messages that arrive after app starts will be displayed/processed
    try {
        if (fs.existsSync(inboxPath)) {
            const data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
            const messages = data.messages || [];
            for (const msg of messages) {
                if (msg.id) {
                    displayedMessageIds.add(msg.id);
                    // Also seed processedUserMessageIds for "nathan" messages
                    if (msg.from === 'nathan') {
                        processedUserMessageIds.add(msg.id);
                    }
                }
            }
            console.log(`[Voice Mirror] Seeded ${displayedMessageIds.size} display IDs, ${processedUserMessageIds.size} user message IDs`);
        }
    } catch (err) {
        console.error('[Voice Mirror] Failed to seed message IDs:', err);
    }

    // Poll every 500ms for new Claude messages
    inboxWatcher = setInterval(() => {
        try {
            if (!fs.existsSync(inboxPath)) return;

            const data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
            const messages = data.messages || [];

            if (messages.length === 0) return;

            // Watch for Claude responses and display in UI
            let latestClaudeMessage = null;
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                const sender = (msg.from || '').toLowerCase();
                if (sender.includes('claude') && msg.thread_id === 'voice-mirror') {
                    latestClaudeMessage = msg;
                    break;
                }
            }

            if (latestClaudeMessage && !displayedMessageIds.has(latestClaudeMessage.id)) {
                displayedMessageIds.add(latestClaudeMessage.id);

                // Keep Set size bounded
                if (displayedMessageIds.size > 100) {
                    const iterator = displayedMessageIds.values();
                    displayedMessageIds.delete(iterator.next().value);
                }

                console.log('[Voice Mirror] New Claude message:', latestClaudeMessage.message?.slice(0, 50));

                // Send to UI
                mainWindow?.webContents.send('chat-message', {
                    role: 'assistant',
                    text: latestClaudeMessage.message,
                    source: 'claude',
                    timestamp: latestClaudeMessage.timestamp,
                    id: latestClaudeMessage.id
                });

                mainWindow?.webContents.send('voice-event', {
                    type: 'claude_message',
                    text: latestClaudeMessage.message
                });
            }

            // === Inbox Bridge for Non-Claude Providers ===
            // Forward user messages to OpenAI-compatible providers (Ollama, LM Studio, etc.)
            // Claude handles inbox directly via MCP tools, but other providers need this bridge
            if (!isClaudeRunning() && activeProvider && activeProvider.isRunning()) {
                for (const msg of messages) {
                    // Skip if already processed or not from voice user
                    if (processedUserMessageIds.has(msg.id) || msg.from !== 'nathan') continue;

                    // Mark as processed immediately to avoid duplicate forwarding
                    processedUserMessageIds.add(msg.id);

                    // Keep Set size bounded
                    if (processedUserMessageIds.size > 100) {
                        const iterator = processedUserMessageIds.values();
                        processedUserMessageIds.delete(iterator.next().value);
                    }

                    const providerName = activeProvider.getDisplayName();
                    console.log(`[Voice Mirror] Forwarding inbox message to ${providerName}: ${msg.message?.slice(0, 50)}...`);

                    // Send to UI as user message
                    mainWindow?.webContents.send('chat-message', {
                        role: 'user',
                        text: msg.message,
                        source: 'voice',
                        timestamp: msg.timestamp,
                        id: msg.id
                    });

                    // Capture response and write back to inbox for Python TTS
                    captureProviderResponse(activeProvider, msg.message).then((response) => {
                        if (response) {
                            // Strip any echoed/quoted user message from the response
                            const cleanedResponse = stripEchoedContent(response);

                            // Write to inbox so Python can speak it
                            writeResponseToInbox(cleanedResponse, providerName, msg.id);

                            // Also display in chat UI
                            mainWindow?.webContents.send('chat-message', {
                                role: 'assistant',
                                text: cleanedResponse,
                                source: providerName.toLowerCase(),
                                timestamp: new Date().toISOString()
                            });
                        }
                    }).catch((err) => {
                        console.error(`[Voice Mirror] Error forwarding to ${providerName}:`, err);
                    });
                }
            }

        } catch (err) {
            // Silently ignore parse errors
        }
    }, 500);

    console.log('[Voice Mirror] Inbox watcher started');
}

function stopInboxWatcher() {
    if (inboxWatcher) {
        clearInterval(inboxWatcher);
        inboxWatcher = null;
    }
}

/**
 * Capture streamed response from an OpenAI-compatible provider.
 * Intercepts the provider's output and collects the full response.
 * Handles tool calls by waiting for the tool loop to complete.
 * @param {Object} provider - The provider instance
 * @param {string} message - The message to send
 * @returns {Promise<string|null>} The final response (after tool execution) or null on timeout
 */
async function captureProviderResponse(provider, message) {
    return new Promise((resolve) => {
        let fullResponse = '';
        let toolInProgress = false;
        let finalResponse = '';
        const originalEmit = provider.emitOutput.bind(provider);

        // Track tool execution state via callbacks
        const originalOnToolCall = provider.onToolCall;
        const originalOnToolResult = provider.onToolResult;

        provider.onToolCall = (data) => {
            toolInProgress = true;
            console.log(`[Voice Mirror] Tool call in progress: ${data.tool}`);
            if (originalOnToolCall) originalOnToolCall(data);
        };

        provider.onToolResult = (data) => {
            console.log(`[Voice Mirror] Tool result received: ${data.tool} (success: ${data.success})`);
            // Reset fullResponse to capture the follow-up response
            // The provider will send another request after injecting tool result
            fullResponse = '';
            lastLength = 0;  // Reset lastLength too so stability detection works correctly
            stableCount = 0;
            toolCompleted = true;  // Mark that tool has completed, now wait for follow-up
            toolInProgress = false;  // Allow stability counting to resume
            if (originalOnToolResult) originalOnToolResult(data);
        };

        // Intercept output to capture the response
        provider.emitOutput = (type, text) => {
            originalEmit(type, text);
            if (type === 'stdout' && text) {
                fullResponse += text;
            }
        };

        // Send the message
        provider.sendInput(message);

        // Wait for response to complete (detect when output stops)
        let lastLength = 0;
        let stableCount = 0;
        let toolCompleted = false;  // Track if we've received a tool result
        const requiredStableChecks = 4;  // 2 seconds of stability
        const checkInterval = setInterval(() => {
            // Don't count stability while tool is executing (waiting for result)
            // Only start counting after tool completes OR if no tool was called
            if (toolInProgress && !toolCompleted) {
                // Tool is executing, don't count stability yet
                stableCount = 0;
                lastLength = fullResponse.length;
                return;
            }

            if (fullResponse.length === lastLength && fullResponse.length > 0) {
                stableCount++;
                // After tool completion, need a bit more time for follow-up response
                const neededChecks = toolCompleted ? requiredStableChecks + 2 : requiredStableChecks;
                if (stableCount >= neededChecks) {
                    clearInterval(checkInterval);
                    cleanup();

                    // Extract final speakable response (skip tool JSON and system messages)
                    finalResponse = extractSpeakableResponse(fullResponse);
                    console.log(`[Voice Mirror] Captured response (${fullResponse.length} chars) -> speakable: "${finalResponse?.slice(0, 100)}..."`);
                    resolve(finalResponse || null);
                }
            } else {
                stableCount = 0;
            }
            lastLength = fullResponse.length;
        }, 500);

        function cleanup() {
            provider.emitOutput = originalEmit;
            provider.onToolCall = originalOnToolCall;
            provider.onToolResult = originalOnToolResult;
        }

        // Timeout after 60 seconds (longer to allow for tool execution)
        setTimeout(() => {
            clearInterval(checkInterval);
            cleanup();
            finalResponse = extractSpeakableResponse(fullResponse);
            resolve(finalResponse || null);
        }, 60000);
    });
}

/**
 * Extract the final speakable response from provider output.
 * Filters out tool JSON, system messages, and intermediate output.
 * Returns only the final natural language response after tool execution.
 * @param {string} output - The full captured output
 * @returns {string} The final response suitable for TTS
 */
function extractSpeakableResponse(output) {
    if (!output) return '';

    // Split by common section markers to find the final response
    // After tool execution, the model typically outputs a natural response
    const sections = output.split(/\[Tool (?:succeeded|failed)\]/i);

    // If we have sections after tool execution, use the last one
    let relevantOutput = sections.length > 1 ? sections[sections.length - 1] : output;

    const lines = relevantOutput.split('\n');
    const speakableLines = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Track markdown code blocks (skip everything inside them)
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        // Skip tool-related system messages
        if (trimmed.startsWith('[Executing tool:') ||
            trimmed.startsWith('[Tool Error:') ||
            trimmed.startsWith('[Max tool iterations') ||
            trimmed.startsWith('Tool "') ||
            trimmed.startsWith('[Tool succeeded]') ||
            trimmed.startsWith('[Tool failed]')) {
            continue;
        }

        // Skip JSON tool calls (detect by pattern)
        if (trimmed.startsWith('{') && trimmed.includes('"tool"')) {
            continue;
        }

        // Skip lines that look like pre-tool-call announcements
        if (trimmed.match(/I'll (?:search|look|check|use|execute|call)/i) &&
            trimmed.match(/tool|search|web_search/i)) {
            continue;
        }

        // Skip user echo lines (> prefix)
        if (trimmed.startsWith('>')) continue;

        // Skip numbered list items that are just URLs or metadata
        if (trimmed.match(/^\d+\.\s*(https?:|www\.)/)) continue;

        // Keep this line
        speakableLines.push(trimmed);
    }

    // Return the collected speakable content
    const result = speakableLines.join(' ').trim();

    // Clean up the result
    // Remove markdown artifacts and URLs (not speakable)
    let cleaned = result
        .replace(/\*\*/g, '')           // Bold markers
        .replace(/\*/g, '')              // Italic markers
        .replace(/`[^`]+`/g, '')         // Inline code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> just text
        .replace(/<(https?:\/\/[^>]+)>/g, '')     // <url> -> remove entirely
        .replace(/https?:\/\/[^\s)>\]]+/g, '')    // Raw URLs -> remove
        .replace(/www\.[^\s)>\]]+/g, '')          // www. URLs -> remove
        .replace(/#+\s*/g, '')           // Headers
        .replace(/\s*-\s*(?=\s|$)/g, ' ')         // Orphaned dashes from removed URLs
        .replace(/\s+/g, ' ')            // Multiple spaces
        .trim();

    // If the result is still mostly JSON or system output, return empty
    if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
        return '';
    }

    return cleaned;
}

/**
 * Strip echoed/quoted user message from AI response.
 * Many models quote the user's message before responding (e.g., "> User's question\n\nResponse")
 * @param {string} response - The AI response text
 * @returns {string} Cleaned response without quoted echo
 */
function stripEchoedContent(response) {
    if (!response) return response;

    // Pattern 1: Lines starting with > (blockquotes)
    // Pattern 2: Lines starting with "User:" or similar
    // Remove leading quoted lines until we hit actual content
    const lines = response.split('\n');
    let startIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip empty lines, blockquotes, and "User:" prefixes
        if (line === '' || line.startsWith('>') || line.match(/^(user|you|human):/i)) {
            startIndex = i + 1;
        } else {
            break;
        }
    }

    return lines.slice(startIndex).join('\n').trim();
}

/**
 * Write AI response to inbox so Python TTS can speak it.
 * @param {string} response - The AI response text
 * @param {string} providerName - Display name of the provider
 * @param {string} replyToId - ID of the message being replied to
 */
function writeResponseToInbox(response, providerName, replyToId) {
    const dataDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
    const inboxPath = path.join(dataDir, 'inbox.json');

    let data = { messages: [] };
    if (fs.existsSync(inboxPath)) {
        try {
            data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
            if (!data.messages) data.messages = [];
        } catch {
            data = { messages: [] };
        }
    }

    // Create sender ID from provider name (e.g., "Ollama (qwen-coder)" -> "ollama-qwen-coder")
    const senderId = providerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const newMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: senderId,
        message: response,
        timestamp: new Date().toISOString(),
        read_by: [],
        reply_to: replyToId,
        thread_id: 'voice-mirror'
    };

    data.messages.push(newMessage);
    fs.writeFileSync(inboxPath, JSON.stringify(data, null, 2));

    console.log(`[Voice Mirror] Wrote response to inbox from ${senderId}`);
}

/**
 * Watch for screen capture requests from Claude via MCP.
 * When Claude calls capture_screen, it writes a request file.
 * We watch that file and fulfill the request.
 */
let screenCaptureWatcher = null;

function startScreenCaptureWatcher() {
    const contextMirrorDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
    const requestPath = path.join(contextMirrorDir, 'screen_capture_request.json');
    const responsePath = path.join(contextMirrorDir, 'screen_capture_response.json');
    const imagesDir = path.join(contextMirrorDir, 'images');

    // Ensure directories exist
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Watch for capture requests
    screenCaptureWatcher = setInterval(async () => {
        try {
            if (!fs.existsSync(requestPath)) return;

            const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
            const requestTime = new Date(request.timestamp).getTime();
            const now = Date.now();

            // Only process requests from the last 5 seconds
            if (now - requestTime > 5000) {
                fs.unlinkSync(requestPath);
                return;
            }

            // Delete request immediately to prevent multiple captures
            fs.unlinkSync(requestPath);

            console.log('[Voice Mirror] Screen capture requested by Claude');

            // Capture the screen
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 1920, height: 1080 }
            });

            if (sources.length > 0) {
                const displayIndex = request.display || 0;
                const source = sources[displayIndex] || sources[0];
                const dataUrl = source.thumbnail.toDataURL();

                // Save image to file
                const imagePath = path.join(imagesDir, `capture-${Date.now()}.png`);
                const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(imagePath, imageBuffer);

                // Write response
                fs.writeFileSync(responsePath, JSON.stringify({
                    success: true,
                    image_path: imagePath,
                    timestamp: new Date().toISOString(),
                    width: 1920,
                    height: 1080
                }, null, 2));

                console.log('[Voice Mirror] Screenshot saved:', imagePath);

                // Also add to inbox so Claude can reference it
                const inboxPath = path.join(contextMirrorDir, 'inbox.json');
                let data = { messages: [] };
                if (fs.existsSync(inboxPath)) {
                    try {
                        data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
                    } catch {}
                }

                data.messages.push({
                    id: `capture-${Date.now()}`,
                    from: 'system',
                    message: `Screenshot captured and saved to: ${imagePath}`,
                    timestamp: new Date().toISOString(),
                    read_by: [],
                    image_path: imagePath
                });

                fs.writeFileSync(inboxPath, JSON.stringify(data, null, 2));
            } else {
                fs.writeFileSync(responsePath, JSON.stringify({
                    success: false,
                    error: 'No displays available',
                    timestamp: new Date().toISOString()
                }, null, 2));
            }

        } catch (err) {
            console.error('[Voice Mirror] Screen capture error:', err);
        }
    }, 500);  // Check every 500ms
}

function stopScreenCaptureWatcher() {
    if (screenCaptureWatcher) {
        clearInterval(screenCaptureWatcher);
        screenCaptureWatcher = null;
    }
}

// ============================================================================
// Browser Request Watcher (for MCP browser_search / browser_fetch tools)
// ============================================================================

let browserRequestWatcher = null;
let browserModule = null;

// Serper.dev API key for web search
const SERPER_API_KEY = process.env.SERPER_API_KEY || '3adf77c61ddf98dff5ab2e3dd35b3eebc3409fa6';

/**
 * Lazy-load the browser module.
 * This avoids loading Playwright until actually needed.
 */
function getBrowserModule() {
    if (!browserModule) {
        browserModule = require('./browser');
        // Configure Serper API key for web search
        if (SERPER_API_KEY) {
            browserModule.setSerperApiKey(SERPER_API_KEY);
        }
    }
    return browserModule;
}

/**
 * Watch for browser requests from MCP server.
 * When Claude calls browser_search or browser_fetch, it writes a request file.
 * We watch that file and fulfill the request.
 */
function startBrowserRequestWatcher() {
    const contextMirrorDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
    const requestPath = path.join(contextMirrorDir, 'browser_request.json');
    const responsePath = path.join(contextMirrorDir, 'browser_response.json');

    // Watch for browser requests
    browserRequestWatcher = setInterval(async () => {
        try {
            if (!fs.existsSync(requestPath)) return;

            const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
            const requestTime = new Date(request.timestamp).getTime();
            const now = Date.now();

            // Only process requests from the last 5 seconds
            if (now - requestTime > 5000) {
                fs.unlinkSync(requestPath);
                return;
            }

            // Delete request immediately to prevent duplicate processing
            fs.unlinkSync(requestPath);

            console.log(`[Voice Mirror] Browser request: ${request.action}`);

            let result;
            const browser = getBrowserModule();

            switch (request.action) {
                case 'search':
                    result = await browser.webSearch(request.args);
                    break;
                case 'fetch':
                    result = await browser.fetchUrl(request.args);
                    break;
                default:
                    result = { success: false, error: `Unknown browser action: ${request.action}` };
            }

            // Write response
            fs.writeFileSync(responsePath, JSON.stringify({
                ...result,
                request_id: request.id,
                timestamp: new Date().toISOString()
            }, null, 2));

            console.log(`[Voice Mirror] Browser request completed: ${request.action}`);

        } catch (err) {
            console.error('[Voice Mirror] Browser request error:', err);
            // Write error response
            const contextMirrorDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
            const responsePath = path.join(contextMirrorDir, 'browser_response.json');
            fs.writeFileSync(responsePath, JSON.stringify({
                success: false,
                error: err.message,
                timestamp: new Date().toISOString()
            }, null, 2));
        }
    }, 500);  // Check every 500ms
}

function stopBrowserRequestWatcher() {
    if (browserRequestWatcher) {
        clearInterval(browserRequestWatcher);
        browserRequestWatcher = null;
    }
}

/**
 * Close the browser when app is quitting.
 */
async function closeBrowser() {
    if (browserModule) {
        try {
            await browserModule.closeBrowser();
            console.log('[Voice Mirror] Browser closed');
        } catch (err) {
            console.error('[Voice Mirror] Error closing browser:', err.message);
        }
    }
}

// Push-to-talk state
let pttKey = null;
let pttActive = false;  // Currently holding PTT key
let uiohookStarted = false;

/**
 * Map PTT key config to uiohook button/key codes.
 * Mouse buttons: 1=left, 2=right, 3=middle, 4=side1 (back), 5=side2 (forward)
 */
function parsePttKey(key) {
    const keyLower = key.toLowerCase();

    // Mouse buttons
    if (keyLower === 'mousebutton4' || keyLower === 'mouse4' || keyLower === 'xbutton1') {
        return { type: 'mouse', button: 4 };
    }
    if (keyLower === 'mousebutton5' || keyLower === 'mouse5' || keyLower === 'xbutton2') {
        return { type: 'mouse', button: 5 };
    }
    if (keyLower === 'mousebutton3' || keyLower === 'mouse3' || keyLower === 'middleclick') {
        return { type: 'mouse', button: 3 };
    }

    // Keyboard keys - map common names to uiohook keycodes
    // See: https://github.com/aspect-build/uiohook-napi/blob/main/lib/keycodes.ts
    const keyMap = {
        'space': 57,
        'f13': 100,
        'f14': 101,
        'f15': 102,
        'scrolllock': 70,
        'pause': 119,
        'insert': 110,
        'home': 102,
        'pageup': 104,
        'delete': 111,
        'end': 107,
        'pagedown': 109,
        'capslock': 58,
        'numlock': 69,
    };

    if (keyMap[keyLower]) {
        return { type: 'keyboard', keycode: keyMap[keyLower] };
    }

    // Single character keys (a-z, 0-9)
    if (keyLower.length === 1) {
        const char = keyLower.charCodeAt(0);
        // a-z: keycodes 30-55 roughly (a=30, b=48, etc. - uiohook uses scan codes)
        // This is approximate - uiohook uses hardware scan codes
        if (char >= 97 && char <= 122) {
            // Rough mapping - may need adjustment per keyboard layout
            const letterMap = { a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35, i: 23, j: 36, k: 37, l: 38, m: 50, n: 49, o: 24, p: 25, q: 16, r: 19, s: 31, t: 20, u: 22, v: 47, w: 17, x: 45, y: 21, z: 44 };
            if (letterMap[keyLower]) {
                return { type: 'keyboard', keycode: letterMap[keyLower] };
            }
        }
        // 0-9: keycodes 11, 2-10
        if (char >= 48 && char <= 57) {
            const numMap = { '0': 11, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10 };
            if (numMap[keyLower]) {
                return { type: 'keyboard', keycode: numMap[keyLower] };
            }
        }
    }

    // Fallback: try to use globalShortcut for modifier combos
    return { type: 'shortcut', key: key };
}

/**
 * Register push-to-talk with uiohook (supports mouse buttons).
 * When held, starts recording. When released, stops.
 */
function registerPushToTalk(key) {
    unregisterPushToTalk();  // Clear any existing

    pttKey = parsePttKey(key);
    console.log(`[Voice Mirror] PTT key parsed:`, pttKey);

    if (!uIOhook) {
        // Fallback to globalShortcut for keyboard shortcuts only
        if (pttKey.type === 'shortcut' || pttKey.type === 'keyboard') {
            console.log('[Voice Mirror] uiohook not available, using globalShortcut fallback');
            const electronKey = key.replace(/ \+ /g, '+');
            try {
                globalShortcut.register(electronKey, () => {
                    if (!pttActive) {
                        pttActive = true;
                        console.log('[Voice Mirror] PTT: Start recording (shortcut)');
                        sendToPython({ command: 'start_recording' });
                        mainWindow?.webContents.send('voice-event', { type: 'recording' });
                    }
                });
                console.log(`[Voice Mirror] PTT registered via globalShortcut: ${electronKey}`);
            } catch (err) {
                console.error('[Voice Mirror] PTT registration error:', err);
            }
        } else {
            console.error('[Voice Mirror] Mouse button PTT requires uiohook-napi. Run: npm install uiohook-napi');
        }
        return;
    }

    // Use uiohook for proper key down/up detection
    if (!uiohookStarted) {
        // Set up event handlers
        uIOhook.on('mousedown', (e) => {
            if (pttKey?.type === 'mouse' && e.button === pttKey.button && !pttActive) {
                pttActive = true;
                console.log(`[Voice Mirror] PTT: Start recording (mouse button ${e.button})`);
                sendToPython({ command: 'start_recording' });
                mainWindow?.webContents.send('voice-event', { type: 'recording' });
            }
        });

        uIOhook.on('mouseup', (e) => {
            if (pttKey?.type === 'mouse' && e.button === pttKey.button && pttActive) {
                pttActive = false;
                console.log(`[Voice Mirror] PTT: Stop recording (mouse button ${e.button})`);
                sendToPython({ command: 'stop_recording' });
                mainWindow?.webContents.send('voice-event', { type: 'idle' });
            }
        });

        uIOhook.on('keydown', (e) => {
            if (pttKey?.type === 'keyboard' && e.keycode === pttKey.keycode && !pttActive) {
                pttActive = true;
                console.log(`[Voice Mirror] PTT: Start recording (keycode ${e.keycode})`);
                sendToPython({ command: 'start_recording' });
                mainWindow?.webContents.send('voice-event', { type: 'recording' });
            }
        });

        uIOhook.on('keyup', (e) => {
            if (pttKey?.type === 'keyboard' && e.keycode === pttKey.keycode && pttActive) {
                pttActive = false;
                console.log(`[Voice Mirror] PTT: Stop recording (keycode ${e.keycode})`);
                sendToPython({ command: 'stop_recording' });
                mainWindow?.webContents.send('voice-event', { type: 'idle' });
            }
        });

        // Start the hook
        try {
            uIOhook.start();
            uiohookStarted = true;
            console.log('[Voice Mirror] uiohook started for PTT');
        } catch (err) {
            console.error('[Voice Mirror] Failed to start uiohook:', err);
        }
    }

    console.log(`[Voice Mirror] PTT registered: ${key} (${pttKey.type})`);
}

/**
 * Unregister push-to-talk.
 */
function unregisterPushToTalk() {
    if (pttKey) {
        if (pttKey.type === 'shortcut') {
            try {
                globalShortcut.unregister(pttKey.key);
            } catch (err) {
                // Ignore errors during unregister
            }
        }
        console.log(`[Voice Mirror] PTT unregistered`);
        pttKey = null;
        pttActive = false;
    }
    // Note: We don't stop uiohook here as it may be reused
}

// Linux transparency workarounds
if (isLinux) {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('disable-gpu');  // Helps with transparency on some systems
}

// App lifecycle
app.whenReady().then(() => {
    // Initialize file logging
    initLogFile();

    // Load configuration
    appConfig = config.loadConfig();
    if (appConfig.advanced?.debugMode) {
        writeLog('CONFIG', `Debug mode enabled`);
    }

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
        if (pythonProcess) {
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
            running: pythonProcess !== null,
            pid: pythonProcess?.pid
        };
    });

    ipcMain.handle('start-python', () => {
        if (!pythonProcess) {
            startPythonVoiceMirror();
            return { started: true };
        }
        return { started: false, reason: 'already running' };
    });

    ipcMain.handle('stop-python', () => {
        if (pythonProcess) {
            sendToPython({ command: 'stop' });
            pythonProcess.kill();
            pythonProcess = null;
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
            // Claude uses PTY - send raw input
            if (isClaudeRunning()) {
                sendRawInput(data);
                return { sent: true };
            }
        } else {
            // OpenAI-compatible providers - accumulate input and send on Enter
            if (activeProvider && activeProvider.isRunning()) {
                // Check if Enter key was pressed (CR or LF)
                if (data === '\r' || data === '\n') {
                    // Send accumulated input
                    if (activeProvider._inputBuffer && activeProvider._inputBuffer.trim()) {
                        activeProvider.sendInput(activeProvider._inputBuffer.trim());
                        activeProvider._inputBuffer = '';
                    }
                } else if (data === '\x7f' || data === '\b') {
                    // Backspace - remove last character
                    if (activeProvider._inputBuffer) {
                        activeProvider._inputBuffer = activeProvider._inputBuffer.slice(0, -1);
                        // Echo backspace to terminal
                        mainWindow?.webContents.send('claude-terminal', {
                            type: 'stdout',
                            text: '\b \b'
                        });
                    }
                } else if (data.charCodeAt(0) >= 32 || data === '\t') {
                    // Printable characters - accumulate and echo
                    activeProvider._inputBuffer = (activeProvider._inputBuffer || '') + data;
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

        if (providerType === 'claude' && isClaudeRunning()) {
            resizePty(cols, rows);
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
        if (!pythonProcess) startPythonVoiceMirror();
        if (!isAIProviderRunning()) startAIProvider();
        return { started: true };
    });

    ipcMain.handle('stop-all', () => {
        if (pythonProcess) {
            sendToPython({ command: 'stop' });
            pythonProcess.kill();
            pythonProcess = null;
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
    if (pythonProcess) {
        pythonProcess.kill('SIGKILL');
        pythonProcess = null;
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
    writeLog('APP', 'Shutting down...');

    // Unregister all shortcuts
    globalShortcut.unregisterAll();

    // Stop uiohook if running
    if (uIOhook && uiohookStarted) {
        try {
            uIOhook.stop();
            uiohookStarted = false;
            writeLog('APP', 'uiohook stopped');
        } catch (err) {
            // Ignore errors during cleanup
        }
    }

    // Stop watchers
    stopScreenCaptureWatcher();
    stopInboxWatcher();
    stopBrowserRequestWatcher();

    // Close browser
    closeBrowser();

    if (pythonProcess) {
        pythonProcess.kill();
    }

    // Stop AI provider (Claude PTY or OpenAI-compatible)
    stopAIProvider();

    // Close log file
    closeLogFile();
});
