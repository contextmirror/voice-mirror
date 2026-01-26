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

const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const { spawnClaude, stopClaude, sendInput, sendRawInput, sendInputWhenReady, isClaudeRunning, isClaudeReady, configureMCPServer, isClaudeAvailable, resizePty } = require('./claude-spawner');

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
        writeLog('LOG', 'Voice Mirror Electron started');
    } catch (err) {
        console.error('Failed to init log file:', err);
    }
}

function writeLog(level, message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;

    // Also write to console
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

    // Handle window blur - minimize to orb if expanded
    mainWindow.on('blur', () => {
        if (isExpanded) {
            collapseToOrb();
        }
    });

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
            label: 'Toggle Panel',
            accelerator: 'CommandOrControl+Shift+V',
            click: () => {
                if (isExpanded) {
                    collapseToOrb();
                } else {
                    expandPanel();
                }
            }
        },
        { label: 'Show Window', click: () => mainWindow?.show() },
        { type: 'separator' },
        {
            label: 'Start Voice + Claude',
            click: () => {
                // Start both Python (voice) and Claude (brain)
                if (!pythonProcess) {
                    startPythonVoiceMirror();
                }
                if (!isClaudeRunning()) {
                    startClaudeCode();
                }
            }
        },
        {
            label: 'Stop All',
            click: () => {
                // Stop Python
                if (pythonProcess) {
                    sendToPython({ command: 'stop' });
                    pythonProcess.kill();
                    pythonProcess = null;
                }
                // Stop Claude
                stopClaudeCode();
                mainWindow?.webContents.send('voice-event', { type: 'disconnected' });
            }
        },
        { type: 'separator' },
        {
            label: 'Start Voice Only',
            click: () => {
                if (!pythonProcess) {
                    startPythonVoiceMirror();
                }
            }
        },
        {
            label: 'Start Claude Only',
            click: () => {
                if (!isClaudeRunning()) {
                    startClaudeCode();
                }
            }
        },
        { type: 'separator' },
        { label: 'Settings', click: () => { /* TODO */ } },
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

    writeLog('PYTHON', `Starting backend from: ${pythonPath}`);
    writeLog('PYTHON', `Using Python: ${venvPython}`);
    writeLog('PYTHON', `Script: ${scriptToRun}`);

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
                    writeLog('EVENT', `${event.event} ${JSON.stringify(event.data || {})}`);
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
            prompt: "What's in this image?"
        });

        pythonProcess.stdin.write(command + '\n');

        // Return a promise that resolves when we get a response
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ text: 'Image sent to backend. Waiting for response...' });
            }, 30000);

            // Listen for response (this is simplified - real impl would track request IDs)
            const responseHandler = (data) => {
                const output = data.toString();
                try {
                    // Try to parse as JSON response
                    if (output.startsWith('{') && output.includes('"type":"image_response"')) {
                        const response = JSON.parse(output);
                        clearTimeout(timeout);
                        pythonProcess.stdout.off('data', responseHandler);
                        resolve({ text: response.text });
                    }
                } catch (e) {
                    // Not JSON, ignore
                }
            };

            pythonProcess.stdout.on('data', responseHandler);
        });
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
            type: 'claude_connected'
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
 * Watch for Claude messages in the MCP inbox.
 * Claude sends responses via claude_send MCP tool - we display them in the UI.
 * Note: Claude uses claude_listen to get voice messages directly (PTY mode).
 */
let inboxWatcher = null;
let displayedMessageIds = new Set();  // Track messages already shown in UI

function startInboxWatcher() {
    const dataDir = path.join(app.getPath('home'), '.config', 'voice-mirror-electron', 'data');
    const inboxPath = path.join(dataDir, 'inbox.json');

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
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
    writeLog('CONFIG', `Loaded from: ${config.getConfigDir()}`);
    writeLog('CONFIG', `Debug mode: ${appConfig.advanced?.debugMode || false}`);

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

    // Claude Code backend IPC handlers
    ipcMain.handle('start-claude', () => {
        if (!isClaudeRunning()) {
            startClaudeCode();
            return { started: true };
        }
        return { started: false, reason: 'already running' };
    });

    ipcMain.handle('stop-claude', () => {
        if (isClaudeRunning()) {
            stopClaudeCode();
            return { stopped: true };
        }
        return { stopped: false, reason: 'not running' };
    });

    ipcMain.handle('get-claude-status', () => {
        return {
            running: isClaudeRunning(),
            mode: 'pty'
        };
    });

    // PTY input/resize handlers for xterm.js
    // Use sendRawInput for keyboard input (passes through directly)
    ipcMain.handle('claude-pty-input', (event, data) => {
        if (isClaudeRunning()) {
            sendRawInput(data);
            return { sent: true };
        }
        return { sent: false, reason: 'not running' };
    });

    ipcMain.handle('claude-pty-resize', (event, cols, rows) => {
        if (isClaudeRunning()) {
            resizePty(cols, rows);
            return { resized: true };
        }
        return { resized: false, reason: 'not running' };
    });

    // Start both Voice + Claude together
    ipcMain.handle('start-all', () => {
        if (!pythonProcess) startPythonVoiceMirror();
        if (!isClaudeRunning()) startClaudeCode();
        return { started: true };
    });

    ipcMain.handle('stop-all', () => {
        if (pythonProcess) {
            sendToPython({ command: 'stop' });
            pythonProcess.kill();
            pythonProcess = null;
        }
        stopClaudeCode();
        return { stopped: true };
    });

    createWindow();
    createTray();
    startScreenCaptureWatcher();
    startInboxWatcher();

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

    // Auto-start Voice Mirror (Python + Claude) on app launch
    try {
        console.log('[Voice Mirror] Auto-starting Python and Claude...');
        startPythonVoiceMirror();

        // Small delay to let Python initialize before starting Claude
        setTimeout(() => {
            try {
                startClaudeCode();
            } catch (err) {
                console.error('[Voice Mirror] Failed to start Claude:', err.message);
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

    // Stop Claude PTY process
    stopClaudeCode();

    // Stop all watchers
    stopScreenCaptureWatcher();
    stopInboxWatcher();

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

    if (pythonProcess) {
        pythonProcess.kill();
    }

    // Stop Claude PTY process
    stopClaudeCode();

    // Close log file
    closeLogFile();
});
