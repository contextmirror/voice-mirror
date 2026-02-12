/**
 * Claude Code Spawner for Voice Mirror Electron
 *
 * Spawns a REAL interactive Claude Code terminal using node-pty.
 * Claude runs with a system prompt to use claude_listen for voice input.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Path to MCP server
const MCP_SERVER_PATH = path.join(__dirname, '..', 'mcp-server', 'index.js');

// Claude settings directories (write to all for compatibility across Claude Code versions)
// Project-level .claude/ takes priority in Claude Code, so we must include it
const PROJECT_CLAUDE_DIR = path.join(__dirname, '..', '.claude');
const CLAUDE_CONFIG_DIRS = [
    PROJECT_CLAUDE_DIR,
    path.join(os.homedir(), '.claude'),
    ...(process.platform === 'linux' ? [path.join(os.homedir(), '.config', 'claude-code')] : [])
];
const CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIRS[0];
const MCP_SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, 'mcp_settings.json');

// Voice Mirror working directory
const VOICE_MIRROR_DIR = path.join(__dirname, '..', 'python');

// Data directory (cross-platform)
function _getDataDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'voice-mirror-electron', 'data');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'voice-mirror-electron', 'data');
    }
    return path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
}
const DATA_DIR = _getDataDir();
const INBOX_PATH = path.join(DATA_DIR, 'inbox.json');

/**
 * System prompt for Voice Mirror's Claude
 */
function getVoiceSystemPrompt() {
    try {
        const config = require('./config');
        const userName = config.get('user.name') || 'user';
        return `Use claude_listen to wait for voice input from ${userName}, then reply with claude_send. Loop forever.`;
    } catch {
        return `Use claude_listen to wait for voice input from user, then reply with claude_send. Loop forever.`;
    }
}
const VOICE_CLAUDE_SYSTEM = getVoiceSystemPrompt();

let ptyProcess = null;
let outputCallback = null;
let readyCallbacks = [];
let isReady = false;
let spawnGeneration = 0;  // Monotonic counter — bumped on spawn and stop to gate stale callbacks

// Debug logging to file
const DEBUG_LOG_PATH = path.join(_getDataDir(), '..', 'claude-spawner-debug.log');
function debugLog(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    // Only write to debug log file, not console (reduces startup noise)
    try {
        fs.appendFileSync(DEBUG_LOG_PATH, line);
    } catch (e) {}
}

/**
 * Configure MCP server for Claude Code.
 * Reads the active tool profile from config and passes ENABLED_GROUPS
 * to the MCP server so it only registers the selected tool groups.
 */
const fsPromises = fs.promises;

async function configureMCPServer(appConfig) {
    // Resolve enabled groups from active tool profile
    const profileName = appConfig?.ai?.toolProfile || 'voice-assistant';
    const profiles = appConfig?.ai?.toolProfiles || {};
    const groups = profiles[profileName]?.groups || ['core', 'meta', 'screen', 'memory'];
    const enabledGroups = groups.join(',');

    console.log(`[Claude Spawner] Tool profile: "${profileName}" → groups: ${enabledGroups}`);

    const serverEntry = {
        command: 'node',
        args: [MCP_SERVER_PATH, '--enabled-groups', enabledGroups],
        env: {
            ENABLED_GROUPS: enabledGroups
        },
        disabled: false
    };

    // Helper: read existing MCP settings or return default
    async function readMcpSettings(filePath) {
        try {
            const content = await fsPromises.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return { mcpServers: {} };
        }
    }

    // Write to all config directories in parallel for cross-version compatibility
    const writePromises = [];

    let writtenCount = 0;
    for (const configDir of CLAUDE_CONFIG_DIRS) {
        await fsPromises.mkdir(configDir, { recursive: true });

        for (const filename of ['mcp_settings.json', '.mcp.json']) {
            const settingsPath = path.join(configDir, filename);
            writePromises.push(
                readMcpSettings(settingsPath).then(settings => {
                    settings.mcpServers = settings.mcpServers || {};
                    settings.mcpServers['voice-mirror-electron'] = serverEntry;
                    return fsPromises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
                        .then(() => { writtenCount++; });
                })
            );
        }
    }

    // Also write .mcp.json to the project root (Voice Mirror working directory)
    const projectMcpPath = path.join(VOICE_MIRROR_DIR, '.mcp.json');
    writePromises.push(
        readMcpSettings(projectMcpPath).then(existing => {
            const projectSettings = {
                mcpServers: { ...existing.mcpServers, 'voice-mirror-electron': serverEntry }
            };
            return fsPromises.writeFile(projectMcpPath, JSON.stringify(projectSettings, null, 2), 'utf-8')
                .then(() => { writtenCount++; });
        })
    );

    await Promise.all(writePromises);
    console.log(`[Claude Spawner] MCP settings written to ${writtenCount} locations`);
}

/**
 * Configure claude-pulse status line for Claude Code.
 * Writes the statusLine entry to ~/.claude/settings.json so Claude Code
 * shows usage bars in the terminal. Also installs slash commands.
 */
async function configureStatusLine() {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const scriptPath = path.join(__dirname, '..', 'vendor', 'claude-pulse', 'claude_status.py');

    // Only configure if the bundled script exists
    if (!fs.existsSync(scriptPath)) {
        debugLog('claude-pulse script not found, skipping status line config');
        return;
    }

    const pythonExe = path.join(__dirname, '..', 'python', '.venv',
        process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');

    // Read existing settings
    let settings = {};
    try {
        const content = await fsPromises.readFile(settingsPath, 'utf-8');
        settings = JSON.parse(content);
    } catch { /* file doesn't exist or invalid JSON — start fresh */ }

    // Skip if statusLine already points to a claude_status.py (user configured it)
    if (settings.statusLine?.command?.includes('claude_status.py')) {
        debugLog('statusLine already configured for claude-pulse, skipping');
    } else {
        settings.statusLine = {
            type: 'command',
            command: `"${pythonExe}" "${scriptPath}"`,
            refresh: 150
        };
        await fsPromises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        console.log('[Claude Spawner] claude-pulse status line configured');
    }

    // Install slash commands (if not already present)
    const commandsDir = path.join(os.homedir(), '.claude', 'commands');
    await fsPromises.mkdir(commandsDir, { recursive: true });

    for (const cmd of ['pulse.md', 'setup.md']) {
        const dest = path.join(commandsDir, cmd);
        if (!fs.existsSync(dest)) {
            const src = path.join(__dirname, '..', 'vendor', 'claude-pulse', 'commands', cmd);
            if (fs.existsSync(src)) {
                await fsPromises.copyFile(src, dest);
                debugLog(`Installed slash command: ${cmd}`);
            }
        }
    }
}

/**
 * Check if Claude CLI is available.
 * Returns the resolved path on success, or null if not found.
 */
let _resolvedClaudePath = null;

function isClaudeAvailable() {
    // Return cached result if we already resolved successfully
    if (_resolvedClaudePath) return true;

    try {
        const { execFileSync } = require('child_process');
        if (process.platform === 'win32') {
            // Try claude.cmd first (npm global), then claude.exe, then claude
            for (const name of ['claude.cmd', 'claude.exe', 'claude']) {
                try {
                    const result = execFileSync('where', [name], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
                    // `where` can return multiple lines; take the first
                    const firstLine = result.split(/\r?\n/)[0].trim();
                    if (firstLine && fs.existsSync(firstLine)) {
                        _resolvedClaudePath = firstLine;
                        debugLog(`Resolved Claude CLI path: ${_resolvedClaudePath}`);
                        return true;
                    }
                } catch { /* try next */ }
            }
            _resolvedClaudePath = null;
            return false;
        } else {
            const result = execFileSync('which', ['claude'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
            if (result) {
                _resolvedClaudePath = result;
                return true;
            }
            return false;
        }
    } catch {
        _resolvedClaudePath = null;
        return false;
    }
}

/**
 * Spawn Claude Code in a real PTY terminal
 */
async function spawnClaude(options = {}) {
    const {
        onOutput = () => {},
        onExit = () => {},
        cols = 120,
        rows = 30
    } = options;

    outputCallback = onOutput;

    if (ptyProcess) {
        console.log('[Claude Spawner] Already running');
        return ptyProcess;
    }

    // Configure MCP server with tool profile from config
    await configureMCPServer(options.appConfig);

    // Configure claude-pulse status line
    await configureStatusLine();

    if (!isClaudeAvailable()) {
        onOutput('[Error] Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code\n');
        return null;
    }

    // Lazy load node-pty (native module)
    let pty;
    try {
        pty = require('node-pty');
    } catch (err) {
        onOutput(`[Error] Failed to load node-pty: ${err.message}\n`);
        return null;
    }

    // Use the resolved full path from isClaudeAvailable()
    const claudeCmd = _resolvedClaudePath || 'claude';
    debugLog(`Using Claude command: ${claudeCmd}`);

    // Start Claude interactively - shows full TUI
    // Voice prompt is injected via PTY after TUI loads (see main.js sendInputWhenReady)
    const claudeArgs = [
        '--dangerously-skip-permissions'
    ];

    console.log('[Claude Spawner] Spawning Claude Code PTY...');
    onOutput('[Claude] Starting interactive session...\n');

    try {
        // Reset ready state and bump generation for this spawn session
        isReady = false;
        readyCallbacks = [];
        spawnGeneration++;
        const myGen = spawnGeneration;

        ptyProcess = pty.spawn(claudeCmd, claudeArgs, {
            name: 'xterm-256color',
            cols: cols,
            rows: rows,
            cwd: VOICE_MIRROR_DIR,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                VOICE_MIRROR_SESSION: 'true'  // Flag for hooks to identify this session
            }
        });

        // Buffer to detect ready state
        let outputBuffer = '';

        ptyProcess.onData((data) => {
            // Drop output from a stale PTY session (killed but still flushing buffers)
            if (myGen !== spawnGeneration) return;

            // Send raw data to terminal (preserves ANSI codes for proper rendering)
            onOutput(data);

            // Accumulate output to detect ready state
            outputBuffer += data;

            // Claude Code TUI is ready when we see the input prompt
            // The TUI shows a ">" prompt or similar when ready to accept input
            // Also detect "What would you like to do?" or initial prompt patterns
            if (!isReady) {
                // Look for patterns indicating Claude is ready for input
                // The TUI typically shows ">" or has a visible prompt area
                // We can detect this by looking for certain ANSI sequences or text
                const hasPrompt = outputBuffer.includes('>') ||
                                  outputBuffer.includes('What would you like') ||
                                  outputBuffer.includes('How can I help') ||
                                  outputBuffer.length > 500;  // Fallback: enough output received

                if (hasPrompt) {
                    isReady = true;
                    debugLog(`TUI ready detected. Buffer length: ${outputBuffer.length}`);

                    // Call all waiting callbacks
                    debugLog(`Calling ${readyCallbacks.length} ready callbacks`);
                    readyCallbacks.forEach(cb => {
                        try {
                            cb();
                        } catch (err) {
                            debugLog(`Ready callback error: ${err}`);
                        }
                    });
                    readyCallbacks = [];
                }
            }
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[Claude Spawner] Exited with code ${exitCode}, signal ${signal}`);
            // Always clean up internal state
            ptyProcess = null;
            // Only forward output/exit events if this is still the active session
            if (myGen !== spawnGeneration) return;
            onOutput(`\n[Claude] Process exited (code: ${exitCode})\n`);
            onExit(exitCode);
        });

        console.log('[Claude Spawner] PTY spawned successfully');
        return ptyProcess;

    } catch (err) {
        console.error('[Claude Spawner] Failed to spawn:', err);
        onOutput(`[Error] Failed to spawn Claude: ${err.message}\n`);
        return null;
    }
}

/**
 * Send raw input to the Claude PTY (keyboard passthrough from terminal)
 * Passes through keystrokes directly without modification
 */
function sendRawInput(data) {
    if (ptyProcess) {
        ptyProcess.write(data);
    }
}

/**
 * Send a complete message to the Claude PTY
 * Strips trailing newlines and adds Enter key after a delay
 * Use this for programmatic message sending, not for raw keyboard input
 */
function sendInput(text) {
    if (ptyProcess) {
        // Strip trailing newlines - we'll send Enter separately
        const cleanText = text.replace(/[\r\n]+$/g, '');
        debugLog(`Sending input to PTY: "${cleanText.slice(0, 60)}..." (${cleanText.length} chars)`);

        // Write the text first (without Enter)
        ptyProcess.write(cleanText);
        debugLog('Text written to PTY');

        // Small delay then send Enter key separately
        // This ensures the TUI has processed all characters before we submit
        setTimeout(() => {
            if (ptyProcess) {
                debugLog('Sending Enter key (\\r)');
                ptyProcess.write('\r');
                debugLog('Enter key sent');
            }
        }, 100);
    } else {
        debugLog('ERROR: Cannot send input - PTY not running');
    }
}

/**
 * Send input when Claude is ready
 * Waits for TUI to be ready before sending
 */
function sendInputWhenReady(text, timeout = 15000) {
    debugLog(`sendInputWhenReady called. isReady=${isReady}, timeout=${timeout}`);
    return new Promise((resolve, reject) => {
        if (!ptyProcess) {
            debugLog('ERROR: PTY not running in sendInputWhenReady');
            reject(new Error('PTY not running'));
            return;
        }

        if (isReady) {
            // Already ready, send immediately
            debugLog('Already ready, sending immediately');
            sendInput(text);
            resolve(true);
            return;
        }

        debugLog('Waiting for TUI to be ready...');

        // Set up timeout
        const timeoutId = setTimeout(() => {
            debugLog(`TIMEOUT: Still not ready after ${timeout}ms`);
            // Remove from callbacks
            const idx = readyCallbacks.indexOf(sendCallback);
            if (idx > -1) readyCallbacks.splice(idx, 1);
            reject(new Error('Timeout waiting for Claude TUI'));
        }, timeout);

        // Callback when ready
        const sendCallback = () => {
            debugLog('Ready callback triggered, clearing timeout');
            clearTimeout(timeoutId);
            // Small delay after ready detection to ensure TUI is fully loaded
            debugLog('Waiting 500ms before sending...');
            setTimeout(() => {
                debugLog('Delay complete, sending input now');
                sendInput(text);
                resolve(true);
            }, 500);
        };

        readyCallbacks.push(sendCallback);
        debugLog(`Added callback, now ${readyCallbacks.length} callbacks waiting`);
    });
}

/**
 * Check if Claude TUI is ready for input
 */
function isClaudeReady() {
    return isReady;
}

/**
 * Stop the Claude PTY process
 */
function stopClaude() {
    // Bump generation FIRST — invalidates onData/onExit callbacks from the dying PTY
    spawnGeneration++;
    if (ptyProcess) {
        console.log('[Claude Spawner] Stopping...');
        ptyProcess.kill();
        ptyProcess = null;
    }
    readyCallbacks = [];
    isReady = false;
}

/**
 * Check if Claude is running
 */
function isClaudeRunning() {
    return ptyProcess !== null;
}

/**
 * Resize the PTY
 */
function resizePty(cols, rows) {
    if (ptyProcess) {
        ptyProcess.resize(cols, rows);
    }
}

/**
 * Write a response to the inbox (for manual/fallback use)
 */
function writeResponseToInbox(message) {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load existing messages
    let data = { messages: [] };
    if (fs.existsSync(INBOX_PATH)) {
        try {
            data = JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
            if (!data.messages) data.messages = [];
        } catch {}
    }

    // Create new message
    const newMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: 'voice-claude',
        message: message,
        timestamp: new Date().toISOString(),
        read_by: [],
        thread_id: 'voice-mirror'
    };

    data.messages.push(newMessage);

    // Keep last 100 messages
    if (data.messages.length > 100) {
        data.messages = data.messages.slice(-100);
    }

    fs.writeFileSync(INBOX_PATH, JSON.stringify(data), 'utf-8');
    return newMessage;
}

module.exports = {
    spawnClaude,
    stopClaude,
    sendInput,
    sendRawInput,
    sendInputWhenReady,
    isClaudeRunning,
    isClaudeReady,
    resizePty,
    configureMCPServer,
    isClaudeAvailable,
    writeResponseToInbox,
    VOICE_CLAUDE_SYSTEM
};
