/**
 * AI provider manager service for Voice Mirror Electron.
 * Manages both Claude Code PTY and OpenAI-compatible providers.
 */

const {
    spawnClaude,
    stopClaude,
    sendInput,
    sendRawInput,
    sendInputWhenReady,
    isClaudeRunning,
    isClaudeAvailable,
    resizePty
} = require('../providers/claude-spawner');

const { CLI_PROVIDERS } = require('../constants');
const { createProvider } = require('../providers');
const { ensureLocalLLMRunning: _ensureLocalLLMRunning } = require('../lib/ollama-launcher');

const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger');
const logger = createLogger();

// Path to MCP server (same as claude-spawner.js)
const MCP_SERVER_PATH = path.join(__dirname, '..', '..', 'mcp-server', 'index.js');

/**
 * Configure MCP server for OpenCode.
 * Writes opencode.json to the Voice Mirror project root with the MCP
 * server entry so OpenCode's AI model can use voice I/O tools.
 */
async function configureOpenCodeMCP(appConfig) {
    const profileName = appConfig?.ai?.toolProfile || 'voice-assistant';
    const profiles = appConfig?.ai?.toolProfiles || {};
    const groups = profiles[profileName]?.groups || ['core', 'meta', 'screen', 'memory'];
    const enabledGroups = groups.join(',');

    logger.info('[AIManager]', `OpenCode MCP tool profile: "${profileName}" - groups: ${enabledGroups}`);

    const openCodeConfig = {
        mcp: {
            'voice-mirror-electron': {
                type: 'local',
                command: ['node', MCP_SERVER_PATH, '--enabled-groups', enabledGroups],
                environment: { ENABLED_GROUPS: enabledGroups },
                enabled: true
            }
        }
    };

    const configPath = path.join(__dirname, '..', '..', 'opencode.json');
    try {
        // Merge with existing config if present
        let existing = {};
        try {
            existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch { /* no existing config */ }

        existing.mcp = existing.mcp || {};
        existing.mcp['voice-mirror-electron'] = openCodeConfig.mcp['voice-mirror-electron'];

        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
        logger.info('[AIManager]', `OpenCode MCP config written to ${configPath}`);
    } catch (err) {
        logger.error('[AIManager]', 'Failed to write OpenCode MCP config:', err.message);
    }
}

/**
 * Create an AI manager service instance.
 * @param {Object} options - Service options
 * @param {Function} options.getConfig - Function to get current app config
 * @param {Function} options.onOutput - Callback for terminal output
 * @param {Function} options.onVoiceEvent - Callback for voice events
 * @param {Function} options.onToolCall - Callback for tool calls
 * @param {Function} options.onToolResult - Callback for tool results
 * @param {Function} options.onProviderSwitch - Callback when provider is switched (clear message IDs)
 * @returns {Object} AI manager service instance
 */
function createAIManager(options = {}) {
    const { getConfig, onOutput, onVoiceEvent, onToolCall, onToolResult, onProviderSwitch, onSystemSpeak, getActivationHint } = options;

    let activeProvider = null;  // Current OpenAI-compatible provider instance
    let hasStartedOnce = false; // Track initial startup vs provider switch
    let cliSpawner = null;      // CLI spawner for non-Claude PTY providers (OpenCode, etc.)
    let outputGated = false;    // When true, sendOutput drops all events (set during provider switch)

    /**
     * Send output to the terminal UI.
     * Gated during provider switches to prevent stale PTY output from reaching the renderer.
     */
    function sendOutput(type, text) {
        if (outputGated && type !== 'start') {
            // During provider switch, only allow 'start' events through (from new provider)
            return;
        }
        if (type === 'start') {
            outputGated = false;  // New provider started — re-enable output
        }
        if (onOutput) {
            onOutput({ type, text });
        }
    }

    /**
     * Send voice event to the UI.
     */
    function sendVoiceEvent(event) {
        if (onVoiceEvent) {
            onVoiceEvent(event);
        }
    }

    /**
     * Start Claude Code with Voice Mirror MCP tools.
     * Spawns a real PTY terminal running Claude Code.
     */
    async function startClaudeCode(cols, rows) {
        if (isClaudeRunning()) {
            logger.info('[AIManager]', 'Claude already running');
            return;
        }

        logger.info('[AIManager]', 'Starting Claude Code PTY...');

        // Check if Claude CLI is available
        if (!isClaudeAvailable()) {
            logger.error('[AIManager]', 'Claude CLI not found!');
            sendOutput('stderr', '[Claude Code] Not found - install with: npm install -g @anthropic-ai/claude-code\n');
            return;
        }

        // Spawn Claude in a real PTY terminal (pass config for tool profile)
        const appConfig = getConfig ? getConfig() : {};
        const pty = await spawnClaude({
            onOutput: (data) => {
                // Forward PTY output to the UI terminal
                sendOutput('stdout', data);
            },
            onExit: (code) => {
                logger.info('[AIManager]', 'Claude PTY exited with code:', code);
                sendOutput('exit', code);
                sendVoiceEvent({ type: 'claude_disconnected' });
            },
            cols: cols || 120,
            rows: rows || 30,
            appConfig
        });

        if (pty) {
            sendOutput('start', '[Claude Code] PTY terminal started\n');
            sendVoiceEvent({
                type: 'claude_connected',
                provider: 'claude',
                providerName: 'Claude Code',
                model: null
            });
            logger.info('[AIManager]', 'Claude PTY started');

            // Wait for Claude TUI to be ready, then send voice mode command
            const senderName = (appConfig.user?.name || 'user').toLowerCase();
            const customPrompt = appConfig.ai?.systemPrompt;

            // Build the full prompt: custom persona (if any) + voice mode instructions
            let voicePrompt = '';
            if (customPrompt) {
                voicePrompt += `${customPrompt}\n\n`;
            }
            voicePrompt += `Use claude_listen to wait for voice input from ${senderName}, then reply with claude_send. Loop forever.\n`;

            sendInputWhenReady(voicePrompt, 20000)
                .then(() => {
                    logger.info('[AIManager]', 'Voice mode command sent successfully');
                })
                .catch((err) => {
                    logger.error('[AIManager]', 'Failed to send voice mode command:', err.message);
                    // Fallback: try sending anyway after a delay
                    setTimeout(() => {
                        if (isClaudeRunning()) {
                            sendInput(voicePrompt + '\r');
                            logger.info('[AIManager]', 'Sent voice mode command (fallback)');
                        }
                    }, 8000);
                });
        } else {
            sendOutput('stderr', '[Claude Code] Failed to start PTY\n');
        }
    }

    /**
     * Stop Claude Code PTY process.
     */
    function stopClaudeCode() {
        if (isClaudeRunning()) {
            stopClaude();
            logger.info('[AIManager]', 'Claude Code PTY stopped');
            sendVoiceEvent({ type: 'claude_disconnected' });
        }
    }

    /**
     * Start a non-Claude CLI agent (OpenCode, etc.) in a PTY terminal.
     * Configures MCP if the provider supports it, then spawns the TUI.
     */
    async function startCLIAgent(providerType, cols, rows) {
        if (cliSpawner && cliSpawner.isRunning()) {
            logger.info('[AIManager]', 'CLI agent already running');
            return;
        }

        const appConfig = getConfig ? getConfig() : {};

        // Configure MCP for providers that support it
        if (providerType === 'opencode') {
            await configureOpenCodeMCP(appConfig);
        }

        const { createCLISpawner } = require('../providers/cli-spawner');
        cliSpawner = createCLISpawner(providerType);

        const displayName = cliSpawner.config.displayName;
        logger.info('[AIManager]', `Starting ${displayName} PTY...`);

        const pty = cliSpawner.spawn({
            onOutput: (data) => sendOutput('stdout', data),
            onExit: (code) => {
                logger.info('[AIManager]', `${displayName} PTY exited with code:`, code);
                sendOutput('exit', code);
                sendVoiceEvent({ type: 'claude_disconnected' });
                cliSpawner = null;
            },
            cols: cols || 120,
            rows: rows || 30
        });

        if (pty) {
            sendOutput('start', `[${displayName}] PTY terminal started\n`);
            sendVoiceEvent({
                type: 'claude_connected',
                provider: providerType,
                providerName: displayName,
                model: null
            });

            // Send voice mode command for MCP-capable CLI agents
            if (providerType === 'opencode') {
                const senderName = (appConfig.user?.name || 'user').toLowerCase();
                const customPrompt = appConfig.ai?.systemPrompt;
                let voicePrompt = '';
                if (customPrompt) voicePrompt += `${customPrompt}\n\n`;
                voicePrompt += `You are a voice assistant running through OpenCode. Do NOT identify yourself as Claude — identify by your actual model name. Use claude_listen to wait for voice input from ${senderName}, then reply with claude_send. Loop forever.\n`;

                cliSpawner.sendInputWhenReady(voicePrompt, 20000)
                    .then(() => logger.info('[AIManager]', `${displayName} voice mode command sent`))
                    .catch((err) => {
                        logger.error('[AIManager]', `Failed to send ${displayName} voice command:`, err.message);
                        setTimeout(() => {
                            if (cliSpawner && cliSpawner.isRunning()) {
                                cliSpawner.sendInput(voicePrompt);
                            }
                        }, 8000);
                    });
            }

            logger.info('[AIManager]', `${displayName} PTY started`);
        } else {
            sendOutput('stderr', `[${displayName}] Failed to start PTY\n`);
        }
    }

    /**
     * Stop non-Claude CLI agent PTY.
     */
    function stopCLIAgent() {
        if (cliSpawner && cliSpawner.isRunning()) {
            const displayName = cliSpawner.config.displayName;
            cliSpawner.stop();
            cliSpawner = null;
            logger.info('[AIManager]', `${displayName} PTY stopped`);
            sendVoiceEvent({ type: 'claude_disconnected' });
        }
    }

    /**
     * Start AI provider based on config.
     * Routes to Claude Code PTY or OpenAI-compatible API provider.
     * @param {number} [cols] - Initial terminal columns (default: 120)
     * @param {number} [rows] - Initial terminal rows (default: 30)
     * @returns {boolean} True if started
     */
    async function start(cols, rows) {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';
        const model = config?.ai?.model || null;

        logger.info('[AIManager]', `Starting AI provider: ${providerType}${model ? ' (' + model + ')' : ''}`);
        const isSwitch = hasStartedOnce;
        hasStartedOnce = true;

        // Defensive: stop any stale provider from a different type before starting
        // This handles the case where stop() wasn't called or didn't fully clean up
        if (CLI_PROVIDERS.includes(providerType)) {
            // About to start CLI — kill any leftover API provider
            if (activeProvider) {
                logger.info('[AIManager]', 'Cleaning up stale API provider before CLI start');
                try { if (activeProvider.isRunning()) activeProvider.stop(); } catch (e) { /* ignore */ }
                activeProvider = null;
            }
        } else {
            // About to start API — kill any leftover CLI providers
            if (isClaudeRunning()) {
                logger.info('[AIManager]', 'Cleaning up stale Claude PTY before API start');
                stopClaudeCode();
            }
            if (cliSpawner && cliSpawner.isRunning()) {
                logger.info('[AIManager]', 'Cleaning up stale CLI agent before API start');
                stopCLIAgent();
            }
        }

        // Check if already running
        if (CLI_PROVIDERS.includes(providerType)) {
            if (providerType === 'claude') {
                // Claude Code uses its own dedicated PTY spawner
                if (isClaudeRunning()) {
                    logger.info('[AIManager]', 'Claude already running');
                    return false;
                }
                await startClaudeCode(cols, rows);
                if (isSwitch && onSystemSpeak) {
                    const hint = getActivationHint ? ` ${getActivationHint()}` : '';
                    setTimeout(() => onSystemSpeak(`Claude is online.${hint}`), 3000);
                }
            } else {
                // Non-Claude CLI agents (OpenCode, Codex, Gemini CLI, Kimi CLI)
                if (cliSpawner && cliSpawner.isRunning()) {
                    logger.info('[AIManager]', `${providerType} already running`);
                    return false;
                }
                await startCLIAgent(providerType, cols, rows);
                if (isSwitch && onSystemSpeak) {
                    const displayName = cliSpawner?.config?.displayName || providerType;
                    const hint = getActivationHint ? ` ${getActivationHint()}` : '';
                    setTimeout(() => onSystemSpeak(`${displayName} is online.${hint}`), 3000);
                }
            }
            return true;
        }

        // For non-Claude providers, use the OpenAI-compatible provider
        if (activeProvider && activeProvider.isRunning()) {
            logger.info('[AIManager]', `${providerType} already running`);
            return false;
        }

        // Get provider config (endpoints, API keys)
        const endpoints = config?.ai?.endpoints || {};
        const apiKeys = config?.ai?.apiKeys || {};

        // Env var names that differ from provider type (e.g. grok uses XAI_API_KEY)
        const envVarAltMap = {
            grok: 'XAI_API_KEY',
            gemini: 'GOOGLE_API_KEY'
        };

        // Try config key first, then standard env var, then alternative env var
        const apiKey = apiKeys[providerType] ||
                       process.env[`${providerType.toUpperCase()}_API_KEY`] ||
                       process.env[envVarAltMap[providerType]] ||
                       undefined;

        // Create provider instance
        activeProvider = createProvider(providerType, {
            model: model,
            baseUrl: endpoints[providerType] || undefined,
            apiKey: apiKey,
            contextLength: config?.ai?.contextLength || 32768,
            systemPrompt: config?.ai?.systemPrompt || null
        });

        // Set up output handlers
        activeProvider.on('output', (data) => {
            sendOutput(data.type, data.text);
        });

        // Set up tool callbacks for local providers
        if (activeProvider.setToolCallbacks) {
            activeProvider.setToolCallbacks(
                // onToolCall - when a tool is being executed
                (data) => {
                    logger.info('[AIManager]', `Tool call: ${data.tool}`);
                    if (onToolCall) {
                        onToolCall({
                            tool: data.tool,
                            args: data.args,
                            iteration: data.iteration
                        });
                    }
                },
                // onToolResult - when a tool execution completes
                (data) => {
                    logger.info('[AIManager]', `Tool result: ${data.tool} - ${data.success ? 'success' : 'failed'}`);
                    if (onToolResult) {
                        onToolResult({
                            tool: data.tool,
                            success: data.success,
                            result: data.result
                        });
                    }
                }
            );
        }

        // Start the provider (pass terminal dimensions so TUI renders at correct size)
        activeProvider.spawn({ cols, rows }).then(() => {
            sendOutput('start', `[${activeProvider.getDisplayName()}] Ready\n`);
            sendVoiceEvent({
                type: 'claude_connected',
                provider: providerType,
                providerName: activeProvider.getDisplayName(),
                model: model
            });

            // Pass TTS/STT engine info to TUI if active
            if (activeProvider.tui) {
                const voiceConfig = config?.voice || {};
                if (voiceConfig.ttsAdapter) activeProvider.tui.updateInfo('ttsEngine', voiceConfig.ttsAdapter);
                if (voiceConfig.sttAdapter) activeProvider.tui.updateInfo('sttEngine', voiceConfig.sttAdapter);
            }

            // Log if tools are enabled
            if (activeProvider.supportsTools && activeProvider.supportsTools()) {
                logger.info('[AIManager]', `Tool support enabled for ${providerType}`);
            }

            // Announce provider switch via TTS
            if (isSwitch && onSystemSpeak) {
                const displayName = activeProvider.getDisplayName();
                const hint = getActivationHint ? ` ${getActivationHint()}` : '';
                onSystemSpeak(`${displayName} is online.${hint}`);
            }
        }).catch((err) => {
            logger.error('[AIManager]', `Failed to start ${providerType}:`, err);
            sendOutput('stderr', `[Error] Failed to start ${providerType}: ${err.message}\n`);
            activeProvider = null; // Clear broken provider
            if (isSwitch && onSystemSpeak) {
                onSystemSpeak(`System check failed. ${providerType} is not responding.`);
            }
        });

        return true;
    }

    /**
     * Stop the active AI provider.
     * Stops whatever is actually running, not based on config.
     * @returns {boolean} True if something was stopped
     */
    function stop() {
        // Gate output FIRST — prevents any stale PTY data from reaching the renderer
        // while the old provider is dying and before the new one starts.
        outputGated = true;

        let stopped = false;

        // Always try to stop Claude PTY if it's running
        if (isClaudeRunning()) {
            stopClaudeCode();
            stopped = true;
            logger.info('[AIManager]', 'Stopped Claude Code PTY');
        }

        // Stop non-Claude CLI agent if running
        if (cliSpawner && cliSpawner.isRunning()) {
            stopCLIAgent();
            stopped = true;
        }

        // Also stop OpenAI-compatible provider if running
        if (activeProvider) {
            const name = activeProvider.getDisplayName();
            try {
                if (activeProvider.isRunning()) {
                    activeProvider.stop();
                }
            } catch (err) {
                logger.error('[AIManager]', `Error stopping ${name}:`, err.message);
            }
            activeProvider = null;
            logger.info('[AIManager]', `Stopped ${name}`);
            stopped = true;
        }

        if (stopped) {
            // Notify about provider switch (for clearing message IDs)
            if (onProviderSwitch) {
                onProviderSwitch();
            }
            logger.info('[AIManager]', 'Provider stopped');

            sendVoiceEvent({ type: 'claude_disconnected' });
        }

        return stopped;
    }

    /**
     * Interrupt the active AI provider's current operation.
     * For PTY providers: sends Ctrl+C. For API providers: aborts the HTTP request.
     * Does NOT stop the provider or clear history.
     * @returns {boolean} True if an interrupt was sent
     */
    function interrupt() {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';

        if (CLI_PROVIDERS.includes(providerType)) {
            if (isClaudeRunning()) {
                sendRawInput('\x03');
                logger.info('[AIManager]', 'Sent Ctrl+C to Claude PTY');

                const senderName = (getConfig()?.user?.name || 'user').toLowerCase();
                sendInputWhenReady(`Use claude_listen to wait for voice input from ${senderName}, then reply with claude_send. Loop forever.\n`, 10000)
                    .then(() => logger.info('[AIManager]', 'Resumed voice listening after interrupt'))
                    .catch(() => {});

                return true;
            }
            if (cliSpawner && cliSpawner.isRunning()) {
                cliSpawner.sendRawInput('\x03');
                logger.info('[AIManager]', 'Sent Ctrl+C to CLI agent PTY');

                // Re-send voice loop for MCP-capable CLI agents
                if (providerType === 'opencode') {
                    const senderName = (getConfig()?.user?.name || 'user').toLowerCase();
                    cliSpawner.sendInputWhenReady(`You are a voice assistant running through OpenCode. Do NOT identify yourself as Claude — identify by your actual model name. Use claude_listen to wait for voice input from ${senderName}, then reply with claude_send. Loop forever.\n`, 10000)
                        .then(() => logger.info('[AIManager]', 'Resumed voice listening after interrupt'))
                        .catch(() => {});
                }

                return true;
            }
            return false;
        }

        if (activeProvider && activeProvider.isRunning() && activeProvider.interrupt) {
            return activeProvider.interrupt();
        }

        return false;
    }

    /**
     * Check if AI provider is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        // Check if Claude PTY is running
        if (isClaudeRunning()) {
            return true;
        }

        // Check if non-Claude CLI agent is running
        if (cliSpawner && cliSpawner.isRunning()) {
            return true;
        }

        // Check if OpenAI-compatible provider is running
        if (activeProvider && activeProvider.isRunning()) {
            return true;
        }

        return false;
    }

    /**
     * Send text input to the active AI provider.
     * @param {string} text - Text to send
     * @returns {boolean} True if sent
     */
    function sendTextInput(text) {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';

        if (CLI_PROVIDERS.includes(providerType)) {
            // Claude uses its own PTY
            if (isClaudeRunning()) {
                sendInput(text);
                return true;
            }
            // Non-Claude CLI agents
            if (cliSpawner && cliSpawner.isRunning()) {
                cliSpawner.sendInput(text);
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
     * Send raw input to the active AI provider (for PTY).
     * @param {string} data - Raw data to send
     * @returns {boolean} True if sent
     */
    function sendRawInputData(data) {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';

        if (CLI_PROVIDERS.includes(providerType)) {
            if (isClaudeRunning()) {
                sendRawInput(data);
                return true;
            }
            if (cliSpawner && cliSpawner.isRunning()) {
                cliSpawner.sendRawInput(data);
                return true;
            }
        }

        // For non-PTY providers, buffer input
        if (activeProvider && activeProvider.isRunning()) {
            // Buffer input (backspace handling, etc.)
            // This is handled in the IPC handler currently
            return true;
        }

        return false;
    }

    /**
     * Resize the PTY terminal.
     * @param {number} cols - Number of columns
     * @param {number} rows - Number of rows
     */
    function resize(cols, rows) {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';

        if (CLI_PROVIDERS.includes(providerType)) {
            if (isClaudeRunning()) {
                resizePty(cols, rows);
            } else if (cliSpawner && cliSpawner.isRunning()) {
                cliSpawner.resize(cols, rows);
            }
        }
    }

    /**
     * Get the active provider instance.
     * @returns {Object|null} The active provider or null
     */
    function getProvider() {
        return activeProvider;
    }

    /**
     * Get display name for the current provider.
     * @returns {string} Display name
     */
    function getDisplayName() {
        if (isClaudeRunning()) {
            return 'Claude Code';
        }
        if (cliSpawner && cliSpawner.isRunning()) {
            return cliSpawner.config.displayName;
        }
        if (activeProvider) {
            return activeProvider.getDisplayName();
        }
        return 'None';
    }

    /**
     * Check if current provider supports tools.
     * @returns {boolean} True if tools supported
     */
    function supportsTools() {
        if (activeProvider && activeProvider.supportsTools) {
            return activeProvider.supportsTools();
        }
        // Claude always supports tools via MCP
        if (isClaudeRunning()) {
            return true;
        }
        // OpenCode supports tools via MCP
        if (cliSpawner && cliSpawner.isRunning()) {
            return true;
        }
        return false;
    }

    /**
     * Ensure a local LLM server is running for the given provider.
     * Delegates to ollama-launcher for Ollama.
     */
    function ensureLocalLLMRunning() {
        const config = getConfig();
        const providerName = config?.ai?.provider || 'claude';
        _ensureLocalLLMRunning(providerName, config);
    }

    return {
        start,
        stop,
        interrupt,
        isRunning,
        sendTextInput,
        sendRawInputData,
        resize,
        getProvider,
        getDisplayName,
        supportsTools,
        ensureLocalLLMRunning,
        // Expose Claude-specific functions for backward compatibility
        isClaudeRunning,
        isClaudeAvailable
    };
}

module.exports = {
    createAIManager
};
