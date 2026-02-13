/**
 * Provider Registry - Factory for creating AI providers
 *
 * Central module for creating and managing AI provider instances.
 */

const { ClaudeProvider } = require('./claude-provider');
const { CLIProvider } = require('./cli-provider');
const { createOpenAIProvider } = require('./openai-provider');

// Provider type constants (only types with special handling)
const PROVIDER_TYPES = {
    CLAUDE: 'claude',
    OPENCODE: 'opencode'
};

/**
 * Create a provider instance
 * @param {string} type - Provider type
 * @param {Object} config - Provider configuration
 * @returns {BaseProvider} Provider instance
 */
function createProvider(type, config = {}) {
    if (type === PROVIDER_TYPES.CLAUDE) {
        return new ClaudeProvider(config);
    }

    // CLI agent providers (OpenCode)
    if (type === PROVIDER_TYPES.OPENCODE) {
        return new CLIProvider(type, config);
    }

    // All other providers use OpenAI-compatible API
    return createOpenAIProvider(type, config);
}

module.exports = {
    createProvider
};
