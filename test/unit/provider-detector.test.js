const { describe, it } = require('node:test');
const assert = require('node:assert');
const { LOCAL_PROVIDERS, CLOUD_PROVIDERS, DETECTION_TIMEOUT, CACHE_TTL } = require('../../electron/services/provider-detector');

describe('provider-detector', () => {
    it('LOCAL_PROVIDERS has ollama, lmstudio, jan entries', () => {
        assert.ok('ollama' in LOCAL_PROVIDERS, 'Should have ollama');
        assert.ok('lmstudio' in LOCAL_PROVIDERS, 'Should have lmstudio');
        assert.ok('jan' in LOCAL_PROVIDERS, 'Should have jan');
    });

    it('each local provider has required config fields', () => {
        for (const [key, provider] of Object.entries(LOCAL_PROVIDERS)) {
            assert.strictEqual(typeof provider.type, 'string', `${key}.type should be string`);
            assert.strictEqual(typeof provider.name, 'string', `${key}.name should be string`);
            assert.strictEqual(typeof provider.baseUrl, 'string', `${key}.baseUrl should be string`);
            assert.strictEqual(typeof provider.modelsEndpoint, 'string', `${key}.modelsEndpoint should be string`);
            assert.strictEqual(typeof provider.chatEndpoint, 'string', `${key}.chatEndpoint should be string`);
        }
    });

    it('CLOUD_PROVIDERS has expected providers', () => {
        const expected = ['claude', 'openai', 'gemini', 'grok', 'groq', 'mistral', 'openrouter', 'deepseek'];
        for (const name of expected) {
            assert.ok(name in CLOUD_PROVIDERS, `Should have cloud provider: ${name}`);
        }
    });

    it('DETECTION_TIMEOUT is a reasonable number (> 0, < 30000)', () => {
        assert.strictEqual(typeof DETECTION_TIMEOUT, 'number');
        assert.ok(DETECTION_TIMEOUT > 0, 'DETECTION_TIMEOUT should be positive');
        assert.ok(DETECTION_TIMEOUT < 30000, 'DETECTION_TIMEOUT should be less than 30s');
    });

    it('CACHE_TTL is a reasonable number (> 0)', () => {
        assert.strictEqual(typeof CACHE_TTL, 'number');
        assert.ok(CACHE_TTL > 0, 'CACHE_TTL should be positive');
    });
});
