/**
 * Python backend service for Voice Mirror Electron.
 * Manages the Python voice processing subprocess (STT, TTS, wake word).
 */

const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

/**
 * Get the Python executable path for the virtual environment.
 * Handles Windows vs Unix path differences.
 * @param {string} basePath - Base path to the python directory
 * @param {boolean} isWindows - Whether running on Windows
 * @returns {string} Path to Python executable
 */
function getPythonExecutable(basePath, isWindows) {
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
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file exists
 */
function fileExists(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if we need to use `sg input` to get /dev/input access on Linux.
 * Returns true if the user is in the 'input' group but the current session doesn't have it.
 * This happens when the user was added to the group but hasn't logged out/back in.
 */
function _needsInputGroupEscalation() {
    // Input group escalation is Linux-only
    if (process.platform !== 'linux') return false;
    try {
        // Check if current session already has input group
        const sessionGroups = execSync('id -Gn', { encoding: 'utf8' }).trim().split(/\s+/);
        if (sessionGroups.includes('input')) {
            return false; // Session already has it
        }

        // Check if user is in input group (in /etc/group) but session doesn't have it
        const userGroups = execSync(`groups ${process.env.USER || ''}`, { encoding: 'utf8' }).trim();
        if (userGroups.includes('input')) {
            // User is in group but session doesn't have it — sg will help
            return true;
        }

        // User isn't in the input group at all — sg won't help
        return false;
    } catch {
        return false;
    }
}

/**
 * Create a Python backend service instance.
 * @param {Object} options - Service options
 * @param {string} options.pythonDir - Path to Python backend directory
 * @param {string} options.dataDir - Path to data directory for images/inbox
 * @param {boolean} options.isWindows - Whether running on Windows
 * @param {Function} options.log - Logging function (level, message)
 * @returns {Object} Python backend service instance
 */
function createPythonBackend(options = {}) {
    const { pythonDir, dataDir, isWindows, log } = options;

    let pythonProcess = null;
    let onEventCallback = null;
    let onResponseIdCallback = null;  // For getting response IDs from displayedMessageIds

    /**
     * Handle JSON events from Python electron_bridge.py
     * @param {Object} event - Event object from Python
     */
    function handlePythonEvent(event) {
        const { event: eventType, data } = event;

        // Map Python events to UI events
        const eventMapping = {
            'starting': () => {
                console.log('[Python] Bridge starting...');
                return { type: 'starting' };
            },
            'ready': () => {
                console.log('[Python] Backend ready');
                return { type: 'ready' };
            },
            'wake_word': () => ({
                type: 'wake',
                model: data.model,
                score: data.score
            }),
            'recording_start': () => ({
                type: 'recording',
                subtype: data.type || 'normal'
            }),
            'recording_stop': () => ({ type: 'processing' }),
            'listening': () => ({ type: 'idle' }),
            'transcription': () => ({
                type: 'transcription',
                text: data.text,
                // Also include chat message data
                chatMessage: {
                    role: 'user',
                    text: data.text
                }
            }),
            'processing': () => ({
                type: 'thinking',
                source: data.source
            }),
            'response': () => {
                // Generate a unique ID for this response to prevent duplicates
                const responseId = `resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                // Notify caller about the response ID for deduplication tracking
                if (onResponseIdCallback) {
                    onResponseIdCallback(responseId);
                }
                return {
                    type: 'speaking',
                    chatMessage: {
                        role: 'assistant',
                        text: data.text,
                        source: data.source,
                        id: responseId
                    }
                };
            },
            'speaking_start': () => ({
                type: 'speaking',
                text: data.text
            }),
            'speaking_end': () => ({ type: 'idle' }),
            'call_start': () => ({ type: 'call_active' }),
            'call_end': () => ({ type: 'idle' }),
            'mode_change': () => ({
                type: 'mode_change',
                mode: data.mode
            }),
            'error': () => {
                console.error('[Python] Error:', data.message);
                return {
                    type: 'error',
                    message: data.message
                };
            },
            'pong': () => {
                console.log('[Python] Pong received');
                return null;  // No UI event needed
            },
            'sent_to_inbox': () => null  // No UI event needed
        };

        const handler = eventMapping[eventType];
        if (handler) {
            const uiEvent = handler();
            if (uiEvent && onEventCallback) {
                onEventCallback(uiEvent);
            }
        } else {
            console.log('[Python] Unknown event:', eventType, data);
        }
    }

    /**
     * Start the Python voice backend.
     * @returns {boolean} True if started successfully
     */
    function start() {
        if (pythonProcess) {
            console.log('[Python] Already running');
            return false;
        }

        const pythonPath = pythonDir || path.join(__dirname, '..', '..', 'python');
        const venvPython = getPythonExecutable(pythonPath, isWindows);

        // Verify Python executable exists before spawning
        if (!fileExists(venvPython)) {
            console.error('[Python] Executable not found:', venvPython);
            console.error('[Python] Please run: cd python && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt');
            if (onEventCallback) {
                onEventCallback({
                    type: 'error',
                    message: 'Python venv not found. Set up the python folder venv.'
                });
            }
            return false;
        }

        // Check if electron_bridge.py exists
        const bridgeScript = path.join(pythonPath, 'electron_bridge.py');
        const scriptToRun = fileExists(bridgeScript) ? 'electron_bridge.py' : 'voice_agent.py';

        if (log) {
            log('PYTHON', `Starting ${scriptToRun}`);
        }

        // Platform-specific spawn options
        const spawnOptions = {
            cwd: pythonPath,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            shell: isWindows
        };

        // On Linux, check if we need `sg input` for global hotkey access to /dev/input
        // This avoids requiring the user to log out/back in after being added to the input group
        if (!isWindows && process.platform === 'linux') {
            const needsSg = _needsInputGroupEscalation();
            if (needsSg) {
                if (log) log('PYTHON', 'Using sg input for /dev/input access (session missing input group)');
                // Spawn via: sg input -c "'path/to/python' 'script.py'"
                // Paths must be quoted because they may contain spaces
                const cmd = `'${venvPython}' '${scriptToRun}'`;
                pythonProcess = spawn('sg', ['input', '-c', cmd], spawnOptions);
            } else {
                pythonProcess = spawn(venvPython, [scriptToRun], spawnOptions);
            }
        } else {
            // On Windows: don't use shell: true with spawn — it causes cmd.exe quoting
            // issues with paths containing spaces. spawn() handles spaces fine when
            // executable and args are passed separately without shell wrapping.
            spawnOptions.shell = false;
            if (log) log('PYTHON', `Spawn: ${venvPython} -u ${scriptToRun} (cwd: ${spawnOptions.cwd})`);
            pythonProcess = spawn(venvPython, ['-u', scriptToRun], spawnOptions);
        }

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
                        handlePythonEvent(event);
                        continue;
                    }
                } catch (e) {
                    // Not JSON, handle as legacy text output
                }

                // Legacy text parsing (for voice_agent.py without bridge)
                console.log('[Python]', line);
                if (onEventCallback) {
                    if (line.includes('Wake word detected')) {
                        onEventCallback({ type: 'wake' });
                    } else if (line.includes('Recording')) {
                        onEventCallback({ type: 'recording' });
                    } else if (line.includes('Speaking')) {
                        onEventCallback({ type: 'speaking' });
                    } else if (line.includes('Listening')) {
                        onEventCallback({ type: 'idle' });
                    }
                }
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            console.error('[Python Error]', msg);
            if (log) log('PYTHON', `stderr: ${msg}`);
        });

        pythonProcess.on('error', (err) => {
            console.error(`[Python] Spawn error:`, err);
            if (log) log('PYTHON', `Spawn error: ${err.message}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`[Python] Process exited with code ${code}`);
            if (log) log('PYTHON', `Process exited with code ${code}`);
            pythonProcess = null;
            if (onEventCallback) {
                onEventCallback({ type: 'disconnected' });
            }
        });

        return true;
    }

    /**
     * Stop the Python backend.
     * @returns {boolean} True if stopped
     */
    function stop() {
        if (pythonProcess) {
            send({ command: 'stop' });
            pythonProcess.kill();
            pythonProcess = null;
            return true;
        }
        return false;
    }

    /**
     * Force kill the Python process (for shutdown).
     */
    function kill() {
        if (pythonProcess) {
            pythonProcess.kill('SIGKILL');
            pythonProcess = null;
        }
    }

    /**
     * Send a command to Python backend via stdin.
     * @param {Object} command - Command object to send
     * @returns {boolean} True if sent
     */
    function send(command) {
        if (pythonProcess && pythonProcess.stdin) {
            const json = JSON.stringify(command);
            pythonProcess.stdin.write(json + '\n');
            console.log('[Python] Sent command:', command.command || command.type);
            return true;
        } else {
            console.error('[Python] Cannot send command - not running');
            return false;
        }
    }

    /**
     * Send an image to Python backend for vision processing.
     * Falls back to saving image and creating an MCP inbox message if Python isn't running.
     * @param {Object} imageData - Image data { base64, filename, prompt }
     * @returns {Object} Result { sent: boolean, text?: string, imagePath?: string, error?: string }
     */
    async function sendImage(imageData) {
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

            console.log('[Python] Image sent to backend');
            return { sent: true };
        } else {
            // Save image and create proper MCP inbox message
            const { getDataDir } = require('./platform-paths');
            const contextMirrorDir = dataDir || getDataDir();
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

                console.log('[Python] Image saved to:', imagePath);

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

                console.log('[Python] Image message sent to inbox');

                return {
                    text: `Screenshot sent to Claude for analysis`,
                    imagePath: imagePath
                };
            } catch (err) {
                console.error('[Python] Failed to save image:', err);
                return { text: 'Failed to process image.', error: err.message };
            }
        }
    }

    /**
     * Check if Python backend is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return pythonProcess !== null;
    }

    /**
     * Get the Python process (for direct access if needed).
     * @returns {ChildProcess|null} The process or null
     */
    function getProcess() {
        return pythonProcess;
    }

    /**
     * Set callback for Python events.
     * @param {Function} callback - Callback function (event) => void
     */
    function onEvent(callback) {
        onEventCallback = callback;
    }

    /**
     * Set callback for response ID tracking (for deduplication).
     * @param {Function} callback - Callback function (responseId) => void
     */
    function onResponseId(callback) {
        onResponseIdCallback = callback;
    }

    /**
     * Speak text via TTS without entering conversation mode or touching inbox.
     * Used for system announcements (startup greeting, provider switch, etc.)
     * @param {string} text - Text to speak
     * @returns {boolean} True if sent
     */
    function systemSpeak(text) {
        return send({ command: 'system_speak', text });
    }

    return {
        start,
        stop,
        kill,
        send,
        sendImage,
        systemSpeak,
        isRunning,
        getProcess,
        onEvent,
        onResponseId
    };
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
                    console.log(`[Docker] Starting ${description}...`);
                    execSync(`docker start ${containerName}`, { timeout: 10000 });
                    console.log(`[Docker] ✓ ${description} started`);
                }
            }
        } catch (err) {
            // Silently ignore - Docker might not be installed or container doesn't exist
            // This is optional functionality
        }
    }
}

module.exports = {
    createPythonBackend,
    startDockerServices,
    getPythonExecutable,
    fileExists
};
