/**
 * Voice Mirror Electron - Cross-Platform Configuration
 *
 * Handles settings storage with proper paths for each OS:
 * - Linux:   ~/.config/voice-mirror/
 * - macOS:   ~/Library/Application Support/Voice Mirror/
 * - Windows: %APPDATA%\Voice Mirror\
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { DEFAULT_ENDPOINTS } = require('./constants');
const { createLogger } = require('./services/logger');
const logger = createLogger();

// Platform detection
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
    // Wake word settings
    wakeWord: {
        enabled: true,
        phrase: 'hey_claude',  // Model name in OpenWakeWord
        sensitivity: 0.5
    },

    // Voice settings
    voice: {
        ttsAdapter: 'kokoro',    // 'kokoro', 'qwen', 'piper', 'edge', 'openai-tts', 'elevenlabs', 'custom-api'
        ttsVoice: 'af_bella',    // Voice ID (adapter-dependent)
        ttsModelSize: '0.6B',    // Qwen3-TTS model size: '0.6B' (faster) or '1.7B' (better quality)
        ttsSpeed: 1.0,
        ttsVolume: 1.0,          // Volume multiplier (0.1–2.0, 1.0 = 100%)
        ttsApiKey: null,         // API key for cloud TTS
        ttsEndpoint: null,       // Custom endpoint URL
        ttsModelPath: null,      // Local model file path (Piper)
        sttModel: 'whisper-local',    // Legacy alias for sttAdapter
        sttAdapter: 'whisper-local',  // 'whisper-local', 'openai-whisper-api', 'custom-api-stt'
        sttModelSize: 'base',    // Whisper model size: 'tiny', 'base' (recommended), 'small'
        sttApiKey: null,         // API key for cloud STT
        sttEndpoint: null,       // Custom STT endpoint URL
        sttModelName: null,      // Specific model name (e.g. "large-v3")
        inputDevice: null,       // Audio input device name (null = system default)
        outputDevice: null       // Audio output device name (null = system default)
    },

    // Appearance
    appearance: {
        orbSize: 64,
        theme: 'colorblind',
        panelWidth: 500,
        panelHeight: 700,
        colors: null,    // null = use preset from theme, object = custom { bg, bgElevated, ... }
        fonts: null,     // null = use preset defaults, object = { fontFamily, fontMono }
        messageCard: null // null = use theme defaults, object = { fontSize, lineHeight, padding, avatarSize, showAvatars, bubbleStyle, userColor, aiColor, userRadius, aiRadius }
    },

    // Behavior
    behavior: {
        startMinimized: false,
        startWithSystem: false,
        hotkey: 'CommandOrControl+Shift+V',
        activationMode: 'wakeWord',  // 'wakeWord', 'pushToTalk'
        pttKey: 'MouseButton4',  // Push-to-talk key: MouseButton4, MouseButton5, or keyboard keys
        dictationKey: 'MouseButton5'  // Dictation key: hold to record, release to type into focused window
    },

    // Window state (remembered between sessions)
    window: {
        orbX: null,  // null = default position (bottom-right)
        orbY: null,
        expanded: false  // Whether the dashboard was open when the app last closed
    },

    // Overlay display settings (Wayland orb)
    overlay: {
        outputName: null  // null = default output, or monitor name like 'DP-1', 'HDMI-A-1'
    },

    // Advanced
    advanced: {
        debugMode: false,
        showDependencies: false  // Hidden flag — enables Dependencies settings tab and dep update checks
    },

    // Sidebar settings
    sidebar: {
        collapsed: false  // Whether sidebar is collapsed to icons-only
    },

    // User settings
    user: {
        name: null                    // User's preferred name (null = ask on first launch)
    },

    // System announcements (Jarvis-style TTS)
    system: {
        acceptedDisclaimer: false,    // Set true after user accepts first-launch disclaimer
        firstLaunchDone: false,       // Set true after first-ever launch greeting
        lastGreetingPeriod: null,     // e.g. "morning-2026-01-29" to avoid repeat greetings
        lastSeenVersion: null         // tracks app version for "What's New" after updates
    },

    // AI Provider settings
    ai: {
        provider: 'claude',           // 'claude' | 'ollama' | 'lmstudio' | 'jan' | 'openai' | etc.
        model: null,                  // Specific model ID (auto-detected for local providers)
        contextLength: 32768,         // Context window size for local models (tokens). Higher = more data but more VRAM.
        autoDetect: true,             // Auto-detect local LLM servers on startup
        systemPrompt: null,              // Custom system prompt / persona (optional)
        toolProfile: 'voice-assistant',  // Active tool profile name (Claude Code only)
        toolProfiles: {                  // Saved tool profiles (which MCP groups to pre-load)
            'voice-assistant': { groups: ['core', 'meta', 'screen', 'memory', 'browser'] },
            'n8n-workflows':   { groups: ['core', 'meta', 'n8n'] },
            'web-browser':     { groups: ['core', 'meta', 'screen', 'browser'] },
            'full-toolbox':    { groups: ['core', 'meta', 'screen', 'memory', 'voice-clone', 'browser', 'n8n'] },
            'minimal':         { groups: ['core', 'meta'] },
            'voice-assistant-lite': { groups: ['core', 'meta', 'screen', 'memory-facade', 'browser-facade'] }
        },
        endpoints: {
            ollama: DEFAULT_ENDPOINTS.ollama,
            lmstudio: DEFAULT_ENDPOINTS.lmstudio,
            jan: DEFAULT_ENDPOINTS.jan,
        },
        apiKeys: {                    // API keys for cloud providers (stored locally)
            openai: null,
            anthropic: null,
            gemini: null,
            grok: null,
            groq: null,
            mistral: null,
            openrouter: null,
            deepseek: null,
            kimi: null
        }
    }
};

/**
 * Get the configuration directory path (cross-platform).
 * Uses Electron's app.getPath('userData') which handles OS differences.
 */
function getConfigDir() {
    // Electron handles this automatically:
    // - Linux: ~/.config/voice-mirror-electron/
    // - macOS: ~/Library/Application Support/voice-mirror-electron/
    // - Windows: %APPDATA%\voice-mirror-electron\
    return app.getPath('userData');
}

/**
 * Get path to a specific config file.
 */
function getConfigPath(filename = 'config.json') {
    return path.join(getConfigDir(), filename);
}

/**
 * Get the data directory path (cross-platform).
 * Delegates to platform-paths.js (canonical source for data dir).
 */
const { getDataDir } = require('./services/platform-paths');

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir() {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    return configDir;
}

/**
 * Load configuration from disk.
 * Returns merged config (defaults + saved values).
 */
function loadConfig() {
    const configPath = getConfigPath();
    const backupPath = configPath + '.bak';

    // Try main config first, fall back to backup
    for (const tryPath of [configPath, backupPath]) {
        try {
            if (fs.existsSync(tryPath)) {
                const saved = JSON.parse(fs.readFileSync(tryPath, 'utf8'));
                if (tryPath === backupPath) {
                    logger.warn('[Config]', 'Main config corrupt, loaded from backup');
                }
                return deepMerge(DEFAULT_CONFIG, saved);
            }
        } catch (error) {
            logger.error('[Config]', `Error loading ${path.basename(tryPath)}:`, error.message);
        }
    }

    // Return defaults if no config exists or both are corrupt
    return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to disk.
 */
function saveConfig(config) {
    ensureConfigDir();
    const configPath = getConfigPath();
    const tempPath = configPath + '.tmp';
    const backupPath = configPath + '.bak';

    try {
        // Atomic write: write to temp file, then rename
        const json = JSON.stringify(config, null, 2);
        fs.writeFileSync(tempPath, json, 'utf8');

        // Backup existing config before overwriting
        if (fs.existsSync(configPath)) {
            try {
                fs.copyFileSync(configPath, backupPath);
            } catch { /* backup is best-effort */ }
        }

        // Rename temp to config (atomic on all platforms)
        fs.renameSync(tempPath, configPath);
        return true;
    } catch (error) {
        logger.error('[Config]', 'Error saving config:', error.message);
        // Clean up temp file if it exists
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        return false;
    }
}

/**
 * Update specific config values (partial update).
 */
function updateConfig(updates) {
    const current = loadConfig();
    const updated = deepMerge(current, updates);
    return saveConfig(updated) ? updated : current;
}

/**
 * Save configuration to disk (async, non-blocking).
 */
async function saveConfigAsync(config) {
    ensureConfigDir();
    const configPath = getConfigPath();
    const tempPath = configPath + '.tmp';
    const backupPath = configPath + '.bak';

    try {
        const json = JSON.stringify(config, null, 2);
        await fsPromises.writeFile(tempPath, json, 'utf8');

        try {
            await fsPromises.access(configPath);
            try { await fsPromises.copyFile(configPath, backupPath); } catch { /* best-effort */ }
        } catch { /* config doesn't exist yet */ }

        await fsPromises.rename(tempPath, configPath);
        return true;
    } catch (error) {
        logger.error('[Config]', 'Error saving config (async):', error.message);
        try { await fsPromises.unlink(tempPath); } catch { /* ignore */ }
        return false;
    }
}

/**
 * Update specific config values (async, non-blocking).
 */
async function updateConfigAsync(updates) {
    const current = loadConfig();
    const updated = deepMerge(current, updates);
    return (await saveConfigAsync(updated)) ? updated : current;
}

/**
 * Reset configuration to defaults.
 */
function resetConfig() {
    return saveConfig(DEFAULT_CONFIG) ? { ...DEFAULT_CONFIG } : null;
}

/**
 * Deep merge two objects (source values override target).
 */
function deepMerge(target, source) {
    const result = { ...target };

    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }

    return result;
}

/**
 * Get platform-specific paths for various resources.
 */
function getPlatformPaths() {
    return {
        config: getConfigDir(),
        logs: path.join(getConfigDir(), 'logs'),
        cache: app.getPath('cache') || path.join(getConfigDir(), 'cache'),
        temp: app.getPath('temp'),
        home: app.getPath('home'),
        desktop: app.getPath('desktop'),
        // Platform info
        platform: process.platform,
        isWindows,
        isMac,
        isLinux
    };
}

module.exports = {
    // Constants
    isWindows,
    isMac,
    isLinux,

    // Path helpers
    getConfigDir,
    getDataDir,
    getPlatformPaths,

    // Config CRUD
    loadConfig,
    updateConfig,
    updateConfigAsync,
    resetConfig
};
