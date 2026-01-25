/**
 * Voice Mirror Electron - Preload Script
 *
 * Exposes safe IPC methods to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceMirror', {
    // Toggle between orb and expanded panel
    toggleExpand: () => ipcRenderer.invoke('toggle-expand'),

    // Capture screen for vision API
    captureScreen: () => ipcRenderer.invoke('capture-screen'),

    // Get current state
    getState: () => ipcRenderer.invoke('get-state'),

    // Listen for state changes
    onStateChange: (callback) => {
        ipcRenderer.on('state-change', (event, data) => callback(data));
    },

    // Listen for voice events (wake, recording, speaking, idle)
    onVoiceEvent: (callback) => {
        ipcRenderer.on('voice-event', (event, data) => callback(data));
    },

    // Configuration API
    config: {
        // Get full config object
        get: () => ipcRenderer.invoke('get-config'),

        // Update config (partial update, merged with existing)
        set: (updates) => ipcRenderer.invoke('set-config', updates),

        // Reset to defaults
        reset: () => ipcRenderer.invoke('reset-config'),

        // Get platform-specific paths and info
        getPlatformInfo: () => ipcRenderer.invoke('get-platform-info')
    },

    // Send image to Python backend for Claude vision
    sendImageToBackend: (imageData) => ipcRenderer.invoke('send-image', imageData),

    // Listen for responses from backend
    onBackendResponse: (callback) => {
        ipcRenderer.on('backend-response', (event, data) => callback(data));
    },

    // Listen for chat messages (transcriptions and responses)
    onChatMessage: (callback) => {
        ipcRenderer.on('chat-message', (event, data) => callback(data));
    },

    // Python backend control
    python: {
        // Send a text/image query to Python
        sendQuery: (query) => ipcRenderer.invoke('send-query', query),

        // Set voice mode (auto, local, claude)
        setMode: (mode) => ipcRenderer.invoke('set-voice-mode', mode),

        // Get Python process status
        getStatus: () => ipcRenderer.invoke('get-python-status'),

        // Start Python backend
        start: () => ipcRenderer.invoke('start-python'),

        // Stop Python backend
        stop: () => ipcRenderer.invoke('stop-python')
    }
});
