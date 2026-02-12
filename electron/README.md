# Electron App

The main Electron application for Voice Mirror - a voice-controlled AI overlay.

## Structure

```
electron/
├── main.js                 # Main process entry point
├── preload.js              # Security bridge (contextBridge)
├── config.js               # Cross-platform configuration
├── claude-spawner.js       # Claude Code PTY spawning
├── overlay.html            # Main HTML (3 pages)
│
├── window/                 # Window management
│   ├── index.js            # Window manager service
│   └── tray.js             # System tray integration
│
├── services/               # Main process services
│   ├── ai-manager.js       # AI provider orchestration
│   ├── python-backend.js   # Python voice processing bridge
│   ├── inbox-watcher.js    # MCP inbox polling
│   ├── screen-capture-watcher.js  # Screenshot requests
│   ├── browser-watcher.js  # Web search/fetch requests
│   ├── provider-detector.js # Local LLM auto-detection
│   ├── push-to-talk.js     # PTT key binding
│   └── logger.js           # File logging
│
├── providers/              # AI provider system
│   ├── index.js            # Provider factory
│   ├── base-provider.js    # Abstract base class
│   ├── claude-provider.js  # Claude Code PTY wrapper
│   └── openai-provider.js  # OpenAI-compatible wrapper
│
├── browser/                # Web browser integration
│   ├── index.js            # Module exports
│   ├── browser-session.js  # Playwright session management
│   ├── browser-search.js   # Search implementations
│   ├── browser-fetch.js    # URL content fetching
│   ├── serper-search.js    # Serper.dev API wrapper
│   └── browser-utils.js    # Anti-detection utilities
│
├── tools/                  # Tool system for local LLMs
│   ├── index.js            # Tool executor & parser
│   ├── definitions.js      # Tool schemas
│   ├── prompts.js          # System prompts
│   └── handlers/           # Tool implementations
│       ├── capture-screen.js
│       ├── memory.js
│       ├── n8n.js
│       └── web-search.js
│
├── js/                     # Renderer JavaScript (ES modules)
│   ├── main.js             # App initialization
│   ├── state.js            # Global state management
│   ├── terminal.js         # ghostty-web terminal + AI control
│   ├── messages.js         # Chat UI & deduplication
│   ├── navigation.js       # Sidebar + page routing
│   ├── settings.js         # Settings UI
│   ├── markdown.js         # Markdown rendering
│   ├── notifications.js    # Toast notifications
│   └── utils.js            # Utility functions
│
└── styles/                 # CSS modules
    ├── tokens.css          # Design tokens
    ├── base.css            # Global styles
    ├── orb.css             # Floating orb
    ├── panel.css           # Expanded panel
    ├── sidebar.css         # Sidebar navigation
    ├── chat.css            # Chat messages
    ├── terminal.css        # Terminal styling (ghostty-web canvas)
    ├── settings.css        # Settings page
    └── notifications.css   # Toast notifications
```

## Architecture

### Main Process (`main.js`)
Orchestrates all services and handles IPC:
- Window creation & lifecycle
- Service initialization (Python, AI, watchers)
- IPC handlers for 40+ operations
- Global shortcut registration

### Service Layer
Modular services for separation of concerns:
- **ai-manager**: Routes between Claude PTY and API providers
- **python-backend**: JSON IPC bridge to Python voice processing
- **inbox-watcher**: Polls MCP inbox for messages
- **screen-capture-watcher**: Fulfills screenshot requests
- **browser-watcher**: Handles web search/fetch requests
- **provider-detector**: Auto-detects Ollama, LM Studio, Jan
- **push-to-talk**: Global key binding (mouse/keyboard)
- **logger**: File logging with color-coded output

### Provider System
Supports 11+ AI providers:
- **Claude Code** (PTY-based, MCP tools, vision)
- **Local**: Ollama (11434), LM Studio (1234), Jan (1337)
- **Cloud**: OpenAI, Gemini, Groq, Mistral, OpenRouter, DeepSeek, Grok

### Browser System
Dual-path web access:
- **Serper.dev API**: Fast, no browser overhead
- **Playwright fallback**: Full JS rendering

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

  // Python backend
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
