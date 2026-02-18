# Voice Mirror Electron - Architecture

## System Overview

```
+-------------------------------------------------+
|              ELECTRON OVERLAY                    |
|  (transparent, always-on-top, frameless)        |
+-------------------------------------------------+
|  * Orb component (draggable, Ctrl+Shift+V)      |
|  * Chat panel (conversation history)            |
|  * Terminal panel (ghostty-web, fullscreen)      |
|  * TUI dashboard (ANSI renderer for local LLMs) |
|  * Screen capture (desktopCapturer + cosmic)    |
|  * System tray integration                      |
|  * Theme engine (8 presets + custom themes)      |
|  * Multi-AI provider support (14+ providers)    |
+------------------+------------------------------+
|  Child Processes:                               |
+------------------+------------------------------+
|  1. VOICE-CORE (Rust binary)                    |
|     * Wake word detection (OpenWakeWord)        |
|     * STT (Whisper via whisper-rs)              |
|     * TTS (Kokoro ONNX)                        |
|     * Three modes: Wake Word, Call, PTT         |
|     * Sends to MCP inbox, waits for response    |
+-------------------------------------------------+
|  2. AI PROVIDER (one of):                       |
|     a) CLI PTY agents (node-pty):               |
|        * Claude Code (with MCP tools)           |
|        * OpenCode, Codex, Gemini CLI, Kimi CLI  |
|     b) OpenAI-compatible API:                   |
|        * Local: Ollama, LM Studio, Jan          |
|        * Cloud: OpenAI, Gemini, Grok, Groq,     |
|          Mistral, OpenRouter, DeepSeek, Kimi    |
|        * HTTP streaming + tool calling          |
|        * TUI dashboard for chat display         |
+---------------------+---------------------------+
|  MCP Inbox           |  ~/.config/voice-mirror- |
|  (shared JSON file)  |  electron/data/inbox.json|
+---------------------+---------------------------+
```

## Multi-Process Architecture

### voice-core (Rust binary, `voice-core/`)

Handles all voice I/O:
- Wake word detection ("Hey Claude" via OpenWakeWord)
- Speech-to-text transcription (Whisper via whisper-rs)
- Text-to-speech (Kokoro ONNX)
- Three activation modes: Wake Word, Call Mode, Push-to-Talk
- Background notification watcher for AI responses
- Sends transcriptions to MCP inbox

### AI Provider (three modes)

**Claude Code PTY** (default):
- Full interactive terminal via node-pty
- Rendered in ghostty-web (Ghostty's VT parser compiled to WASM)
- Watches inbox for voice messages (`claude_listen`)
- Has 56 MCP tools across 8 groups (core, meta, screen, memory, voice-clone, browser, n8n, diagnostic)
- Plus 3 facade groups for voice-mode tool profiles (memory-facade, n8n-facade, browser-facade)
- Responds via `claude_send` (triggers TTS)

**CLI PTY agents** (OpenCode, Codex, Gemini CLI, Kimi CLI):
- Same PTY architecture as Claude Code
- Spawned via generic `cli-spawner.js` with per-CLI config
- Rendered in ghostty-web terminal

**OpenAI-compatible API** (local and cloud):
- HTTP streaming responses with tool support
- Auto-detected local providers (Ollama, LM Studio, Jan)
- Cloud providers with API keys (OpenAI, Gemini, Grok, Groq, Mistral, OpenRouter, DeepSeek, Kimi)
- Tool call parsing for screen capture, web search, memory
- TUI renderer provides ANSI-based dashboard display in the terminal

This architecture means Voice Mirror Electron is **fully standalone** - it doesn't need an external Claude Code session running.

---

## MCP Server Tools

The MCP server (`mcp-server/index.js`) exposes **56 tools across 8 dynamically-loaded groups**, plus 3 facade groups for voice-mode tool profiles. Tool definitions live in `mcp-server/tool-groups.js`.

### Core (always loaded - 4 tools)
| Tool | Purpose |
|------|---------|
| `claude_send` | Send message to inbox (triggers TTS) |
| `claude_inbox` | Read messages from inbox |
| `claude_listen` | Wait for voice messages (blocking, exclusive lock) |
| `claude_status` | Presence tracking (active/idle) |

### Meta (always loaded - 3 tools)
| Tool | Purpose |
|------|---------|
| `load_tools` | Load a tool group on demand |
| `unload_tools` | Unload a tool group to reduce context |
| `list_tool_groups` | Show available groups and their status |

### Screen (on-demand - 1 tool)
| Tool | Purpose |
|------|---------|
| `capture_screen` | Screenshot via cosmic-screenshot or Electron |

### Memory (on-demand - 6 tools)
| Tool | Purpose |
|------|---------|
| `memory_search` | Hybrid semantic (70% vector) + keyword (30%) search |
| `memory_get` | Retrieve full memory content by path or chunk ID |
| `memory_remember` | Store persistent memory (core/stable/notes tiers) |
| `memory_forget` | Delete a memory (requires confirmation) |
| `memory_stats` | Get memory system statistics |
| `memory_flush` | Flush context to persistent memory before compaction |

### Voice Cloning (on-demand - 3 tools)
| Tool | Purpose |
|------|---------|
| `clone_voice` | Clone voice from audio (URL or file) |
| `clear_voice_clone` | Reset to default voice |
| `list_voice_clones` | List saved voice clones |

### Browser (on-demand - 16 tools)
| Tool | Purpose |
|------|---------|
| `browser_start` / `browser_stop` / `browser_status` | Browser lifecycle |
| `browser_tabs` / `browser_open` / `browser_close_tab` / `browser_focus` | Tab management |
| `browser_navigate` | Navigate to URL |
| `browser_screenshot` | Capture page as image |
| `browser_snapshot` | DOM/accessibility tree with refs (role, aria, ai formats) |
| `browser_act` | Execute actions (click, type, fill, hover, press, select, drag, evaluate, wait, upload, resize, dialog_accept, dialog_dismiss) |
| `browser_console` | Get console logs |
| `browser_search` | Google search (Serper API or Playwright) |
| `browser_fetch` | Fetch URL content with JS rendering |
| `browser_cookies` | Manage browser cookies (list, set, delete, clear) |
| `browser_storage` | Read/write localStorage or sessionStorage |

### n8n (on-demand - 22 tools)
| Tool | Purpose |
|------|---------|
| `n8n_list_workflows` / `n8n_get_workflow` / `n8n_create_workflow` / `n8n_update_workflow` / `n8n_delete_workflow` | Workflow CRUD |
| `n8n_validate_workflow` / `n8n_trigger_workflow` / `n8n_deploy_template` | Workflow operations |
| `n8n_get_executions` / `n8n_get_execution` / `n8n_delete_execution` / `n8n_retry_execution` | Execution management |
| `n8n_list_credentials` / `n8n_create_credential` / `n8n_delete_credential` / `n8n_get_credential_schema` | Credentials |
| `n8n_search_nodes` / `n8n_get_node` | Node discovery |
| `n8n_list_tags` / `n8n_create_tag` / `n8n_delete_tag` | Tag management |
| `n8n_list_variables` | Variable access |

### Diagnostic (on-demand - 1 tool)
| Tool | Purpose |
|------|---------|
| `pipeline_trace` | Send test message through live pipeline, trace message flow |

### Facade Groups (voice-mode alternatives - 3 groups, 3 tools)

These are single-tool alternatives to the full groups, designed for voice-mode tool profiles where fewer tools reduce context overhead:

| Group | Tool | Purpose |
|-------|------|---------|
| `memory-facade` | `memory_manage` | Single tool with action parameter for all memory operations |
| `n8n-facade` | `n8n_manage` | Single tool with action parameter for common n8n operations |
| `browser-facade` | `browser_manage` | Single tool with action parameter for browser control |

### Tool Management Features

- **Auto-load by intent**: Keywords in user messages trigger automatic group loading (e.g., "search" loads browser group)
- **Auto-unload idle**: Groups unused for 15+ tool calls are automatically unloaded
- **Tool profiles**: Configurable via `--enabled-groups` CLI arg, `ENABLED_GROUPS` env var, or `config.json` profiles
- **Destructive tool gating**: Tools like `memory_forget`, `n8n_delete_*` require `confirmed: true`

**Data Storage:** `~/.config/voice-mirror-electron/`
- `data/inbox.json` - Message queue (max 100 messages)
- `data/status.json` - Instance presence
- `data/listener_lock.json` - Exclusive listener mutex
- `data/images/` - Screenshots (keeps last 5)
- `data/voices/` - Cloned voice metadata
- `memory/MEMORY.md` - Main memory file (source of truth)
- `memory/daily/` - Auto-logged conversations
- `memory/index.db` - SQLite with FTS5 + embeddings

---

## Electron Main Process

**Core modules:**
- `main.js` - Window management, tray, IPC, service orchestration
- `preload.js` - Security bridge to renderer (contextBridge)
- `preload-log-viewer.js` - Preload for log viewer window
- `config.js` - Cross-platform config management
- `constants.js` - Shared constants (`CLI_PROVIDERS`, `DEFAULT_ENDPOINTS`)

**Window management:**
- `window/index.js` - Window manager service
- `window/tray.js` - System tray integration

**IPC handlers (`electron/ipc/` - 7 modules):**
- `ipc/index.js` - IPC handler registration entry point
- `ipc/ai.js` - AI provider IPC handlers
- `ipc/config.js` - Configuration IPC handlers
- `ipc/misc.js` - Miscellaneous IPC handlers
- `ipc/screen.js` - Screen capture IPC handlers
- `ipc/validators.js` - Input validation utilities
- `ipc/voice.js` - Voice backend IPC handlers
- `ipc/window.js` - Window management IPC handlers

**Service layer (`electron/services/` - 16 modules):**
- `services/ai-manager.js` - AI provider orchestration
- `services/voice-backend.js` - Rust voice-core process management
- `services/inbox-watcher.js` - MCP inbox polling
- `services/screen-capture-watcher.js` - Screenshot request fulfillment
- `services/browser-watcher.js` - Web search/fetch requests
- `services/provider-detector.js` - Auto-detect local LLMs + API key detection from env vars
- `services/font-manager.js` - Custom font management (TTF, OTF, WOFF, WOFF2)
- `services/wayland-orb.js` - Rust native overlay for Wayland (JSON stdio IPC)
- `services/logger.js` - File logging service
- `services/log-viewer.js` - Log viewer window management
- `services/perf-monitor.js` - Real-time CPU/memory monitoring
- `services/hotkey-manager.js` - Global hotkey management
- `services/diagnostic-collector.js` - Diagnostic data collection
- `services/diagnostic-watcher.js` - Diagnostic event monitoring
- `services/platform-paths.js` - Cross-platform path resolution
- `services/update-checker.js` - Git-based update checker and auto-pull

**Provider system (`electron/providers/` - 9 modules):**
- `providers/index.js` - Provider factory & registry
- `providers/base-provider.js` - Abstract base class (EventEmitter)
- `providers/claude-provider.js` - PTY-based Claude Code
- `providers/claude-spawner.js` - Claude Code PTY spawner (node-pty)
- `providers/claude-instructions.js` - Dynamic system prompt builder for embedded Claude
- `providers/cli-provider.js` - Generic CLI provider wrapper (OpenCode, Codex, Gemini CLI, Kimi CLI)
- `providers/cli-spawner.js` - CLI-based provider PTY spawning with per-CLI config
- `providers/openai-provider.js` - HTTP API providers (Ollama, LM Studio, Jan, OpenAI, Gemini, etc.)
- `providers/tui-renderer.js` - ANSI TUI dashboard renderer for local LLM providers

**Browser system (`electron/browser/` - 9 modules):**
- `browser/index.js` - Module entry point
- `browser/browser-controller.js` - Tab, navigation, screenshot, snapshot, actions
- `browser/browser-search.js` - Google Search via Playwright
- `browser/browser-fetch.js` - Fetch + parse URLs
- `browser/search-utils.js` - Shared search utilities
- `browser/webview-actions.js` - CDP actions (click, type, fill, hover, press, select, drag, evaluate, wait, upload, resize)
- `browser/webview-cdp.js` - Chrome DevTools Protocol connection
- `browser/webview-snapshot.js` - DOM snapshot generation (role, aria, ai formats)
- `browser/role-refs.js` - Accessibility tree ref handling

**Tools system (for local LLM tool calling):**
- `tools/index.js` - Tool call parser & executor
- `tools/definitions.js` - Tool schemas & validation
- `tools/openai-schema.js` - OpenAI function calling schema
- `tools/prompts.js` - System prompts for tool-enabled LLMs
- `tools/handlers/` - Individual tool implementations (browser-control, capture-screen, memory, n8n)

**Utility library (`electron/lib/`):**
- `lib/index.js` - Library entry point
- `lib/filtered-env.js` - Build filtered environment for child processes
- `lib/json-file-watcher.js` - JSON file change watcher
- `lib/ollama-launcher.js` - Auto-start Ollama if installed but not running
- `lib/safe-path.js` - Path sanitization utilities
- `lib/windows-screen-capture.js` - Windows-specific screen capture

---

## Renderer Process

### TUI Renderer (`electron/providers/tui-renderer.js`)

A custom JavaScript TUI dashboard that renders via ANSI escape sequences for local LLM providers (Ollama, LM Studio, etc.). Features:
- Box-drawing layout with conversation panel (left) and tool calls + info panel (right)
- ANSI 24-bit color theming via `setThemeColors()` -- inherits the app theme
- Streaming token display with cursor animation
- Tool call spinner with status tracking (running/done/failed)
- Context usage bar, TTS/STT engine display
- Word-wrapping, scrollback, and incremental rendering for performance
- Resize-aware layout recalculation

### Theme Engine (`electron/renderer/theme-engine.js`)

Centralized theme system with 8 presets and custom theme support:

| Preset | Key | Description |
|--------|-----|-------------|
| Colorblind | `colorblind` | **Default** -- Accessible blue/orange palette (Wong palette inspired) |
| Midnight | `midnight` | Deep navy with blue accent |
| Emerald | `emerald` | Dark green with emerald accent |
| Rose | `rose` | Dark pink/magenta theme |
| Slate | `slate` | Cool gray with indigo accent |
| Black | `black` | Pure OLED black with neutral accent |
| Claude Gray | `gray` | Warm gray with orange accent |
| Light | `light` | Light theme with indigo accent |

Each preset defines **10 key colors** (`bg`, `bgElevated`, `text`, `textStrong`, `muted`, `accent`, `ok`, `warn`, `danger`, `orbCore`) plus **2 fonts** (`fontFamily`, `fontMono`). The engine derives **30+ CSS variables**, orb colors, and a full terminal theme (ghostty-web ANSI palette) from these 10 inputs.

Features:
- `deriveTheme()` -- Generate all CSS variables from 10 colors
- `deriveOrbColors()` -- Generate orb RGB arrays from theme
- `deriveTerminalTheme()` -- Generate ghostty-web terminal theme from colors
- `applyTheme()` -- Set CSS vars on `:root`, update orb, push to terminal and TUI renderer
- `applyMessageCardOverrides()` -- Chat bubble style customization
- Theme import/export (JSON format, version 1)
- Custom theme persistence via config

**JavaScript modules (`electron/renderer/` - 24 files):**
| Module | Purpose |
|--------|---------|
| `main.js` | Entry point, voice events, image workflow |
| `state.js` | Global state management |
| `navigation.js` | Sidebar + page routing |
| `terminal.js` | ghostty-web terminal + AI provider control |
| `settings.js` | Settings page router + tab initialization |
| `settings-ai.js` | AI & Tools tab (provider selection, scanning, CLI install, model, tool profiles) |
| `settings-appearance.js` | Appearance tab (theme presets, color pickers, fonts, orb preview, message cards, import/export) |
| `settings-voice.js` | Voice & Audio tab (TTS adapter/voice, STT model, audio devices, activation mode, keybinds) |
| `settings-dependencies.js` | Dependencies tab (npm package versions, system tool checks) |
| `messages.js` | Chat message handling with deduplication |
| `markdown.js` | Secure markdown rendering (marked + DOMPurify) |
| `notifications.js` | Toast notification system |
| `utils.js` | Utility functions |
| `browser-panel.js` | Browser automation panel UI |
| `orb-canvas.js` | Canvas-based orb renderer with animations |
| `chat-input.js` | Chat input bar, sending text messages, voice toggle |
| `chat-store.js` | Chat persistence and sidebar history |
| `log.js` | Renderer-side structured logging utility |
| `theme-engine.js` | Theme presets, color derivation, CSS variable application |
| `ai-status.js` | AI provider status display |
| `image-handler.js` | Image handling for vision workflow |
| `resize.js` | Frameless window resize handling |
| `voice-handler.js` | Voice event handling |
| `whats-new.js` | "What's New" changelog display |

**CSS modules (`electron/renderer/styles/` - 12 files):**
| File | Purpose |
|------|---------|
| `tokens.css` | Design tokens (colors, spacing, animations) |
| `base.css` | Base styles + entrance animations |
| `orb.css` | Floating orb + state animations |
| `panel.css` | Panel container + image preview |
| `sidebar.css` | Sidebar navigation + tooltips |
| `chat.css` | Chat messages + markdown styles |
| `terminal.css` | Terminal panel (fullscreen) |
| `settings.css` | Settings page + provider dropdown |
| `notifications.css` | Toast notifications |
| `browser.css` | Browser panel styles |
| `fonts.css` | Custom font face declarations |
| `whats-new.css` | "What's New" dialog styles |

---

## Preload API

```javascript
// Exposed to renderer via contextBridge
window.voiceMirror = {
    // Core UI
    toggleExpand, getScreens, captureScreen, supportsVision,
    getState, openExternal,

    // Window manipulation
    getWindowPosition, setWindowPosition, getCursorPosition,
    startDragCapture, stopDragCapture,
    getWindowBounds, setWindowBounds, saveWindowBounds,
    minimizeWindow, maximizeWindow, quitApp,

    // Event listeners
    onStateChange, onVoiceEvent, onChatMessage, onOpenSettings,

    // Configuration
    config: { get, set, reset, getPlatformInfo, browseModelFile },

    // Overlay (Wayland orb)
    overlay: { listOutputs },

    // Theme import/export
    theme: { export, import },

    // Custom fonts
    fonts: { upload, add, remove, list, getDataUrl },

    // Voice core
    voice: { sendQuery, setMode, getStatus, start, stop, restart,
             listAudioDevices, getDetectedKeys, stopSpeaking },
    sendImageToBackend,

    // AI provider control (PTY terminal)
    claude: { start, stop, interrupt, getStatus, onOutput,
              sendInput, resize, setTuiTheme },

    // Clipboard (for terminal copy/paste)
    readClipboard, writeClipboard,

    // Browser panel
    browser: { getStatus, popOut, onStatusChange },

    // AI provider discovery
    ai: { scanProviders, getProviders, setProvider, getProvider,
          checkCLIAvailable, installCLI,
          checkDependencyVersions, updateDependency },

    // Tool events (for local LLM tool system)
    tools: { onToolCall, onToolResult, onToolActivity },

    // Chat persistence
    chat: { list, load, save, delete, rename },

    // Combined controls
    startAll, stopAll,

    // Uninstall
    runUninstall,

    // Dev logging
    devlog, toggleLogViewer,

    // Performance monitor
    onPerfStats, onContextUsage, togglePerfMonitor, onToggleStatsBar,

    // Version & updates
    getAppVersion, getChangelog, markVersionSeen,
    onUpdateAvailable, onUpdateStatus,
    applyUpdate, installUpdate, relaunch,

    // Hotkey fallback
    hotkeyFallback
}
```

---

## Data Flow

### Voice Input Flow
```
User speaks "Hey Claude"
    |
voice-core: OpenWakeWord detects wake word
    |
voice-core: Starts recording, Whisper transcribes
    |
voice-core: Sends transcription to inbox.json
    |
Claude Code: claude_listen detects message
    |
Claude Code: Processes, responds via claude_send
    |
voice-core: Detects response in inbox
    |
voice-core: Kokoro TTS speaks response
    |
Electron: Updates chat UI
```

### Screen Capture Flow
```
User clicks capture button (or voice command)
    |
Electron: desktopCapturer captures screen
    |
Image saved to ~/.config/.../data/images/
    |
Claude: Uses vision API to analyze
    |
Response flows back through inbox -> TTS
```

### Theme Flow
```
User selects preset or custom colors in Settings > Appearance
    |
theme-engine: resolveTheme() merges preset + overrides
    |
theme-engine: deriveTheme() computes 30+ CSS variables
    |
theme-engine: applyTheme() sets :root CSS vars
    |             |                      |
    v             v                      v
  Orb canvas   ghostty-web terminal   TUI renderer
  (RGB arrays)  (ANSI palette)         (24-bit ANSI codes)
```

---

## Integration with Claude Code

Voice Mirror Electron can spawn Claude Code CLI in a hidden terminal:
- User speaks -> transcribed -> sent to Claude Code
- Claude responds -> piped to TTS -> spoken
- Same subscription, no extra API cost (output is just rendered differently)

**Key insight:** Rendering output in Electron instead of a terminal doesn't cost extra tokens.

```
Claude generates response -> tokens used once
                |
Electron renders it nicely -> FREE (just display)
                |
Kokoro speaks it -> FREE (local TTS)
```

---

## Wayland Orb (wayland-orb/)

Native Rust layer-shell overlay for Linux/Wayland. Replaces the Electron orb window on Wayland for better performance.

- Built with smithay-client-toolkit + tiny-skia (software rendering)
- JSON stdio protocol for state updates (Idle, Recording, Speaking, Thinking)
- Click-to-expand detection forwarded to Electron
- Monitor/output selection support
- Color-coded animated states (purple idle, pink recording, blue speaking)
- Managed by `services/wayland-orb.js` in Electron

---

## Chrome Extension (chrome-extension/)

MV3 browser extension for relaying CDP commands to existing Chrome tabs.

- Allows Voice Mirror to attach to user's existing browser session
- Relays Chrome DevTools Protocol commands via `extension-relay.js`
- Requires `debugger` and `tabs` permissions

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `ghostty-web` | Terminal emulator (Ghostty's VT parser compiled to WASM) |
| `node-pty` | Pseudo-terminal for CLI provider spawning |
| `marked` + `dompurify` | Secure markdown rendering in chat |
| `@anthropic-ai/sdk` | Anthropic API client |
| `@modelcontextprotocol/sdk` | MCP server framework |
| `better-sqlite3` | Memory system database |
| `onnxruntime-node` | ONNX model runtime (embeddings) |
| `playwright` | Browser automation (headless Chrome) |

---

## Compaction Handling

When Claude's context compacts:
1. PreCompact hook writes to MCP inbox
2. Voice Mirror detects notification
3. Speaks "One moment, reorganizing..."
4. Waits for Claude to resume
5. Continues conversation seamlessly
