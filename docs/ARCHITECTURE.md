# Voice Mirror — Architecture

## System Overview

```
+-----------------------------------------------------------+
|                    TAURI 2 APPLICATION                     |
+-----------------------------------------------------------+
|                                                           |
|  ┌─ Svelte 5 Frontend (WebView) ────────────────────────┐ |
|  │  Orb overlay (draggable, animated states)            │ |
|  │  Chat panel (conversation history, markdown)         │ |
|  │  Terminal panel (xterm.js, fullscreen PTY)           │ |
|  │  Settings panel (7 tabs)                             │ |
|  │  Sidebar (navigation, chat list)                     │ |
|  │  Theme engine (8 presets + custom themes)            │ |
|  │  9 reactive stores (Svelte 5 runes)                  │ |
|  │  API layer: invoke('command', { args }) → Rust       │ |
|  └──────────────────────────────────────────────────────┘ |
|                         │ invoke()                        |
|                         ▼                                 |
|  ┌─ Rust Backend (Tauri commands) ──────────────────────┐ |
|  │                                                      │ |
|  │  commands/     Tauri command handlers                 │ |
|  │  ├── config    Config CRUD (get, set, reset)         │ |
|  │  ├── window    Window management (pos, bounds, quit) │ |
|  │  ├── voice     Voice pipeline control                │ |
|  │  ├── ai        AI provider management                │ |
|  │  ├── chat      Chat persistence (list, load, save)   │ |
|  │  ├── tools     Tool profile management               │ |
|  │  └── shortcuts  Global shortcut registration         │ |
|  │                                                      │ |
|  │  providers/    AI provider implementations           │ |
|  │  ├── cli       PTY providers (portable-pty)          │ |
|  │  │             Claude Code, OpenCode, Codex,         │ |
|  │  │             Gemini CLI, Kimi CLI                   │ |
|  │  └── api       HTTP API providers                    │ |
|  │                Ollama, LM Studio, Jan, OpenAI, Groq  │ |
|  │                                                      │ |
|  │  voice/        Rust-native voice pipeline            │ |
|  │  ├── pipeline  Orchestrator (modes, state machine)   │ |
|  │  ├── stt       Whisper ONNX via whisper-rs           │ |
|  │  ├── tts       Kokoro ONNX / Edge TTS               │ |
|  │  └── vad       Voice activity detection              │ |
|  │                                                      │ |
|  │  mcp/          Native Rust MCP server                │ |
|  │  ├── server    stdio JSON-RPC transport              │ |
|  │  ├── tools     Tool definitions                      │ |
|  │  └── handlers  Tool handler implementations          │ |
|  │                                                      │ |
|  │  ipc/          Named pipe server (Win) / Unix socket │ |
|  │  config/       Config schema + persistence (serde)   │ |
|  │  services/     Platform detection, logging, etc.     │ |
|  └──────────────────────────────────────────────────────┘ |
+-----------------------------------------------------------+
```

Voice Mirror is a **Tauri 2** desktop application. The frontend is a **Svelte 5** single-page application running inside a Tauri WebView. All backend logic — voice processing, AI provider management, MCP tool serving, configuration — runs in **Rust** via Tauri commands. There are no Node.js processes at runtime; the only JavaScript is the frontend bundle.

---

## Multi-Process Architecture

Unlike the previous Electron architecture (which orchestrated multiple child processes from Node.js), Tauri consolidates most logic into the Rust backend:

| Component | Runtime | Notes |
|-----------|---------|-------|
| Frontend UI | WebView (Svelte 5) | Vite-bundled, HMR in dev |
| Voice pipeline | Rust (in-process) | STT, TTS, VAD — all native |
| AI CLI providers | Child process (PTY) | Claude Code, OpenCode, etc. via portable-pty |
| AI API providers | Rust HTTP client | Ollama, LM Studio, OpenAI, etc. |
| MCP server | Rust binary (`voice-mirror-mcp`) | Separate process, stdio JSON-RPC |
| Config I/O | Rust (serde) | Atomic writes to `%APPDATA%/voice-mirror/config.json` |

The Rust backend manages the lifecycle of all child processes (PTY terminals, MCP server) and communicates with the frontend exclusively through Tauri's `invoke()` IPC mechanism.

---

## Tauri Commands

The frontend communicates with the backend by calling `invoke('command_name', { args })`, which routes to a `#[tauri::command]` Rust function that returns `Result<T, String>`.

### commands/config.rs
| Command | Purpose |
|---------|---------|
| `get_config` | Read full config or a specific key |
| `set_config` | Update config fields (deep merge) |
| `reset_config` | Reset config to defaults |

### commands/window.rs
| Command | Purpose |
|---------|---------|
| `get_window_position` | Get current window position |
| `set_window_position` | Move window to (x, y) |
| `minimize` | Minimize window |
| `maximize` | Toggle maximize |
| `quit` | Quit application |

### commands/voice.rs
| Command | Purpose |
|---------|---------|
| `start_voice` | Start voice pipeline |
| `stop_voice` | Stop voice pipeline |
| `speak_text` | Trigger TTS for a text string |
| `ptt_press` / `ptt_release` | Push-to-talk control |
| `set_voice_mode` | Switch activation mode (Wake Word, Call, PTT) |

### commands/ai.rs
| Command | Purpose |
|---------|---------|
| `start_ai` | Start the active AI provider |
| `stop_ai` | Stop the active AI provider |
| `set_provider` | Switch AI provider |
| `scan_providers` | Auto-detect available providers |
| `list_models` | List models for the active provider |
| `ai_pty_input` | Send text input to a PTY provider |

### commands/chat.rs
| Command | Purpose |
|---------|---------|
| `chat_list` | List saved chat sessions |
| `chat_load` | Load a chat session by ID |
| `chat_save` | Save a chat session |
| `chat_delete` | Delete a chat session |
| `chat_rename` | Rename a chat session |

### commands/tools.rs
| Command | Purpose |
|---------|---------|
| `get_enabled_tools` | Get currently enabled tool groups |
| `set_enabled_tools` | Enable/disable tool groups |

### commands/shortcuts.rs
| Command | Purpose |
|---------|---------|
| `register_shortcut` | Register a global keyboard shortcut |
| `unregister_shortcut` | Remove a global keyboard shortcut |

---

## Svelte 5 Frontend

The frontend is a Svelte 5 application built with Vite. It runs inside the Tauri WebView — there is no Node.js context, no preload script, and no `window.voiceMirror` bridge. All backend communication goes through `invoke()` calls defined in `tauri/src/lib/api.js`.

### Components (30 files, 7 directories)

**Chat** (6 components):
| Component | Purpose |
|-----------|---------|
| `ChatPanel.svelte` | Main chat container with message list |
| `ChatBubble.svelte` | Individual message bubble |
| `ChatInput.svelte` | Text input bar with voice toggle |
| `MessageGroup.svelte` | Groups consecutive messages by sender |
| `StreamingCursor.svelte` | Animated cursor for streaming responses |
| `ToolCard.svelte` | Tool call display (name, status, result) |

**Settings** (7 components):
| Component | Purpose |
|-----------|---------|
| `SettingsPanel.svelte` | Settings page router and tab navigation |
| `AISettings.svelte` | AI provider selection, model config, scanning |
| `AppearanceSettings.svelte` | Theme presets, color pickers, fonts |
| `VoiceSettings.svelte` | TTS/STT config, audio devices, activation mode |
| `ToolSettings.svelte` | MCP tool group management |
| `BehaviorSettings.svelte` | Behavior and shortcut settings |
| `DependencySettings.svelte` | Dependency version checks |

**Sidebar** (2 components):
| Component | Purpose |
|-----------|---------|
| `Sidebar.svelte` | Navigation sidebar with page routing |
| `ChatList.svelte` | Chat session history list |

**Overlay** (2 components):
| Component | Purpose |
|-----------|---------|
| `Orb.svelte` | Animated orb with state-driven visuals |
| `OverlayPanel.svelte` | Overlay container for orb + expanded panel |

**Terminal** (2 components):
| Component | Purpose |
|-----------|---------|
| `Terminal.svelte` | xterm.js terminal for PTY providers |
| `TerminalToolbar.svelte` | Terminal control bar |

**Shared** (12 components):
| Component | Purpose |
|-----------|---------|
| `Button.svelte` | Reusable button component |
| `Select.svelte` | Dropdown select component |
| `TextInput.svelte` | Text input component |
| `Toggle.svelte` | Toggle switch component |
| `Slider.svelte` | Range slider component |
| `Skeleton.svelte` | Loading skeleton placeholder |
| `ErrorState.svelte` | Error display component |
| `Toast.svelte` | Individual toast notification |
| `ToastContainer.svelte` | Toast notification container |
| `TitleBar.svelte` | Custom title bar (frameless window) |
| `OnboardingModal.svelte` | First-run onboarding wizard |
| `WhatsNewModal.svelte` | Changelog display modal |

### Stores (9 reactive stores using Svelte 5 runes)

All stores live in `tauri/src/lib/stores/` and use `.svelte.js` extension for rune support:

| Store | Purpose |
|-------|---------|
| `config.svelte.js` | App configuration state (synced with Rust backend) |
| `chat.svelte.js` | Chat messages, sessions, streaming state |
| `voice.svelte.js` | Voice pipeline state (mode, status, devices) |
| `ai-status.svelte.js` | AI provider status (running, provider name, model) |
| `theme.svelte.js` | Theme presets, `deriveTheme()`, CSS variable generation |
| `navigation.svelte.js` | Current page, sidebar state |
| `overlay.svelte.js` | Orb state (idle, recording, speaking, thinking) |
| `toast.svelte.js` | Toast notification queue |
| `shortcuts.svelte.js` | Global shortcut bindings |

### API Layer (`tauri/src/lib/api.js`)

50+ `invoke()` wrapper functions that map to Tauri commands. The frontend never calls `invoke()` directly — all calls go through this module, which handles serialization, error formatting, and typing.

```javascript
// Example: api.js wraps Tauri invoke() calls
export async function getConfig() {
    return await invoke('get_config');
}

export async function setProvider(provider, model) {
    return await invoke('set_provider', { provider, model });
}

export async function startVoice() {
    return await invoke('start_voice');
}
```

### Library Modules (`tauri/src/lib/`)

| Module | Purpose |
|--------|---------|
| `api.js` | 50+ invoke() wrappers for all Tauri commands |
| `markdown.js` | Secure markdown rendering |
| `utils.js` | Utility functions |
| `updater.js` | App update checking |
| `orb-presets.js` | Orb animation presets |
| `voice-greeting.js` | Voice greeting logic |
| `local-llm-instructions.js` | System prompts for local LLM tool calling |

---

## Provider System

Voice Mirror supports two categories of AI providers, all managed by the Rust backend (`providers/`).

### CLI PTY Providers (`providers/cli.rs`)

Interactive terminal-based AI tools spawned as child processes via **portable-pty**:

| Provider | Binary | Notes |
|----------|--------|-------|
| Claude Code | `claude` | Full MCP tool support |
| OpenCode | `opencode` | Alternative CLI agent |
| Codex | `codex` | OpenAI's CLI agent |
| Gemini CLI | `gemini` | Google's CLI agent |
| Kimi CLI | `kimi` | Moonshot's CLI agent |

These providers:
- Run in a pseudo-terminal managed by Rust (portable-pty)
- Stream output to the frontend via Tauri events
- Accept input via the `ai_pty_input` command
- Are rendered in the xterm.js terminal component

### HTTP API Providers (`providers/api.rs`)

OpenAI-compatible HTTP API providers using Rust's async HTTP client:

| Provider | Type | Notes |
|----------|------|-------|
| Ollama | Local | Auto-detected on localhost:11434 |
| LM Studio | Local | Auto-detected on localhost:1234 |
| Jan | Local | Auto-detected on localhost:1337 |
| OpenAI | Cloud | Requires API key |
| Groq | Cloud | Requires API key |

These providers:
- Use streaming HTTP responses (SSE)
- Support tool calling (function calling schema)
- Emit events to the frontend for real-time token display
- Are managed by the provider manager (`providers/manager.rs`)

### Tool Calling (`providers/tool_calling.rs`)

For API providers that support function calling, the Rust backend:
1. Converts MCP tool definitions to OpenAI function calling schema
2. Sends tool schemas with each API request
3. Parses tool call responses
4. Executes tools via the MCP handler
5. Returns results to the provider for the next turn

---

## Voice Pipeline

The voice pipeline is implemented entirely in Rust (`voice/`), replacing the previous Python and Node.js voice backends.

### Pipeline Orchestrator (`voice/pipeline.rs`)

Manages the voice state machine:

```
Idle → [Wake Word / PTT / Call Mode] → Recording → Transcribing → Processing → Speaking → Idle
```

Three activation modes:
- **Wake Word**: Always listening for keyword detection
- **Push-to-Talk (PTT)**: Records while key is held
- **Call Mode**: Continuous conversation (records after each TTS response)

### Speech-to-Text (`voice/stt.rs`)

- **Engine**: Whisper ONNX via `whisper-rs`
- **Models**: tiny, base, small, medium (configurable)
- **Input**: Raw PCM audio from system microphone
- **Output**: Transcribed text string

### Text-to-Speech (`voice/tts.rs`)

- **Kokoro ONNX**: Local neural TTS, multiple voices, no API cost
- **Edge TTS**: Microsoft's cloud TTS service (free tier)
- **Playback**: `rodio` crate for audio output
- **Output**: PCM audio played through system speakers

### Voice Activity Detection (`voice/vad.rs`)

- Energy-based VAD for detecting speech boundaries
- Used to determine when the user has finished speaking
- Configurable silence threshold and minimum speech duration

---

## MCP Server

The MCP server is now a **native Rust binary** (`voice-mirror-mcp`) that communicates via stdio JSON-RPC. This replaces the previous Node.js MCP server (`mcp-server/`).

### Architecture

```
AI Provider (Claude Code, etc.)
    │
    │  stdio JSON-RPC
    ▼
voice-mirror-mcp (Rust binary)
    │
    │  Named pipe (Windows) / Unix socket
    ▼
Tauri app backend (Rust)
    │
    ├── Voice pipeline (speak, listen)
    ├── Screen capture
    ├── Config access
    └── Chat history
```

### Components

| Module | Purpose |
|--------|---------|
| `mcp/server.rs` | JSON-RPC transport, request routing |
| `mcp/tools.rs` | Tool definitions and schemas |
| `mcp/handlers.rs` | Tool handler implementations |

### Communication

The MCP server communicates with the main Tauri app via **named pipes** (Windows) or **Unix domain sockets** (macOS/Linux):

| Module | Purpose |
|--------|---------|
| `ipc/pipe_server.rs` | Named pipe server in the Tauri app |
| `ipc/pipe_client.rs` | Named pipe client in the MCP binary |
| `ipc/protocol.rs` | Shared message protocol (JSON) |

This allows the MCP server (running as a child process of Claude Code or other CLI agents) to invoke actions in the main app — triggering TTS, capturing screens, reading config — without file-based IPC.

---

## Config System

### Schema (`config/schema.rs`)

The full config schema is defined as Rust structs with serde serialization:

```rust
pub struct AppConfig {
    pub ai: AIConfig,          // Provider, model, endpoint, API keys
    pub voice: VoiceConfig,    // TTS engine/voice, STT model, activation mode
    pub window: WindowConfig,  // Position, size, always-on-top
    pub theme: ThemeConfig,    // Preset name, custom overrides
    pub tools: ToolsConfig,    // Enabled tool groups
    pub shortcuts: ShortcutsConfig, // Global keybindings
    pub behavior: BehaviorConfig,   // Auto-start, notifications
}
```

### Persistence (`config/persistence.rs`)

- **Location**: `%APPDATA%/voice-mirror/config.json` (Windows), `~/.config/voice-mirror/config.json` (Linux/macOS)
- **Atomic writes**: Write to `.tmp`, backup to `.bak`, rename `.tmp` to config
- **Deep merge**: New config fields get defaults automatically
- **Type safety**: Rust's type system ensures config values are valid at compile time

### Migration (`config/migration.rs`)

Handles migration from the old Electron config format (`voice-mirror-electron/`) to the new Tauri config format (`voice-mirror/`).

---

## Theme System

### 8 Built-in Presets

| Preset | Key | Description |
|--------|-----|-------------|
| Colorblind | `colorblind` | **Default** — Accessible blue/orange palette (Wong palette inspired) |
| Midnight | `midnight` | Deep navy with blue accent |
| Emerald | `emerald` | Dark green with emerald accent |
| Rose | `rose` | Dark pink/magenta theme |
| Slate | `slate` | Cool gray with indigo accent |
| Black | `black` | Pure OLED black with neutral accent |
| Claude Gray | `gray` | Warm gray with orange accent |
| Light | `light` | Light theme with indigo accent |

### Theme Architecture

Presets and theme logic live in `tauri/src/lib/stores/theme.svelte.js`:

Each preset defines **10 key colors** (`bg`, `bgElevated`, `text`, `textStrong`, `muted`, `accent`, `ok`, `warn`, `danger`, `orbCore`) plus **2 fonts** (`fontFamily`, `fontMono`).

```
User selects preset or custom colors in Settings > Appearance
    │
theme store: resolveTheme() merges preset + overrides
    │
theme store: deriveTheme() computes 30+ CSS variables
    │
theme store: applies CSS variables to :root
    │
    ├──→ Orb component (reactive color props)
    ├──→ Terminal (xterm.js theme)
    └──→ All Svelte components (CSS variables)
```

Features:
- `deriveTheme()` — Generate all CSS variables from 10 colors
- `deriveOrbColors()` — Generate orb RGB arrays from theme
- Theme import/export (JSON format)
- Custom theme persistence via config store
- Reactive updates via Svelte 5 `$derived` runes

---

## Data Flow

### Voice Input Flow

```
User speaks "Hey Claude"
    │
Voice pipeline (Rust): Wake word detection triggers
    │
Voice pipeline (Rust): VAD monitors, records audio
    │
Voice pipeline (Rust): Whisper ONNX transcribes speech
    │
Rust backend: Sends transcription to active AI provider
    │
AI provider processes and generates response
    │
Rust backend: Receives response text
    │
Voice pipeline (Rust): Kokoro/Edge TTS synthesizes speech
    │
Voice pipeline (Rust): rodio plays audio
    │
Tauri event → Svelte frontend: Updates chat UI
```

### Screen Capture Flow

```
User clicks capture button (or voice command)
    │
Svelte frontend: invoke('capture_screen')
    │
Rust backend: Platform-specific screen capture
    │
Image saved to app data directory
    │
AI provider: Analyzes image via vision API
    │
Response flows back → TTS speaks result
    │
Tauri event → Svelte frontend: Updates chat
```

### Provider Switch Flow

```
User selects new provider in Settings > AI
    │
Svelte frontend: invoke('set_provider', { provider, model })
    │
Rust backend: Stops current provider
    │
Rust backend: Starts new provider (PTY or HTTP client)
    │
Tauri event → Svelte frontend: Updates AI status store
    │
UI reflects new provider (terminal or chat mode)
```

---

## Wayland Orb (`wayland-orb/`)

Native Rust layer-shell overlay for Linux/Wayland. Replaces the WebView orb on Wayland for better compositing performance.

- Built with smithay-client-toolkit + tiny-skia (software rendering)
- JSON stdio protocol for state updates (Idle, Recording, Speaking, Thinking)
- Click-to-expand detection forwarded to Tauri
- Monitor/output selection support
- Color-coded animated states (purple idle, pink recording, blue speaking)

---

## Chrome Extension (`chrome-extension/`)

MV3 browser extension for relaying CDP commands to existing Chrome tabs.

- Allows Voice Mirror to attach to the user's existing browser session
- Relays Chrome DevTools Protocol commands
- Requires `debugger` and `tabs` permissions

---

## Key Dependencies

### Rust (Cargo)

| Crate | Purpose |
|-------|---------|
| `tauri` | Application framework (WebView, commands, events, window management) |
| `portable-pty` | Pseudo-terminal for CLI provider spawning |
| `whisper-rs` | Speech-to-text (Whisper ONNX runtime) |
| `rodio` | Audio playback for TTS output |
| `serde` / `serde_json` | Config serialization, JSON handling |
| `tokio` | Async runtime |
| `reqwest` | HTTP client for API providers |

### JavaScript (npm)

| Package | Purpose |
|---------|---------|
| `svelte` | Frontend framework (v5, with runes) |
| `@tauri-apps/api` | Tauri invoke() and event APIs |
| `vite` | Build tool with HMR |
| `xterm` | Terminal emulator for PTY providers |
| `marked` + `dompurify` | Secure markdown rendering in chat |

---

## Testing

### Rust Tests (167+)

```bash
cd tauri/src-tauri && cargo test
```

Unit tests for commands, config schema, providers, voice pipeline, MCP handlers, and IPC protocol.

### JavaScript Tests (1070+)

```bash
npm test
```

Uses `node:test` + `node:assert/strict`. Two patterns:
- **Direct import**: CommonJS modules tested by requiring and calling functions
- **Source inspection**: ES modules tested by reading file text and asserting patterns exist

---

## Dev Commands

```bash
cd tauri && cargo tauri dev        # Run app with Vite HMR + Rust hot-reload
cd tauri/src-tauri && cargo check  # Type-check Rust without building
cd tauri/src-tauri && cargo test   # Run Rust test suite (167+ tests)
npm test                           # Run JS test suite (1070+ tests)
```
