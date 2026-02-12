/**
 * Provider Registry - Factory for creating AI providers
 *
 * Central module for creating and managing AI provider instances.
 */

const { BaseProvider } = require('./base-provider');
const { ClaudeProvider } = require('./claude-provider');
const { CLIProvider } = require('./cli-provider');
const { OpenAIProvider, createOpenAIProvider } = require('./openai-provider');

// Provider type constants
const PROVIDER_TYPES = {
    CLAUDE: 'claude',
    CODEX: 'codex',
    GEMINI_CLI: 'gemini-cli',
    OLLAMA: 'ollama',
    LMSTUDIO: 'lmstudio',
    JAN: 'jan',
    OPENAI: 'openai',
    GEMINI: 'gemini',
    GROQ: 'groq',
    GROK: 'grok',
    MISTRAL: 'mistral',
    OPENROUTER: 'openrouter',
    DEEPSEEK: 'deepseek',
    KIMI: 'kimi',
    KIMI_CLI: 'kimi-cli',
    OPENCODE: 'opencode'
};

// CLI agent providers (full terminal access, PTY-based)
const CLI_PROVIDERS = ['claude', 'codex', 'gemini-cli', 'kimi-cli', 'opencode'];

// Local providers (don't require API key)
const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'jan'];

// Cloud providers (require API key)
const CLOUD_PROVIDERS = ['openai', 'gemini', 'groq', 'grok', 'mistral', 'openrouter', 'deepseek', 'kimi'];

// Provider display names
const PROVIDER_NAMES = {
    claude: 'Claude Code',
    codex: 'OpenAI Codex',
    'gemini-cli': 'Gemini CLI',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    jan: 'Jan',
    openai: 'OpenAI',
    gemini: 'Gemini',
    groq: 'Groq',
    grok: 'Grok (xAI)',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek',
    kimi: 'Kimi (Moonshot)',
    'kimi-cli': 'Kimi CLI',
    opencode: 'OpenCode'
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

    // CLI agent providers (Codex, Gemini CLI, Kimi CLI, OpenCode)
    if (type === PROVIDER_TYPES.CODEX || type === PROVIDER_TYPES.GEMINI_CLI || type === PROVIDER_TYPES.KIMI_CLI || type === PROVIDER_TYPES.OPENCODE) {
        return new CLIProvider(type, config);
    }

    // All other providers use OpenAI-compatible API
    return createOpenAIProvider(type, config);
}

/**
 * Get display name for a provider type
 * @param {string} type - Provider type
 * @param {string} model - Optional model name to include
 * @returns {string} Display name
 */
function getProviderDisplayName(type, model = null) {
    const baseName = PROVIDER_NAMES[type] || type;

    if (model) {
        // Shorten model name (e.g., "llama3.2:latest" -> "llama3.2")
        const shortModel = model.split(':')[0];
        return `${baseName} (${shortModel})`;
    }

    return baseName;
}

/**
 * Check if a provider type is local (no API key required)
 * @param {string} type - Provider type
 * @returns {boolean}
 */
function isLocalProvider(type) {
    return LOCAL_PROVIDERS.includes(type);
}

/**
 * Check if a provider type is cloud (requires API key)
 * @param {string} type - Provider type
 * @returns {boolean}
 */
function isCloudProvider(type) {
    return CLOUD_PROVIDERS.includes(type);
}

/**
 * Check if a provider type uses PTY (interactive terminal)
 * @param {string} type - Provider type
 * @returns {boolean}
 */
function isPTYProvider(type) {
    return CLI_PROVIDERS.includes(type);
}

/**
 * Get all provider types
 * @returns {Array} List of provider types
 */
function getAllProviderTypes() {
    return Object.values(PROVIDER_TYPES);
}

/**
 * Get provider info for settings UI
 * @returns {Array} List of provider info objects
 */
function getProviderList() {
    return [
        {
            type: 'claude',
            name: 'Claude Code',
            description: 'Full Claude Code CLI with MCP tools',
            isLocal: false,
            isPTY: true,
            requiresApiKey: false,
            supportsVision: true,
            supportsMCP: true
        },
        {
            type: 'codex',
            name: 'OpenAI Codex',
            description: 'OpenAI Codex CLI agent',
            isLocal: false,
            isPTY: true,
            requiresApiKey: false,
            supportsVision: false,
            supportsMCP: false
        },
        {
            type: 'gemini-cli',
            name: 'Gemini CLI',
            description: 'Google Gemini CLI agent',
            isLocal: false,
            isPTY: true,
            requiresApiKey: false,
            supportsVision: false,
            supportsMCP: false
        },
        {
            type: 'kimi-cli',
            name: 'Kimi CLI',
            description: 'Moonshot AI CLI agent with MCP',
            isLocal: false,
            isPTY: true,
            requiresApiKey: false,
            supportsVision: true,
            supportsMCP: true
        },
        {
            type: 'opencode',
            name: 'OpenCode',
            description: '75+ models via OpenCode CLI with MCP',
            isLocal: false,
            isPTY: true,
            requiresApiKey: false,
            supportsVision: false,
            supportsMCP: true
        },
        {
            type: 'ollama',
            name: 'Ollama',
            description: 'Local LLM runtime',
            isLocal: true,
            isPTY: false,
            requiresApiKey: false,
            supportsVision: true,  // With llava
            supportsMCP: false
        },
        {
            type: 'lmstudio',
            name: 'LM Studio',
            description: 'Local LLM with GUI',
            isLocal: true,
            isPTY: false,
            requiresApiKey: false,
            supportsVision: true,
            supportsMCP: false
        },
        {
            type: 'jan',
            name: 'Jan',
            description: 'Open source AI assistant',
            isLocal: true,
            isPTY: false,
            requiresApiKey: false,
            supportsVision: false,
            supportsMCP: false
        },
        {
            type: 'openai',
            name: 'OpenAI',
            description: 'GPT-4, GPT-3.5',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'OPENAI_API_KEY',
            supportsVision: true,
            supportsMCP: false
        },
        {
            type: 'gemini',
            name: 'Gemini',
            description: 'Google Gemini models',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'GOOGLE_API_KEY',
            supportsVision: true,
            supportsMCP: false
        },
        {
            type: 'groq',
            name: 'Groq',
            description: 'Fast inference',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'GROQ_API_KEY',
            supportsVision: false,
            supportsMCP: false
        },
        {
            type: 'grok',
            name: 'Grok (xAI)',
            description: 'xAI Grok models',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'XAI_API_KEY',
            supportsVision: true,
            supportsMCP: false
        },
        {
            type: 'mistral',
            name: 'Mistral',
            description: 'Mistral AI models',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'MISTRAL_API_KEY',
            supportsVision: false,
            supportsMCP: false
        },
        {
            type: 'openrouter',
            name: 'OpenRouter',
            description: 'Multi-model aggregator',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'OPENROUTER_API_KEY',
            supportsVision: true,
            supportsMCP: false
        },
        {
            type: 'deepseek',
            name: 'DeepSeek',
            description: 'DeepSeek models',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'DEEPSEEK_API_KEY',
            supportsVision: false,
            supportsMCP: false
        },
        {
            type: 'kimi',
            name: 'Kimi (Moonshot)',
            description: 'Moonshot AI multimodal models',
            isLocal: false,
            isPTY: false,
            requiresApiKey: true,
            apiKeyEnv: 'MOONSHOT_API_KEY',
            supportsVision: true,
            supportsMCP: false
        }
    ];
}

module.exports = {
    // Classes
    BaseProvider,
    ClaudeProvider,
    CLIProvider,
    OpenAIProvider,

    // Factory
    createProvider,
    createOpenAIProvider,

    // Constants
    PROVIDER_TYPES,
    PROVIDER_NAMES,
    CLI_PROVIDERS,
    LOCAL_PROVIDERS,
    CLOUD_PROVIDERS,

    // Utilities
    getProviderDisplayName,
    isLocalProvider,
    isCloudProvider,
    isPTYProvider,
    getAllProviderTypes,
    getProviderList
};
