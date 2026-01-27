/**
 * Browser control configuration and profile system.
 *
 * Profiles:
 *   - managed (default): Launches isolated Chrome with --remote-debugging-port
 *   - extension: Connects to user's browser via Chrome extension relay
 *   - remote: Connects to external CDP endpoint
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Default ports
const DEFAULT_CDP_PORT = 19210;
const DEFAULT_RELAY_PORT = 19202;
const DEFAULT_COLOR = '#7C3AED'; // Voice Mirror purple

const CONFIG_DIR = path.join(os.homedir(), '.voice-mirror');
const BROWSER_DIR = path.join(CONFIG_DIR, 'browser');
const CONFIG_FILE = path.join(CONFIG_DIR, 'browser-config.json');

/**
 * @typedef {Object} BrowserProfileConfig
 * @property {number} [cdpPort]
 * @property {string} [cdpUrl]
 * @property {'managed'|'extension'} [driver]
 * @property {string} [color]
 */

/**
 * @typedef {Object} BrowserConfig
 * @property {boolean} enabled
 * @property {string} defaultProfile
 * @property {string} [color]
 * @property {boolean} [headless]
 * @property {boolean} [noSandbox]
 * @property {string} [executablePath]
 * @property {Object<string, BrowserProfileConfig>} profiles
 */

/**
 * @typedef {Object} ResolvedProfile
 * @property {string} name
 * @property {number} cdpPort
 * @property {string} cdpUrl
 * @property {string} cdpHost
 * @property {boolean} cdpIsLoopback
 * @property {string} color
 * @property {'managed'|'extension'} driver
 */

function isLoopbackHost(host) {
    const h = (host || '').trim().toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
        h === '[::1]' || h === '::1' || h === '[::]' || h === '::';
}

function getDefaultConfig() {
    return {
        enabled: true,
        defaultProfile: 'managed',
        color: DEFAULT_COLOR,
        headless: false,
        noSandbox: process.platform === 'linux',
        executablePath: null,
        profiles: {
            managed: {
                cdpPort: DEFAULT_CDP_PORT,
                color: DEFAULT_COLOR,
                driver: 'managed'
            },
            extension: {
                driver: 'extension',
                cdpUrl: `http://127.0.0.1:${DEFAULT_RELAY_PORT}`,
                color: '#00AA00'
            }
        }
    };
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const loaded = JSON.parse(raw);
            const defaults = getDefaultConfig();
            return {
                ...defaults,
                ...loaded,
                profiles: { ...defaults.profiles, ...(loaded.profiles || {}) }
            };
        }
    } catch {
        // Fall through to defaults
    }
    return getDefaultConfig();
}

function saveConfig(config) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Resolve a profile by name from config.
 * @param {BrowserConfig} config
 * @param {string} [profileName]
 * @returns {ResolvedProfile|null}
 */
function resolveProfile(config, profileName) {
    const name = profileName || config.defaultProfile || 'managed';
    const profile = config.profiles[name];
    if (!profile) return null;

    const driver = profile.driver === 'extension' ? 'extension' : 'managed';
    let cdpPort = profile.cdpPort || 0;
    let cdpUrl = '';
    let cdpHost = '127.0.0.1';

    if (profile.cdpUrl) {
        try {
            const parsed = new URL(profile.cdpUrl);
            cdpHost = parsed.hostname;
            cdpPort = parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80);
            cdpUrl = parsed.toString().replace(/\/$/, '');
        } catch {
            return null;
        }
    } else if (cdpPort) {
        cdpUrl = `http://127.0.0.1:${cdpPort}`;
    } else {
        cdpPort = DEFAULT_CDP_PORT;
        cdpUrl = `http://127.0.0.1:${cdpPort}`;
    }

    return {
        name,
        cdpPort,
        cdpUrl,
        cdpHost,
        cdpIsLoopback: isLoopbackHost(cdpHost),
        color: profile.color || config.color || DEFAULT_COLOR,
        driver
    };
}

/**
 * Get the user data directory for a profile.
 * @param {string} [profileName]
 * @returns {string}
 */
function getProfileUserDataDir(profileName = 'managed') {
    return path.join(BROWSER_DIR, profileName, 'user-data');
}

/**
 * List all available profile names.
 * @param {BrowserConfig} config
 * @returns {string[]}
 */
function listProfileNames(config) {
    return Object.keys(config.profiles || {});
}

module.exports = {
    DEFAULT_CDP_PORT,
    DEFAULT_RELAY_PORT,
    DEFAULT_COLOR,
    CONFIG_DIR,
    BROWSER_DIR,
    CONFIG_FILE,
    isLoopbackHost,
    getDefaultConfig,
    loadConfig,
    saveConfig,
    resolveProfile,
    getProfileUserDataDir,
    listProfileNames
};
