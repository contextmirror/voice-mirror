/**
 * OpenAI function-calling schema converter and streaming accumulator.
 *
 * Converts internal tool definitions to OpenAI function-calling format
 * and provides helpers for streaming tool-call accumulation.
 */

const { getAllTools } = require('./definitions');

/**
 * Convert a single internal tool definition to OpenAI function-calling format.
 *
 * @param {Object} tool - Internal tool definition from definitions.js
 * @returns {Object} OpenAI function tool schema
 */
function toOpenAIFunction(tool) {
    const properties = {};
    const required = [];

    for (const [argName, argDef] of Object.entries(tool.args)) {
        const prop = {
            type: argDef.type || 'string',
            description: argDef.description || ''
        };
        properties[argName] = prop;

        if (argDef.required) {
            required.push(argName);
        }
    }

    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: 'object',
                properties,
                required
            }
        }
    };
}

/**
 * Convert all internal tool definitions to OpenAI function-calling format.
 *
 * @returns {Object[]} Array of OpenAI function tool schemas
 */
function toOpenAITools() {
    return getAllTools().map(toOpenAIFunction);
}

/**
 * Accumulate streamed delta.tool_calls into a complete tool_calls array.
 *
 * During streaming, the API sends partial tool_calls indexed by position.
 * Each delta may contain partial function name or arguments that need to
 * be concatenated across chunks.
 *
 * @param {Object[]} accumulated - Current accumulated tool calls (mutated in place)
 * @param {Object[]} deltaToolCalls - The delta.tool_calls array from a streaming chunk
 * @returns {Object[]} The updated accumulated array (same reference)
 */
function accumulateToolCalls(accumulated, deltaToolCalls) {
    if (!deltaToolCalls || !Array.isArray(deltaToolCalls)) return accumulated;

    for (const delta of deltaToolCalls) {
        const idx = delta.index ?? 0;

        // Initialize slot if new
        if (!accumulated[idx]) {
            accumulated[idx] = {
                id: delta.id || '',
                type: 'function',
                function: { name: '', arguments: '' }
            };
        }

        const entry = accumulated[idx];

        // Merge fields
        if (delta.id) {
            entry.id = delta.id;
        }
        if (delta.function) {
            if (delta.function.name) {
                entry.function.name += delta.function.name;
            }
            if (delta.function.arguments) {
                entry.function.arguments += delta.function.arguments;
            }
        }
    }

    return accumulated;
}

/**
 * Parse completed accumulated tool calls into a simplified format
 * suitable for tool execution.
 *
 * @param {Object[]} toolCalls - Accumulated tool calls from accumulateToolCalls
 * @returns {Object[]} Parsed tool calls: [{id, name, args}]
 */
function parseCompletedToolCalls(toolCalls) {
    if (!toolCalls || !Array.isArray(toolCalls)) return [];

    return toolCalls.map(tc => {
        let args = {};
        try {
            if (tc.function.arguments) {
                args = JSON.parse(tc.function.arguments);
            }
        } catch (err) {
            console.error(`[openai-schema] Failed to parse tool call arguments for ${tc.function.name}:`, err.message);
        }

        return {
            id: tc.id,
            name: tc.function.name,
            args
        };
    });
}

module.exports = {
    toOpenAIFunction,
    toOpenAITools,
    accumulateToolCalls,
    parseCompletedToolCalls
};
