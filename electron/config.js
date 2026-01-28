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
        ttsAdapter: 'kokoro',    // 'kokoro' (default) or 'qwen' (voice cloning)
        ttsVoice: 'af_bella',    // Voice ID (adapter-dependent)
        ttsModelSize: '0.6B',    // Qwen3-TTS model size: '0.6B' (faster) or '1.7B' (better quality)
        ttsSpeed: 1.0,
        sttModel: 'parakeet'     // or 'whisper'
    },

    // Appearance
    appearance: {
        orbSize: 64,
        theme: 'dark',
        panelWidth: 500,
        panelHeight: 700
    },

    // Behavior
    behavior: {
        startMinimized: false,
        startWithSystem: false,
        clickToTalk: true,
        hotkey: 'CommandOrControl+Shift+V',
        activationMode: 'wakeWord',  // 'wakeWord', 'callMode', 'pushToTalk'
        pttKey: 'MouseButton4',  // Push-to-talk key: MouseButton4, MouseButton5, or keyboard keys
        terminalLocation: 'fullscreen'  // 'fullscreen' | 'chat-bottom' - where terminal is displayed
    },

    // Window position (remembered between sessions)
    window: {
        orbX: null,  // null = default position (bottom-right)
        orbY: null
    },

    // Overlay display settings (Wayland orb)
    overlay: {
        outputName: null  // null = default output, or monitor name like 'DP-1', 'HDMI-A-1'
    },

    // Advanced
    advanced: {
        pythonPath: null,  // null = auto-detect sibling folder
        debugMode: false
    },

    // Sidebar settings
    sidebar: {
        collapsed: false  // Whether sidebar is collapsed to icons-only
    },

    // AI Provider settings
    ai: {
        provider: 'claude',           // 'claude' | 'ollama' | 'lmstudio' | 'jan' | 'openai' | etc.
        model: null,                  // Specific model ID (auto-detected for local providers)
        autoDetect: true,             // Auto-detect local LLM servers on startup
        endpoints: {
            ollama: 'http://127.0.0.1:11434',
            lmstudio: 'http://127.0.0.1:1234',
            jan: 'http://127.0.0.1:1337'
        },
        apiKeys: {                    // API keys for cloud providers (stored locally)
            openai: null,
            anthropic: null,
            google: null,
            xai: null,
            groq: null,
            mistral: null,
            openrouter: null,
            deepseek: null
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

    try {
        if (fs.existsSync(configPath)) {
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            // Deep merge with defaults (saved values override defaults)
            return deepMerge(DEFAULT_CONFIG, saved);
        }
    } catch (error) {
        console.error('[Config] Error loading config:', error.message);
    }

    // Return defaults if no config exists or on error
    return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to disk.
 */
function saveConfig(config) {
    ensureConfigDir();
    const configPath = getConfigPath();

    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log('[Config] Saved to:', configPath);
        return true;
    } catch (error) {
        console.error('[Config] Error saving config:', error.message);
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
 * Reset configuration to defaults.
 */
function resetConfig() {
    return saveConfig(DEFAULT_CONFIG) ? { ...DEFAULT_CONFIG } : null;
}

/**
 * Get a specific config value by dot-notation path.
 * Example: getConfigValue('voice.ttsVoice') => 'af_bella'
 */
function getConfigValue(keyPath) {
    const config = loadConfig();
    return keyPath.split('.').reduce((obj, key) => obj?.[key], config);
}

/**
 * Set a specific config value by dot-notation path.
 * Example: setConfigValue('voice.ttsSpeed', 1.2)
 */
function setConfigValue(keyPath, value) {
    const config = loadConfig();
    const keys = keyPath.split('.');
    const lastKey = keys.pop();

    let target = config;
    for (const key of keys) {
        if (!(key in target)) {
            target[key] = {};
        }
        target = target[key];
    }
    target[lastKey] = value;

    return saveConfig(config);
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

/**
 * Get the autostart directory/registry path for this platform.
 * Note: Actual autostart implementation requires platform-specific code.
 */
function getAutostartInfo() {
    if (isWindows) {
        return {
            type: 'registry',
            path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
            key: 'VoiceMirror'
        };
    } else if (isMac) {
        return {
            type: 'launchAgent',
            path: path.join(app.getPath('home'), 'Library', 'LaunchAgents'),
            plist: 'com.voicemirror.app.plist'
        };
    } else {
        // Linux - XDG autostart
        const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config');
        return {
            type: 'desktop',
            path: path.join(xdgConfigHome, 'autostart'),
            file: 'voice-mirror.desktop'
        };
    }
}

module.exports = {
    // Constants
    DEFAULT_CONFIG,
    isWindows,
    isMac,
    isLinux,

    // Path helpers
    getConfigDir,
    getConfigPath,
    ensureConfigDir,
    getPlatformPaths,
    getAutostartInfo,

    // Config CRUD
    loadConfig,
    saveConfig,
    updateConfig,
    resetConfig,
    getConfigValue,
    setConfigValue
};
