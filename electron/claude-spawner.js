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

// Claude settings directory (Claude Code uses ~/.config/claude-code on Linux)
const CLAUDE_CONFIG_DIR = process.platform === 'linux'
    ? path.join(os.homedir(), '.config', 'claude-code')
    : path.join(os.homedir(), '.claude');
const MCP_SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, 'mcp_settings.json');

// Voice Mirror working directory
const VOICE_MIRROR_DIR = path.join(__dirname, '..', 'python');

// Data directory
const DATA_DIR = path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
const INBOX_PATH = path.join(DATA_DIR, 'inbox.json');

/**
 * System prompt for Voice Mirror's Claude
 */
const VOICE_CLAUDE_SYSTEM = `Use claude_listen to wait for voice input from nathan, then reply with claude_send. Loop forever.`;

let ptyProcess = null;
let outputCallback = null;
let readyCallbacks = [];
let isReady = false;

// Debug logging to file
const DEBUG_LOG_PATH = path.join(os.homedir(), '.config', 'voice-mirror-electron', 'claude-spawner-debug.log');
function debugLog(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    console.log('[Claude Spawner]', msg);
    try {
        fs.appendFileSync(DEBUG_LOG_PATH, line);
    } catch (e) {}
}

/**
 * Configure MCP server for Claude Code
 */
function configureMCPServer() {
    // Ensure config directory exists
    if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
        fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
    }

    // Load existing settings or create new
    let settings = { mcpServers: {} };
    if (fs.existsSync(MCP_SETTINGS_PATH)) {
        try {
            settings = JSON.parse(fs.readFileSync(MCP_SETTINGS_PATH, 'utf-8'));
        } catch {}
    }

    // Add/update voice-mirror-electron server
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers['voice-mirror-electron'] = {
        command: 'node',
        args: [MCP_SERVER_PATH],
        env: {},
        disabled: false
    };

    fs.writeFileSync(MCP_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[Claude Spawner] MCP settings configured');
}

/**
 * Check if Claude CLI is available
 */
function isClaudeAvailable() {
    const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    try {
        const { execSync } = require('child_process');
        execSync(`which ${claudePath}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Spawn Claude Code in a real PTY terminal
 */
function spawnClaude(options = {}) {
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

    // Configure MCP server
    configureMCPServer();

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

    const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';

    // Start Claude interactively - shows full TUI
    // Voice prompt is injected via PTY after TUI loads (see main.js sendInputWhenReady)
    const claudeArgs = [
        '--dangerously-skip-permissions'
    ];

    console.log('[Claude Spawner] Spawning Claude Code PTY...');
    onOutput('[Claude] Starting interactive session...\n');

    try {
        // Reset ready state
        isReady = false;
        readyCallbacks = [];

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
            // Send raw data to xterm.js (preserves ANSI codes for proper rendering)
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
            onOutput(`\n[Claude] Process exited (code: ${exitCode})\n`);
            ptyProcess = null;
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
 * Send raw input to the Claude PTY (for xterm.js keyboard input)
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
    if (ptyProcess) {
        console.log('[Claude Spawner] Stopping...');
        ptyProcess.kill();
        ptyProcess = null;
    }
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

    fs.writeFileSync(INBOX_PATH, JSON.stringify(data, null, 2), 'utf-8');
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
