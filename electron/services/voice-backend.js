/**
 * Voice backend service for Voice Mirror Electron.
 * Manages the Rust voice-core subprocess (STT, TTS, wake word).
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createLogger } = require('./logger');
const logger = createLogger();

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
 * Find the voice-core binary path.
 * Checks packaged path first, then release build, then debug.
 * @param {string} projectRoot - Path to project root
 * @returns {string|null} Path to binary or null
 */
function findVoiceCoreBinary(projectRoot) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryName = `voice-core${ext}`;

    // Packaged app: resources/bin/voice-core(.exe)
    if (process.resourcesPath) {
        const packaged = path.join(process.resourcesPath, 'bin', binaryName);
        if (fileExists(packaged)) return packaged;
    }

    // Dev: voice-core/target/release/voice-core(.exe)
    const release = path.join(projectRoot, 'voice-core', 'target', 'release', binaryName);
    if (fileExists(release)) return release;

    // Dev: voice-core/target/debug/voice-core(.exe)
    const debug = path.join(projectRoot, 'voice-core', 'target', 'debug', binaryName);
    if (fileExists(debug)) return debug;

    return null;
}

/**
 * Create a voice backend service instance.
 * @param {Object} options - Service options
 * @param {string} options.projectRoot - Path to project root directory
 * @param {string} options.dataDir - Path to data directory for images/inbox
 * @param {boolean} options.isWindows - Whether running on Windows
 * @param {Function} options.log - Logging function (level, message)
 * @param {Function} options.getSenderName - Function returning current sender name
 * @returns {Object} Voice backend service instance
 */
function createVoiceBackend(options = {}) {
    const { projectRoot, dataDir, isWindows, log, getSenderName } = options;
    const _senderName = () => (getSenderName ? getSenderName() : 'user');

    let voiceProcess = null;
    let onEventCallback = null;
    let onResponseIdCallback = null;  // For getting response IDs from displayedMessageIds

    // Auto-restart state
    let restartAttempts = 0;
    let intentionalStop = false;
    let isStarting = false; // Guard against concurrent start attempts
    const MAX_RESTARTS = 3;
    const RESTART_DELAY = 8000; // 8 seconds

    /**
     * Handle JSON events from voice-core binary
     * @param {Object} event - Event object from voice-core
     */
    // Pending promise resolvers for request/response patterns
    const pendingRequests = new Map();
    let cachedAudioDevices = null;

    function handleVoiceEvent(event) {
        const { event: eventType, data } = event;

        // Resolve pending requests
        if (pendingRequests.has(eventType)) {
            const resolve = pendingRequests.get(eventType);
            pendingRequests.delete(eventType);
            resolve(data);
            return;
        }

        // Map voice-core events to UI events
        const eventMapping = {
            'starting': () => {
                logger.info('[Voice]', 'Backend starting...');
                return { type: 'starting' };
            },
            'loading': () => {
                logger.info('[Voice]', 'Loading:', data.step || '...');
                return { type: 'loading', message: data.step };
            },
            'ready': () => {
                logger.info('[Voice]', 'Backend ready');
                restartAttempts = 0;  // Reset on successful start
                isStarting = false;   // Process fully started, allow new start attempts
                // Pre-fetch audio devices on ready so they're cached for settings
                send({ command: 'list_audio_devices' });
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
            'mode_change': () => ({
                type: 'mode_change',
                mode: data.mode
            }),
            'dictation_start': () => ({ type: 'dictation_start' }),
            'dictation_stop': () => ({ type: 'dictation_stop' }),
            'dictation_result': () => ({
                type: 'dictation_result',
                text: data.text,
                success: data.success
            }),
            'error': () => {
                logger.error('[Voice]', 'Error:', data.message);
                return {
                    type: 'error',
                    message: data.message
                };
            },
            'pong': () => {
                logger.info('[Voice]', 'Pong received');
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
        } else if (eventType === 'audio_devices') {
            // Cache late-arriving audio device list
            cachedAudioDevices = data;
        } else if (eventType === 'config_updated') {
            // Config sync acknowledgment - no action needed
        } else {
            logger.info('[Voice]', 'Unknown event:', eventType);
        }
    }

    /**
     * Start the voice-core backend.
     * @returns {boolean} True if started successfully
     */
    function start() {
        if (voiceProcess) {
            logger.info('[Voice]', 'Already running');
            return false;
        }
        if (isStarting) {
            logger.info('[Voice]', 'Start already in progress');
            return false;
        }
        isStarting = true;

        const root = projectRoot || path.join(__dirname, '..', '..');
        const binaryPath = findVoiceCoreBinary(root);

        // Verify binary exists before spawning
        if (!binaryPath) {
            logger.error('[Voice]', 'voice-core binary not found');
            logger.error('[Voice]', 'Please build: cd voice-core && cargo build --release');
            if (onEventCallback) {
                onEventCallback({
                    type: 'error',
                    message: 'voice-core binary not found. Run: cd voice-core && cargo build --release'
                });
            }
            isStarting = false;
            return false;
        }

        if (log) {
            log('VOICE', `Starting voice-core: ${binaryPath}`);
        }

        const spawnOptions = {
            cwd: path.dirname(binaryPath),
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
        };

        voiceProcess = spawn(binaryPath, [], spawnOptions);

        // Note: isStarting is reset in 'ready' event handler or on process 'close'
        // NOT here, because spawn() returns immediately before the process is actually ready

        // Buffer for incomplete JSON lines
        let stdoutBuffer = '';

        voiceProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();

            // Prevent unbounded buffer growth (cap at 1MB)
            if (stdoutBuffer.length > 1024 * 1024) {
                logger.warn('[Voice]', 'stdout buffer exceeded 1MB, truncating');
                stdoutBuffer = stdoutBuffer.slice(-1024 * 512); // Keep last 512KB
            }

            // Process complete lines
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                // Parse as JSON event from voice-core
                try {
                    const event = JSON.parse(line);
                    if (event.event) {
                        handleVoiceEvent(event);
                        continue;
                    }
                } catch (e) {
                    // Not JSON — log as raw output
                }

                logger.info('[Voice]', line);
            }
        });

        voiceProcess.stderr.on('data', (data) => {
            const text = data.toString().trim();
            if (!text) return;
            // Parse each line individually — tracing may batch multiple lines
            for (const msg of text.split('\n')) {
                const line = msg.trim();
                if (!line) continue;
                if (line.includes(' ERROR ')) {
                    logger.error('[Voice]', 'stderr:', line);
                    if (log) log('ERROR', line);
                } else if (line.includes(' WARN ')) {
                    logger.warn('[Voice]', 'stderr:', line);
                    if (log) log('WARN', line);
                } else {
                    logger.info('[VOICE]', line);
                    if (log) log('VOICE', line);
                }
            }
        });

        voiceProcess.on('error', (err) => {
            logger.error('[Voice]', 'Spawn error:', err);
            if (log) log('VOICE', `Spawn error: ${err.message}`);
            isStarting = false; // Reset guard on spawn failure
            if (onEventCallback) onEventCallback({ type: "error", message: `Voice backend spawn failed: ${err.message}` });
        });

        voiceProcess.on('close', (code) => {
            logger.info('[Voice]', `Process exited with code ${code}`);
            if (log) log('VOICE', `Process exited with code ${code}`);
            voiceProcess = null;
            isStarting = false; // Allow new start attempts

            // Don't restart if intentionally stopped
            if (intentionalStop) {
                intentionalStop = false;
                if (onEventCallback) onEventCallback({ type: 'disconnected' });
                return;
            }

            // Attempt auto-restart on crash
            if (code !== 0 && restartAttempts < MAX_RESTARTS) {
                restartAttempts++;
                logger.info('[Voice]', `Attempting restart ${restartAttempts}/${MAX_RESTARTS}...`);
                if (log) log('VOICE', `Attempting restart ${restartAttempts}/${MAX_RESTARTS}`);
                if (onEventCallback) {
                    onEventCallback({
                        type: 'reconnecting',
                        attempt: restartAttempts,
                        maxAttempts: MAX_RESTARTS
                    });
                }
                setTimeout(() => start(), RESTART_DELAY);
            } else if (code !== 0 && restartAttempts >= MAX_RESTARTS) {
                logger.error('[Voice]', 'Max restart attempts reached');
                if (log) log('VOICE', 'Max restart attempts reached');
                if (onEventCallback) {
                    onEventCallback({ type: 'error', message: 'Voice backend failed after 3 restart attempts' });
                    onEventCallback({ type: 'restart_failed' });
                }
            } else {
                // Clean exit (code 0)
                if (onEventCallback) onEventCallback({ type: 'disconnected' });
            }
        });

        return true;
    }

    /**
     * Stop the voice backend.
     * @returns {boolean} True if stopped
     */
    function stop() {
        if (voiceProcess) {
            intentionalStop = true;  // Prevent auto-restart
            send({ command: 'stop' });
            // Give process 3 seconds to exit gracefully, then force kill
            const proc = voiceProcess;
            const killTimer = setTimeout(() => {
                try {
                    proc.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
                } catch { /* already exited */ }
            }, 3000);
            proc.on('close', () => clearTimeout(killTimer));
            // Don't kill immediately — let the 'stop' command trigger graceful exit.
            // The 3-second timeout above will force-kill if it doesn't exit in time.
            voiceProcess = null;
            return true;
        }
        return false;
    }

    /**
     * Restart the voice backend (manual restart, resets retry counter).
     * @returns {boolean} True if restart initiated
     */
    function restart() {
        restartAttempts = 0;  // Reset counter for manual restart
        intentionalStop = false;
        stop();
        setTimeout(() => start(), 1000);
        return true;
    }

    /**
     * Force kill the voice process (for shutdown).
     */
    function kill() {
        if (voiceProcess) {
            try {
                // SIGKILL not available on Windows; process.kill() uses TerminateProcess
                voiceProcess.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
            } catch (err) {
                logger.error('[Voice]', 'Kill error:', err.message);
            }
            voiceProcess = null;
        }
    }

    /**
     * Send a command to voice backend via stdin.
     * @param {Object} command - Command object to send
     * @returns {boolean} True if sent
     */
    function send(command) {
        if (voiceProcess && voiceProcess.stdin) {
            const json = JSON.stringify(command);
            voiceProcess.stdin.write(json + '\n');
            logger.info('[Voice]', 'Sent command:', command.command || command.type);
            return true;
        } else {
            logger.error('[Voice]', 'Cannot send command - not running');
            return false;
        }
    }

    /**
     * Send an image to voice backend for vision processing.
     * Falls back to saving image and creating an MCP inbox message if backend isn't running.
     * @param {Object} imageData - Image data { base64, filename, prompt }
     * @returns {Object} Result { sent: boolean, text?: string, imagePath?: string, error?: string }
     */
    async function sendImage(imageData) {
        const { base64, filename } = imageData;

        // Extract just the base64 data (remove data:image/png;base64, prefix)
        const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

        if (voiceProcess && voiceProcess.stdin) {
            // Send JSON command to backend via stdin
            const command = JSON.stringify({
                type: 'image',
                data: base64Data,
                filename: filename,
                prompt: imageData.prompt || "What's in this image?"
            });

            voiceProcess.stdin.write(command + '\n');

            logger.info('[Voice]', 'Image sent to backend');
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

                logger.info('[Voice]', 'Image saved to:', imagePath);

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
                    from: _senderName(),
                    message: imageData.prompt || "What's in this image?",
                    timestamp: new Date().toISOString(),
                    read_by: [],
                    thread_id: `voice-${Date.now()}`,
                    image_path: imagePath,
                    image_data_url: `data:image/png;base64,${base64Data}`
                };

                data.messages.push(newMessage);

                // Keep last 100 messages
                if (data.messages.length > 100) {
                    data.messages = data.messages.slice(-100);
                }

                fs.writeFileSync(inboxPath, JSON.stringify(data));

                // Also create trigger file to notify watchers
                const triggerPath = path.join(contextMirrorDir, 'claude_message_trigger.json');
                fs.writeFileSync(triggerPath, JSON.stringify({
                    from: _senderName(),
                    messageId: newMessage.id,
                    timestamp: newMessage.timestamp,
                    has_image: true,
                    image_path: imagePath
                }, null, 2));

                logger.info('[Voice]', 'Image message sent to inbox');

                return {
                    text: `Screenshot sent to Claude for analysis`,
                    imagePath: imagePath
                };
            } catch (err) {
                logger.error('[Voice]', 'Failed to save image:', err);
                return { text: 'Failed to process image.', error: err.message };
            }
        }
    }

    /**
     * Check if voice backend is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return voiceProcess !== null;
    }

    /**
     * Get the voice process (for direct access if needed).
     * @returns {ChildProcess|null} The process or null
     */
    function getProcess() {
        return voiceProcess;
    }

    /**
     * Set callback for voice events.
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

    /**
     * List available audio devices from voice backend.
     * @returns {Promise<{input: Array, output: Array}|null>}
     */
    function listAudioDevices() {
        if (!isRunning()) return Promise.resolve(cachedAudioDevices);

        // Return cache immediately if available
        if (cachedAudioDevices) return Promise.resolve(cachedAudioDevices);

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete('audio_devices');
                resolve(null);
            }, 10000);

            pendingRequests.set('audio_devices', (data) => {
                clearTimeout(timeout);
                cachedAudioDevices = data;
                resolve(data);
            });

            send({ command: 'list_audio_devices' });
        });
    }

    /**
     * Write Electron's voice config to voice_settings.json so voice-core reads correct settings on startup.
     * @param {Object} cfg - Application config
     */
    async function syncVoiceSettings(cfg) {
        try {
            const fsP = fs.promises;
            await fsP.mkdir(dataDir, { recursive: true });
            const settingsPath = path.join(dataDir, 'voice_settings.json');

            // Read existing settings to preserve location/timezone
            let existing = {};
            try {
                existing = JSON.parse(await fsP.readFile(settingsPath, 'utf-8'));
            } catch { /* ignore parse errors or missing file */ }

            // Merge Electron voice config into settings (camelCase -> snake_case)
            const voice = cfg?.voice || {};
            const behavior = cfg?.behavior || {};
            const updates = {};

            // TTS adapter settings
            if (voice.ttsAdapter) updates.tts_adapter = voice.ttsAdapter;
            if (voice.ttsVoice) updates.tts_voice = voice.ttsVoice;
            if (voice.ttsModelSize) updates.tts_model_size = voice.ttsModelSize;
            if (voice.ttsVolume !== undefined) updates.tts_volume = voice.ttsVolume;
            if (voice.ttsSpeed !== undefined) updates.tts_speed = voice.ttsSpeed;
            if (voice.ttsApiKey !== undefined) updates.tts_api_key = voice.ttsApiKey;
            if (voice.ttsEndpoint !== undefined) updates.tts_endpoint = voice.ttsEndpoint;
            if (voice.ttsModelPath !== undefined) updates.tts_model_path = voice.ttsModelPath;

            // STT adapter settings
            if (voice.sttModel) updates.stt_adapter = voice.sttModel;
            if (voice.sttAdapter) updates.stt_adapter = voice.sttAdapter;
            if (voice.sttApiKey !== undefined) updates.stt_api_key = voice.sttApiKey;
            if (voice.sttEndpoint !== undefined) updates.stt_endpoint = voice.sttEndpoint;
            if (voice.sttModelName !== undefined) updates.stt_model_name = voice.sttModelName;

            // Behavior / hotkey settings
            // Map Electron camelCase mode names to Rust snake_case equivalents
            if (behavior.activationMode) {
                const modeMap = { pushToTalk: 'ptt', wakeWord: 'wake_word' };
                updates.activation_mode = modeMap[behavior.activationMode] || behavior.activationMode;
            }
            if (behavior.pttKey !== undefined) updates.ptt_key = behavior.pttKey;
            if (behavior.dictationKey !== undefined) updates.dictation_key = behavior.dictationKey;

            // Audio device settings
            if (voice.inputDevice !== undefined) updates.input_device = voice.inputDevice;
            if (voice.outputDevice !== undefined) updates.output_device = voice.outputDevice;

            // User settings (lowercase to match inbox watcher sender name)
            if (cfg?.user?.name !== undefined) updates.user_name = cfg.user.name ? cfg.user.name.toLowerCase() : null;

            const merged = { ...existing, ...updates };
            await fsP.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
            logger.info('[Voice]', 'Synced voice settings to', settingsPath);
        } catch (err) {
            logger.error('[Voice]', 'Failed to sync voice settings:', err.message);
        }
    }

    return {
        start,
        stop,
        restart,
        kill,
        send,
        sendImage,
        systemSpeak,
        listAudioDevices,
        syncVoiceSettings,
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
    const { execFileSync: dockerExec } = require('child_process');

    // Check if Docker is available first
    try {
        dockerExec('docker', ['--version'], { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' });
    } catch {
        return; // Docker not installed - skip silently
    }

    // Docker containers to start (name -> description)
    const services = {
        'searxng': 'SearXNG (web search)',
        'n8n': 'n8n (workflow automation)'
    };

    for (const [containerName, description] of Object.entries(services)) {
        try {
            // Check if container exists
            const allContainers = dockerExec('docker', ['ps', '-a', '--format', '{{.Names}}'], {
                encoding: 'utf-8',
                timeout: 5000,
                stdio: 'pipe'
            }).trim();
            const exists = allContainers.split('\n').includes(containerName);

            if (exists) {
                // Check if it's running
                const runningContainers = dockerExec('docker', ['ps', '--format', '{{.Names}}'], {
                    encoding: 'utf-8',
                    timeout: 5000
                }).trim();
                const running = runningContainers.split('\n').includes(containerName);

                if (!running) {
                    logger.info('[Docker]', `Starting ${description}...`);
                    dockerExec('docker', ['start', containerName], { timeout: 10000 });
                    logger.info('[Docker]', `${description} started`);
                }
            }
        } catch (err) {
            // Silently ignore - Docker might not be installed or container doesn't exist
            // This is optional functionality
        }
    }
}

module.exports = {
    createVoiceBackend,
    startDockerServices
};
