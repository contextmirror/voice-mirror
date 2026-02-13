/**
 * File logging service for Voice Mirror Electron.
 * Writes color-coded, structured logs to vmr.log in the config data directory.
 *
 * Categories: APP, CONFIG, PYTHON, CLAUDE, EVENT, ERROR, LOG,
 *             UI, BACKEND, TOOL, PTT, TTS, IPC
 */

const fs = require('fs');
const path = require('path');

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
    BRIGHT_RED: '\x1b[91m',
    BRIGHT_GREEN: '\x1b[92m',
    BRIGHT_YELLOW: '\x1b[93m',
    BRIGHT_CYAN: '\x1b[96m',
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
    // Dev log categories
    'UI': [Colors.BRIGHT_CYAN, '📱'],
    'BACKEND': [Colors.BLUE, '📡'],
    'TOOL': [Colors.BRIGHT_YELLOW, '⚡'],
    'PTT': [Colors.MAGENTA, '🎤'],
    'TTS': [Colors.GREEN, '🔊'],
    'IPC': [Colors.DIM, '↔'],
};

// Category padding for aligned output
const CAT_PAD = 8;

/**
 * Create a logger instance.
 * @param {Object} options - Logger options
 * @param {string} options.dataDir - Directory to store log file (defaults to ~/.config/voice-mirror-electron/data)
 * @returns {Object} Logger instance
 */
function createLogger(options = {}) {
    let logFile = null;
    let logFilePath = null;

    /**
     * Initialize the log file.
     */
    function init() {
        try {
            const { getDataDir } = require('./platform-paths');
            const dataDir = options.dataDir || getDataDir();

            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            logFilePath = path.join(dataDir, 'vmr.log');
            // Truncate log file on startup (keep it fresh each session)
            logFile = fs.createWriteStream(logFilePath, { flags: 'w' });
            log('APP', 'Voice Mirror started');
        } catch (err) {
            console.error('Failed to init log file:', err);
        }
    }

    /**
     * Write a log message with color-coded output.
     * @param {string} level - Log category
     * @param {string} message - Message to log
     */
    function log(level, message) {
        const now = new Date();
        const timestamp = now.toTimeString().slice(0, 8); // HH:MM:SS
        const [color, icon] = LOG_STYLES[level] || [Colors.WHITE, '•'];
        const cat = `[${level}]`.padEnd(CAT_PAD);

        const logLine = `${Colors.DIM}[${timestamp}]${Colors.RESET} ${color}${cat} ${icon} ${message}${Colors.RESET}`;

        if (level === 'ERROR') {
            console.error(logLine);
        } else {
            console.log(logLine);
        }

        if (logFile) {
            logFile.write(logLine + '\n');
        }
    }

    /**
     * Structured dev log for tracking event flow with correlation.
     * @param {string} category - Category: UI, BACKEND, TOOL, PTT, TTS, IPC
     * @param {string} action - What happened (e.g., "card-rendered", "response-captured")
     * @param {Object} data - Contextual data
     * @param {string} [data.msgId] - Message ID for correlation
     * @param {string} [data.text] - Message text (logged up to 200 chars)
     * @param {string} [data.role] - user | assistant
     * @param {string} [data.source] - Provider name
     * @param {string} [data.tool] - Tool name
     * @param {boolean} [data.success] - Tool success
     * @param {number} [data.duration] - Duration in ms
     * @param {number} [data.chars] - Character count
     * @param {string} [data.reason] - Why something happened (e.g., dedup reason)
     */
    function devlog(category, action, data = {}) {
        const parts = [action];

        if (data.role) parts.push(data.role);
        if (data.text) {
            const preview = data.text.length > 200
                ? `"${data.text.slice(0, 200)}..."`
                : `"${data.text}"`;
            parts.push(preview);
        }
        if (data.source) parts.push(data.source);
        if (data.tool) parts.push(data.tool);
        if (data.success !== undefined) parts.push(data.success ? '→ success' : '→ failed');
        if (data.duration !== undefined) parts.push(`(${data.duration}ms)`);
        if (data.chars !== undefined) parts.push(`(${data.chars} chars)`);
        if (data.reason) parts.push(`[${data.reason}]`);
        if (data.msgId) parts.push(`| ${data.msgId}`);

        log(category, parts.join(' | '));
    }

    /**
     * Close the log file.
     */
    function close() {
        if (logFile) {
            logFile.end();
            logFile = null;
        }
    }

    return {
        init,
        log,
        devlog,
        close
    };
}

module.exports = {
    createLogger
};
