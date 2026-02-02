/**
 * state.js - Global state management
 * Central state object for Voice Mirror Electron
 */

export const state = {
    isExpanded: false,
    pendingImageData: null,
    callModeActive: false,
    // AI Provider state
    aiRunning: false,               // Whether AI provider is running (renamed from claudeRunning)
    currentProvider: 'claude',      // Provider type: 'claude' | 'ollama' | 'lmstudio' | 'openai' | etc.
    currentProviderName: 'Claude Code',  // Display name for UI
    currentModel: null,             // Model ID (e.g., 'llama3.2:latest', 'gpt-4')
    detectedProviders: [],          // List of auto-detected local providers
    // Terminal state
    terminalVisible: false,         // Whether terminal panel is visible on chat page
    terminalMinimized: false,
    terminalLocation: 'fullscreen', // 'fullscreen' | 'chat-bottom' - where terminal is displayed
    settingsVisible: false,
    recordingKeybind: null,
    currentConfig: {},
    // Screenshot + voice workflow
    awaitingVoiceForImage: false,  // True when we have an image waiting for voice
    imageVoiceTimeout: null,        // Timeout ID for auto-send
    imageVoicePrompt: null,         // Voice prompt to use with image
    // Navigation state
    currentPage: 'chat',            // 'chat' | 'terminal' | 'settings'
    sidebarCollapsed: false,        // Whether sidebar is collapsed to icons
    pendingProviderClear: false     // Flag: clear terminal when new provider connects
};

// Deduplication: track recent messages to prevent duplicates
export const recentMessages = new Map();
export const DEDUP_WINDOW_MS = 5000;

// Markdown cache
export const MARKDOWN_CACHE_LIMIT = 200;
export const MARKDOWN_CACHE_MAX_CHARS = 50000;
export const MARKDOWN_CHAR_LIMIT = 140000;
export const markdownCache = new Map();
