/**
 * Voice Mirror Memory System - Embedding Provider Factory
 * Creates and manages embedding providers (Local, OpenAI, Gemini)
 *
 * Local-first by default - prefers offline operation
 */

const path = require('path');
const fs = require('fs');
const { getModelCacheDir } = require('../utils');

/**
 * @typedef {Object} EmbeddingProvider
 * @property {string} id - Provider ID ('local', 'openai', 'gemini')
 * @property {string} model - Model name
 * @property {number} dimensions - Embedding dimensions
 * @property {(text: string) => Promise<number[]>} embedQuery - Embed single text
 * @property {(texts: string[]) => Promise<number[][]>} embedBatch - Embed multiple texts
 */

/**
 * @typedef {Object} ProviderOptions
 * @property {'auto' | 'local' | 'openai' | 'gemini'} provider - Provider to use
 * @property {string} [apiKey] - API key for remote providers
 * @property {string} [baseUrl] - Custom base URL
 * @property {string} [model] - Model override
 * @property {'local' | 'openai' | 'gemini' | 'none'} [fallback] - Fallback provider
 */

/**
 * Create an embedding provider
 * @param {ProviderOptions} options
 * @returns {Promise<{provider: EmbeddingProvider, fallbackFrom?: string, fallbackReason?: string}>}
 */
async function createEmbeddingProvider(options) {
    const { provider = 'auto', fallback = 'openai' } = options;

    // Auto-selection: local first, then remote
    if (provider === 'auto') {
        return await createAutoProvider(options);
    }

    // Specific provider requested
    try {
        const providerInstance = await createSpecificProvider(provider, options);
        return { provider: providerInstance };
    } catch (err) {
        // Try fallback if available
        if (fallback && fallback !== 'none' && fallback !== provider) {
            console.warn(`Primary provider '${provider}' failed: ${err.message}. Trying fallback '${fallback}'`);
            try {
                const fallbackInstance = await createSpecificProvider(fallback, options);
                return {
                    provider: fallbackInstance,
                    fallbackFrom: provider,
                    fallbackReason: err.message
                };
            } catch (fallbackErr) {
                throw new Error(`Both primary (${provider}) and fallback (${fallback}) providers failed: ${err.message}; ${fallbackErr.message}`);
            }
        }
        throw err;
    }
}

/**
 * Auto-select provider (local first)
 * @param {ProviderOptions} options
 */
async function createAutoProvider(options) {
    const errors = [];

    // 1. Try local first (no API costs, offline)
    try {
        const localProvider = await createLocalProvider(options);
        return { provider: localProvider };
    } catch (err) {
        errors.push(`Local: ${err.message}`);
    }

    // 2. Try OpenAI
    if (options.apiKey || process.env.OPENAI_API_KEY) {
        try {
            const openaiProvider = await createOpenAIProvider(options);
            return {
                provider: openaiProvider,
                fallbackFrom: 'local',
                fallbackReason: errors[0]
            };
        } catch (err) {
            errors.push(`OpenAI: ${err.message}`);
        }
    }

    // 3. Try Gemini
    if (options.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
        try {
            const geminiProvider = await createGeminiProvider(options);
            return {
                provider: geminiProvider,
                fallbackFrom: 'local',
                fallbackReason: errors[0]
            };
        } catch (err) {
            errors.push(`Gemini: ${err.message}`);
        }
    }

    throw new Error(`No embedding provider available. Errors: ${errors.join('; ')}\n\nTo fix:\n- For local: Run 'npm run download-model' to get embeddinggemma\n- For OpenAI: Set OPENAI_API_KEY environment variable\n- For Gemini: Set GOOGLE_API_KEY environment variable`);
}

/**
 * Create a specific provider
 * @param {'local' | 'openai' | 'gemini'} provider
 * @param {ProviderOptions} options
 */
async function createSpecificProvider(provider, options) {
    switch (provider) {
        case 'local':
            return await createLocalProvider(options);
        case 'openai':
            return await createOpenAIProvider(options);
        case 'gemini':
            return await createGeminiProvider(options);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

/**
 * Create local embedding provider
 * @param {ProviderOptions} options
 */
async function createLocalProvider(options) {
    const LocalProvider = require('./local');
    const provider = new LocalProvider(options);
    await provider.init();
    return provider;
}

/**
 * Create OpenAI embedding provider
 * @param {ProviderOptions} options
 */
async function createOpenAIProvider(options) {
    const OpenAIProvider = require('./openai');
    const provider = new OpenAIProvider(options);
    await provider.init();
    return provider;
}

/**
 * Create Gemini embedding provider
 * @param {ProviderOptions} options
 */
async function createGeminiProvider(options) {
    const GeminiProvider = require('./gemini');
    const provider = new GeminiProvider(options);
    await provider.init();
    return provider;
}

/**
 * Check if local model exists
 * @returns {boolean}
 */
function isLocalModelAvailable() {
    const modelPath = path.join(getModelCacheDir(), 'embeddinggemma-300M-Q8_0.gguf');
    return fs.existsSync(modelPath);
}

// Export provider classes for direct access
const LocalProvider = require('./local');

module.exports = {
    createEmbeddingProvider,
    isLocalModelAvailable,
    LocalProvider
};
