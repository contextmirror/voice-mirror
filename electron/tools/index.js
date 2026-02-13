/**
 * ToolExecutor - Parses and executes tool calls from local LLMs.
 *
 * Detects JSON tool calls in model responses, executes the appropriate handler,
 * and returns results for injection back into the conversation.
 */

const { getToolNames, validateArgs } = require('./definitions');
const { getToolSystemPrompt, getBasicSystemPrompt } = require('./prompts');
const handlers = require('./handlers');

// Limits for tool results (prevent context overflow in local LLMs)
const TOOL_RESULT_MAX_CHARS = 12000;
const TOOL_ERROR_MAX_CHARS = 400;
const TOOL_TIMEOUT_MS = 30000;

/**
 * Truncate text to prevent context overflow.
 * @param {string} text - Text to truncate
 * @param {number} maxChars - Maximum characters
 * @returns {string} Truncated text
 */
function truncateText(text, maxChars) {
    if (!text || text.length <= maxChars) {
        // Diagnostic trace: no truncation needed
        try {
            const dc = require('../services/diagnostic-collector');
            if (dc.hasActiveTrace()) {
                dc.addActiveStage('truncate_text', {
                    input: text?.length || 0,
                    output: text?.length || 0,
                    max_chars: maxChars,
                    truncated: false,
                    lost: 0
                });
            }
        } catch { /* diagnostic not available */ }
        return text;
    }
    // Diagnostic trace: truncation occurred
    try {
        const dc = require('../services/diagnostic-collector');
        if (dc.hasActiveTrace()) {
            dc.addActiveStage('truncate_text', {
                input: text.length,
                output: maxChars,
                max_chars: maxChars,
                truncated: true,
                lost: text.length - maxChars
            });
        }
    } catch { /* diagnostic not available */ }
    return text.slice(0, maxChars) + '\n…(truncated)…';
}

class ToolExecutor {
    constructor(options = {}) {
        this.options = options;
    }

    /**
     * Check if a response contains a tool call.
     * Looks for JSON containing {"tool": ...} anywhere in the response.
     *
     * @param {string} text - The model's response text
     * @returns {Object|null} Parsed tool call or null
     */
    parseToolCall(text) {
        if (!text) return null;

        // Quick check: must contain "tool" somewhere
        if (!text.includes('"tool"')) {
            return null;
        }

        // Strip markdown code blocks (models often wrap JSON in ```json ... ```)
        let cleanText = text
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '');

        // Find the start of a JSON object that contains "tool"
        // The JSON may be formatted with newlines, so we look for opening brace
        // then check if "tool" appears before the next closing brace
        const braceIndex = cleanText.indexOf('{');
        if (braceIndex === -1) {
            return null;
        }

        // Find all opening braces and check each one
        let jsonStart = -1;
        let searchStart = 0;
        while (searchStart < cleanText.length) {
            const idx = cleanText.indexOf('{', searchStart);
            if (idx === -1) break;

            // Check if "tool" appears relatively soon after this brace
            const nextChunk = cleanText.slice(idx, idx + 150);
            if (nextChunk.includes('"tool"')) {
                jsonStart = idx;
                break;
            }
            searchStart = idx + 1;
        }

        if (jsonStart === -1) {
            return null;
        }
        const remaining = cleanText.slice(jsonStart);

        try {
            // Find matching closing brace
            let jsonEnd = remaining.length;
            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let i = 0; i < remaining.length; i++) {
                const char = remaining[i];

                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (char === '\\') {
                    escaped = true;
                    continue;
                }

                if (char === '"') {
                    inString = !inString;
                    continue;
                }

                if (inString) continue;

                if (char === '{') depth++;
                if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }

            const jsonStr = remaining.slice(0, jsonEnd);
            const parsed = JSON.parse(jsonStr);

            // Validate it has a tool field
            if (!parsed.tool || typeof parsed.tool !== 'string') {
                return null;
            }

            // Check if it's a known tool
            const toolNames = getToolNames();
            if (!toolNames.includes(parsed.tool)) {
                console.log(`[ToolExecutor] Unknown tool: ${parsed.tool}`);
                return {
                    isToolCall: true,
                    tool: parsed.tool,
                    args: parsed.args || {},
                    error: `Unknown tool: ${parsed.tool}. Available tools: ${toolNames.join(', ')}`
                };
            }

            return {
                isToolCall: true,
                tool: parsed.tool,
                args: parsed.args || {}
            };

        } catch (err) {
            // Not valid JSON or doesn't match expected format
            console.log(`[ToolExecutor] JSON parse error:`, err.message);
            return null;
        }
    }

    /**
     * Execute a tool call with timeout protection.
     *
     * @param {string} toolName - Name of the tool to execute
     * @param {Object} args - Tool arguments
     * @param {number} timeoutMs - Timeout in milliseconds (default 30s)
     * @returns {Promise<Object>} Execution result
     */
    async execute(toolName, args = {}, timeoutMs) {
        // Browser control needs more time (launches Chrome, waits for pages)
        if (!timeoutMs) {
            timeoutMs = toolName === 'browser_control' ? 60000 : TOOL_TIMEOUT_MS;
        }
        console.log(`[ToolExecutor] Executing: ${toolName}`, args);

        // Validate arguments
        const validation = validateArgs(toolName, args);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Tool timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        try {
            // Race between execution and timeout
            return await Promise.race([
                this._executeInternal(toolName, args),
                timeoutPromise
            ]);
        } catch (err) {
            console.error(`[ToolExecutor] Error/timeout executing ${toolName}:`, err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Internal tool execution (routes to handlers).
     * @private
     */
    async _executeInternal(toolName, args) {
        switch (toolName) {
            case 'capture_screen':
                return await handlers.captureScreen(args);
            case 'memory_search':
                return await handlers.memorySearch(args);
            case 'memory_remember':
                return await handlers.memoryRemember(args);
            case 'memory_forget':
                return await handlers.memoryForget(args);
            case 'memory_clear':
                return await handlers.memoryClear(args);
            case 'n8n_list_workflows':
                return await handlers.n8nListWorkflows(args);
            case 'n8n_trigger_workflow':
                return await handlers.n8nTriggerWorkflow(args);
            case 'browser_control':
                return await handlers.browserControl(args);
            default:
                return { success: false, error: `No handler for tool: ${toolName}` };
        }
    }

    /**
     * Get the system prompt with tool instructions.
     *
     * @param {Object} options - Prompt options
     * @returns {string} System prompt
     */
    getSystemPrompt(options = {}) {
        return getToolSystemPrompt(options);
    }

    /**
     * Get basic system prompt without tools (for models that struggle).
     *
     * @param {Object} options - Prompt options
     * @returns {string} System prompt
     */
    getBasicPrompt(options = {}) {
        return getBasicSystemPrompt(options);
    }

    /**
     * Format tool result for injection into conversation.
     * Truncates results to prevent context overflow in local LLMs.
     *
     * @param {string} toolName - Tool that was executed
     * @param {Object} result - Tool execution result
     * @returns {string|Object} Formatted result — string for text, or object with {text, image_data_url} for vision
     */
    formatToolResult(toolName, result) {
        let formatted;
        if (result.success) {
            const truncated = truncateText(result.result, TOOL_RESULT_MAX_CHARS);
            formatted = `Tool "${toolName}" result:\n${truncated}`;
        } else {
            const truncated = truncateText(result.error, TOOL_ERROR_MAX_CHARS);
            formatted = `Tool "${toolName}" failed: ${truncated}`;
        }

        // Diagnostic trace: formatted tool result
        try {
            const dc = require('../services/diagnostic-collector');
            if (dc.hasActiveTrace()) {
                dc.addActiveStage('format_tool_result', {
                    tool: toolName,
                    success: result.success,
                    has_image: !!(result.data_url),
                    raw_result_length: result.success ? (result.result || '').length : (result.error || '').length,
                    formatted_length: formatted.length,
                    formatted_preview: formatted.substring(0, 500)
                });
            }
        } catch { /* diagnostic not available */ }

        // If tool returned image data, include it for vision models
        if (result.success && result.data_url) {
            return { text: formatted, image_data_url: result.data_url };
        }

        return formatted;
    }
}

module.exports = { ToolExecutor };
