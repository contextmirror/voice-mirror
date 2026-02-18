# Voice Mirror Electron - Development Guide

## Quick Start

```bash
# Install dependencies
npm install

# Start Electron (dev mode)
npm start

# Start with dev flag (additional logging)
npm run dev

# Interactive onboarding wizard (first-time setup)
npm run setup

# Check system health and dependencies
npm run doctor

# Build distributable
npm run build
```

---

## Project Structure

```
Voice Mirror Electron/
├── electron/
│   ├── main.js              # Window management, tray, IPC orchestration
│   ├── preload.js           # Security bridge to renderer
│   ├── config.js            # Cross-platform config (defaults + load/save)
│   ├── constants.js         # Shared constants (CLI_PROVIDERS, DEFAULT_ENDPOINTS)
│   ├── overlay.html         # Main HTML shell
│   ├── log-viewer.html      # Log viewer window
│   ├── preload-log-viewer.js
│   ├── ipc/                 # IPC handler modules (9 files)
│   │   ├── index.js         # IPC registration entry point
│   │   ├── ai.js            # AI provider IPC handlers
│   │   ├── config.js        # Config read/write IPC
│   │   ├── misc.js          # Misc IPC (open-external, theme import/export, fonts)
│   │   ├── screen.js        # Screen capture IPC
│   │   ├── validators.js    # Input validation for all IPC channels
│   │   ├── voice.js         # Voice backend IPC
│   │   └── window.js        # Window management IPC
│   ├── renderer/            # Renderer modules (26 files)
│   │   ├── main.js          # Renderer entry point
│   │   ├── state.js         # Shared renderer state
│   │   ├── navigation.js    # Page navigation (dashboard, settings, browser)
│   │   ├── terminal.js      # ghostty-web terminal (Claude PTY)
│   │   ├── messages.js      # Chat message rendering
│   │   ├── chat-input.js    # Chat input box
│   │   ├── chat-store.js    # Chat history persistence
│   │   ├── markdown.js      # Markdown rendering (marked + DOMPurify)
│   │   ├── orb-canvas.js    # Animated orb (pixel-level rendering)
│   │   ├── theme-engine.js  # Theme presets, derivation, CSS variable system
│   │   ├── settings.js      # Settings coordinator
│   │   ├── settings-ai.js   # AI provider settings tab
│   │   ├── settings-appearance.js  # Appearance/theme settings tab
│   │   ├── settings-voice.js       # Voice settings tab
│   │   ├── settings-dependencies.js # Dependencies settings tab
│   │   ├── voice-handler.js # Voice event handling
│   │   ├── ai-status.js     # AI provider status display
│   │   ├── browser-panel.js # Embedded browser panel
│   │   ├── image-handler.js # Image paste/drag handling
│   │   ├── notifications.js # Toast notification system
│   │   ├── resize.js        # Panel resize handling
│   │   ├── whats-new.js     # What's New dialog (post-update)
│   │   ├── utils.js         # Shared utilities
│   │   ├── log.js           # Renderer-side logger
│   │   └── styles/          # CSS modules (12 files)
│   ├── window/              # Window & tray management
│   ├── providers/           # Multi-AI provider system (10 files)
│   │   ├── base-provider.js # Base provider class
│   │   ├── claude-provider.js    # Claude Code PTY provider
│   │   ├── claude-spawner.js     # Claude PTY process spawner
│   │   ├── claude-instructions.js # Claude system instructions
│   │   ├── cli-provider.js       # Generic CLI agent provider
│   │   ├── cli-spawner.js        # Generic CLI agent spawner
│   │   ├── openai-provider.js    # OpenAI-compatible HTTP provider
│   │   ├── tui-renderer.js       # TUI output renderer
│   │   └── index.js              # Provider registry
│   ├── services/            # Service modules (17 files)
│   │   ├── ai-manager.js    # AI provider lifecycle management
│   │   ├── voice-backend.js # Voice-core binary management
│   │   ├── hotkey-manager.js # Global hotkey registration + auto-recovery
│   │   ├── browser-watcher.js    # MCP browser request watcher
│   │   ├── screen-capture-watcher.js # Screen capture request watcher
│   │   ├── inbox-watcher.js      # MCP inbox message watcher
│   │   ├── provider-detector.js  # Local LLM auto-detection
│   │   ├── perf-monitor.js       # CPU/memory sampling + CSV logging
│   │   ├── diagnostic-collector.js # Diagnostic data collection
│   │   ├── diagnostic-watcher.js   # Diagnostic request watcher
│   │   ├── font-manager.js  # Custom font management
│   │   ├── logger.js        # File logging with color-coded output
│   │   ├── log-viewer.js    # Log viewer window service
│   │   ├── update-checker.js # Git-based update checker
│   │   ├── wayland-orb.js   # Native Rust layer-shell overlay (Linux/Wayland)
│   │   └── platform-paths.js # Platform-specific path resolution
│   ├── browser/             # Chrome/Chromium automation (10 files, CDP + Playwright)
│   ├── tools/               # Tool system for local LLMs
│   ├── templates/           # Settings HTML templates (5 files)
│   └── lib/                 # Shared libraries (filtered-env, json-file-watcher, etc.)
├── voice-core/              # Rust voice processing binary
│   ├── src/                 # STT (whisper), wake word, audio pipeline
│   └── Cargo.toml           # Rust dependencies
├── mcp-server/              # MCP server (59 tools, 11 groups including facades)
│   ├── handlers/            # Tool group handlers (core, screen, memory, voice-clone, browser, n8n, diagnostic, facades)
│   ├── lib/memory/          # Memory system with embeddings + SQLite FTS5
│   ├── tool-groups.js       # Tool schema definitions
│   └── index.js             # Server wiring and request handling
├── wayland-orb/             # Rust native layer-shell overlay (Linux/Wayland)
│   └── src/                 # main.rs, renderer.rs, ipc.rs
├── chrome-extension/        # Browser relay extension (MV3)
├── cli/                     # CLI tool (setup, doctor, uninstall, start)
│   ├── index.mjs            # CLI entry point (commander-based)
│   ├── setup.mjs            # Interactive onboarding wizard
│   ├── doctor.mjs           # System health checker
│   ├── uninstall.mjs        # Uninstaller
│   └── dependency-setup.mjs # Dependency installation helpers
├── scripts/
│   ├── launch.js            # Cross-platform Electron launcher
│   └── launch-hidden.vbs    # Windows silent launcher
├── test/
│   ├── unit/                # Unit tests (35 files)
│   ├── integration/         # Integration tests (service lifecycle + 8 suites)
│   └── lib/                 # Test helpers
├── assets/                  # Icons
├── docs/                    # Documentation
└── package.json
```

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `node scripts/launch.js` | Launch Electron (cross-platform launcher) |
| `dev` | `node scripts/launch.js --dev` | Launch with dev flag (extra logging) |
| `build` | `electron-builder` | Build distributable packages |
| `build:voice-core` | `cd voice-core && cargo build --release` | Build Rust voice-core binary |
| `setup` | `node cli/index.mjs setup` | Interactive onboarding wizard |
| `doctor` | `node cli/index.mjs doctor` | Check system health and dependencies |
| `test` | `node --test test/unit/*.test.js test/integration/*.test.js mcp-server/lib/memory/*.test.js mcp-server/handlers/*.test.js` | Run all tests (unit + integration + MCP) |

---

## Launch System

### `scripts/launch.js`

The cross-platform Node.js launcher replaces platform-specific shell commands. It handles:

1. **ELECTRON_RUN_AS_NODE removal** -- unsets the environment variable that VSCode sets, which would prevent Electron from launching as a GUI app.
2. **Linux-specific flags** -- automatically adds `--ozone-platform=x11`, `--disable-gpu`, and `--no-sandbox` on Linux for Wayland/X11 compatibility.
3. **Dev mode pass-through** -- forwards `--dev` flag when using `npm run dev`.
4. **Electron binary resolution** -- uses `require.resolve('electron/cli.js')` to find the correct Electron binary.

### `scripts/launch-hidden.vbs`

Windows-only VBScript for launching the app without a visible console window.

### CLI Launcher

The `cli/` directory provides a `voice-mirror` CLI tool (registered as a `bin` entry in package.json):

```bash
voice-mirror setup       # Interactive onboarding wizard
voice-mirror doctor      # Check system health and dependencies
voice-mirror start       # Launch Voice Mirror
voice-mirror uninstall   # Remove Voice Mirror from system
```

---

## Dependencies

### Electron (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| electron | ^40.0.0 | Desktop framework (devDependency) |
| ghostty-web | ^0.4.0 | Terminal emulator (GPU-accelerated, WebGL) |
| node-pty | ^1.1.0 | PTY spawning for CLI agents |
| marked | ^17.0.1 | Markdown rendering |
| dompurify | ^3.3.1 | HTML sanitization |
| playwright-core | ^1.58.0 | Headless browser for web search/automation |
| ws | ^8.19.0 | WebSocket server |
| electron-updater | ^6.3.0 | Auto-update support |
| commander | ^14.0.3 | CLI argument parsing |
| @clack/prompts | ^1.0.0 | Interactive CLI prompts |
| chalk | ^5.6.2 | CLI colored output |
| electron-builder | ^26.0.0 | Distribution packaging (devDependency) |

### MCP Server (mcp-server/)

| Package | Purpose |
|---------|---------|
| @modelcontextprotocol/sdk | MCP protocol |
| better-sqlite3 | SQLite with FTS5 for memory |
| chokidar | File watching for sync |
| node-llama-cpp | Local embeddings (optional) |

### External Tools

| Tool | Purpose |
|------|---------|
| ffmpeg | Audio processing for voice cloning |
| yt-dlp | Download audio from YouTube/etc. |

---

## Build Targets

| Platform | Format | Command |
|----------|--------|---------|
| Linux | AppImage | `npm run build` |
| macOS | DMG | `npm run build` |
| Windows | NSIS | `npm run build` |

Output goes to `dist/` folder. The Rust `voice-core` binary is automatically built via the `prebuild` script before packaging.

---

## Testing

Tests use `node:test` and `node:assert/strict` (source-inspection style -- tests read and analyze source code).

### Test Paths

| Path | Type | Files |
|------|------|-------|
| `test/unit/*.test.js` | Unit tests | 35 files |
| `test/integration/suites/*.js` | Integration test suites | 8 suites |
| `test/integration/service-lifecycle.test.js` | Service lifecycle test | 1 file |
| `mcp-server/lib/memory/*.test.js` | Memory system tests | 8 files |
| `mcp-server/handlers/*.test.js` | MCP handler tests | 1 file |

### Running Tests

```bash
# Run all tests
npm test

# Run a specific test file
node --test test/unit/config-rw.test.js

# Run integration tests only
node --test test/integration/*.test.js
```

---

## Logging & Debugging

**Log file:** `~/.config/voice-mirror-electron/data/vmr.log`

**Monitor in real-time:**
```bash
tail -f ~/.config/voice-mirror-electron/data/vmr.log
```

**Log levels:**
- `CONFIG` - Configuration changes
- `EVENT` - Voice events
- `VOICE` - voice-core messages
- `APP` - Application lifecycle
- `HOTKEY` - Hotkey registration and triggers
- `ERROR` - Errors

---

## VS Code Integration

### Debug Configurations (launch.json)

1. **Debug Electron Main** - Remote debugging on port 9222
2. **Debug Electron (No GPU)** - Same with `--disable-gpu`

### Tasks (tasks.json)

- Start Electron
- Start Electron (No GPU)
- Build AppImage
- npm install

---

## Architecture Notes

### Terminal Rendering

The terminal uses **ghostty-web ^0.4.0**, a GPU-accelerated WebGL terminal emulator. It replaces the previous xterm.js stack and provides better performance for rendering Claude Code's TUI output. The terminal module is at `electron/renderer/terminal.js`.

### Provider System

The multi-AI provider system supports two categories:

**CLI Agent Providers** (PTY-based, full terminal access):
- **Claude Code** -- Full terminal with MCP tools
- **OpenCode** -- Alternative CLI agent

**Local LLM Providers** (OpenAI-compatible HTTP API):
- **Ollama** -- Auto-detected at `http://127.0.0.1:11434`
- **LM Studio** -- Auto-detected at `http://127.0.0.1:1234`
- **Jan** -- Auto-detected at `http://127.0.0.1:1337`

Local providers are auto-detected via `/v1/models` endpoint probing.

### IPC Architecture

IPC handlers are organized into dedicated modules under `electron/ipc/`:

```
Renderer ←→ Preload (contextBridge) ←→ Main Process (ipc/ handlers)
                                           ↓
                              voice-core (Rust binary, stdin/stdout JSON)
                                           ↓
                              Claude PTY or HTTP API
```

IPC channels have input validation via `electron/ipc/validators.js`, which validates all renderer-to-main messages before processing.

### MCP Integration

Voice Mirror exposes an MCP server with **59 tools across 11 groups** (8 full + 3 facade):

| Group | Always Loaded | Tools | Description |
|-------|:---:|:---:|---|
| **core** | Yes | 4 | `claude_send`, `claude_inbox`, `claude_listen`, `claude_status` |
| **meta** | Yes | 3 | `load_tools`, `unload_tools`, `list_tool_groups` |
| **screen** | No | 1 | `capture_screen` |
| **memory** | No | 6 | search, get, remember, forget, stats, flush |
| **voice-clone** | No | 3 | clone, clear, list |
| **browser** | No | 16 | Full CDP automation (start, navigate, screenshot, snapshot, act, search, fetch, tabs, console) |
| **n8n** | No | 22 | Workflow CRUD, executions, credentials, tags, templates |
| **diagnostic** | No | 1 | `pipeline_trace` |
| **memory-facade** | No | 1 | Single-tool facade for memory |
| **n8n-facade** | No | 1 | Single-tool facade for n8n |
| **browser-facade** | No | 1 | Single-tool facade for browser |

Non-always-loaded groups are activated dynamically based on keyword intent detection or explicit user request via the `load_tools` meta tool.

### Tool Profiles

Predefined tool profiles control which MCP groups are pre-loaded:

| Profile | Groups |
|---------|--------|
| voice-assistant | core, meta, screen, memory, browser |
| voice-assistant-lite | core, meta, screen, memory-facade, browser-facade |
| n8n-workflows | core, meta, n8n |
| web-browser | core, meta, screen, browser |
| full-toolbox | core, meta, screen, memory, voice-clone, browser, n8n |
| minimal | core, meta |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SERPER_API_KEY` | Serper.dev API for fast web search |
| `OPENAI_API_KEY` | OpenAI API key (auto-detected on startup) |
| `ANTHROPIC_API_KEY` | Anthropic API key (auto-detected on startup) |
| `GOOGLE_API_KEY` | Gemini API key (auto-detected on startup) |
| `GROQ_API_KEY` | Groq API key (auto-detected on startup) |
| `MISTRAL_API_KEY` | Mistral API key (auto-detected on startup) |
| `XAI_API_KEY` | Grok/xAI API key (auto-detected on startup) |
| `OPENROUTER_API_KEY` | OpenRouter API key (auto-detected on startup) |
| `DEEPSEEK_API_KEY` | DeepSeek API key (auto-detected on startup) |

---

## Troubleshooting

### Electron won't start
- Check if `node_modules/electron` exists
- Try `npm start` (uses the cross-platform launcher)
- On Linux, the launcher automatically adds `--disable-gpu` and `--no-sandbox`
- Run `npm run doctor` to check system health

### voice-core not starting
- Ensure voice-core binary is built: `cd voice-core && cargo build --release`
- Check `vmr.log` for errors

### No audio
- Verify wake word model exists (`models/hey_claude_v2.onnx`)
- Check TTS model is downloaded
- Run `npm run doctor` to verify all dependencies

### Claude not responding
- Verify Claude CLI is installed (`claude --version`)
- Check MCP server is configured in Claude settings
- Look for errors in terminal output

### Web search not working
- Check `SERPER_API_KEY` is set (for fast search)
- Playwright fallback requires Chromium: `npx playwright install chromium`
- Check browser watcher logs in vmr.log

### Voice cloning issues
- Requires ffmpeg: `sudo apt install ffmpeg` (Linux) or install via system package manager
- Requires yt-dlp for URL downloads
