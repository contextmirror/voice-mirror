# Electron App

The main Electron application for Voice Mirror - a voice-controlled AI overlay.

## Structure

```
electron/
├── main.js                 # Main process entry point
├── preload.js              # Security bridge (contextBridge)
├── config.js               # Cross-platform configuration
├── constants.js            # Shared constants
├── overlay.html            # Main HTML (3 pages)
│
├── window/                 # Window management
│   ├── index.js            # Window manager service
│   └── tray.js             # System tray integration
│
├── ipc/                    # IPC bridge modules
│   ├── index.js            # IPC registration entry point
│   ├── validators.js       # IPC argument validation
│   ├── ai.js               # AI provider IPC handlers
│   ├── config.js           # Configuration IPC handlers
│   ├── misc.js             # Miscellaneous IPC handlers
│   ├── screen.js           # Screen capture IPC handlers
│   └── window.js           # Window management IPC handlers
│
├── lib/                    # Shared utilities
│   ├── json-file-watcher.js     # JSON file change watcher
│   ├── ollama-launcher.js       # Ollama process launcher
│   ├── safe-path.js             # Safe path resolution
│   └── windows-screen-capture.js # Windows screen capture
│
├── services/               # Main process services
│   ├── ai-manager.js       # AI provider orchestration
│   ├── voice-backend.js    # Rust voice-core process bridge
│   ├── inbox-watcher.js    # MCP inbox polling
│   ├── screen-capture-watcher.js  # Screenshot requests
│   ├── browser-watcher.js  # Web search/fetch requests
│   ├── provider-detector.js # Local LLM auto-detection
│   ├── hotkey-manager.js   # Global hotkey binding (PTT, shortcuts)
│   ├── logger.js           # File logging
│   ├── diagnostic-collector.js  # Diagnostic data collection
│   ├── diagnostic-watcher.js    # Diagnostic request watcher
│   ├── perf-monitor.js     # Performance monitoring
│   ├── platform-paths.js   # Platform-specific path resolution
│   ├── uiohook-shared.js   # Shared uiohook utilities
│   ├── update-checker.js   # App update checking
│   └── wayland-orb.js      # Wayland orb rendering
│
├── providers/              # AI provider system
│   ├── index.js            # Provider factory
│   ├── base-provider.js    # Abstract base class
│   ├── claude-provider.js  # Claude Code PTY wrapper
│   ├── claude-spawner.js   # Claude Code PTY spawning
│   ├── cli-provider.js     # Generic CLI provider wrapper
│   ├── cli-spawner.js      # CLI-based provider PTY spawning
│   └── openai-provider.js  # OpenAI-compatible wrapper
│
├── browser/                # Web browser integration (CDP-based)
│   ├── index.js            # Module exports
│   ├── browser-controller.js    # Browser lifecycle & session management
│   ├── browser-search.js   # Search implementations
│   ├── browser-fetch.js    # URL content fetching
│   ├── search-utils.js     # Search result parsing utilities
│   ├── role-refs.js         # ARIA role references
│   ├── webview-actions.js   # Webview user actions
│   ├── webview-cdp.js       # Chrome DevTools Protocol client
│   └── webview-snapshot.js  # Webview page snapshots
│
├── tools/                  # Tool system for local LLMs
│   ├── index.js            # Tool executor & parser
│   ├── definitions.js      # Tool schemas
│   ├── openai-schema.js    # OpenAI-format tool schemas
│   ├── prompts.js          # System prompts
│   └── handlers/           # Tool implementations
│       ├── index.js         # Handler registry
│       ├── browser-control.js
│       ├── capture-screen.js
│       ├── memory.js
│       └── n8n.js
│
├── renderer/               # Renderer JavaScript (ES modules) + CSS
│   ├── main.js             # App initialization
│   ├── state.js            # Global state management
│   ├── terminal.js         # ghostty-web terminal + AI control
│   ├── messages.js         # Chat UI & deduplication
│   ├── navigation.js       # Sidebar + page routing
│   ├── settings.js         # Settings UI
│   ├── markdown.js         # Markdown rendering
│   ├── notifications.js    # Toast notifications
│   ├── utils.js            # Utility functions
│   ├── log.js              # Client-side logging
│   ├── browser-panel.js    # Browser panel UI
│   ├── chat-input.js       # Chat input component
│   ├── chat-store.js       # Chat message persistence
│   ├── orb-canvas.js       # Orb canvas rendering
│   ├── theme-engine.js     # Theme management
│   └── styles/             # CSS modules
│       ├── tokens.css      # Design tokens
│       ├── base.css        # Global styles
│       ├── orb.css         # Floating orb
│       ├── panel.css       # Expanded panel
│       ├── sidebar.css     # Sidebar navigation
│       ├── chat.css        # Chat messages
│       ├── browser.css     # Browser panel
│       ├── terminal.css    # Terminal styling (ghostty-web canvas)
│       ├── settings.css    # Settings page
│       └── notifications.css # Toast notifications
│
├── templates/              # Settings page HTML templates
│   ├── settings-ai.html
│   ├── settings-appearance.html
│   ├── settings-general.html
│   └── settings-voice.html
```

## Architecture

### Main Process (`main.js`)
Orchestrates all services and delegates IPC to `ipc/` modules:
- Window creation & lifecycle
- Service initialization (voice backend, AI, watchers)
- Global shortcut registration

### IPC Layer (`ipc/`)
Modular IPC handlers split by domain (ai, config, misc, screen, window), registered via `ipc/index.js`.

### Service Layer
Modular services for separation of concerns:
- **ai-manager**: Routes between Claude PTY and API providers
- **voice-backend**: JSON IPC bridge to Rust voice-core
- **inbox-watcher**: Polls MCP inbox for messages
- **screen-capture-watcher**: Fulfills screenshot requests
- **browser-watcher**: Handles web search/fetch requests
- **provider-detector**: Auto-detects Ollama, LM Studio, Jan
- **hotkey-manager**: Global key binding (mouse/keyboard PTT, shortcuts)
- **logger**: File logging with color-coded output
- **update-checker**: App update checking
- **perf-monitor**: Performance monitoring
- **diagnostic-collector / diagnostic-watcher**: Diagnostic data collection

### Provider System
Supports 11+ AI providers:
- **Claude Code** (PTY-based, MCP tools, vision)
- **Local**: Ollama (11434), LM Studio (1234), Jan (1337)
- **Cloud**: OpenAI, Gemini, Groq, Mistral, OpenRouter, DeepSeek, Grok

### Browser System
CDP-based web automation via Electron's webview tag:
- **browser-controller**: Session lifecycle management
- **webview-cdp**: Chrome DevTools Protocol client
- **browser-search / search-utils**: Web search with result parsing
- **browser-fetch**: URL content fetching
- **webview-actions / webview-snapshot**: Page interaction and snapshots

### Tool System
For local LLMs that support function calling:
- Tool schema definitions
- Call parsing from model output
- Result injection with truncation
- Timeout handling (30s)

## Key Features

### Orb Visual States
| State | Color | Animation |
|-------|-------|-----------|
| Idle | Purple gradient | Gentle pulse |
| Recording | Pink/Red | Fast pulse |
| Speaking | Blue/Cyan | Wave effect |
| Thinking | Purple | Spin |

### Window Modes
- **Collapsed**: 64px draggable orb
- **Expanded**: 500x700px panel with sidebar

### IPC API (via preload)
```javascript
window.voiceMirror = {
  // Core UI
  toggleExpand, captureScreen, getState,

  // Voice backend (Rust voice-core)
  python: { sendQuery, setMode, start, stop },

  // AI provider
  claude: { start, stop, sendInput, resize },
  ai: { scanProviders, getProviders, setProvider },

  // Configuration
  config: { get, set, reset }
}
```

## Development

### Run in dev mode
```bash
npm run dev
```

### Debug with GPU issues
```bash
npm start -- --disable-gpu
```

### Logs
```bash
tail -f ~/.config/voice-mirror-electron/data/vmr.log
```

## Dependencies

| Package | Purpose |
|---------|---------|
| electron | Desktop framework |
| ghostty-web | Terminal emulator (WASM) |
| node-pty | PTY spawning |
| marked + dompurify | Markdown rendering |
| uiohook-napi | Global hotkeys |
| playwright-core | Browser automation |
