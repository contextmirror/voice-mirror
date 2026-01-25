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
    return appConfig?.appearance?.panelWidth || 400;
}
function getPanelHeight() {
    return appConfig?.appearance?.panelHeight || 500;
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

    // Then resize
    setTimeout(() => {
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

function startPythonVoiceMirror() {
    // Path to Python Voice Mirror (sibling folder)
    const pythonPath = path.join(__dirname, '..', '..', 'Voice Mirror');
    const venvPython = getPythonExecutable(pythonPath);

    // Verify Python executable exists before spawning
    if (!fileExists(venvPython)) {
        console.error('[Voice Mirror] Python executable not found:', venvPython);
        console.error('[Voice Mirror] Please ensure the Voice Mirror venv is set up.');
        return;
    }

    console.log('[Voice Mirror] Starting Python backend from:', pythonPath);
    console.log('[Voice Mirror] Using Python:', venvPython);

    // Platform-specific spawn options
    const spawnOptions = {
        cwd: pythonPath,
        env: { ...process.env },
        // Windows needs shell: true for some Python setups
        shell: isWindows
    };

    pythonProcess = spawn(venvPython, ['voice_agent.py'], spawnOptions);

    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[Voice Mirror]', output);

        // Forward relevant events to renderer
        if (output.includes('Wake word detected')) {
            mainWindow?.webContents.send('voice-event', { type: 'wake' });
        } else if (output.includes('Recording')) {
            mainWindow?.webContents.send('voice-event', { type: 'recording' });
        } else if (output.includes('Speaking')) {
            mainWindow?.webContents.send('voice-event', { type: 'speaking' });
        } else if (output.includes('Listening')) {
            mainWindow?.webContents.send('voice-event', { type: 'idle' });
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error('[Voice Mirror Error]', data.toString());
    });

    pythonProcess.on('close', (code) => {
        console.log(`[Voice Mirror] Python process exited with code ${code}`);
        pythonProcess = null;
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
        // Fallback: Save image to temp file and create inbox message
        const tempDir = app.getPath('temp');
        const imagePath = path.join(tempDir, `voice-mirror-${Date.now()}.png`);

        try {
            // Write image to temp file
            const imageBuffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(imagePath, imageBuffer);

            console.log('[Voice Mirror] Image saved to:', imagePath);

            // Create MCP inbox message for Claude Code
            const inboxPath = path.join(app.getPath('home'), '.context-mirror', 'claude_messages.json');

            let messages = [];
            if (fs.existsSync(inboxPath)) {
                try {
                    messages = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
                } catch (e) {
                    messages = [];
                }
            }

            messages.push({
                id: `img-${Date.now()}`,
                timestamp: new Date().toISOString(),
                sender: 'voice-mirror-electron',
                message: `Please analyze this image: ${imagePath}`,
                type: 'image_request',
                imagePath: imagePath
            });

            // Ensure directory exists
            const inboxDir = path.dirname(inboxPath);
            if (!fs.existsSync(inboxDir)) {
                fs.mkdirSync(inboxDir, { recursive: true });
            }

            fs.writeFileSync(inboxPath, JSON.stringify(messages, null, 2));

            return {
                text: `Image saved. You can ask Claude Code to analyze: ${imagePath}`,
                imagePath: imagePath
            };
        } catch (err) {
            console.error('[Voice Mirror] Failed to save image:', err);
            return { text: 'Failed to process image.', error: err.message };
        }
    }
}

// Linux transparency workarounds
if (isLinux) {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('disable-gpu');  // Helps with transparency on some systems
}

// App lifecycle
app.whenReady().then(() => {
    // Load configuration
    appConfig = config.loadConfig();
    console.log('[Config] Loaded from:', config.getConfigDir());
    console.log('[Config] Debug mode:', appConfig.advanced?.debugMode || false);

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

    // Config IPC handlers (for settings UI)
    ipcMain.handle('get-config', () => {
        return config.loadConfig();
    });

    ipcMain.handle('set-config', (event, updates) => {
        appConfig = config.updateConfig(updates);
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

    createWindow();
    createTray();

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

    // Optionally start Python Voice Mirror
    // Uncomment when ready to integrate:
    // startPythonVoiceMirror();
});

app.on('window-all-closed', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
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
    // Unregister all shortcuts
    globalShortcut.unregisterAll();

    if (pythonProcess) {
        pythonProcess.kill();
    }
});
