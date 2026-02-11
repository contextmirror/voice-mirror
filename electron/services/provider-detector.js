/**
 * Provider Detector - Auto-detect available LLM providers
 *
 * Scans common endpoints to find running LLM servers (Ollama, LM Studio, Jan).
 * Returns list of available providers with their loaded models.
 *
 * Ported from Context Mirror's providerDetector.ts
 */

// Detection timeout in milliseconds
const DETECTION_TIMEOUT = 5000;

// Cache TTL in milliseconds (30 seconds)
const CACHE_TTL = 30000;

// Local provider configurations (OpenAI-compatible endpoints)
const LOCAL_PROVIDERS = {
    ollama: {
        type: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://127.0.0.1:11434',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions'
    },
    lmstudio: {
        type: 'lmstudio',
        name: 'LM Studio',
        baseUrl: 'http://127.0.0.1:1234',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions'
    },
    jan: {
        type: 'jan',
        name: 'Jan',
        baseUrl: 'http://127.0.0.1:1337',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions'
    }
};

// Cloud provider configurations
const CLOUD_PROVIDERS = {
    claude: {
        type: 'claude',
        name: 'Claude Code',
        isLocal: false,
        requiresApiKey: false,  // Uses Claude CLI auth
        apiKeyEnv: 'ANTHROPIC_API_KEY'
    },
    openai: {
        type: 'openai',
        name: 'OpenAI',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        chatEndpoint: '/chat/completions'
    },
    gemini: {
        type: 'gemini',
        name: 'Google Gemini',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'GEMINI_API_KEY'
    },
    grok: {
        type: 'grok',
        name: 'Grok (xAI)',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'XAI_API_KEY',
        baseUrl: 'https://api.x.ai/v1',
        chatEndpoint: '/chat/completions'
    },
    groq: {
        type: 'groq',
        name: 'Groq',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'GROQ_API_KEY',
        baseUrl: 'https://api.groq.com/openai/v1',
        chatEndpoint: '/chat/completions'
    },
    mistral: {
        type: 'mistral',
        name: 'Mistral',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'MISTRAL_API_KEY',
        baseUrl: 'https://api.mistral.ai/v1',
        chatEndpoint: '/chat/completions'
    },
    openrouter: {
        type: 'openrouter',
        name: 'OpenRouter',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'OPENROUTER_API_KEY',
        baseUrl: 'https://openrouter.ai/api/v1',
        chatEndpoint: '/chat/completions'
    },
    deepseek: {
        type: 'deepseek',
        name: 'DeepSeek',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseUrl: 'https://api.deepseek.com/v1',
        chatEndpoint: '/chat/completions'
    },
    kimi: {
        type: 'kimi',
        name: 'Kimi (Moonshot)',
        isLocal: false,
        requiresApiKey: true,
        apiKeyEnv: 'MOONSHOT_API_KEY',
        baseUrl: 'https://api.moonshot.ai/v1',
        chatEndpoint: '/chat/completions'
    }
};

/**
 * Try to find and start Ollama if it's installed but not running.
 * Searches common install locations on the current platform.
 * @returns {Promise<boolean>} True if Ollama was started successfully
 */
async function tryStartOllama() {
    const { execFile, execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const home = os.homedir();

    // Build candidate list per platform
    const candidates = [];

    if (process.platform === 'win32') {
        candidates.push(
            // Standard installer locations
            path.join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama app.exe'),
            path.join(home, 'AppData', 'Local', 'Ollama', 'ollama app.exe'),
            'C:\\Program Files\\Ollama\\ollama app.exe',
            'C:\\Program Files (x86)\\Ollama\\ollama app.exe',
        );
        // Search all drive roots for Ollama directories
        for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
            try {
                if (!fs.existsSync(drive + '\\')) continue;
                candidates.push(`${drive}\\Ollama\\ollama app.exe`);
            } catch { /* drive not accessible */ }
        }
        // Try Windows `where` command to find ollama on PATH
        try {
            const found = execSync('where ollama 2>nul', { encoding: 'utf-8', timeout: 3000 }).trim();
            if (found) {
                for (const line of found.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (trimmed && !candidates.includes(trimmed)) {
                        candidates.push(trimmed);
                        // Also check for "ollama app.exe" next to plain ollama.exe
                        const appExe = path.join(path.dirname(trimmed), 'ollama app.exe');
                        if (!candidates.includes(appExe)) candidates.push(appExe);
                    }
                }
            }
        } catch { /* not on PATH */ }
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Ollama.app/Contents/MacOS/ollama',
            '/usr/local/bin/ollama',
            '/opt/homebrew/bin/ollama',
            path.join(home, 'Applications', 'Ollama.app', 'Contents', 'MacOS', 'ollama'),
        );
    } else {
        // Linux
        candidates.push(
            '/usr/local/bin/ollama',
            '/usr/bin/ollama',
            '/snap/bin/ollama',
            path.join(home, '.local', 'bin', 'ollama'),
        );
    }

    // Last resort: bare 'ollama' on PATH (all platforms)
    candidates.push('ollama');

    for (const exe of candidates) {
        try {
            // Check if the file exists (skip PATH-based 'ollama' — handled separately)
            if (exe !== 'ollama' && !fs.existsSync(exe)) continue;

            console.log(`[ProviderDetector] Found Ollama at: ${exe}`);

            // Start detached so it survives if Voice Mirror exits
            const isApp = exe.endsWith('app.exe') || exe.endsWith('Ollama.app/Contents/MacOS/ollama');
            if (isApp) {
                // "ollama app.exe" starts the tray app which includes the server
                execFile(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            } else {
                // Plain 'ollama' binary needs 'serve' subcommand
                execFile(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            }

            // Wait for server to come online (poll up to 10s)
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 500));
                try {
                    const resp = await fetch('http://127.0.0.1:11434/', {
                        signal: AbortSignal.timeout(2000)
                    });
                    if (resp.ok || resp.status < 500) {
                        console.log(`[ProviderDetector] Ollama started successfully`);
                        return true;
                    }
                } catch { /* not ready yet */ }
            }

            console.log(`[ProviderDetector] Ollama started but server not responding after 10s`);
            return false;
        } catch (err) {
            // This candidate didn't work, try next
            continue;
        }
    }

    console.log(`[ProviderDetector] Ollama not found on this system`);
    return false;
}

/**
 * Parse models from API response
 * All providers use OpenAI-compatible format: { data: [{ id: "model-name" }, ...] }
 */
function parseModels(response) {
    if (response.data && Array.isArray(response.data)) {
        return response.data.map(m => m.id || 'unknown').filter(id => id !== 'unknown');
    }
    // Fallback for older Ollama format
    if (response.models && Array.isArray(response.models)) {
        return response.models.map(m => m.name || m.id || 'unknown').filter(id => id !== 'unknown');
    }
    return [];
}

/**
 * Detect a single local provider
 * @param {string} type - Provider type (ollama, lmstudio, jan)
 * @param {string} customEndpoint - Optional custom endpoint override
 * @returns {Promise<Object>} Provider status
 */
async function detectLocalProvider(type, customEndpoint = null) {
    const config = LOCAL_PROVIDERS[type];
    if (!config) {
        return { type, name: type, online: false, error: 'Unknown provider type' };
    }

    const baseUrl = customEndpoint || config.baseUrl;
    const url = baseUrl + config.modelsEndpoint;

    const status = {
        type,
        name: config.name,
        baseUrl,
        chatEndpoint: baseUrl + config.chatEndpoint,
        online: false,
        models: [],
        model: null
    };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DETECTION_TIMEOUT);

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
            status.online = true;

            try {
                const data = await response.json();
                status.models = parseModels(data);
                status.model = status.models[0] || null;  // First model as default
            } catch {
                // Could connect but couldn't parse models - still online
                status.models = [];
            }

            console.log(`[ProviderDetector] ${config.name}: ONLINE (${status.models.length} models)`);
        } else {
            console.log(`[ProviderDetector] ${config.name}: HTTP ${response.status}`);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log(`[ProviderDetector] ${config.name}: TIMEOUT`);
            status.error = 'timeout';
        } else {
            console.log(`[ProviderDetector] ${config.name}: OFFLINE`);
            status.error = 'offline';

            // Auto-start Ollama if it's installed but not running
            if (type === 'ollama' && !customEndpoint) {
                const started = await tryStartOllama();
                if (started) {
                    // Retry detection now that Ollama is running
                    return detectLocalProvider(type, customEndpoint);
                }
            }
        }
    }

    return status;
}

/**
 * Provider Detector Service
 * Manages detection and caching of available providers
 */
class ProviderDetectorService {
    constructor() {
        this.cachedStatus = new Map();
        this.lastScan = 0;
    }

    /**
     * Scan all local providers in parallel
     * @returns {Promise<Array>} List of provider statuses
     */
    async scanAll() {
        console.log('[ProviderDetector] Scanning for local providers...');

        const providers = Object.keys(LOCAL_PROVIDERS);
        const results = await Promise.all(providers.map(type => detectLocalProvider(type)));

        // Update cache
        this.lastScan = Date.now();
        results.forEach(status => {
            this.cachedStatus.set(status.type, status);
        });

        const online = results.filter(r => r.online);
        console.log(`[ProviderDetector] Found ${online.length} provider(s) online:`,
            online.map(p => `${p.name} (${p.models.length} models)`).join(', ') || 'none'
        );

        return results;
    }

    /**
     * Get available (online) providers
     * Uses cache if fresh, otherwise rescans
     * @param {boolean} forceRefresh - Force rescan even if cache is fresh
     * @returns {Promise<Array>} List of online providers
     */
    async getAvailable(forceRefresh = false) {
        const cacheAge = Date.now() - this.lastScan;

        if (!forceRefresh && cacheAge < CACHE_TTL && this.cachedStatus.size > 0) {
            return Array.from(this.cachedStatus.values()).filter(s => s.online);
        }

        const all = await this.scanAll();
        return all.filter(s => s.online);
    }

    /**
     * Check if a specific provider is online
     * @param {string} type - Provider type
     * @param {string} customEndpoint - Optional custom endpoint
     * @returns {Promise<Object>} Provider status
     */
    async checkProvider(type, customEndpoint = null) {
        const status = await detectLocalProvider(type, customEndpoint);
        this.cachedStatus.set(type, status);
        return status;
    }

    /**
     * Get the first available provider (for auto-selection)
     * Prioritizes Ollama, then LM Studio, then Jan
     * @returns {Promise<Object|null>} First available provider or null
     */
    async getFirstAvailable() {
        const available = await this.getAvailable();

        // Prefer Ollama if available
        const ollama = available.find(p => p.type === 'ollama');
        if (ollama) return ollama;

        return available.length > 0 ? available[0] : null;
    }

    /**
     * Auto-select a provider based on saved preference or first available
     * @param {Object} savedConfig - Saved AI configuration from config.js
     * @returns {Promise<Object|null>} Selected provider status
     */
    async autoSelect(savedConfig = {}) {
        const savedType = savedConfig.provider;
        const savedModel = savedConfig.model;
        const endpoints = savedConfig.endpoints || {};

        // If Claude is selected, return it (no detection needed)
        if (savedType === 'claude') {
            return {
                type: 'claude',
                name: 'Claude Code',
                online: true,  // Assume available (uses CLI)
                models: [],
                model: null
            };
        }

        // Check if saved local provider is online
        if (savedType && LOCAL_PROVIDERS[savedType]) {
            const customEndpoint = endpoints[savedType] || null;
            const status = await this.checkProvider(savedType, customEndpoint);

            if (status.online) {
                console.log(`[ProviderDetector] Using saved provider: ${status.name}`);

                // Use saved model preference if available
                if (savedModel && status.models.includes(savedModel)) {
                    status.model = savedModel;
                    console.log(`[ProviderDetector] Using saved model: ${savedModel}`);
                } else if (status.model) {
                    console.log(`[ProviderDetector] Using default model: ${status.model}`);
                }

                return status;
            }
        }

        // Fall back to first available
        console.log('[ProviderDetector] Saved provider offline or not set, scanning for alternatives...');
        const first = await this.getFirstAvailable();

        if (first) {
            console.log(`[ProviderDetector] Auto-selected: ${first.name} (${first.model || 'default'})`);
        } else {
            console.log('[ProviderDetector] No local providers found');
        }

        return first;
    }

    /**
     * Get cached status without network call
     * @returns {Array} List of cached provider statuses
     */
    getCachedStatus() {
        return Array.from(this.cachedStatus.values());
    }

    /**
     * Clear cache and force rescan on next getAvailable()
     */
    clearCache() {
        this.cachedStatus.clear();
        this.lastScan = 0;
    }

    /**
     * Get provider configuration by type
     * @param {string} type - Provider type
     * @returns {Object|null} Provider configuration
     */
    getProviderConfig(type) {
        return LOCAL_PROVIDERS[type] || CLOUD_PROVIDERS[type] || null;
    }

    /**
     * Get all provider configurations
     * @returns {Object} All provider configs (local + cloud)
     */
    getAllProviderConfigs() {
        return {
            local: { ...LOCAL_PROVIDERS },
            cloud: { ...CLOUD_PROVIDERS }
        };
    }

    /**
     * Get display name for a provider type
     * @param {string} type - Provider type
     * @param {string} model - Optional model name to include
     * @returns {string} Display name
     */
    getDisplayName(type, model = null) {
        const config = this.getProviderConfig(type);
        const name = config?.name || type;

        if (model) {
            // Shorten model name for display (e.g., "llama3.2:latest" -> "llama3.2")
            const shortModel = model.split(':')[0];
            return `${name} (${shortModel})`;
        }

        return name;
    }
}

/**
 * Detect API keys from environment variables and credential files.
 * Returns { providerId: keyValue, ... } for found keys.
 * Special flags prefixed with _ (e.g. _claudeCliAuth) are metadata, not keys.
 */
function detectApiKeys() {
    const detected = {};
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    // Check environment variables for each cloud provider
    for (const [id, provider] of Object.entries(CLOUD_PROVIDERS)) {
        if (!provider.apiKeyEnv) continue;
        const envVal = process.env[provider.apiKeyEnv];
        if (envVal && envVal.length > 8) {
            detected[id] = envVal;
        }
    }

    // Check Claude CLI credentials file
    try {
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        if (fs.existsSync(credPath)) {
            const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            if (creds.claudeAiOauth?.accessToken) {
                detected._claudeCliAuth = true;
            }
        }
    } catch { /* ignore missing/corrupt credentials */ }

    return detected;
}

// Export singleton instance
const providerDetector = new ProviderDetectorService();

module.exports = {
    providerDetector,
    detectApiKeys,
    LOCAL_PROVIDERS,
    CLOUD_PROVIDERS,
    DETECTION_TIMEOUT,
    CACHE_TTL
};
