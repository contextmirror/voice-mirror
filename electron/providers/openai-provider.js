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
const { toOpenAITools, accumulateToolCalls, parseCompletedToolCalls } = require('../tools/openai-schema');

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

        // Context window size for local models (tokens)
        this.contextLength = config.contextLength || 32768;

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
        // Models that support vision (image input)
        const visionModels = [
            'gpt-4-vision', 'gpt-4o',           // OpenAI
            'llava', 'bakllava',                  // LLaVA family
            'qwen3-vl', 'qwen2.5vl', 'qwen2-vl', 'qwen-vl',  // Qwen vision
            'minicpm-v', 'minicpm-o',             // MiniCPM vision/omni
            'gemma3',                             // Google Gemma 3 (vision)
            'llama3.2-vision',                    // Meta Llama vision
            'moondream',                          // Moondream
            'granite3.2-vision',                  // IBM Granite vision
        ];
        return visionModels.some(v => this.model?.toLowerCase().includes(v));
    }

    /**
     * Check if this provider supports tools (any path: native or text-parsing).
     * All providers get tool support when enabled.
     */
    supportsTools() {
        return this.toolsEnabled;
    }

    /**
     * Check if this provider supports native OpenAI function calling.
     * Cloud providers use native tool calling; local providers use text-parsing fallback.
     */
    supportsNativeTools() {
        const nativeProviders = ['openai', 'gemini', 'groq', 'grok', 'mistral', 'openrouter', 'deepseek'];
        return nativeProviders.includes(this.providerType);
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
        // Native-tools providers get a lean prompt (tools are sent via API);
        // text-parsing providers get the full tool system prompt with JSON examples.
        let systemPrompt = this.systemPrompt;
        if (!systemPrompt && this.supportsTools()) {
            if (this.supportsNativeTools()) {
                systemPrompt = this.toolExecutor.getBasicPrompt({
                    location: options.location,
                    customInstructions: options.customInstructions
                });
                console.log(`[OpenAIProvider] Using basic prompt (native tool calling)`);
            } else {
                systemPrompt = this.toolExecutor.getSystemPrompt({
                    location: options.location,
                    customInstructions: options.customInstructions
                });
                console.log(`[OpenAIProvider] Using tool-enabled system prompt (text-parsing)`);
            }
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

            // Add native tool definitions for cloud providers
            const useNativeTools = this.supportsTools() && this.supportsNativeTools();
            if (useNativeTools) {
                body.tools = toOpenAITools();
                body.tool_choice = 'auto';
            }

            // Diagnostic trace: capture what the model receives
            try {
                const dc = require('../services/diagnostic-collector');
                if (dc.hasActiveTrace()) {
                    const contentLength = (c) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, p) => s + (p.text || '').length, 0) : 0;
                    const contentPreview = (c) => typeof c === 'string' ? c.substring(0, 200) : Array.isArray(c) ? `(multimodal: ${c.map(p => p.type).join('+')})` : '(unknown)';
                    dc.addActiveStage('provider_request', {
                        message_count: this.messages.length,
                        total_chars: this.messages.reduce((s, m) => s + contentLength(m.content), 0),
                        messages: this.messages.map(m => ({
                            role: m.role,
                            length: contentLength(m.content),
                            preview: contentPreview(m.content)
                        })),
                        is_tool_followup: isToolFollowUp,
                        model: this.model
                    });
                }
            } catch { /* diagnostic not available */ }

            // Ollama: set context window size (default 2048 is too small for tool use)
            // Browser tool results can be 10K+ chars, need room for system prompt + history
            if (this.providerType === 'ollama') {
                body.options = { num_ctx: this.contextLength };
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
            let accumulatedToolCalls = [];
            let finishReason = null;
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
                            const choice = parsed.choices?.[0];
                            const content = choice?.delta?.content;
                            if (content) {
                                fullResponse += content;
                                this.emitOutput('stdout', content);
                            }

                            // Accumulate native tool calls from streaming deltas
                            if (choice?.delta?.tool_calls) {
                                accumulateToolCalls(accumulatedToolCalls, choice.delta.tool_calls);
                            }

                            // Track finish reason
                            if (choice?.finish_reason) {
                                finishReason = choice.finish_reason;
                            }
                        } catch {
                            // Ignore parse errors for incomplete chunks
                        }
                    }
                }
            }

            // Diagnostic trace: model response complete
            try {
                const dc = require('../services/diagnostic-collector');
                if (dc.hasActiveTrace()) {
                    dc.addActiveStage('model_response', {
                        is_tool_followup: isToolFollowUp,
                        response_length: fullResponse.length,
                        response_text: fullResponse
                    });
                }
            } catch { /* diagnostic not available */ }

            // --- Native tool calling path (cloud providers) ---
            const hasNativeToolCalls = useNativeTools && accumulatedToolCalls.length > 0 &&
                (finishReason === 'tool_calls' || finishReason === 'stop');

            if (hasNativeToolCalls) {
                // Add assistant message with tool_calls to history (required by API)
                const assistantMsg = { role: 'assistant', content: fullResponse || null, tool_calls: accumulatedToolCalls };
                this.messages.push(assistantMsg);

                // Parse accumulated tool calls
                const parsedCalls = parseCompletedToolCalls(accumulatedToolCalls);

                // Check iteration limit
                if (this.currentToolIteration >= this.maxToolIterations) {
                    console.log(`[OpenAIProvider] Max tool iterations (${this.maxToolIterations}) reached`);
                    this.emitOutput('stdout', '\n[Max tool iterations reached]\n');
                    this.emitOutput('context-usage', JSON.stringify(this.estimateTokenUsage()));
                    return;
                }

                // Execute each tool call and add role:"tool" messages
                for (const tc of parsedCalls) {
                    this.currentToolIteration++;

                    // Notify UI
                    if (this.onToolCall) {
                        this.onToolCall({ tool: tc.name, args: tc.args, iteration: this.currentToolIteration });
                    }

                    console.log(`[OpenAIProvider] Native tool call: ${tc.name}`);
                    this.emitOutput('stdout', `\n[Executing tool: ${tc.name}...]\n`);

                    // Diagnostic trace
                    try {
                        const dc = require('../services/diagnostic-collector');
                        if (dc.hasActiveTrace()) {
                            dc.addActiveStage('tool_call_detected', {
                                tool: tc.name, args: tc.args, native: true,
                                raw_response_length: fullResponse.length,
                                raw_response_preview: fullResponse.substring(0, 300)
                            });
                        }
                    } catch { /* diagnostic not available */ }

                    // Execute
                    const result = await this.toolExecutor.execute(tc.name, tc.args);

                    // Notify UI of result
                    if (this.onToolResult) {
                        this.onToolResult({ tool: tc.name, success: result.success, result: result.result || result.error });
                    }

                    // Format result text
                    const resultMessage = this.toolExecutor.formatToolResult(tc.name, result);
                    const resultText = typeof resultMessage === 'object' ? resultMessage.text : resultMessage;

                    // Add role:"tool" message with tool_call_id (required by API)
                    this.messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: resultText
                    });

                    // Diagnostic trace
                    try {
                        const dc = require('../services/diagnostic-collector');
                        if (dc.hasActiveTrace()) {
                            const ctxChars = (c) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, p) => s + (p.text || '').length, 0) : 0;
                            dc.addActiveStage('tool_result_injected', {
                                tool: tc.name, success: result.success, native: true,
                                result_message_length: resultText.length,
                                result_message_preview: resultText.substring(0, 500),
                                conversation_size: this.messages.length,
                                total_context_chars: this.messages.reduce((s, m) => s + ctxChars(m.content), 0)
                            });
                        }
                    } catch { /* diagnostic not available */ }

                    console.log(`[OpenAIProvider] Tool result: ${result.success ? 'success' : 'failed'}`);
                    this.emitOutput('stdout', `[Tool ${result.success ? 'succeeded' : 'failed'}]\n\n`);
                }

                // Emit context usage before follow-up
                this.emitOutput('context-usage', JSON.stringify(this.estimateTokenUsage()));

                // Get follow-up response from model with tool results
                await this.sendInput('', true);
                return;
            }

            // Add assistant response to history
            if (fullResponse) {
                this.messages.push({
                    role: 'assistant',
                    content: fullResponse
                });
            }

            // Emit context usage estimate
            this.emitOutput('context-usage', JSON.stringify(this.estimateTokenUsage()));

            // --- Text-parsing tool path (local providers fallback) ---
            if (this.supportsTools() && !this.supportsNativeTools() && fullResponse) {
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

                    // Diagnostic trace: tool call detected
                    try {
                        const dc = require('../services/diagnostic-collector');
                        if (dc.hasActiveTrace()) {
                            dc.addActiveStage('tool_call_detected', {
                                tool: toolCall.tool,
                                args: toolCall.args,
                                raw_response_length: fullResponse.length,
                                raw_response_preview: fullResponse.substring(0, 300)
                            });
                        }
                    } catch { /* diagnostic not available */ }

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
                    // Append instruction directly to result message (avoids dual system messages confusing small models)
                    const resultMessage = this.toolExecutor.formatToolResult(toolCall.tool, result);
                    const instruction = '\n\n[INSTRUCTION] The above is REAL, CURRENT data. Read it carefully and answer my original question using ONLY facts from this data. Respond in plain natural language, under 3 sentences. No JSON. No markdown.';

                    // If result includes an image and model supports vision, send as multimodal content
                    if (typeof resultMessage === 'object' && resultMessage.image_data_url && this.supportsVision()) {
                        // Strip data URL prefix to get raw base64
                        const rawBase64 = resultMessage.image_data_url.replace(/^data:image\/\w+;base64,/, '');

                        if (this.providerType === 'ollama') {
                            // Ollama native format: images array with raw base64 on message
                            this.messages.push({
                                role: 'user',
                                content: resultMessage.text + instruction,
                                images: [rawBase64]
                            });
                            console.log(`[OpenAIProvider] Sending image via Ollama native format (${Math.round(rawBase64.length / 1024)}KB)`);
                        } else {
                            // OpenAI-compatible format: multimodal content array
                            this.messages.push({
                                role: 'user',
                                content: [
                                    {
                                        type: 'image_url',
                                        image_url: { url: resultMessage.image_data_url }
                                    },
                                    {
                                        type: 'text',
                                        text: resultMessage.text + instruction
                                    }
                                ]
                            });
                        }
                    } else {
                        const textResult = typeof resultMessage === 'object' ? resultMessage.text : resultMessage;
                        this.messages.push({
                            role: 'user',
                            content: textResult + instruction
                        });
                    }

                    // Diagnostic trace: tool result injected
                    try {
                        const dc = require('../services/diagnostic-collector');
                        if (dc.hasActiveTrace()) {
                            const rmText = typeof resultMessage === 'object' ? resultMessage.text : resultMessage;
                            const ctxChars = (c) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, p) => s + (p.text || '').length, 0) : 0;
                            dc.addActiveStage('tool_result_injected', {
                                tool: toolCall.tool,
                                success: result.success,
                                has_image: typeof resultMessage === 'object' && !!resultMessage.image_data_url,
                                result_message_length: rmText.length,
                                result_message_preview: rmText.substring(0, 500),
                                conversation_size: this.messages.length,
                                total_context_chars: this.messages.reduce((s, m) => s + ctxChars(m.content), 0)
                            });
                        }
                    } catch { /* diagnostic not available */ }

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

        // Re-add system prompt (use correct type for provider)
        let systemPrompt = this.systemPrompt;
        if (!systemPrompt && this.supportsTools()) {
            if (this.supportsNativeTools()) {
                systemPrompt = this.toolExecutor.getBasicPrompt();
            } else {
                systemPrompt = this.toolExecutor.getSystemPrompt();
            }
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
     * When trimming, ensures assistant messages with tool_calls stay paired
     * with their corresponding role:"tool" messages (orphaned tool messages
     * cause API errors).
     * @private
     */
    _limitMessageHistory() {
        if (this.messages.length <= MAX_HISTORY_MESSAGES) return;

        const system = this.messages.filter(m => m.role === 'system');
        const nonSystem = this.messages.filter(m => m.role !== 'system');
        let recent = nonSystem.slice(-MAX_HISTORY_MESSAGES);

        // Ensure we don't start with an orphaned role:"tool" message
        // (tool messages must follow their assistant+tool_calls message)
        while (recent.length > 0 && recent[0].role === 'tool') {
            recent = recent.slice(1);
        }

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
     * Estimate token usage from the current messages array.
     * Uses ~4 characters per token as a rough approximation.
     * @returns {{ used: number, limit: number }} Estimated tokens used and context limit
     */
    estimateTokenUsage() {
        const totalChars = this.messages.reduce((sum, m) => {
            let chars = 0;
            if (typeof m.content === 'string') {
                chars += m.content.length;
            } else if (Array.isArray(m.content)) {
                // Multimodal content array — count text parts, estimate image tokens
                chars += m.content.reduce((s, part) => {
                    if (part.type === 'text') return s + (part.text || '').length;
                    if (part.type === 'image_url') return s + 1000; // ~250 tokens for an image
                    return s;
                }, 0);
            }
            // Count tool_calls on assistant messages (function names + arguments)
            if (m.tool_calls && Array.isArray(m.tool_calls)) {
                chars += m.tool_calls.reduce((s, tc) => {
                    return s + (tc.function?.name || '').length + (tc.function?.arguments || '').length;
                }, 0);
            }
            return sum + chars;
        }, 0);
        return {
            used: Math.ceil(totalChars / 4),
            limit: this.contextLength
        };
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
        systemPrompt: config.systemPrompt || null,
        contextLength: config.contextLength || 32768
    });
}

module.exports = { OpenAIProvider, createOpenAIProvider };
