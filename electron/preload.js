/**
 * Voice Mirror Electron - Preload Script
 *
 * Exposes safe IPC methods to the renderer process.
 */

const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('voiceMirror', {
    // Toggle between orb and expanded panel
    toggleExpand: () => ipcRenderer.invoke('toggle-expand'),

    // Capture screen for vision API
    getScreens: () => ipcRenderer.invoke('get-screens'),
    captureScreen: (sourceId) => ipcRenderer.invoke('capture-screen', sourceId),
    supportsVision: () => ipcRenderer.invoke('supports-vision'),

    // Get current state
    getState: () => ipcRenderer.invoke('get-state'),

    // Window dragging (for custom orb drag without -webkit-app-region)
    getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
    setWindowPosition: (x, y) => ipcRenderer.invoke('set-window-position', x, y),
    getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),

    // Drag capture - expand window temporarily to catch mouse events
    startDragCapture: () => ipcRenderer.invoke('start-drag-capture'),
    stopDragCapture: (x, y) => ipcRenderer.invoke('stop-drag-capture', x, y),

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

    // Overlay (Wayland orb) controls
    overlay: {
        listOutputs: () => ipcRenderer.invoke('list-overlay-outputs'),
    },

    // Theme import/export
    theme: {
        export: (data) => ipcRenderer.invoke('theme-export', data),
        import: () => ipcRenderer.invoke('theme-import'),
    },

    // Custom font management
    fonts: {
        upload: () => ipcRenderer.invoke('font-upload'),
        add: (filePath, type) => ipcRenderer.invoke('font-add', filePath, type),
        remove: (fontId) => ipcRenderer.invoke('font-remove', fontId),
        list: () => ipcRenderer.invoke('font-list'),
        getDataUrl: (fontId) => ipcRenderer.invoke('font-get-data-url', fontId),
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
        stop: () => ipcRenderer.invoke('stop-python'),

        // Restart Python backend (manual retry after failures)
        restart: () => ipcRenderer.invoke('python-restart'),

        // List available audio input/output devices
        listAudioDevices: () => ipcRenderer.invoke('list-audio-devices'),

        // Get provider names with auto-detected API keys (names only, not values)
        getDetectedKeys: () => ipcRenderer.invoke('get-detected-keys')
    },

    // Claude Code backend control
    claude: {
        // Start Claude Code backend
        start: () => ipcRenderer.invoke('start-claude'),

        // Stop Claude Code backend
        stop: () => ipcRenderer.invoke('stop-claude'),

        // Interrupt current operation (Ctrl+C for PTY, abort for API)
        interrupt: () => ipcRenderer.invoke('interrupt-ai'),

        // Get Claude process status
        getStatus: () => ipcRenderer.invoke('get-claude-status'),

        // Listen for Claude terminal output (raw PTY data for xterm.js)
        onOutput: (callback) => {
            ipcRenderer.on('claude-terminal', (event, data) => callback(data));
        },

        // Send input to Claude PTY (keyboard input from xterm.js)
        sendInput: (data) => ipcRenderer.invoke('claude-pty-input', data),

        // Resize Claude PTY (when xterm.js resizes)
        resize: (cols, rows) => ipcRenderer.invoke('claude-pty-resize', cols, rows)
    },

    // Clipboard access (for terminal paste on Windows)
    readClipboard: () => clipboard.readText(),

    // Browser panel control
    browser: {
        getStatus: () => ipcRenderer.invoke('browser-get-status'),
        popOut: () => ipcRenderer.invoke('browser-pop-out'),
        onStatusChange: (callback) => {
            ipcRenderer.on('browser-status', (event, data) => callback(data));
        }
    },

    // AI Provider control (model-agnostic)
    ai: {
        // Scan for available local providers (Ollama, LM Studio, Jan)
        scanProviders: () => ipcRenderer.invoke('ai-scan-providers'),

        // Get available providers (cached results from last scan)
        getProviders: () => ipcRenderer.invoke('ai-get-providers'),

        // Set active provider
        setProvider: (providerId, model) => ipcRenderer.invoke('ai-set-provider', providerId, model),

        // Get current provider info
        getProvider: () => ipcRenderer.invoke('ai-get-provider')
    },

    // Tool events (for local LLM tool system)
    tools: {
        // Listen for tool call events (when model invokes a tool)
        onToolCall: (callback) => {
            ipcRenderer.on('tool-call', (event, data) => callback(data));
        },

        // Listen for tool result events (when tool execution completes)
        onToolResult: (callback) => {
            ipcRenderer.on('tool-result', (event, data) => callback(data));
        },

        // Listen for MCP tool activity events (Claude Code file IPC watchers)
        onToolActivity: (callback) => {
            ipcRenderer.on('tool-activity', (event, data) => callback(data));
        }
    },

    // Chat history persistence
    chat: {
        list: () => ipcRenderer.invoke('chat-list'),
        load: (id) => ipcRenderer.invoke('chat-load', id),
        save: (chat) => ipcRenderer.invoke('chat-save', chat),
        delete: (id) => ipcRenderer.invoke('chat-delete', id),
        rename: (id, name) => ipcRenderer.invoke('chat-rename', id, name),
    },

    // Combined controls
    startAll: () => ipcRenderer.invoke('start-all'),
    stopAll: () => ipcRenderer.invoke('stop-all'),

    // Window controls
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    quitApp: () => ipcRenderer.invoke('quit-app'),

    // Dev logging — renderer → main process → vmr.log
    devlog: (category, action, data) => ipcRenderer.send('devlog', category, action, data),

    // Open external URLs in default browser
    openExternal: (url) => {
        // Block dangerous URL schemes at the preload boundary
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
            return Promise.resolve({ success: false, error: 'Only http/https URLs allowed' });
        }
        return ipcRenderer.invoke('open-external', url);
    },

    // Listen for open-settings command from tray menu
    onOpenSettings: (callback) => {
        ipcRenderer.on('open-settings', () => callback());
    },

    // Performance monitor
    onPerfStats: (callback) => {
        ipcRenderer.on('perf-stats', (event, data) => callback(data));
    },
    onContextUsage: (callback) => {
        ipcRenderer.on('context-usage', (event, data) => callback(data));
    },
    togglePerfMonitor: () => ipcRenderer.send('toggle-perf-monitor'),
    onToggleStatsBar: (callback) => {
        ipcRenderer.on('toggle-stats-bar', () => callback());
    },

    // Update checker
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, data) => callback(data));
    },
    onUpdateStatus: (callback) => {
        ipcRenderer.on('update-status', (event, data) => callback(data));
    },
    applyUpdate: () => ipcRenderer.invoke('apply-update'),
    relaunch: () => ipcRenderer.invoke('app-relaunch'),

    // Hotkey fallback — renderer sends this when it detects the hotkey via DOM keydown
    // (only honored if primary uiohook + globalShortcut layers both failed)
    hotkeyFallback: (id) => ipcRenderer.send('hotkey-fallback', id)
});
