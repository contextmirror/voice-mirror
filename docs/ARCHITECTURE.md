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
|  │  Lens workspace (editor, preview, file tree, term)   │ |
|  │  Terminal panel (ghostty-web WASM, fullscreen PTY)   │ |
|  │  Settings panel (9 tabs)                             │ |
|  │  Sidebar (navigation, chat list, project strip)      │ |
|  │  Theme engine (8 presets + custom themes)            │ |
|  │  16 reactive stores (Svelte 5 runes)                 │ |
|  │  API layer: invoke('command', { args }) → Rust       │ |
|  └──────────────────────────────────────────────────────┘ |
|                         │ invoke()                        |
|                         ▼                                 |
|  ┌─ Rust Backend (Tauri commands) ──────────────────────┐ |
|  │                                                      │ |
|  │  commands/     Tauri command handlers (13 modules)    │ |
|  │  ├── config    Config CRUD (get, set, reset)         │ |
|  │  ├── window    Window management (pos, bounds, quit) │ |
|  │  ├── voice     Voice pipeline control                │ |
|  │  ├── ai        AI provider management                │ |
|  │  ├── chat      Chat persistence (list, load, save)   │ |
|  │  ├── tools     Tool/dependency management            │ |
|  │  ├── shortcuts  Global shortcut registration         │ |
|  │  ├── files     File operations (read, write, tree)   │ |
|  │  ├── screenshot Screen/window/monitor capture        │ |
|  │  ├── shell     Shell PTY spawning                    │ |
|  │  ├── lens      WebView2 browser preview              │ |
|  │  ├── lsp       Language server protocol              │ |
|  │  └── dev_server Dev server detection                 │ |
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
|  │  ├── tools     Tool registry (11 groups)             │ |
|  │  ├── handlers  8 handler modules                     │ |
|  │  └── pipe_router Concurrent pipe message routing     │ |
|  │                                                      │ |
|  │  ipc/          Named pipe server (Win) / Unix socket │ |
|  │  config/       Config schema + persistence (serde)   │ |
|  │  services/     8 services (browser bridge, file      │ |
|  │                watcher, input hook, logger, etc.)     │ |
|  └──────────────────────────────────────────────────────┘ |
+-----------------------------------------------------------+
```

Voice Mirror is a **Tauri 2** desktop application. The frontend is a **Svelte 5** single-page application running inside a Tauri WebView. All backend logic — voice processing, AI provider management, MCP tool serving, configuration — runs in **Rust** via Tauri commands. There are no Node.js processes at runtime; the only JavaScript is the frontend bundle.

---

## Multi-Process Architecture

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

100 commands across 13 modules. The frontend communicates with the backend by calling `invoke('command_name', { args })`, which routes to a `#[tauri::command]` Rust function that returns `Result<T, String>`.

### commands/config.rs (5 commands)
| Command | Purpose |
|---------|---------|
| `get_config` | Read full config |
| `set_config` | Update config fields (deep merge) |
| `reset_config` | Reset config to defaults |
| `get_platform_info` | Get OS/platform information |
| `migrate_electron_config` | Migrate from old Electron config |

### commands/window.rs (11 commands)
| Command | Purpose |
|---------|---------|
| `get_window_position` | Get current window position |
| `set_window_position` | Move window to (x, y) |
| `save_window_bounds` | Persist window bounds to config |
| `minimize_window` | Minimize window |
| `maximize_window` | Toggle maximize |
| `set_window_size` | Set window dimensions |
| `set_always_on_top` | Toggle always-on-top |
| `set_resizable` | Toggle resizability |
| `show_window` | Show/unhide window |
| `quit_app` | Quit application |
| `get_process_stats` | Get memory/CPU usage stats |

### commands/voice.rs (12 commands)
| Command | Purpose |
|---------|---------|
| `start_voice` | Start voice pipeline |
| `stop_voice` | Stop voice pipeline |
| `get_voice_status` | Get pipeline state |
| `set_voice_mode` | Switch activation mode |
| `list_audio_devices` | List system audio devices |
| `speak_text` | Trigger TTS for a text string |
| `stop_speaking` | Stop TTS playback |
| `ptt_press` / `ptt_release` | Push-to-talk control |
| `configure_ptt_key` | Set PTT keybinding |
| `configure_dictation_key` | Set dictation keybinding |
| `inject_text` | Inject text via OS input simulation |

### commands/ai.rs (13 commands)
| Command | Purpose |
|---------|---------|
| `start_ai` | Start the active AI provider |
| `stop_ai` | Stop the active AI provider |
| `get_ai_status` | Get provider status |
| `ai_pty_input` | Send text input to a PTY provider |
| `ai_raw_input` | Send raw bytes to PTY |
| `ai_pty_resize` | Resize PTY dimensions |
| `interrupt_ai` | Send interrupt signal |
| `send_voice_loop` | Send voice loop message |
| `scan_providers` | Auto-detect available providers |
| `list_models` | List models for a provider |
| `set_provider` | Switch AI provider |
| `write_user_message` | Write message to inbox file |
| `get_provider` | Get current provider info |

### commands/chat.rs (6 commands)
| Command | Purpose |
|---------|---------|
| `chat_list` | List saved chat sessions |
| `chat_load` | Load a chat session by ID |
| `chat_save` | Save a chat session |
| `chat_delete` | Delete a chat session |
| `export_chat_to_file` | Export chat to file |
| `chat_rename` | Rename a chat session |

### commands/files.rs (13 commands)
| Command | Purpose |
|---------|---------|
| `list_directory` | List directory contents |
| `get_git_changes` | Get git diff for project |
| `get_project_root` | Get current project root |
| `read_file` | Read file contents |
| `read_external_file` | Read file outside project |
| `get_file_git_content` | Get git version of file |
| `write_file` | Write file contents |
| `create_file` | Create new file |
| `create_directory` | Create new directory |
| `rename_entry` | Rename file/directory |
| `delete_entry` | Delete file/directory |
| `reveal_in_explorer` | Open in OS file manager |
| `search_files` | Search files in project |

### commands/screenshot.rs (6 commands)
| Command | Purpose |
|---------|---------|
| `take_screenshot` | Capture primary screen |
| `list_monitors` | List available monitors |
| `list_windows` | List open windows |
| `capture_monitor` | Capture specific monitor |
| `capture_window` | Capture specific window |
| `lens_capture_browser` | Capture lens browser preview |

### commands/shell.rs (5 commands)
| Command | Purpose |
|---------|---------|
| `shell_spawn` | Spawn a shell PTY |
| `shell_input` | Send input to shell |
| `shell_resize` | Resize shell PTY |
| `shell_kill` | Kill shell process |
| `shell_list` | List active shells |

### commands/lens.rs (10 commands)
| Command | Purpose |
|---------|---------|
| `lens_create_webview` | Create browser preview WebView2 |
| `lens_navigate` | Navigate to URL |
| `lens_go_back` / `lens_go_forward` | Browser history navigation |
| `lens_reload` | Reload page |
| `lens_resize_webview` | Reposition/resize WebView2 |
| `lens_close_webview` | Close browser preview |
| `lens_set_visible` | Show/hide preview |
| `lens_hard_refresh` | Hard refresh (bypass cache) |
| `lens_clear_cache` | Clear WebView2 cache |

### commands/lsp.rs (9 commands)
| Command | Purpose |
|---------|---------|
| `lsp_open_file` | Notify LSP of file open |
| `lsp_close_file` | Notify LSP of file close |
| `lsp_change_file` | Send file changes to LSP |
| `lsp_save_file` | Notify LSP of file save |
| `lsp_request_completion` | Request completions |
| `lsp_request_hover` | Request hover info |
| `lsp_request_definition` | Request go-to-definition |
| `lsp_get_status` | Get LSP server status |
| `lsp_shutdown` | Shut down LSP server |

### commands/dev_server.rs (3 commands)
| Command | Purpose |
|---------|---------|
| `detect_dev_servers` | Detect running dev servers |
| `probe_port` | Check if a port is active |
| `kill_port_process` | Kill process on a port |

### commands/tools.rs (3 commands)
| Command | Purpose |
|---------|---------|
| `scan_cli_tools` | Scan for installed CLI tools |
| `check_npm_versions` | Check npm package versions |
| `update_npm_package` | Update an npm package |

### commands/shortcuts.rs (4 commands)
| Command | Purpose |
|---------|---------|
| `register_shortcut` | Register a global keyboard shortcut |
| `unregister_shortcut` | Remove a global keyboard shortcut |
| `list_shortcuts` | List registered shortcuts |
| `unregister_all_shortcuts` | Remove all shortcuts |

---

## Svelte 5 Frontend

The frontend is a Svelte 5 application built with Vite. It runs inside the Tauri WebView — there is no Node.js context, no preload script, and no `window.voiceMirror` bridge. All backend communication goes through `invoke()` calls defined in `src/lib/api.js`.

### Components (60 files, 7 directories)

**Chat** (7 components):
| Component | Purpose |
|-----------|---------|
| `ChatPanel.svelte` | Main chat container with message list |
| `ChatBubble.svelte` | Individual message bubble |
| `ChatInput.svelte` | Text input bar with voice toggle |
| `MessageGroup.svelte` | Groups consecutive messages by sender |
| `ScreenshotPicker.svelte` | Screenshot selection for chat attachments |
| `StreamingCursor.svelte` | Animated cursor for streaming responses |
| `ToolCard.svelte` | Tool call display (name, status, result) |

**Lens** (16 components):
| Component | Purpose |
|-----------|---------|
| `LensWorkspace.svelte` | Layout orchestrator (SplitPanel nesting) |
| `LensPanel.svelte` | Main panel container |
| `LensToolbar.svelte` | Browser URL bar (back/forward/refresh/URL) |
| `LensPreview.svelte` | Native Tauri child WebView2 container |
| `FileEditor.svelte` | CodeMirror 6 editor |
| `FileTree.svelte` | Project file browser |
| `TabBar.svelte` | Editor tab strip |
| `TabContextMenu.svelte` | Tab right-click menu |
| `FileContextMenu.svelte` | File tree right-click menu |
| `EditorContextMenu.svelte` | Editor right-click menu |
| `CommandPalette.svelte` | Ctrl+P file search |
| `DiffViewer.svelte` | File diff viewer |
| `StatusDropdown.svelte` | Status bar dropdown |
| `McpTab.svelte` | MCP server status tab |
| `LspTab.svelte` | LSP server status tab |
| `ServersTab.svelte` | Server management tab |

**Settings** (13 components across `settings/` and `settings/appearance/`):
| Component | Purpose |
|-----------|---------|
| `SettingsPanel.svelte` | Settings page router and tab navigation |
| `AISettings.svelte` | AI provider selection, model config, scanning |
| `AppearanceSettings.svelte` | Theme presets, color pickers, fonts |
| `VoiceSettings.svelte` | TTS/STT config, audio devices, activation mode |
| `TTSConfig.svelte` | TTS engine configuration |
| `ToolSettings.svelte` | MCP tool group management |
| `BehaviorSettings.svelte` | Behavior and shortcut settings |
| `KeybindRecorder.svelte` | Keyboard shortcut capture UI |
| `DependencySettings.svelte` | Dependency version checks |
| `appearance/ThemeSection.svelte` | Theme preset picker |
| `appearance/OrbSection.svelte` | Orb appearance settings |
| `appearance/TypographySection.svelte` | Font settings |
| `appearance/MessageCardSection.svelte` | Chat message card settings |

**Sidebar** (4 components):
| Component | Purpose |
|-----------|---------|
| `Sidebar.svelte` | Navigation sidebar with page routing |
| `ChatList.svelte` | Chat session history list |
| `SessionPanel.svelte` | Session management panel |
| `ProjectStrip.svelte` | Project selector strip |

**Overlay** (2 components):
| Component | Purpose |
|-----------|---------|
| `Orb.svelte` | Animated orb with state-driven visuals |
| `OverlayPanel.svelte` | Overlay container for orb + expanded panel |

**Terminal** (3 components):
| Component | Purpose |
|-----------|---------|
| `Terminal.svelte` | ghostty-web terminal for AI PTY providers |
| `ShellTerminal.svelte` | Shell PTY terminal (user shells) |
| `TerminalTabs.svelte` | Tabbed container: AI tab + shell tabs + unified toolbar |

**Shared** (15 components):
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
| `SplitPanel.svelte` | Resizable split panel layout |
| `ResizeEdges.svelte` | Frameless window resize handles |
| `StatsBar.svelte` | Process statistics bar |
| `OnboardingModal.svelte` | First-run onboarding wizard |
| `WhatsNewModal.svelte` | Changelog display modal |

### Stores (16 reactive stores using Svelte 5 runes)

All stores live in `src/lib/stores/` and use `.svelte.js` extension for rune support:

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
| `tabs.svelte.js` | Editor tab management |
| `lens.svelte.js` | Lens navigation state |
| `project.svelte.js` | Project path + file tree |
| `terminal-tabs.svelte.js` | Terminal tab management |
| `layout.svelte.js` | Panel layout state |
| `attachments.svelte.js` | Chat attachment management |
| `dev-server-manager.svelte.js` | Dev server detection and management |

### API Layer (`src/lib/api.js`)

102 `invoke()` wrapper functions that map to Tauri commands. The frontend never calls `invoke()` directly — all calls go through this module, which handles serialization, error formatting, and typing.

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

### Library Modules (`src/lib/`)

| Module | Purpose |
|--------|---------|
| `api.js` | 102 invoke() wrappers for all Tauri commands |
| `markdown.js` | Secure markdown rendering (marked + DOMPurify) |
| `utils.js` | Utility functions (deepMerge, formatTime, uid) |
| `updater.js` | App update checking |
| `orb-presets.js` | Orb animation presets |
| `voice-greeting.js` | Voice greeting logic |
| `voice-adapters.js` | Voice engine adapters |
| `local-llm-instructions.js` | System prompts for local LLM tool calling |
| `providers.js` | AI provider definitions |
| `file-icons.js` | File type icon mapping |
| `editor-theme.js` | CodeMirror theme (Voice Mirror custom) |
| `avatar-presets.js` | Avatar/orb preset system |

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
- Are rendered in the ghostty-web terminal component

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

The voice pipeline is implemented entirely in Rust (`voice/`).

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

The MCP server is a **native Rust binary** (`voice-mirror-mcp`) that communicates via stdio JSON-RPC.

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
    ├── Browser bridge (WebView2 control)
    ├── Screen capture
    ├── Memory system
    ├── Config access
    └── Chat history
```

### Components

| Module | Purpose |
|--------|---------|
| `mcp/server.rs` | JSON-RPC transport, request routing |
| `mcp/tools.rs` | Tool registry (11 groups, dynamic load/unload) |
| `mcp/pipe_router.rs` | Concurrent pipe message routing (oneshot for browser responses, mpsc for user messages) |
| `mcp/handlers/core.rs` | Core voice communication handlers |
| `mcp/handlers/browser.rs` | Browser control via named pipe to WebView2 |
| `mcp/handlers/screen.rs` | Screen capture handlers |
| `mcp/handlers/memory.rs` | Persistent memory system |
| `mcp/handlers/n8n.rs` | n8n workflow automation |
| `mcp/handlers/diagnostic.rs` | Pipeline diagnostic tools |
| `mcp/handlers/facades.rs` | Single-tool wrappers for voice mode |

### Tool Groups (11)

| Group | Tools | Always Loaded | Description |
|-------|-------|---------------|-------------|
| `core` | 4 | Yes | Voice communication (send, inbox, listen, status) |
| `meta` | 3 | Yes | Tool management (load, unload, list groups) |
| `screen` | 1 | No | Screen capture |
| `memory` | 6 | No | Persistent memory (search, remember, forget, stats, flush) |
| `browser` | 16 | No | Chrome browser control and web research |
| `n8n` | 22 | No | n8n workflow automation |
| `diagnostic` | 1 | No | Pipeline diagnostic tools |
| `memory-facade` | 1 | No | Single-tool memory wrapper (for voice mode) |
| `n8n-facade` | 1 | No | Single-tool n8n wrapper (for voice mode) |
| `browser-facade` | 1 | No | Single-tool browser wrapper (for voice mode) |

### Communication

The MCP server communicates with the main Tauri app via **named pipes** (Windows) or **Unix domain sockets** (macOS/Linux):

| Module | Purpose |
|--------|---------|
| `ipc/pipe_server.rs` | Named pipe server in the Tauri app |
| `ipc/pipe_client.rs` | Named pipe client in the MCP binary |
| `ipc/protocol.rs` | Shared message protocol (length-prefixed JSON) |

The `PipeRouter` dispatches incoming messages to separate channels: oneshot for `BrowserResponse` (request-response) and mpsc for `UserMessage` (streaming).

---

## Config System

### Schema (`config/schema.rs`)

The full config schema is defined as Rust structs with serde serialization:

```rust
pub struct AppConfig {
    pub wake_word: WakeWordConfig,
    pub voice: VoiceConfig,
    pub appearance: AppearanceConfig,
    pub behavior: BehaviorConfig,
    pub window: WindowConfig,
    pub overlay: OverlayConfig,
    pub advanced: AdvancedConfig,
    pub sidebar: SidebarConfig,
    pub workspace: WorkspaceConfig,
    pub user: UserConfig,
    pub system: SystemConfig,
    pub ai: AiConfig,
    pub projects: ProjectsConfig,
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

Presets and theme logic live in `src/lib/stores/theme.svelte.js`:

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
    ├──→ Terminal (ghostty-web theme)
    └──→ All Svelte components (CSS variables)
```

Features:
- `deriveTheme()` — Generate all CSS variables from 10 colors
- `deriveOrbColors()` — Generate orb RGB arrays from theme
- Theme import/export (JSON format)
- Custom theme persistence via config store
- Reactive updates via Svelte 5 `$derived` runes

---

## Services (`services/`)

| Service | Purpose |
|---------|---------|
| `browser_bridge.rs` | Dispatches browser actions to WebView2 (navigate, click, fill, screenshot, snapshot, evaluate JS) |
| `file_watcher.rs` | Watches project files for changes (notifies frontend of external edits) |
| `inbox_watcher.rs` | Watches inbox directory for new voice messages |
| `input_hook.rs` | Global keyboard/mouse hook for PTT and shortcuts |
| `text_injector.rs` | OS-level text injection (simulates typing) |
| `dev_server.rs` | Dev server detection (Vite, Next.js, Parcel, Expo, etc.) |
| `logger.rs` | Structured logging via tracing crate |
| `platform.rs` | Platform detection and OS utilities |

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
| `webview2-com` / `windows` | WebView2 COM API for browser bridge (Windows) |

### JavaScript (npm)

| Package | Purpose |
|---------|---------|
| `svelte` | Frontend framework (v5, with runes) |
| `@tauri-apps/api` | Tauri invoke() and event APIs |
| `vite` | Build tool with HMR |
| `ghostty-web` | WASM terminal emulator for PTY providers |
| `@codemirror/*` | Code editor for Lens file editor |
| `marked` + `dompurify` | Secure markdown rendering in chat |

---

## Testing

### Rust Tests

```bash
npm run test:rust    # cargo test --bin voice-mirror-mcp
```

Unit tests for MCP handlers, IPC protocol, and tool registry. Note: `cargo test --lib` fails on Windows due to WebView2 DLL issues — use `cargo check --tests` for compilation verification.

### JavaScript Tests (2818+)

```bash
npm test
```

Uses `node:test` + `node:assert/strict`. Two patterns:
- **Direct import**: Pure JS functions tested by importing and calling
- **Source inspection**: Svelte stores/components tested by reading file text and asserting patterns exist

---

## Dev Commands

```bash
npm install          # Install frontend dependencies
npm run dev          # Tauri dev mode with HMR (also rebuilds MCP binary)
npm run build        # Build production Tauri app (also rebuilds MCP binary)
npm test             # Run JS test suite (2818+ tests)
npm run test:rust    # Run Rust tests (cargo test --bin voice-mirror-mcp)
npm run test:all     # Run both JS and Rust tests
npm run check        # Svelte type checking
```
