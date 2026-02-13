/**
 * state.js - Global state management
 * Central state object for Voice Mirror Electron
 */

export const state = {
    isExpanded: false,
    pendingImageData: null,
    // AI Provider state
    aiRunning: false,               // Whether AI provider is running (renamed from claudeRunning)
    currentProvider: null,          // Provider type: 'claude' | 'ollama' | 'lmstudio' | 'openai' | etc. (null until config loads)
    currentProviderName: '',        // Display name for UI (empty until config loads)
    currentModel: null,             // Model ID (e.g., 'llama3.2:latest', 'gpt-4')
    detectedProviders: [],          // List of auto-detected local providers
    // Terminal state
    terminalMinimized: false,
    recordingKeybind: null,
    currentConfig: {},
    // Screenshot + voice workflow
    awaitingVoiceForImage: false,  // True when we have an image waiting for voice
    imageVoiceTimeout: null,        // Timeout ID for auto-send
    imageVoicePrompt: null,         // Voice prompt to use with image
    // Navigation state
    currentPage: 'chat',            // 'chat' | 'terminal' | 'settings'
    sidebarCollapsed: false,        // Whether sidebar is collapsed to icons
    pendingProviderClear: false,    // Flag: clear terminal when new provider connects
    providerGeneration: 0           // Monotonic counter — incremented on each provider switch
};

// Deduplication: track recent messages to prevent duplicates
export const recentMessages = new Map();
export const DEDUP_WINDOW_MS = 5000;

// Markdown cache
export const MARKDOWN_CACHE_LIMIT = 200;
export const MARKDOWN_CACHE_MAX_CHARS = 50000;
export const MARKDOWN_CHAR_LIMIT = 140000;
export const markdownCache = new Map();
