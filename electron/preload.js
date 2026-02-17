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
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('state-change', handler);
        return () => ipcRenderer.removeListener('state-change', handler);
    },

    // Listen for voice events (wake, recording, speaking, idle)
    onVoiceEvent: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('voice-event', handler);
        return () => ipcRenderer.removeListener('voice-event', handler);
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
        getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),

        // Browse for a model file (returns { success, data: filePath })
        browseModelFile: (fileType) => ipcRenderer.invoke('browse-model-file', fileType)
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

    // Send image to voice backend for Claude vision
    sendImageToBackend: (imageData) => ipcRenderer.invoke('send-image', imageData),

    // Listen for chat messages (transcriptions and responses)
    onChatMessage: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('chat-message', handler);
        return () => ipcRenderer.removeListener('chat-message', handler);
    },

    // Voice backend control (Rust voice-core process)
    voice: {
        sendQuery: (query) => ipcRenderer.invoke('send-query', query),
        setMode: (mode) => ipcRenderer.invoke('set-voice-mode', mode),
        getStatus: () => ipcRenderer.invoke('get-voice-status'),
        start: () => ipcRenderer.invoke('start-voice'),
        stop: () => ipcRenderer.invoke('stop-voice'),
        restart: () => ipcRenderer.invoke('voice-restart'),
        listAudioDevices: () => ipcRenderer.invoke('list-audio-devices'),
        getDetectedKeys: () => ipcRenderer.invoke('get-detected-keys'),
        stopSpeaking: () => ipcRenderer.invoke('stop-speaking')
    },

    // Claude Code backend control
    claude: {
        // Start Claude Code backend
        start: (cols, rows) => ipcRenderer.invoke('start-claude', cols, rows),

        // Stop Claude Code backend
        stop: () => ipcRenderer.invoke('stop-claude'),

        // Interrupt current operation (Ctrl+C for PTY, abort for API)
        interrupt: () => ipcRenderer.invoke('interrupt-ai'),

        // Get Claude process status
        getStatus: () => ipcRenderer.invoke('get-claude-status'),

        // Listen for Claude terminal output (raw PTY data for terminal)
        onOutput: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('claude-terminal', handler);
            return () => ipcRenderer.removeListener('claude-terminal', handler);
        },

        // Send input to Claude PTY (keyboard input from terminal)
        sendInput: (data) => ipcRenderer.invoke('claude-pty-input', data),

        // Resize Claude PTY (when terminal resizes)
        resize: (cols, rows) => ipcRenderer.invoke('claude-pty-resize', cols, rows)
    },

    // Clipboard access (for terminal copy/paste)
    readClipboard: () => clipboard.readText(),
    writeClipboard: (text) => clipboard.writeText(text),

    // Browser panel control
    browser: {
        getStatus: () => ipcRenderer.invoke('browser-get-status'),
        popOut: () => ipcRenderer.invoke('browser-pop-out'),
        onStatusChange: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('browser-status', handler);
            return () => ipcRenderer.removeListener('browser-status', handler);
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
        getProvider: () => ipcRenderer.invoke('ai-get-provider'),

        // Check if a CLI tool is available on PATH
        checkCLIAvailable: (command) => ipcRenderer.invoke('check-cli-available', command),

        // Install a CLI tool via npm global install
        installCLI: (packageName) => ipcRenderer.invoke('install-cli', packageName),

        // Check dependency versions (ghostty-web, opencode)
        checkDependencyVersions: () => ipcRenderer.invoke('check-dependency-versions'),

        // Update a specific dependency
        updateDependency: (depId) => ipcRenderer.invoke('update-dependency', depId),

    },

    // Tool events (for local LLM tool system)
    tools: {
        // Listen for tool call events (when model invokes a tool)
        onToolCall: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('tool-call', handler);
            return () => ipcRenderer.removeListener('tool-call', handler);
        },

        // Listen for tool result events (when tool execution completes)
        onToolResult: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('tool-result', handler);
            return () => ipcRenderer.removeListener('tool-result', handler);
        },

        // Listen for MCP tool activity events (Claude Code file IPC watchers)
        onToolActivity: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('tool-activity', handler);
            return () => ipcRenderer.removeListener('tool-activity', handler);
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
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    quitApp: () => ipcRenderer.invoke('quit-app'),

    // Frameless window resize (transparent windows lack native resize edges)
    getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
    setWindowBounds: (x, y, w, h) => ipcRenderer.send('set-window-bounds', x, y, w, h),
    saveWindowBounds: () => ipcRenderer.invoke('save-window-bounds'),

    // Uninstall
    runUninstall: (keepConfig) => ipcRenderer.invoke('run-uninstall', !!keepConfig),

    // Dev logging — renderer → main process → vmr.log
    devlog: (category, action, data) => ipcRenderer.send('devlog', category, action, data),

    // Toggle the log viewer window
    toggleLogViewer: () => ipcRenderer.invoke('toggle-log-viewer'),

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
        const handler = () => callback();
        ipcRenderer.on('open-settings', handler);
        return () => ipcRenderer.removeListener('open-settings', handler);
    },

    // Performance monitor
    onPerfStats: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('perf-stats', handler);
        return () => ipcRenderer.removeListener('perf-stats', handler);
    },
    onContextUsage: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('context-usage', handler);
        return () => ipcRenderer.removeListener('context-usage', handler);
    },
    togglePerfMonitor: () => ipcRenderer.send('toggle-perf-monitor'),
    onToggleStatsBar: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('toggle-stats-bar', handler);
        return () => ipcRenderer.removeListener('toggle-stats-bar', handler);
    },

    // Update checker
    onUpdateAvailable: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('update-available', handler);
        return () => ipcRenderer.removeListener('update-available', handler);
    },
    onUpdateStatus: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('update-status', handler);
        return () => ipcRenderer.removeListener('update-status', handler);
    },
    applyUpdate: () => ipcRenderer.invoke('apply-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    relaunch: () => ipcRenderer.invoke('app-relaunch'),

    // Hotkey fallback — renderer sends this when it detects the hotkey via DOM keydown
    // (only honored if globalShortcut registration failed)
    hotkeyFallback: (id) => ipcRenderer.send('hotkey-fallback', id)
});
