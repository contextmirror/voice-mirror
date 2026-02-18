/**
 * Generic CLI Spawner for Voice Mirror Electron
 *
 * Spawns interactive CLI tools (Claude Code, Codex, Gemini CLI, etc.)
 * in a node-pty terminal. Extracted from claude-spawner.js to support
 * multiple CLI-based AI providers.
 */

const path = require('path');
const fs = require('fs');
const { getDataDir } = require('../services/platform-paths');
const { createLogger } = require('../services/logger');
const { buildFilteredEnv } = require('../lib/filtered-env');
const logger = createLogger();

// Debug logging
const DEBUG_LOG_PATH = path.join(getDataDir(), '..', 'cli-spawner-debug.log');
function debugLog(label, msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${label}] ${msg}\n`;
    logger.debug(`[CLI Spawner:${label}]`, msg);
    // Async write to debug log file (non-blocking, fire-and-forget)
    fs.promises.appendFile(DEBUG_LOG_PATH, line).catch(() => {});
}

/**
 * CLI configuration map
 * Each entry defines the command, args, and patterns to detect readiness.
 */
const CLI_CONFIGS = {
    codex: {
        command: 'codex',
        args: [],
        readyPatterns: ['>', 'What', 'How can'],
        displayName: 'OpenAI Codex'
    },
    'gemini-cli': {
        command: 'gemini',
        args: [],
        readyPatterns: ['>', 'What', 'How can'],
        displayName: 'Gemini CLI'
    },
    'kimi-cli': {
        command: 'kimi',
        args: [],
        readyPatterns: ['>', 'What', 'How can'],
        displayName: 'Kimi CLI'
    },
    opencode: {
        command: 'opencode',
        args: [],
        readyPatterns: ['>', 'What', 'How can', 'help'],
        displayName: 'OpenCode',
        instructionsDir: '.opencode'
    }
};

/**
 * Check if a CLI tool is available on the system
 * @param {string} command - The command to check
 * @returns {boolean}
 */
function isCLIAvailable(command) {
    try {
        const { execFileSync } = require('child_process');
        const which = process.platform === 'win32' ? 'where' : 'which';
        execFileSync(which, [command], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Create a CLI spawner instance for a given CLI type.
 *
 * @param {string} cliType - Key into CLI_CONFIGS (e.g. 'codex', 'gemini-cli')
 * @returns {Object} Spawner interface with spawn, stop, sendInput, etc.
 */
function createCLISpawner(cliType) {
    const config = CLI_CONFIGS[cliType];
    if (!config) {
        throw new Error(`Unknown CLI type: ${cliType}`);
    }

    const label = cliType;
    let ptyProcess = null;
    let isReady = false;
    let readyCallbacks = [];
    let spawnGeneration = 0;  // Monotonic counter — bumped on spawn and stop to gate stale callbacks

    function spawn(options = {}) {
        const {
            onOutput = () => {},
            onExit = () => {},
            cols = 120,
            rows = 30,
            cwd,
            appConfig
        } = options;

        if (ptyProcess) {
            debugLog(label, 'Already running');
            return ptyProcess;
        }

        let command = config.command;
        if (process.platform === 'win32') {
            // Try .cmd first (npm global scripts), fall back to bare name
            try {
                require('child_process').execFileSync('where', [`${config.command}.cmd`], { stdio: 'ignore' });
                command = `${config.command}.cmd`;
            } catch {
                // Leave as bare command — pty.spawn will search PATH
            }
        }

        if (!isCLIAvailable(command)) {
            onOutput(`[Error] ${config.displayName} CLI not found. Ensure "${config.command}" is installed and on your PATH.\n`);
            return null;
        }

        let pty;
        try {
            pty = require('node-pty');
        } catch (err) {
            onOutput(`[Error] Failed to load node-pty: ${err.message}\n`);
            return null;
        }

        const spawnCwd = cwd || process.cwd();

        // Write Voice Mirror instructions for CLI agents that support instruction files
        if (config.instructionsDir && appConfig) {
            try {
                const { buildGenericInstructions } = require('./claude-instructions');
                const instructions = buildGenericInstructions({
                    providerName: config.displayName,
                    userName: appConfig.user?.name || 'User',
                    enabledGroups: appConfig.ai?.toolProfile
                        ? (appConfig.ai.toolProfiles?.[appConfig.ai.toolProfile]?.groups || []).join(',') || 'core,meta'
                        : 'core,meta',
                    appVersion: require('../../package.json').version,
                });
                const instrDir = path.join(spawnCwd, config.instructionsDir);
                if (!fs.existsSync(instrDir)) fs.mkdirSync(instrDir, { recursive: true });
                fs.writeFileSync(path.join(instrDir, 'instructions.md'), instructions, 'utf8');
                debugLog(label, `Wrote instructions to ${instrDir}/instructions.md`);
            } catch (err) {
                debugLog(label, `Failed to write instructions: ${err.message}`);
            }
        }

        debugLog(label, `Spawning ${config.displayName} PTY...`);
        onOutput(`[${config.displayName}] Starting interactive session...\n`);

        try {
            isReady = false;
            readyCallbacks = [];
            spawnGeneration++;
            const myGen = spawnGeneration;

            ptyProcess = pty.spawn(command, config.args, {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: spawnCwd,
                env: buildFilteredEnv({
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor'
                })
            });

            let outputBuffer = '';

            ptyProcess.onData((data) => {
                // Drop output from a stale PTY session (killed but still flushing buffers)
                if (myGen !== spawnGeneration) return;

                onOutput(data);
                outputBuffer += data;

                if (!isReady) {
                    const hasPrompt = config.readyPatterns.some(p => outputBuffer.includes(p)) ||
                                      outputBuffer.length > 500;
                    if (hasPrompt) {
                        isReady = true;
                        debugLog(label, `TUI ready. Buffer length: ${outputBuffer.length}`);
                        outputBuffer = ''; // Free the buffer immediately
                        readyCallbacks.forEach(cb => {
                            try { cb(); } catch (err) {
                                debugLog(label, `Ready callback error: ${err}`);
                            }
                        });
                        readyCallbacks = [];
                    }
                }
            });

            ptyProcess.onExit(({ exitCode, signal }) => {
                debugLog(label, `Exited code=${exitCode} signal=${signal}`);
                // Always clean up internal state
                ptyProcess = null;
                isReady = false;
                // Only forward output/exit events if this is still the active session
                if (myGen !== spawnGeneration) return;
                onOutput(`\n[${config.displayName}] Process exited (code: ${exitCode})\n`);
                onExit(exitCode);
            });

            debugLog(label, 'PTY spawned successfully');
            return ptyProcess;
        } catch (err) {
            debugLog(label, `Failed to spawn: ${err}`);
            onOutput(`[Error] Failed to spawn ${config.displayName}: ${err.message}\n`);
            return null;
        }
    }

    function stop() {
        // Bump generation FIRST — invalidates onData/onExit callbacks from the dying PTY
        spawnGeneration++;
        if (ptyProcess) {
            debugLog(label, 'Stopping...');
            ptyProcess.kill();
            ptyProcess = null;
            isReady = false;
        }
        readyCallbacks = [];
    }

    function sendRawInput(data) {
        if (ptyProcess) {
            ptyProcess.write(data);
        }
    }

    function sendInput(text) {
        if (ptyProcess) {
            const cleanText = text.replace(/[\r\n]+$/g, '');
            debugLog(label, `Sending input: "${cleanText.slice(0, 60)}..." (${cleanText.length} chars)`);
            ptyProcess.write(cleanText);
            setTimeout(() => {
                if (ptyProcess) ptyProcess.write('\r');
            }, 100);
        }
    }

    function sendInputWhenReady(text, timeout = 15000) {
        return new Promise((resolve, reject) => {
            if (!ptyProcess) {
                reject(new Error('PTY not running'));
                return;
            }
            if (isReady) {
                sendInput(text);
                resolve(true);
                return;
            }

            const timeoutId = setTimeout(() => {
                const idx = readyCallbacks.indexOf(sendCallback);
                if (idx > -1) readyCallbacks.splice(idx, 1);
                reject(new Error(`Timeout waiting for ${config.displayName} TUI`));
            }, timeout);

            const sendCallback = () => {
                clearTimeout(timeoutId);
                setTimeout(() => {
                    sendInput(text);
                    resolve(true);
                }, 500);
            };

            readyCallbacks.push(sendCallback);
        });
    }

    function resize(cols, rows) {
        if (ptyProcess) ptyProcess.resize(cols, rows);
    }

    function isRunning() {
        return ptyProcess !== null;
    }

    function getIsReady() {
        return isReady;
    }

    return {
        spawn,
        stop,
        sendRawInput,
        sendInput,
        sendInputWhenReady,
        resize,
        isRunning,
        isReady: getIsReady,
        config
    };
}

module.exports = {
    createCLISpawner,
    isCLIAvailable,
    CLI_CONFIGS
};
