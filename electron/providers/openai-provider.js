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
const { DEFAULT_ENDPOINTS } = require('../constants');
const { createLogger } = require('../services/logger');
const logger = createLogger();

// Hoist diagnostic-collector require to module level (was 4x inline requires)
let diagnosticCollector;
try { diagnosticCollector = require('../services/diagnostic-collector'); } catch { diagnosticCollector = null; }

// Limit conversation history to prevent context overflow in local LLMs
const MAX_HISTORY_MESSAGES = 20;

class OpenAIProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.providerType = config.type || 'ollama';
        this.providerName = config.name || 'Ollama';
        this.baseUrl = config.baseUrl || DEFAULT_ENDPOINTS.ollama;
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
        this.maxToolIterations = config.maxToolIterations || 10;
        this.currentToolIteration = 0;

        // Callback for tool events (set by main.js)
        this.onToolCall = null;
        this.onToolResult = null;

        // Cached tool definitions (tools don't change mid-session)
        this._cachedTools = null;
    }

    _getTools() {
        if (!this._cachedTools) {
            this._cachedTools = toOpenAITools();
        }
        return this._cachedTools;
    }

    getDisplayName() {
        if (this.model) {
            // Shorten model name for display (e.g., "llama3.2:latest" -> "llama3.2")
            const shortModel = this.model.split(':')[0];
            return `${this.providerName} (${shortModel})`;
        }
        return this.providerName;
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
            'ministral',                          // Mistral ministral (vision)
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
            logger.info('[OpenAIProvider]', `${this.providerName} already running`);
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
                logger.info('[OpenAIProvider]', 'Using basic prompt (native tool calling)');
            } else {
                systemPrompt = this.toolExecutor.getSystemPrompt({
                    location: options.location,
                    customInstructions: options.customInstructions
                });
                logger.info('[OpenAIProvider]', 'Using tool-enabled system prompt (text-parsing)');
            }
        }

        if (systemPrompt) {
            this.messages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        this.emitOutput('start', `${this.getDisplayName()} ready\n`);

        // Create TUI dashboard for rich terminal rendering
        const { TUIRenderer } = require('./tui-renderer');
        this.tui = new TUIRenderer(
            (text) => this.emitOutput('tui', text),
            {
                model: this.model,
                providerName: this.providerName,
                contextLength: this.contextLength,
                cols: options.cols || 120,
                rows: options.rows || 30
            }
        );
        this.tui.updateInfo('toolCount', `${Object.keys(this._getTools()).length}`);
        this.tui.render();

        logger.info('[OpenAIProvider]', `${this.providerName} started with model: ${this.model}`);

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
        if (this.tui) {
            this.tui.destroy();
            this.tui = null;
        }
        this.running = false;
        this.messages = [];
        logger.info('[OpenAIProvider]', `${this.providerName} stopped`);
    }

    resize(cols, rows) {
        if (this.tui) this.tui.resize(cols, rows);
    }

    hasTUI() {
        return !!this.tui;
    }

    /**
     * Interrupt the current request without stopping the provider.
     * Aborts in-flight streaming but preserves message history and running state.
     * @returns {boolean} True if a request was interrupted
     */
    interrupt() {
        if (this.abortController) {
            logger.info('[OpenAIProvider]', `${this.providerName} request interrupted`);
            this.abortController.abort();
            // sendInput()'s catch block handles AbortError → emits [Cancelled]
            return true;
        }
        return false;
    }

    /**
     * Send a message and get a response
     *
     * @param {string} text - User message (empty string for tool follow-up)
     * @param {boolean} isToolFollowUp - Whether this is a follow-up after tool execution
     * @param {string|null} imageDataUrl - Optional data URL for image (data:image/png;base64,...)
     */
    async sendInput(text, isToolFollowUp = false, imageDataUrl = null) {
        if (!this.running) {
            this.emitOutput('stderr', '[Error] Provider not running\n');
            return;
        }

        // Add user message to history (unless it's a tool follow-up with empty text)
        if (text && !isToolFollowUp) {
            if (imageDataUrl && this.supportsVision()) {
                const rawBase64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
                if (this.providerType === 'ollama') {
                    this.messages.push({
                        role: 'user',
                        content: text,
                        images: [rawBase64]
                    });
                } else {
                    this.messages.push({
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: imageDataUrl } },
                            { type: 'text', text }
                        ]
                    });
                }
                logger.info('[OpenAIProvider]', `Sending user image via ${this.providerType} format (${Math.round(rawBase64.length / 1024)}KB)`);
            } else {
                this.messages.push({
                    role: 'user',
                    content: text
                });
            }
            try {
                if (this.tui) {
                    this.tui.appendMessage('user', text);
                } else {
                    this.emitOutput('stdout', `\n> ${text}\n\n`);
                }
            } catch (tuiErr) {
                logger.error('[OpenAIProvider]', `TUI appendMessage error: ${tuiErr.message}`);
            }
            // Reset tool iteration counter for new user input
            this.currentToolIteration = 0;
        }

        // Limit history before sending to prevent context overflow
        this._limitMessageHistory();

        try {
            // Create abort controller for this request
            this.abortController = new AbortController();
            let malformedChunkWarned = false;  // Escalate first malformed SSE chunk to warn
            let timeoutWarningTimer = null;    // 60s warning before 120s hard timeout

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
                body.tools = this._getTools();
                body.tool_choice = 'auto';
            }

            // Diagnostic trace: capture what the model receives
            try {
                if (diagnosticCollector?.hasActiveTrace()) {
                    const contentLength = (c) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, p) => s + (p.text || '').length, 0) : 0;
                    const contentPreview = (c) => typeof c === 'string' ? c.substring(0, 200) : Array.isArray(c) ? `(multimodal: ${c.map(p => p.type).join('+')})` : '(unknown)';
                    diagnosticCollector.addActiveStage('provider_request', {
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

            logger.info('[OpenAIProvider]', `Sending request to ${url}`);

            // Combine user-cancel signal with a 2-minute timeout to prevent hanging on slow networks
            const timeoutSignal = AbortSignal.timeout(120000);
            const combinedSignal = AbortSignal.any
                ? AbortSignal.any([this.abortController.signal, timeoutSignal])
                : this.abortController.signal; // Fallback for older Node.js without AbortSignal.any

            // Start a 60-second warning timer before the 120s hard timeout
            timeoutWarningTimer = setTimeout(() => {
                this.emitOutput('stdout', '\n[Still waiting for response... timeout in 60s]\n');
            }, 60000);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: combinedSignal
            });

            // Response headers received — clear the timeout warning
            clearTimeout(timeoutWarningTimer);
            timeoutWarningTimer = null;

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            // Process streaming response
            let fullResponse = '';
            let accumulatedToolCalls = [];
            let finishReason = null;
            let streamStart = Date.now();
            let tokenCount = 0;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                let done, value;
                try {
                    ({ done, value } = await reader.read());
                } catch (readErr) {
                    logger.error('[OpenAIProvider]', `Stream read error: ${readErr.message}`);
                    try {
                        if (this.tui) {
                            this.tui.appendMessage('assistant', `[Stream error: ${readErr.message}]`);
                        }
                    } catch { /* TUI error during error handling — ignore */ }
                    this.emitOutput('stderr', `\n[Stream error] ${readErr.message}\n`);
                    break;
                }
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
                                tokenCount++;
                                try {
                                    if (this.tui) {
                                        this.tui.streamToken(content);
                                    } else {
                                        this.emitOutput('stdout', content);
                                    }
                                } catch (tuiErr) {
                                    logger.error('[OpenAIProvider]', `TUI streamToken error: ${tuiErr.message}`);
                                }
                                // Emit stream token for real-time chat UI (parallel to TUI)
                                this.emitOutput('stream-token', content);
                            }

                            // Accumulate native tool calls from streaming deltas
                            if (choice?.delta?.tool_calls) {
                                accumulateToolCalls(accumulatedToolCalls, choice.delta.tool_calls);
                            }

                            // Track finish reason
                            if (choice?.finish_reason) {
                                finishReason = choice.finish_reason;
                            }
                        } catch (parseErr) {
                            // Log non-empty chunks that fail to parse (empty/whitespace chunks are normal SSE separators)
                            if (data && data.trim()) {
                                if (!malformedChunkWarned) {
                                    malformedChunkWarned = true;
                                    logger.warn('[OpenAIProvider]', `Malformed SSE chunk: ${parseErr.message} (data: ${data.substring(0, 100)})`);
                                } else {
                                    logger.debug('[OpenAIProvider]', `Malformed SSE chunk: ${parseErr.message} (data: ${data.substring(0, 100)})`);
                                }
                            }
                        }
                    }
                }
            }

            // Update TUI speed and finish stream
            try {
                if (this.tui && tokenCount > 0) {
                    const elapsed = (Date.now() - streamStart) / 1000;
                    if (elapsed > 0) {
                        this.tui.updateInfo('speed', `${(tokenCount / elapsed).toFixed(0)} tok/s`);
                    }
                    this.tui.finishStream();
                }
            } catch (tuiErr) {
                logger.error('[OpenAIProvider]', `TUI finishStream error: ${tuiErr.message}`);
            }

            // Diagnostic trace: model response complete
            try {
                if (diagnosticCollector?.hasActiveTrace()) {
                    diagnosticCollector.addActiveStage('model_response', {
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
                    logger.info('[OpenAIProvider]', `Max tool iterations (${this.maxToolIterations}) reached`);
                    this.emitOutput('stdout', '\n[Max tool iterations reached]\n');
                    this.emitOutput('stream-end', fullResponse || '');
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

                    logger.info('[OpenAIProvider]', `Native tool call: ${tc.name}`);
                    try {
                        if (this.tui) {
                            this.tui.addToolCall(tc.name, JSON.stringify(tc.args || {}).slice(0, 40));
                        } else {
                            this.emitOutput('stdout', `\n[Executing tool: ${tc.name}...]\n`);
                        }
                    } catch (tuiErr) {
                        logger.error('[OpenAIProvider]', `TUI addToolCall error: ${tuiErr.message}`);
                    }

                    // Diagnostic trace
                    try {
                        if (diagnosticCollector?.hasActiveTrace()) {
                            diagnosticCollector.addActiveStage('tool_call_detected', {
                                tool: tc.name, args: tc.args, native: true,
                                raw_response_length: fullResponse.length,
                                raw_response_preview: fullResponse.substring(0, 300)
                            });
                        }
                    } catch { /* diagnostic not available */ }

                    // Execute (catch errors to continue conversation with error result)
                    let result;
                    try {
                        result = await this.toolExecutor.execute(tc.name, tc.args);
                    } catch (toolErr) {
                        logger.error('[OpenAIProvider]', `Tool execution error (${tc.name}): ${toolErr.message}`);
                        result = { success: false, error: toolErr.message };
                    }

                    // Notify UI of result
                    if (this.onToolResult) {
                        this.onToolResult({ tool: tc.name, success: result.success, result: result.result || result.error, iteration: this.currentToolIteration });
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
                        if (diagnosticCollector?.hasActiveTrace()) {
                            const ctxChars = (c) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, p) => s + (p.text || '').length, 0) : 0;
                            diagnosticCollector.addActiveStage('tool_result_injected', {
                                tool: tc.name, success: result.success, native: true,
                                result_message_length: resultText.length,
                                result_message_preview: resultText.substring(0, 500),
                                conversation_size: this.messages.length,
                                total_context_chars: this.messages.reduce((s, m) => s + ctxChars(m.content), 0)
                            });
                        }
                    } catch { /* diagnostic not available */ }

                    logger.info('[OpenAIProvider]', `Tool result: ${result.success ? 'success' : 'failed'}`);
                    try {
                        if (this.tui) {
                            this.tui.updateToolCall(tc.name, result.success ? 'done' : 'failed');
                        } else {
                            this.emitOutput('stdout', `[Tool ${result.success ? 'succeeded' : 'failed'}]\n\n`);
                        }
                    } catch (tuiErr) {
                        logger.error('[OpenAIProvider]', `TUI updateToolCall error: ${tuiErr.message}`);
                    }
                }

                // Emit context usage before follow-up
                const nativeUsage = this.estimateTokenUsage();
                this.emitOutput('context-usage', JSON.stringify(nativeUsage));
                try {
                    if (this.tui) {
                        this.tui.updateContext(nativeUsage.used, nativeUsage.limit);
                    }
                } catch (tuiErr) {
                    logger.error('[OpenAIProvider]', `TUI updateContext error: ${tuiErr.message}`);
                }

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
                try {
                    if (this.tui) {
                        this.tui.appendMessage('assistant', fullResponse);
                        // Don't emit 'response' here — need to check for tool calls first.
                        // Tool call JSON should NOT be sent to InboxWatcher as a response.
                        // The 'response' emit happens below, after tool parsing.
                    }
                } catch (tuiErr) {
                    logger.error('[OpenAIProvider]', `TUI appendMessage error: ${tuiErr.message}`);
                }
            }

            // Emit context usage estimate
            const usage = this.estimateTokenUsage();
            this.emitOutput('context-usage', JSON.stringify(usage));
            try {
                if (this.tui) {
                    this.tui.updateContext(usage.used, usage.limit);
                }
            } catch (tuiErr) {
                logger.error('[OpenAIProvider]', `TUI updateContext error: ${tuiErr.message}`);
            }

            // --- Text-parsing tool path (local providers fallback) ---
            if (this.supportsTools() && !this.supportsNativeTools() && fullResponse) {
                const toolCall = this.toolExecutor.parseToolCall(fullResponse);

                if (toolCall && toolCall.isToolCall) {
                    // Check iteration limit
                    if (this.currentToolIteration >= this.maxToolIterations) {
                        logger.info('[OpenAIProvider]', `Max tool iterations (${this.maxToolIterations}) reached`);
                        this.emitOutput('stdout', '\n[Max tool iterations reached]\n');
                        this.emitOutput('stream-end', fullResponse || '');
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

                    logger.info('[OpenAIProvider]', `Tool call detected: ${toolCall.tool}`);
                    try {
                        if (this.tui) {
                            this.tui.addToolCall(toolCall.tool, JSON.stringify(toolCall.args || {}).slice(0, 40));
                        } else {
                            this.emitOutput('stdout', `\n[Executing tool: ${toolCall.tool}...]\n`);
                        }
                    } catch (tuiErr) {
                        logger.error('[OpenAIProvider]', `TUI addToolCall error: ${tuiErr.message}`);
                    }

                    // Diagnostic trace: tool call detected
                    try {
                        if (diagnosticCollector?.hasActiveTrace()) {
                            diagnosticCollector.addActiveStage('tool_call_detected', {
                                tool: toolCall.tool,
                                args: toolCall.args,
                                raw_response_length: fullResponse.length,
                                raw_response_preview: fullResponse.substring(0, 300)
                            });
                        }
                    } catch { /* diagnostic not available */ }

                    // Execute the tool (catch errors to continue conversation with error result)
                    let result;
                    try {
                        result = await this.toolExecutor.execute(toolCall.tool, toolCall.args);
                    } catch (toolErr) {
                        logger.error('[OpenAIProvider]', `Tool execution error (${toolCall.tool}): ${toolErr.message}`);
                        result = { success: false, error: toolErr.message };
                    }

                    // Notify UI of tool result
                    if (this.onToolResult) {
                        this.onToolResult({
                            tool: toolCall.tool,
                            success: result.success,
                            result: result.result || result.error,
                            iteration: this.currentToolIteration
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
                            logger.info('[OpenAIProvider]', `Sending image via Ollama native format (${Math.round(rawBase64.length / 1024)}KB)`);
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
                        if (diagnosticCollector?.hasActiveTrace()) {
                            const rmText = typeof resultMessage === 'object' ? resultMessage.text : resultMessage;
                            const ctxChars = (c) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, p) => s + (p.text || '').length, 0) : 0;
                            diagnosticCollector.addActiveStage('tool_result_injected', {
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

                    logger.info('[OpenAIProvider]', `Tool result: ${result.success ? 'success' : 'failed'}`);
                    try {
                        if (this.tui) {
                            this.tui.updateToolCall(toolCall.tool, result.success ? 'done' : 'failed');
                        } else {
                            this.emitOutput('stdout', `[Tool ${result.success ? 'succeeded' : 'failed'}]\n\n`);
                        }
                    } catch (tuiErr) {
                        logger.error('[OpenAIProvider]', `TUI updateToolCall error: ${tuiErr.message}`);
                    }

                    // Get follow-up response from model
                    await this.sendInput('', true);
                    return;
                }
            }

            if (!fullResponse) {
                this.emitOutput('stdout', '\n[No response from model]\n');
            }

            if (this.tui) {
                // Emit response text for InboxWatcher to capture (chat cards + TTS).
                // Only reaches here for non-tool-call responses — tool calls return early
                // above after executing and calling sendInput('', true) for follow-up.
                if (fullResponse) {
                    this.emitOutput('response', fullResponse);
                }
                // Signal end of streaming to chat UI (finalize card with markdown)
                this.emitOutput('stream-end', fullResponse);
            } else {
                this.emitOutput('stdout', '\n\n');
            }

        } catch (err) {
            // Clean up timeout warning timer on error/abort
            if (timeoutWarningTimer) {
                clearTimeout(timeoutWarningTimer);
                timeoutWarningTimer = null;
            }
            if (err.name === 'AbortError') {
                this.emitOutput('stdout', '\n[Cancelled]\n');
            } else {
                logger.error('[OpenAIProvider]', 'Error:', err);
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
        logger.info('[OpenAIProvider]', 'Raw input not supported for API providers');
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

        // Find system messages and non-system messages using index-based approach
        let systemEnd = 0;
        while (systemEnd < this.messages.length && this.messages[systemEnd].role === 'system') {
            systemEnd++;
        }

        const nonSystemCount = this.messages.length - systemEnd;
        let startIdx = this.messages.length - Math.min(nonSystemCount, MAX_HISTORY_MESSAGES);

        // Ensure we don't start with an orphaned role:"tool" message
        while (startIdx < this.messages.length && this.messages[startIdx].role === 'tool') {
            startIdx++;
        }

        // Build trimmed array: system messages + recent non-system
        const trimmed = [];
        for (let i = 0; i < systemEnd; i++) trimmed.push(this.messages[i]);
        for (let i = startIdx; i < this.messages.length; i++) trimmed.push(this.messages[i]);
        this.messages = trimmed;

        // Strip base64 images from older messages (keep last 4 messages intact)
        const IMAGE_KEEP_RECENT = 4;
        const stripBefore = this.messages.length - IMAGE_KEEP_RECENT;
        for (let i = 0; i < stripBefore; i++) {
            const msg = this.messages[i];
            if (Array.isArray(msg.content)) {
                msg.content = msg.content.map(part => {
                    if (part.type === 'image_url') {
                        return { type: 'text', text: '[image]' };
                    }
                    return part;
                });
            }
            // Strip Ollama-style images array
            if (msg.images) {
                delete msg.images;
            }
        }

        logger.info('[OpenAIProvider]', `Trimmed history to ${this.messages.length} messages`);
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

}

/**
 * Create an OpenAI provider for a specific local or cloud service
 */
function createOpenAIProvider(type, config = {}) {
    const providers = {
        ollama: {
            name: 'Ollama',
            baseUrl: DEFAULT_ENDPOINTS.ollama,
            chatEndpoint: '/v1/chat/completions',
            defaultModel: null  // Auto-detect from Ollama
        },
        lmstudio: {
            name: 'LM Studio',
            baseUrl: DEFAULT_ENDPOINTS.lmstudio,
            chatEndpoint: '/v1/chat/completions',
            defaultModel: null  // Auto-detect from LM Studio
        },
        jan: {
            name: 'Jan',
            baseUrl: DEFAULT_ENDPOINTS.jan,
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
