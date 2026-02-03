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
        ttsVolume: 1.0,          // Volume multiplier (0.1–2.0, 1.0 = 100%)
        sttModel: 'parakeet',    // or 'whisper'
        inputDevice: null,       // Audio input device name (null = system default)
        outputDevice: null       // Audio output device name (null = system default)
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

    // User settings
    user: {
        name: null                    // User's preferred name (null = ask on first launch)
    },

    // System announcements (Jarvis-style TTS)
    system: {
        firstLaunchDone: false,       // Set true after first-ever launch greeting
        lastGreetingPeriod: null      // e.g. "morning-2026-01-29" to avoid repeat greetings
    },

    // AI Provider settings
    ai: {
        provider: 'claude',           // 'claude' | 'ollama' | 'lmstudio' | 'jan' | 'openai' | etc.
        model: null,                  // Specific model ID (auto-detected for local providers)
        contextLength: 32768,         // Context window size for local models (tokens). Higher = more data but more VRAM.
        autoDetect: true,             // Auto-detect local LLM servers on startup
        toolProfile: 'voice-assistant',  // Active tool profile name (Claude Code only)
        toolProfiles: {                  // Saved tool profiles (which MCP groups to pre-load)
            'voice-assistant': { groups: ['core', 'meta', 'screen', 'memory'] },
            'n8n-workflows':   { groups: ['core', 'meta', 'n8n'] },
            'web-browser':     { groups: ['core', 'meta', 'screen', 'browser'] },
            'full-toolbox':    { groups: ['core', 'meta', 'screen', 'memory', 'voice-clone', 'browser', 'n8n'] },
            'minimal':         { groups: ['core', 'meta'] }
        },
        endpoints: {
            ollama: 'http://127.0.0.1:11434',
            lmstudio: 'http://127.0.0.1:1234',
            jan: 'http://127.0.0.1:1337'
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
 * Stores runtime data: inbox, voice files, logs, etc.
 */
function getDataDir() {
    return path.join(getConfigDir(), 'data');
}

/**
 * Ensure the data directory exists.
 */
function ensureDataDir() {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
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
    const backupPath = configPath + '.bak';

    // Try main config first, fall back to backup
    for (const tryPath of [configPath, backupPath]) {
        try {
            if (fs.existsSync(tryPath)) {
                const saved = JSON.parse(fs.readFileSync(tryPath, 'utf8'));
                if (tryPath === backupPath) {
                    console.warn('[Config] Main config corrupt, loaded from backup');
                }
                return deepMerge(DEFAULT_CONFIG, saved);
            }
        } catch (error) {
            console.error(`[Config] Error loading ${path.basename(tryPath)}:`, error.message);
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
        console.error('[Config] Error saving config:', error.message);
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
        console.error('[Config] Error saving config (async):', error.message);
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
    getDataDir,
    ensureConfigDir,
    ensureDataDir,
    getPlatformPaths,
    getAutostartInfo,

    // Config CRUD
    loadConfig,
    saveConfigAsync,
    updateConfig,
    updateConfigAsync,
    resetConfig
};
