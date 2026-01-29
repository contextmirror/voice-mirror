/**
 * OpenAI Provider - OpenAI-compatible API provider
 *
 * Supports local providers (Ollama, LM Studio, Jan) and cloud providers
 * (OpenAI, Groq, xAI, Mistral, OpenRouter, DeepSeek) via OpenAI-compatible API.
 *
 * Unlike Claude provider, this does NOT use a PTY terminal - it communicates
 * via HTTP API calls.
 *
 * For local providers, includes tool support via JSON output format.
 */

const { BaseProvider } = require('./base-provider');
const { ToolExecutor } = require('../tools');

// Limit conversation history to prevent context overflow in local LLMs
const MAX_HISTORY_MESSAGES = 20;

class OpenAIProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.providerType = config.type || 'ollama';
        this.providerName = config.name || 'Ollama';
        this.baseUrl = config.baseUrl || 'http://127.0.0.1:11434';
        this.chatEndpoint = config.chatEndpoint || '/v1/chat/completions';
        this.apiKey = config.apiKey || null;
        this.model = config.model || null;
        this.messages = [];  // Conversation history
        this.systemPrompt = config.systemPrompt || null;
        this.abortController = null;

        // Tool execution support for local models
        this.toolExecutor = new ToolExecutor();
        this.toolsEnabled = config.toolsEnabled !== false;  // Enabled by default
        this.maxToolIterations = config.maxToolIterations || 3;
        this.currentToolIteration = 0;

        // Callback for tool events (set by main.js)
        this.onToolCall = null;
        this.onToolResult = null;
    }

    getType() {
        return this.providerType;
    }

    getDisplayName() {
        if (this.model) {
            // Shorten model name for display (e.g., "llama3.2:latest" -> "llama3.2")
            const shortModel = this.model.split(':')[0];
            return `${this.providerName} (${shortModel})`;
        }
        return this.providerName;
    }

    getLoadedModel() {
        return this.model;
    }

    isPTY() {
        return false;
    }

    supportsMCP() {
        return false;  // OpenAI API doesn't support MCP tools natively
    }

    supportsVision() {
        // Some models support vision (gpt-4-vision, llava, etc.)
        const visionModels = ['gpt-4-vision', 'gpt-4o', 'llava', 'bakllava'];
        return visionModels.some(v => this.model?.toLowerCase().includes(v));
    }

    /**
     * Check if this provider supports tools via JSON output.
     * Local providers (Ollama, LM Studio, Jan) get tool support.
     */
    supportsTools() {
        const localProviders = ['ollama', 'lmstudio', 'jan'];
        return this.toolsEnabled && localProviders.includes(this.providerType);
    }

    /**
     * Set tool event callbacks.
     */
    setToolCallbacks(onToolCall, onToolResult) {
        this.onToolCall = onToolCall;
        this.onToolResult = onToolResult;
    }

    /**
     * Start the provider (no actual spawning for API-based providers)
     */
    async spawn(options = {}) {
        if (this.running) {
            console.log(`[OpenAIProvider] ${this.providerName} already running`);
            return true;
        }

        // For API-based providers, we just mark as running
        // Actual connection test could be done here
        this.running = true;
        this.messages = [];
        this.currentToolIteration = 0;

        // Add system prompt
        // For local providers with tools enabled, use the tool system prompt
        let systemPrompt = this.systemPrompt;
        if (this.supportsTools() && !systemPrompt) {
            systemPrompt = this.toolExecutor.getSystemPrompt({
                location: options.location,
                customInstructions: options.customInstructions
            });
            console.log(`[OpenAIProvider] Using tool-enabled system prompt`);
        }

        if (systemPrompt) {
            this.messages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        this.emitOutput('start', `${this.getDisplayName()} ready\n`);
        console.log(`[OpenAIProvider] ${this.providerName} started with model: ${this.model}`);

        return true;
    }

    /**
     * Stop the provider
     */
    async stop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.running = false;
        this.messages = [];
        console.log(`[OpenAIProvider] ${this.providerName} stopped`);
    }

    /**
     * Send a message and get a response
     *
     * @param {string} text - User message (empty string for tool follow-up)
     * @param {boolean} isToolFollowUp - Whether this is a follow-up after tool execution
     */
    async sendInput(text, isToolFollowUp = false) {
        if (!this.running) {
            this.emitOutput('stderr', '[Error] Provider not running\n');
            return;
        }

        // Add user message to history (unless it's a tool follow-up with empty text)
        if (text && !isToolFollowUp) {
            this.messages.push({
                role: 'user',
                content: text
            });
            this.emitOutput('stdout', `\n> ${text}\n\n`);
            // Reset tool iteration counter for new user input
            this.currentToolIteration = 0;
        }

        // Limit history before sending to prevent context overflow
        this._limitMessageHistory();

        try {
            // Create abort controller for this request
            this.abortController = new AbortController();

            const url = this.baseUrl + this.chatEndpoint;
            const headers = {
                'Content-Type': 'application/json'
            };

            // Add API key if required
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const body = {
                model: this.model,
                messages: this.messages,
                stream: true  // Use streaming for real-time output
            };

            // Ollama: set context window size (default 2048 is too small for tool use)
            // Browser tool results can be 10K+ chars, need room for system prompt + history
            if (this.providerType === 'ollama') {
                body.options = { num_ctx: 16384 };
            }

            if (!this.model) {
                this.emitOutput('stderr', '[Error] No model specified. Please select a model in Settings.\n');
                return;
            }

            console.log(`[OpenAIProvider] Sending request to ${url}`);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            // Process streaming response
            let fullResponse = '';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                fullResponse += content;
                                this.emitOutput('stdout', content);
                            }
                        } catch {
                            // Ignore parse errors for incomplete chunks
                        }
                    }
                }
            }

            // Add assistant response to history
            if (fullResponse) {
                this.messages.push({
                    role: 'assistant',
                    content: fullResponse
                });
            }

            // Check for tool call in response (only for local providers with tools enabled)
            if (this.supportsTools() && fullResponse) {
                const toolCall = this.toolExecutor.parseToolCall(fullResponse);

                if (toolCall && toolCall.isToolCall) {
                    // Check iteration limit
                    if (this.currentToolIteration >= this.maxToolIterations) {
                        console.log(`[OpenAIProvider] Max tool iterations (${this.maxToolIterations}) reached`);
                        this.emitOutput('stdout', '\n[Max tool iterations reached]\n');
                        return;
                    }

                    this.currentToolIteration++;

                    // Handle unknown tool error
                    if (toolCall.error) {
                        this.emitOutput('stdout', `\n[Tool Error: ${toolCall.error}]\n`);
                        return;
                    }

                    // Notify UI of tool call
                    if (this.onToolCall) {
                        this.onToolCall({
                            tool: toolCall.tool,
                            args: toolCall.args,
                            iteration: this.currentToolIteration
                        });
                    }

                    console.log(`[OpenAIProvider] Tool call detected: ${toolCall.tool}`);
                    this.emitOutput('stdout', `\n[Executing tool: ${toolCall.tool}...]\n`);

                    // Execute the tool
                    const result = await this.toolExecutor.execute(toolCall.tool, toolCall.args);

                    // Notify UI of tool result
                    if (this.onToolResult) {
                        this.onToolResult({
                            tool: toolCall.tool,
                            success: result.success,
                            result: result.result || result.error
                        });
                    }

                    // Format and inject result into conversation
                    const resultMessage = this.toolExecutor.formatToolResult(toolCall.tool, result);
                    this.messages.push({
                        role: 'user',
                        content: resultMessage
                    });

                    console.log(`[OpenAIProvider] Tool result: ${result.success ? 'success' : 'failed'}`);
                    this.emitOutput('stdout', `[Tool ${result.success ? 'succeeded' : 'failed'}]\n\n`);

                    // Get follow-up response from model
                    await this.sendInput('', true);
                    return;
                }
            }

            this.emitOutput('stdout', '\n\n');

        } catch (err) {
            if (err.name === 'AbortError') {
                this.emitOutput('stdout', '\n[Cancelled]\n');
            } else {
                console.error(`[OpenAIProvider] Error:`, err);
                this.emitOutput('stderr', `\n[Error] ${err.message}\n`);
            }
        } finally {
            this.abortController = null;
        }
    }

    /**
     * Send raw input (not applicable for API-based providers)
     */
    sendRawInput(data) {
        // For API providers, we could accumulate input until Enter is pressed
        // For now, just ignore raw input
        console.log('[OpenAIProvider] Raw input not supported for API providers');
    }

    /**
     * Clear conversation history
     */
    clearHistory() {
        this.messages = [];
        this.currentToolIteration = 0;

        // Re-add system prompt
        let systemPrompt = this.systemPrompt;
        if (this.supportsTools() && !systemPrompt) {
            systemPrompt = this.toolExecutor.getSystemPrompt();
        }

        if (systemPrompt) {
            this.messages.push({
                role: 'system',
                content: systemPrompt
            });
        }
    }

    /**
     * Limit message history to prevent context overflow.
     * Keeps system message + last N messages.
     * @private
     */
    _limitMessageHistory() {
        if (this.messages.length <= MAX_HISTORY_MESSAGES) return;

        const system = this.messages.filter(m => m.role === 'system');
        const nonSystem = this.messages.filter(m => m.role !== 'system');
        const recent = nonSystem.slice(-MAX_HISTORY_MESSAGES);

        this.messages = [...system, ...recent];
        console.log(`[OpenAIProvider] Trimmed history to ${this.messages.length} messages`);
    }

    /**
     * Enable or disable tool support
     */
    setToolsEnabled(enabled) {
        this.toolsEnabled = enabled;
        console.log(`[OpenAIProvider] Tools ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Set the model to use
     */
    setModel(model) {
        this.model = model;
        console.log(`[OpenAIProvider] Model set to: ${model}`);
    }

    /**
     * Set API key
     */
    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * Set system prompt
     */
    setSystemPrompt(prompt) {
        this.systemPrompt = prompt;
        // Update messages if already running
        if (this.messages.length > 0 && this.messages[0].role === 'system') {
            this.messages[0].content = prompt;
        } else if (prompt) {
            this.messages.unshift({ role: 'system', content: prompt });
        }
    }

    /**
     * Test connection to the provider
     */
    async testConnection() {
        try {
            const url = this.baseUrl + '/v1/models';
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await fetch(url, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(5000)
            });

            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Fetch available models from the provider
     */
    async fetchModels() {
        try {
            const url = this.baseUrl + '/v1/models';
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await fetch(url, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                return data.data.map(m => m.id).filter(Boolean);
            }
            if (data.models && Array.isArray(data.models)) {
                return data.models.map(m => m.name || m.id).filter(Boolean);
            }
            return [];
        } catch {
            return [];
        }
    }
}

/**
 * Create an OpenAI provider for a specific local or cloud service
 */
function createOpenAIProvider(type, config = {}) {
    const providers = {
        ollama: {
            name: 'Ollama',
            baseUrl: 'http://127.0.0.1:11434',
            chatEndpoint: '/v1/chat/completions',
            defaultModel: null  // Auto-detect from Ollama
        },
        lmstudio: {
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234',
            chatEndpoint: '/v1/chat/completions',
            defaultModel: null  // Auto-detect from LM Studio
        },
        jan: {
            name: 'Jan',
            baseUrl: 'http://127.0.0.1:1337',
            chatEndpoint: '/v1/chat/completions',
            defaultModel: null  // Auto-detect from Jan
        },
        openai: {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            chatEndpoint: '/chat/completions',
            defaultModel: 'gpt-4o-mini'
        },
        gemini: {
            name: 'Gemini',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            chatEndpoint: '/chat/completions',
            defaultModel: 'gemini-2.0-flash'
        },
        groq: {
            name: 'Groq',
            baseUrl: 'https://api.groq.com/openai/v1',
            chatEndpoint: '/chat/completions',
            defaultModel: 'llama-3.3-70b-versatile'
        },
        grok: {
            name: 'Grok (xAI)',
            baseUrl: 'https://api.x.ai/v1',
            chatEndpoint: '/chat/completions',
            defaultModel: 'grok-2'
        },
        mistral: {
            name: 'Mistral',
            baseUrl: 'https://api.mistral.ai/v1',
            chatEndpoint: '/chat/completions',
            defaultModel: 'mistral-small-latest'
        },
        openrouter: {
            name: 'OpenRouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            chatEndpoint: '/chat/completions',
            defaultModel: 'meta-llama/llama-3.3-70b-instruct'
        },
        deepseek: {
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            chatEndpoint: '/chat/completions',
            defaultModel: 'deepseek-chat'
        }
    };

    const defaults = providers[type] || providers.ollama;

    return new OpenAIProvider({
        type,
        name: config.name || defaults.name,
        baseUrl: config.baseUrl || defaults.baseUrl,
        chatEndpoint: config.chatEndpoint || defaults.chatEndpoint,
        apiKey: config.apiKey || null,
        model: config.model || defaults.defaultModel,
        systemPrompt: config.systemPrompt || null
    });
}

module.exports = { OpenAIProvider, createOpenAIProvider };
