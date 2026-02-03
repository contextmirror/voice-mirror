const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { OpenAIProvider } = require('../../electron/providers/openai-provider');

describe('OpenAIProvider context usage estimation', () => {
    let provider;

    beforeEach(() => {
        provider = new OpenAIProvider({
            type: 'ollama',
            model: 'test-model',
            contextLength: 32768
        });
        provider.messages = [];
    });

    it('returns zero for empty messages', () => {
        const usage = provider.estimateTokenUsage();
        assert.strictEqual(usage.used, 0);
        assert.strictEqual(usage.limit, 32768);
    });

    it('estimates tokens at ~4 chars per token', () => {
        provider.messages = [
            { role: 'system', content: 'a'.repeat(400) },  // ~100 tokens
            { role: 'user', content: 'b'.repeat(200) }     // ~50 tokens
        ];
        const usage = provider.estimateTokenUsage();
        assert.strictEqual(usage.used, 150);
        assert.strictEqual(usage.limit, 32768);
    });

    it('handles non-string content gracefully', () => {
        provider.messages = [
            { role: 'user', content: 'hello' },    // 5 chars → 2 tokens
            { role: 'assistant', content: null }     // should count as 0
        ];
        const usage = provider.estimateTokenUsage();
        assert.strictEqual(usage.used, 2);
    });

    it('uses configured context length as limit', () => {
        const p = new OpenAIProvider({
            type: 'ollama',
            model: 'test',
            contextLength: 8192
        });
        const usage = p.estimateTokenUsage();
        assert.strictEqual(usage.limit, 8192);
    });

    it('emits context-usage after sendInput completes', async () => {
        // Mock fetch to return a simple streaming response
        const originalFetch = global.fetch;
        const chunks = [
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            'data: [DONE]\n\n'
        ];
        global.fetch = async () => ({
            ok: true,
            body: {
                getReader: () => {
                    let i = 0;
                    return {
                        read: async () => {
                            if (i >= chunks.length) return { done: true };
                            const value = new TextEncoder().encode(chunks[i++]);
                            return { done: false, value };
                        }
                    };
                }
            }
        });

        provider.running = true;
        provider.model = 'test-model';

        const outputs = [];
        provider.on('output', (data) => outputs.push(data));

        await provider.sendInput('Hello');

        global.fetch = originalFetch;

        const ctxOutput = outputs.find(o => o.type === 'context-usage');
        assert.ok(ctxOutput, 'Should emit context-usage output');

        const usage = JSON.parse(ctxOutput.text);
        assert.ok(usage.used > 0, 'Should have non-zero token usage');
        assert.strictEqual(usage.limit, 32768);
    });
});
