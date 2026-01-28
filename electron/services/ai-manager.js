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
    const { getConfig, onOutput, onVoiceEvent, onToolCall, onToolResult, onProviderSwitch } = options;

    let activeProvider = null;  // Current OpenAI-compatible provider instance

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
    function startClaudeCode() {
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
        const pty = spawnClaude({
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
    function start() {
        const config = getConfig();
        const providerType = config?.ai?.provider || 'claude';
        const model = config?.ai?.model || null;

        console.log(`[AIManager] Starting AI provider: ${providerType}${model ? ' (' + model + ')' : ''}`);

        // Check if already running
        if (providerType === 'claude') {
            // Claude uses the existing PTY-based system
            if (isClaudeRunning()) {
                console.log('[AIManager] Claude already running');
                return false;
            }
            startClaudeCode();
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

        // Map provider type to alternative API key names (check both)
        const apiKeyAltMap = {
            gemini: 'google',  // gemini keys can be under 'gemini' or 'google'
            grok: 'xai'        // grok keys can be under 'grok' or 'xai'
        };
        const altKeyName = apiKeyAltMap[providerType];

        // Try provider name first, then alternative name, then env var
        const apiKey = apiKeys[providerType] ||
                       (altKeyName && apiKeys[altKeyName]) ||
                       process.env[`${providerType.toUpperCase()}_API_KEY`] ||
                       (altKeyName && process.env[`${altKeyName.toUpperCase()}_API_KEY`]) ||
                       undefined;

        // Create provider instance
        activeProvider = createProvider(providerType, {
            model: model,
            baseUrl: endpoints[providerType] || undefined,
            apiKey: apiKey
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
        }).catch((err) => {
            console.error(`[AIManager] Failed to start ${providerType}:`, err);
            sendOutput('stderr', `[Error] Failed to start ${providerType}: ${err.message}\n`);
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
        if (activeProvider && activeProvider.isRunning()) {
            const name = activeProvider.getDisplayName();
            activeProvider.stop();
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

        if (providerType === 'claude') {
            // Claude uses PTY input
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

        if (providerType === 'claude' && isClaudeRunning()) {
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

        if (providerType === 'claude' && isClaudeRunning()) {
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
