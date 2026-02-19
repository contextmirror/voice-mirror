/**
 * config.js -- Svelte 5 reactive config store backed by Tauri IPC.
 *
 * Uses $state internally via a reactive object wrapper.
 * loadConfig() fetches from backend; updateConfig() sends partial patches.
 */

import { getConfig, setConfig, resetConfig as apiResetConfig } from '../api.js';
import { deepMerge } from '../utils.js';

/** Default configuration (mirrors Voice Mirror Electron defaults) */
const DEFAULT_CONFIG = {
  wakeWord: {
    enabled: true,
    phrase: 'hey_claude',
    sensitivity: 0.5,
  },
  voice: {
    ttsAdapter: 'kokoro',
    ttsVoice: 'af_bella',
    ttsModelSize: '0.6B',
    ttsSpeed: 1.0,
    ttsVolume: 1.0,
    ttsApiKey: null,
    ttsEndpoint: null,
    ttsModelPath: null,
    sttModel: 'whisper-local',
    sttAdapter: 'whisper-local',
    sttModelSize: 'base',
    sttApiKey: null,
    sttEndpoint: null,
    sttModelName: null,
    inputDevice: null,
    outputDevice: null,
    announceStartup: true,
    announceProviderSwitch: true,
  },
  appearance: {
    orbSize: 80,
    theme: 'colorblind',
    panelWidth: 500,
    panelHeight: 700,
    colors: null,
    fonts: null,
    messageCard: {
      aiAvatar: 'cube',
      userAvatar: 'person',
      customAvatars: null,
    },
    orb: null,
  },
  behavior: {
    startMinimized: false,
    startWithSystem: false,
    hotkey: 'CommandOrControl+Shift+V',
    activationMode: 'wakeWord',
    pttKey: 'MouseButton4',
    statsHotkey: 'CommandOrControl+Shift+M',
    dictationKey: 'MouseButton5',
  },
  window: {
    orbX: null,
    orbY: null,
    expanded: false,
  },
  overlay: {
    outputName: null,
  },
  advanced: {
    debugMode: false,
    showDependencies: false,
  },
  sidebar: {
    collapsed: false,
  },
  user: {
    name: null,
  },
  system: {
    acceptedDisclaimer: false,
    firstLaunchDone: false,
    lastGreetingPeriod: null,
    lastSeenVersion: null,
  },
  ai: {
    provider: 'claude',
    model: null,
    contextLength: 32768,
    autoDetect: true,
    systemPrompt: null,
    toolProfile: 'voice-assistant',
    toolProfiles: {
      'voice-assistant': { groups: ['core', 'meta', 'screen', 'memory', 'browser'] },
      'n8n-workflows': { groups: ['core', 'meta', 'n8n'] },
      'web-browser': { groups: ['core', 'meta', 'screen', 'browser'] },
      'full-toolbox': { groups: ['core', 'meta', 'screen', 'memory', 'voice-clone', 'browser', 'n8n'] },
      'minimal': { groups: ['core', 'meta'] },
      'voice-assistant-lite': { groups: ['core', 'meta', 'screen', 'memory-facade', 'browser-facade'] },
    },
    endpoints: {
      ollama: 'http://127.0.0.1:11434',
      lmstudio: 'http://127.0.0.1:1234',
      jan: 'http://127.0.0.1:1337',
    },
    apiKeys: {
      openai: null,
      anthropic: null,
      gemini: null,
      grok: null,
      groq: null,
      mistral: null,
      openrouter: null,
      deepseek: null,
      kimi: null,
    },
  },
};

/**
 * Reactive config store.
 * Access config values via configStore.value (a plain object).
 */
function createConfigStore() {
  let value = $state(structuredClone(DEFAULT_CONFIG));
  let loaded = $state(false);
  let error = $state(null);

  return {
    get value() { return value; },
    get loaded() { return loaded; },
    get error() { return error; },

    /** Replace the entire config */
    set(newConfig) {
      value = deepMerge(DEFAULT_CONFIG, newConfig);
      loaded = true;
      error = null;
    },

    /** Reset to defaults */
    reset() {
      value = structuredClone(DEFAULT_CONFIG);
      loaded = true;
      error = null;
    },

    /** Mark an error */
    setError(msg) {
      error = msg;
    },
  };
}

export const configStore = createConfigStore();

/**
 * Fetch full config from the Tauri backend and populate the store.
 */
export async function loadConfig() {
  try {
    const result = await getConfig();
    if (result && result.success !== false) {
      configStore.set(result.data || result);
    }
  } catch (err) {
    console.error('[config] Failed to load:', err);
    configStore.setError(String(err));
  }
}

/**
 * Send a partial config update to the backend and merge into the store.
 * @param {Object} patch - Partial config object
 */
export async function updateConfig(patch) {
  try {
    const result = await setConfig(patch);
    if (result && result.success !== false) {
      configStore.set(result.data || deepMerge(configStore.value, patch));
    }
  } catch (err) {
    console.error('[config] Failed to update:', err);
    configStore.setError(String(err));
  }
}

/**
 * Reset config to defaults on both frontend and backend.
 */
export async function resetConfigToDefaults() {
  try {
    await apiResetConfig();
    configStore.reset();
  } catch (err) {
    console.error('[config] Failed to reset:', err);
    configStore.setError(String(err));
  }
}

export { DEFAULT_CONFIG };
