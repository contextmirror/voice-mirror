const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
    toOpenAIFunction,
    toOpenAITools,
    accumulateToolCalls,
    parseCompletedToolCalls
} = require('../../electron/tools/openai-schema');

// --- toOpenAIFunction ---

describe('toOpenAIFunction', () => {
    it('converts a tool with no args', () => {
        const tool = {
            name: 'capture_screen',
            description: 'Take a screenshot',
            args: {}
        };
        const result = toOpenAIFunction(tool);

        assert.strictEqual(result.type, 'function');
        assert.strictEqual(result.function.name, 'capture_screen');
        assert.strictEqual(result.function.description, 'Take a screenshot');
        assert.deepStrictEqual(result.function.parameters, {
            type: 'object',
            properties: {},
            required: []
        });
    });

    it('converts a tool with required and optional args', () => {
        const tool = {
            name: 'memory_search',
            description: 'Search memories',
            args: {
                query: {
                    type: 'string',
                    required: true,
                    description: 'What to search'
                },
                limit: {
                    type: 'number',
                    required: false,
                    description: 'Max results'
                }
            }
        };
        const result = toOpenAIFunction(tool);

        assert.strictEqual(result.function.name, 'memory_search');
        assert.deepStrictEqual(result.function.parameters.required, ['query']);
        assert.strictEqual(result.function.parameters.properties.query.type, 'string');
        assert.strictEqual(result.function.parameters.properties.query.description, 'What to search');
        assert.strictEqual(result.function.parameters.properties.limit.type, 'number');
    });

    it('defaults arg type to string if not specified', () => {
        const tool = {
            name: 'test_tool',
            description: 'Test',
            args: {
                value: { required: true, description: 'A value' }
            }
        };
        const result = toOpenAIFunction(tool);
        assert.strictEqual(result.function.parameters.properties.value.type, 'string');
    });
});

// --- toOpenAITools ---

describe('toOpenAITools', () => {
    it('returns an array of tool schemas', () => {
        const tools = toOpenAITools();
        assert.ok(Array.isArray(tools));
        assert.ok(tools.length > 0, 'Should have at least one tool');
    });

    it('each tool has correct structure', () => {
        const tools = toOpenAITools();
        for (const tool of tools) {
            assert.strictEqual(tool.type, 'function');
            assert.ok(tool.function, 'Should have function property');
            assert.ok(typeof tool.function.name === 'string', 'name should be string');
            assert.ok(typeof tool.function.description === 'string', 'description should be string');
            assert.ok(tool.function.parameters, 'Should have parameters');
            assert.strictEqual(tool.function.parameters.type, 'object');
            assert.ok(tool.function.parameters.properties !== undefined, 'Should have properties');
            assert.ok(Array.isArray(tool.function.parameters.required), 'required should be array');
        }
    });

    it('includes capture_screen and memory_search', () => {
        const tools = toOpenAITools();
        const names = tools.map(t => t.function.name);
        assert.ok(names.includes('capture_screen'), 'Should include capture_screen');
        assert.ok(names.includes('memory_search'), 'Should include memory_search');
    });
});

// --- accumulateToolCalls ---

describe('accumulateToolCalls', () => {
    it('initializes a new tool call from first delta', () => {
        const acc = [];
        accumulateToolCalls(acc, [{
            index: 0,
            id: 'call_abc',
            function: { name: 'memory_search', arguments: '{"q' }
        }]);

        assert.strictEqual(acc.length, 1);
        assert.strictEqual(acc[0].id, 'call_abc');
        assert.strictEqual(acc[0].function.name, 'memory_search');
        assert.strictEqual(acc[0].function.arguments, '{"q');
    });

    it('accumulates arguments across multiple deltas', () => {
        const acc = [];
        accumulateToolCalls(acc, [{
            index: 0,
            id: 'call_abc',
            function: { name: 'memory_search', arguments: '{"que' }
        }]);
        accumulateToolCalls(acc, [{
            index: 0,
            function: { arguments: 'ry": "test"}' }
        }]);

        assert.strictEqual(acc[0].function.arguments, '{"query": "test"}');
    });

    it('handles multiple parallel tool calls by index', () => {
        const acc = [];
        accumulateToolCalls(acc, [{
            index: 0,
            id: 'call_1',
            function: { name: 'memory_search', arguments: '{}' }
        }]);
        accumulateToolCalls(acc, [{
            index: 1,
            id: 'call_2',
            function: { name: 'capture_screen', arguments: '{}' }
        }]);

        assert.strictEqual(acc.length, 2);
        assert.strictEqual(acc[0].function.name, 'memory_search');
        assert.strictEqual(acc[1].function.name, 'capture_screen');
    });

    it('returns accumulated array unchanged for null/undefined input', () => {
        const acc = [{ id: 'x', type: 'function', function: { name: 'a', arguments: '' } }];
        const result = accumulateToolCalls(acc, null);
        assert.strictEqual(result, acc);
        assert.strictEqual(result.length, 1);
    });

    it('handles missing index (defaults to 0)', () => {
        const acc = [];
        accumulateToolCalls(acc, [{
            id: 'call_no_idx',
            function: { name: 'test', arguments: '{}' }
        }]);
        assert.strictEqual(acc[0].id, 'call_no_idx');
    });
});

// --- parseCompletedToolCalls ---

describe('parseCompletedToolCalls', () => {
    it('parses a single tool call', () => {
        const toolCalls = [{
            id: 'call_abc',
            type: 'function',
            function: { name: 'memory_search', arguments: '{"query": "test"}' }
        }];
        const parsed = parseCompletedToolCalls(toolCalls);

        assert.strictEqual(parsed.length, 1);
        assert.strictEqual(parsed[0].id, 'call_abc');
        assert.strictEqual(parsed[0].name, 'memory_search');
        assert.deepStrictEqual(parsed[0].args, { query: 'test' });
    });

    it('parses multiple tool calls', () => {
        const toolCalls = [
            { id: 'call_1', type: 'function', function: { name: 'memory_search', arguments: '{"query": "a"}' } },
            { id: 'call_2', type: 'function', function: { name: 'capture_screen', arguments: '{}' } }
        ];
        const parsed = parseCompletedToolCalls(toolCalls);

        assert.strictEqual(parsed.length, 2);
        assert.strictEqual(parsed[0].name, 'memory_search');
        assert.strictEqual(parsed[1].name, 'capture_screen');
    });

    it('handles empty arguments string', () => {
        const toolCalls = [{
            id: 'call_x',
            type: 'function',
            function: { name: 'capture_screen', arguments: '' }
        }];
        const parsed = parseCompletedToolCalls(toolCalls);
        assert.deepStrictEqual(parsed[0].args, {});
    });

    it('handles malformed JSON arguments gracefully', () => {
        const toolCalls = [{
            id: 'call_bad',
            type: 'function',
            function: { name: 'memory_search', arguments: '{broken json' }
        }];
        const parsed = parseCompletedToolCalls(toolCalls);
        assert.strictEqual(parsed[0].name, 'memory_search');
        assert.deepStrictEqual(parsed[0].args, {});
    });

    it('returns empty array for null input', () => {
        assert.deepStrictEqual(parseCompletedToolCalls(null), []);
        assert.deepStrictEqual(parseCompletedToolCalls(undefined), []);
    });
});

// --- OpenAIProvider method behavior ---

describe('OpenAIProvider supportsNativeTools', () => {
    // We test the provider class directly
    const { OpenAIProvider } = require('../../electron/providers/openai-provider');

    it('returns true for cloud providers', () => {
        const cloudTypes = ['openai', 'gemini', 'groq', 'grok', 'mistral', 'openrouter', 'deepseek'];
        for (const type of cloudTypes) {
            const p = new OpenAIProvider({ type });
            assert.strictEqual(p.supportsNativeTools(), true,
                `${type} should support native tools`);
        }
    });

    it('returns false for local providers by default', () => {
        const localTypes = ['ollama', 'lmstudio', 'jan'];
        for (const type of localTypes) {
            const p = new OpenAIProvider({ type });
            assert.strictEqual(p.supportsNativeTools(), false,
                `${type} should not support native tools by default`);
        }
    });
});

describe('OpenAIProvider supportsTools', () => {
    const { OpenAIProvider } = require('../../electron/providers/openai-provider');

    it('returns true for all providers when tools enabled', () => {
        const allTypes = ['ollama', 'lmstudio', 'jan', 'openai', 'gemini', 'groq', 'grok', 'mistral', 'openrouter', 'deepseek'];
        for (const type of allTypes) {
            const p = new OpenAIProvider({ type, toolsEnabled: true });
            assert.strictEqual(p.supportsTools(), true,
                `${type} should support tools when enabled`);
        }
    });

    it('returns false when tools disabled', () => {
        const p = new OpenAIProvider({ type: 'openai', toolsEnabled: false });
        assert.strictEqual(p.supportsTools(), false);
    });
});
