const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * Tests for the provider display name logic from electron/js/main.js init().
 * Extracted here to verify that CLI providers (like Claude Code) don't show local model names.
 */

const providerNames = {
    claude: 'Claude Code',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    jan: 'Jan',
    openai: 'OpenAI',
    gemini: 'Gemini',
    grok: 'Grok',
    groq: 'Groq',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek'
};

const cliProviders = ['claude'];

function getDisplayName(provider, model) {
    let displayName = providerNames[provider] || provider;
    if (model && !cliProviders.includes(provider)) {
        const shortModel = model.split(':')[0];
        displayName = `${displayName} (${shortModel})`;
    }
    return displayName;
}

describe('provider display name', () => {
    it('Claude Code should not include model name even when localModel is set', () => {
        const result = getDisplayName('claude', 'llama3.1');
        assert.strictEqual(result, 'Claude Code');
    });

    it('Claude Code with null model returns just "Claude Code"', () => {
        const result = getDisplayName('claude', null);
        assert.strictEqual(result, 'Claude Code');
    });

    it('Ollama should include model name', () => {
        const result = getDisplayName('ollama', 'llama3.1:latest');
        assert.strictEqual(result, 'Ollama (llama3.1)');
    });

    it('LM Studio should include model name', () => {
        const result = getDisplayName('lmstudio', 'mistral-7b');
        assert.strictEqual(result, 'LM Studio (mistral-7b)');
    });

    it('Jan should include model name', () => {
        const result = getDisplayName('jan', 'tinyllama');
        assert.strictEqual(result, 'Jan (tinyllama)');
    });

    it('Cloud provider without model shows just provider name', () => {
        const result = getDisplayName('openai', null);
        assert.strictEqual(result, 'OpenAI');
    });

    it('Cloud provider with model shows model in parentheses', () => {
        const result = getDisplayName('openai', 'gpt-4o');
        assert.strictEqual(result, 'OpenAI (gpt-4o)');
    });

    it('Unknown provider uses raw provider string', () => {
        const result = getDisplayName('custom-llm', null);
        assert.strictEqual(result, 'custom-llm');
    });
});
