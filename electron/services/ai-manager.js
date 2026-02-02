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
} = require('../claude-spawner');

// CLI agent providers that use PTY mode
const CLI_PROVIDERS = ['claude', 'codex', 'gemini-cli'];
const { createProvider } = require('../providers');

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

    /**
     * Send output to the terminal UI.
     */
    function sendOutput(type, text) {
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
    async function startClaudeCode() {
        if (isClaudeRunning()) {
            console.log('[AIManager] Claude already running');
            return;
        }

        console.log('[AIManager] Starting Claude Code PTY...');

        // Check if Claude CLI is available
        if (!isClaudeAvailable()) {
            console.error('[AIManager] Claude CLI not found!');
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
                console.log('[AIManager] Claude PTY exited with code:', code);
                sendOutput('exit', code);
                sendVoiceEvent({ type: 'claude_disconnected' });
            },
            cols: 120,
            rows: 30,
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
            console.log('[AIManager] Claude PTY started');

            // Wait for Claude TUI to be ready, then send voice mode command
            const voicePrompt = 'Use claude_listen to wait for voice input from nathan, then reply with claude_send. Loop forever.\n';
            sendInputWhenReady(voicePrompt, 20000)
                .then(() => {
                    console.log('[AIManager] Voice mode command sent successfully');
                })
                .catch((err) => {
                    console.error('[AIManager] Failed to send voice mode command:', err.message);
                    // Fallback: try sending anyway after a delay
                    setTimeout(() => {
                        if (isClaudeRunning()) {
                            sendInput(voicePrompt + '\r');
                            console.log('[AIManager] Sent voice mode command (fallback)');
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
            console.log('[AIManager] Claude Code PTY stopped');
            sendVoiceEvent({ type: 'claude_disconnected' });
        }
    }

    /**
     * Start AI provider based on config.
     * Routes to Claude Code PTY or OpenAI-compatible API provider.
     * @returns {boolean} True if started
     */
    async function start() {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';
        const model = config?.ai?.model || config?.ai?.localModel || null;

        console.log(`[AIManager] Starting AI provider: ${providerType}${model ? ' (' + model + ')' : ''}`);
        const isSwitch = hasStartedOnce;
        hasStartedOnce = true;

        // Defensive: stop any stale provider from a different type before starting
        // This handles the case where stop() wasn't called or didn't fully clean up
        if (CLI_PROVIDERS.includes(providerType)) {
            // About to start CLI — kill any leftover API provider
            if (activeProvider) {
                console.log('[AIManager] Cleaning up stale API provider before CLI start');
                try { if (activeProvider.isRunning()) activeProvider.stop(); } catch (e) { /* ignore */ }
                activeProvider = null;
            }
        } else {
            // About to start API — kill any leftover CLI provider
            if (isClaudeRunning()) {
                console.log('[AIManager] Cleaning up stale Claude PTY before API start');
                stopClaudeCode();
            }
        }

        // Check if already running
        if (CLI_PROVIDERS.includes(providerType)) {
            // CLI providers use PTY-based system (currently only Claude Code implemented)
            if (isClaudeRunning()) {
                console.log('[AIManager] Claude already running');
                return false;
            }
            await startClaudeCode();
            if (isSwitch && onSystemSpeak) {
                // Delay to let PTY initialize
                const hint = getActivationHint ? ` ${getActivationHint()}` : '';
                setTimeout(() => onSystemSpeak(`Claude is online.${hint}`), 3000);
            }
            return true;
        }

        // For non-Claude providers, use the OpenAI-compatible provider
        if (activeProvider && activeProvider.isRunning()) {
            console.log(`[AIManager] ${providerType} already running`);
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
            contextLength: config?.ai?.contextLength || 32768
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
                    console.log(`[AIManager] Tool call: ${data.tool}`);
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
                    console.log(`[AIManager] Tool result: ${data.tool} - ${data.success ? 'success' : 'failed'}`);
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

        // Start the provider
        activeProvider.spawn().then(() => {
            sendOutput('start', `[${activeProvider.getDisplayName()}] Ready\n`);
            sendVoiceEvent({
                type: 'claude_connected',
                provider: providerType,
                providerName: activeProvider.getDisplayName(),
                model: model
            });

            // Log if tools are enabled
            if (activeProvider.supportsTools && activeProvider.supportsTools()) {
                console.log(`[AIManager] Tool support enabled for ${providerType}`);
            }

            // Announce provider switch via TTS
            if (isSwitch && onSystemSpeak) {
                const displayName = activeProvider.getDisplayName();
                const hint = getActivationHint ? ` ${getActivationHint()}` : '';
                onSystemSpeak(`${displayName} is online.${hint}`);
            }
        }).catch((err) => {
            console.error(`[AIManager] Failed to start ${providerType}:`, err);
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
        let stopped = false;

        // Always try to stop Claude PTY if it's running
        if (isClaudeRunning()) {
            stopClaudeCode();
            stopped = true;
            console.log('[AIManager] Stopped Claude Code PTY');
        }

        // Also stop OpenAI-compatible provider if running
        if (activeProvider) {
            const name = activeProvider.getDisplayName();
            try {
                if (activeProvider.isRunning()) {
                    activeProvider.stop();
                }
            } catch (err) {
                console.error(`[AIManager] Error stopping ${name}:`, err.message);
            }
            activeProvider = null;
            console.log(`[AIManager] Stopped ${name}`);
            stopped = true;
        }

        if (stopped) {
            // Notify about provider switch (for clearing message IDs)
            if (onProviderSwitch) {
                onProviderSwitch();
            }
            console.log('[AIManager] Provider stopped');

            sendVoiceEvent({ type: 'claude_disconnected' });
        }

        return stopped;
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
            // CLI providers use PTY input
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
     * Send raw input to the active AI provider (for PTY).
     * @param {string} data - Raw data to send
     * @returns {boolean} True if sent
     */
    function sendRawInputData(data) {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';

        if (CLI_PROVIDERS.includes(providerType) && isClaudeRunning()) {
            sendRawInput(data);
            return true;
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

        if (CLI_PROVIDERS.includes(providerType) && isClaudeRunning()) {
            resizePty(cols, rows);
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
        return false;
    }

    return {
        start,
        stop,
        isRunning,
        sendTextInput,
        sendRawInputData,
        resize,
        getProvider,
        getDisplayName,
        supportsTools,
        // Expose Claude-specific functions for backward compatibility
        isClaudeRunning,
        isClaudeAvailable
    };
}

module.exports = {
    createAIManager
};
