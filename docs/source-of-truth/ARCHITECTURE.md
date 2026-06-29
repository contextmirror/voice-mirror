# Voice Mirror — Architecture

> Voice Mirror is a **Windows-first** voice-native IDE. The cross-platform basics (chat, editor, terminal, full-screen capture) work everywhere, but the see-and-drive App Preview / native-app driving, push-to-talk/dictation injection, and WebView2 browser bridge are **Windows-only** for v1. Launch gaps are tracked in [`docs/internal/LAUNCH-READINESS.md`](../internal/LAUNCH-READINESS.md).
>
> Last verified against code: 2026-06-29.

## System Overview

```
+-----------------------------------------------------------+
|                    TAURI 2 APPLICATION                     |
+-----------------------------------------------------------+
|                                                           |
|  ┌─ Svelte 5 Frontend (WebView) ────────────────────────┐ |
|  │  Orb overlay (draggable, animated states)            │ |
|  │  Chat panel (conversation history, markdown)         │ |
|  │  Title-bar menu bar (File/Edit/…/Help) + command reg │ |
|  │  Lens workspace (editor, preview, file tree, term)   │ |
|  │  App Preview / sandbox (see-and-drive running apps)  │ |
|  │  Terminal: AI tab (xterm.js+WebGL) + shells (ghostty)│ |
|  │  Settings panel + onboarding wizard + Get-Started    │ |
|  │  Sidebar (navigation, chat list, project strip)      │ |
|  │  Theme engine (8 presets + custom themes)            │ |
|  │  31 reactive stores (Svelte 5 runes)                 │ |
|  │  API layer: invoke('command', { args }) → Rust       │ |
|  └──────────────────────────────────────────────────────┘ |
|                         │ invoke()                        |
|                         ▼                                 |
|  ┌─ Rust Backend (Tauri commands) ──────────────────────┐ |
|  │                                                      │ |
|  │  commands/     Tauri command handlers (~20 modules)   │ |
|  │  ├── config    Config CRUD (get, set, reset)         │ |
|  │  ├── window    Window management (pos, bounds, quit) │ |
|  │  ├── voice     Voice pipeline control                │ |
|  │  ├── ai        AI provider management                │ |
|  │  ├── chat      Chat persistence (list, load, save)   │ |
|  │  ├── tools     Tool/dependency management            │ |
|  │  ├── shortcuts  Global shortcut registration         │ |
|  │  ├── files/    File ops + git (split submodules)     │ |
|  │  ├── screenshot Screen/window/monitor capture        │ |
|  │  ├── terminal  Shell PTY spawning                    │ |
|  │  ├── lens/     WebView2 browser preview (submodules) │ |
|  │  ├── lsp       Language server protocol              │ |
|  │  ├── sandbox   See-and-drive App Preview (CDP/UIA)   │ |
|  │  ├── dev_server Dev server detection                 │ |
|  │  ├── output    Output panel channels                 │ |
|  │  ├── project / mcp / onboarding / workspace_state    │ |
|  │  └── design    Element-capture design mode           │ |
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
|  │  ├── tools     Tool registry (5 groups, 45 tools)    │ |
|  │  ├── handlers  7 handler modules                     │ |
|  │  └── pipe_router Concurrent pipe message routing     │ |
|  │                                                      │ |
|  │  ipc/          Named pipe server (Win) / Unix socket │ |
|  │  config/       Config schema + persistence (serde)   │ |
|  │  services/     browser bridge, sandbox (CDP), uia,   │ |
|  │                window_follow, window_stream, file    │ |
|  │                watcher, input hook, logger, etc.      │ |
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

**231 commands** registered in `lib.rs`, spread across ~20 top-level command modules plus the `files/` and `lens/` submodule trees. The frontend communicates with the backend by calling `invoke('command_name', { args })`, which routes to a `#[tauri::command]` Rust function (most return an `IpcResponse` envelope).

Approximate per-module counts: `lsp` 45, `files/` (git + fs) 33, `lens/` 40, `voice` 19, `ai` 13, `window` 11, `sandbox` 10, `screenshot` 10, `output` 7, `chat` 6, `terminal` 6, `config` 5, `design`/`shortcuts`/`project` 4 each, `dev_server`/`mcp`/`onboarding` 3 each, `workspace_state` 2.

The per-module tables below cover the most-used modules; some counts are illustrative and may lag the headline total.

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

### commands/voice.rs (19 commands)
| Command | Purpose |
|---------|---------|
| `start_voice` | Start voice pipeline |
| `stop_voice` | Stop voice pipeline |
| `restart_voice` | Restart voice pipeline |
| `get_voice_status` | Get pipeline state |
| `set_voice_mode` | Switch activation mode |
| `list_audio_devices` | List system audio devices |
| `speak_text` | Trigger TTS for a text string |
| `stop_speaking` | Stop TTS playback |
| `ptt_press` / `ptt_release` | Push-to-talk control |
| `configure_ptt_key` | Set PTT keybinding |
| `configure_dictation_key` | Set dictation keybinding |
| `inject_text` | Inject text via OS input simulation |
| `ensure_stt_model` | Download/ensure STT model is available |
| `detect_gpu` | Detect GPU for CUDA acceleration |
| `list_stt_models` | List available STT models |
| `delete_stt_model` | Delete a downloaded STT model |

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

### commands/files/ (33 commands across submodules)

Split into `read_write`, `directory`, `filesystem`, `search`, and `git` (20 git
commands: stage/unstage, commit, push/pull/fetch, branches, stash, …).
Representative commands:
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

### commands/screenshot.rs (10 commands)
| Command | Purpose |
|---------|---------|
| `take_screenshot` | Capture primary screen |
| `list_monitors` | List available monitors |
| `list_windows` | List open windows |
| `capture_monitor` | Capture specific monitor |
| `capture_window` | Capture specific window |
| `lens_capture_browser` | Capture lens browser preview |
| … | plus region/window-region capture + helpers |

### commands/sandbox.rs (10 commands) — See-and-Drive App Preview

Launch, attach, snapshot, screenshot, click, type, and close a running app
inside the live App Preview. Uses **CDP** (Chrome DevTools Protocol over a
remote-debugging port) for WebView2/Tauri/Electron/Chromium apps and **UI
Automation (UIA)** for native non-CDP Windows apps — both producing one unified
`@ref` element model. Backed by `services/sandbox.rs` (CDP), `services/uia.rs`
(UIA worker), `services/window_follow.rs` (event-driven window-follow), and
`services/window_stream.rs` (WGC → MJPEG streaming). **Windows-only.**

### commands/output.rs (7 commands)

Output-panel channel registration, project-channel lifecycle, and log push for
the VS Code-style Output panel (system + dynamic project channels).

### commands/terminal.rs (shell PTY commands)
| Command | Purpose |
|---------|---------|
| `terminal_spawn` | Spawn a shell PTY |
| `terminal_input` | Send input to shell |
| `terminal_resize` | Resize shell PTY |
| `terminal_kill` | Kill shell process |
| `terminal_list` | List active shells |

### commands/lens/ (~40 commands across submodules)

Split into `navigation`, `tabs`, `find`, `zoom`, `device_preview`, `downloads`,
`history`, `devtools`, and `webview_setup`. Representative commands:
| Command | Purpose |
|---------|---------|
| `lens_create_tab` | Create browser tab |
| `lens_close_tab` | Close browser tab |
| `lens_switch_tab` | Switch active browser tab |
| `lens_close_all_tabs` | Close all browser tabs |
| `lens_create_webview` | Create browser preview WebView2 |
| `lens_navigate` | Navigate to URL |
| `lens_go_back` / `lens_go_forward` | Browser history navigation |
| `lens_reload` | Reload page |
| `lens_resize_webview` | Reposition/resize WebView2 |
| `lens_close_webview` | Close browser preview |
| `lens_set_visible` | Show/hide preview |
| `lens_hard_refresh` | Hard refresh (bypass cache) |
| `lens_clear_cache` | Clear WebView2 cache |

### commands/lsp.rs (45 commands)

The 15 most-used are listed below; the full set (45) covers the entire LSP feature matrix — type/declaration/implementation navigation, document highlight, inlay hints, code lens, semantic tokens, document colors, folding ranges, workspace symbols, call/type hierarchy, selection range, on-type/range formatting, linked editing, server management, etc. See [`LSP-GAP.md`](LSP-GAP.md) and [`LSP-WIRING-AUDIT.md`](LSP-WIRING-AUDIT.md).

| Command | Purpose |
|---------|---------|
| `lsp_open_file` | Notify LSP of file open |
| `lsp_close_file` | Notify LSP of file close |
| `lsp_change_file` | Send file changes to LSP |
| `lsp_save_file` | Notify LSP of file save |
| `lsp_request_completion` | Request completions |
| `lsp_request_hover` | Request hover info |
| `lsp_request_definition` | Request go-to-definition |
| `lsp_request_document_symbols` | Request document symbols (outline) |
| `lsp_request_references` | Find all references |
| `lsp_request_code_actions` | Request code actions |
| `lsp_prepare_rename` | Prepare rename (validate position) |
| `lsp_rename` | Execute rename refactoring |
| `lsp_apply_workspace_edit` | Apply workspace edit |
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

### commands/design.rs (4 commands)
| Command | Purpose |
|---------|---------|
| `design_command` | Execute design tool commands (element capture, etc.) |

### Other modules

`project.rs` (4 — project add/remove/list), `mcp.rs` (3 — MCP server management),
`onboarding.rs` (3 — first-run wizard), `workspace_state.rs` (2 — layout
persistence). The `git` commands live under `files/git.rs` (20).

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

### Components (102 files, 8 directories)

> The tables below are representative, not exhaustive — the component set has grown well past the originals. Notable additions since this doc was first written: terminal split (`AiTerminal.svelte` = xterm.js+WebGL for the AI provider PTY, `Terminal.svelte` = ghostty-web for user shells, plus `TerminalSidebar`/`TerminalTabStrip`/`TerminalPanel`/`TerminalActionBar`/`TerminalSearch`/`TerminalContextMenu`/colour+icon pickers), the App Preview (`SandboxPreview.svelte`), browser polish (`BrowserMenu`, `DownloadsPanel`, `HistoryPanel`, `DevicePreview`, `ElementInspector`, `ConsolePanel`, `FindBar`), LSP panels, `ProblemsPanel`, `StatusBar`, `EditorPane`/`GroupTabBar`, MCP server settings, `onboarding/WelcomeWizard.svelte`, and `shared/GettingStarted.svelte`.

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

**Lens** (23 components):
| Component | Purpose |
|-----------|---------|
| `LensWorkspace.svelte` | Layout orchestrator (SplitPanel nesting) |
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
| `DiffMinimap.svelte` | Diff minimap sidebar |
| `DiffToolbar.svelte` | Diff toolbar controls |
| `StatusDropdown.svelte` | Status bar dropdown |
| `OutlinePanel.svelte` | Document symbol outline (LSP) |
| `ReferencesPanel.svelte` | Find references panel (LSP) |
| `CodeActionsMenu.svelte` | Code actions menu (LSP) |
| `RenameInput.svelte` | Inline rename input (LSP) |
| `BrowserTabBar.svelte` | Browser tab strip |
| `DesignToolbar.svelte` | Design toolbar |
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

**Terminal** (11 components — engine split):
| Component | Purpose |
|-----------|---------|
| `AiTerminal.svelte` | **xterm.js + WebGL** terminal for the AI provider PTY (Claude Code, etc.) |
| `Terminal.svelte` | **ghostty-web** (WASM) terminal for user shell PTY sessions |
| `TerminalTabs.svelte` | Tabbed container: AI tab + shell tabs + unified toolbar |
| `TerminalPanel.svelte` | Shell terminal panel host (grid splits) |
| `TerminalSidebar.svelte` | Terminal instance tree (drag-to-reorder) |
| `TerminalTabStrip.svelte` | Shell tab strip |
| `TerminalActionBar.svelte` | Terminal toolbar actions |
| `TerminalSearch.svelte` | Find-in-terminal (Ctrl+F) |
| `TerminalContextMenu.svelte` | Terminal right-click menu |
| `TerminalColorPicker.svelte` / `TerminalIconPicker.svelte` | Tab colour / icon pickers |

**App Preview / Sandbox + Onboarding:**
| Component | Purpose |
|-----------|---------|
| `lens/SandboxPreview.svelte` | Live see-and-drive preview of a running app (CDP/UIA, window-follow) |
| `onboarding/WelcomeWizard.svelte` | First-run provider detection/install/auth wizard |
| `shared/GettingStarted.svelte` | 9-step Get-Started tutorial (auto-shows once; Help → Get Started) |
| `shared/TitleBar.svelte` | Frameless title bar + menu bar (File/Edit/Selection/View/Go/Run/Terminal/Help) wired to the command registry |

**Shared** (11 components):
| Component | Purpose |
|-----------|---------|
| `Button.svelte` | Reusable button component |
| `Select.svelte` | Dropdown select component |
| `TextInput.svelte` | Text input component |
| `Toggle.svelte` | Toggle switch component |
| `Slider.svelte` | Range slider component |
| `Toast.svelte` | Individual toast notification |
| `ToastContainer.svelte` | Toast notification container |
| `TitleBar.svelte` | Custom title bar (frameless window) |
| `SplitPanel.svelte` | Resizable split panel layout |
| `ResizeEdges.svelte` | Frameless window resize handles |
| `StatsBar.svelte` | Process statistics bar |

### Stores (31 reactive stores using Svelte 5 runes)

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
| `browser-tabs.svelte.js` | Browser tab management |
| `layout.svelte.js` | Panel layout state |
| `attachments.svelte.js` | Chat attachment management |
| `lsp-diagnostics.svelte.js` | LSP diagnostic state |
| `dev-server-manager.svelte.js` | Dev server detection and management |
| `diagnostics.svelte.js` | Runtime self-diagnostics + health-contract registry (`EXPECTED_SUBSYSTEMS`) |
| `sandbox-preview.svelte.js` | App Preview / see-and-drive state |
| `status-bar.svelte.js` | Bottom status-bar slots (git, diagnostics, cursor, language, LSP, dev server) |
| `editor-groups.svelte.js` | Split-editor group tree |
| `workspace-state.svelte.js` | Workspace layout persistence |
| `onboarding.svelte.js` | First-run wizard state |
| `terminal-profiles.svelte.js` | Shell profile detection |
| `browser-history.svelte.js` / `downloads.svelte.js` / `device-preview.svelte.js` / `navigation-history.svelte.js` / `search.svelte.js` | Browser history, downloads, device preview, editor back/forward, content search |

(31 total — the rows above the line are the originals; this group lists the major additions.)

### API Layer (`src/lib/api.js`)

130+ `invoke()` wrapper functions that map to Tauri commands. The frontend never calls `invoke()` directly — all calls go through this module, which handles serialization, error formatting, and typing.

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
| `api.js` | 130+ invoke() wrappers for all Tauri commands |
| `commands.svelte.js` | Central command registry (70 commands) shared by the menu bar + command palette |
| `health-contracts.js` | Health-check contracts wired into the diagnostics store |
| `markdown.js` | Secure markdown rendering (marked + DOMPurify) |
| `utils.js` | Utility functions (deepMerge, formatTime, uid) |
| `orb-presets.js` | Orb animation presets |
| `voice-greeting.js` | Voice greeting logic |
| `voice-adapters.js` | Voice engine adapters |
| `local-llm-instructions.js` | System prompts for local LLM tool calling |
| `providers.js` | AI provider definitions |
| `file-icons.js` | File type icon mapping |
| `editor-theme.js` | CodeMirror theme (Voice Mirror custom) |
| `editor-lsp.svelte.js` | LSP integration for CodeMirror editor |
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
| Gemini | Cloud | `gemini-2.0-flash` |
| Grok (xAI) | Cloud | `grok-2` |
| Mistral | Cloud | `mistral-small-latest` |
| OpenRouter | Cloud | aggregator |
| DeepSeek | Cloud | `deepseek-chat` |

> **Frontend exposure:** the backend supports all the providers above, but the
> frontend provider selector (`src/lib/providers.js`) currently surfaces a
> curated subset — `claude` + `opencode` (CLI), the three local servers
> (Ollama / LM Studio / Jan), and a `dictation` (voice-only) pseudo-provider.
> The other cloud/CLI providers are backend-capable but not in the UI picker.

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
Idle → [PTT / Toggle / Dictation] → Recording → Transcribing → Processing → Speaking → Idle
```

Activation modes (`VoiceMode` enum in `voice/mod.rs`):
- **Push-to-Talk (PTT)** — records while a key is held (**default**)
- **Toggle** — press once to start, again to stop
- **Wake Word** — keyword detection (enum variant exists; **not yet implemented** — the deprecated `continuous`/`hybrid` values map onto it)
- **Dictation** — a separate insert-text-at-cursor path with its own keybinding, used for the standalone dictation flow

PTT and dictation key injection are **Windows-only** for v1.

### Speech-to-Text (`voice/stt.rs`)

- **Engine**: Whisper (GGML) via `whisper-rs`, with **CUDA GPU** acceleration when available
- **Models**: tiny, base, small, large-v3-turbo, large-v3 (configurable; default `base`)
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
    ├── Sandbox / App Preview (CDP + UIA see-and-drive)
    ├── Window/screen capture
    ├── Memory system
    ├── Config access
    └── Chat history
```

### Components

| Module | Purpose |
|--------|---------|
| `mcp/server.rs` | JSON-RPC transport, request routing |
| `mcp/tools.rs` | Tool registry (45 tools, 5 groups, dynamic load/unload) |
| `mcp/pipe_router.rs` | Concurrent pipe message routing (oneshot for browser responses, mpsc for user messages) |
| `mcp/handlers/core.rs` | Core voice communication + `get_logs` |
| `mcp/handlers/browser.rs` | Browser control (`browser_action`) via named pipe to WebView2 |
| `mcp/handlers/memory.rs` | Persistent memory system |
| `mcp/handlers/capture.rs` | Window/screen capture + `list_ports` |
| `mcp/handlers/sandbox.rs` | See-and-drive sandbox (`sandbox_*`) via pipe IPC |
| `mcp/handlers/n8n.rs` | n8n workflow automation |

### Tool Groups (5, 45 tools total)

| Group | Tools | Always Loaded | Description |
|-------|-------|---------------|-------------|
| `core` | 5 | Yes | Voice communication (`voice_send`, `voice_inbox`, `voice_listen`, `voice_status`) + `get_logs` |
| `memory` | 6 | No | Persistent memory (search, get, remember, forget, stats, flush) |
| `browser` | 1 | No | `browser_action` — one unified tool with 30+ parameterized actions (navigate, screenshot, snapshot, click, fill, cookies, storage, auth, search, fetch, …) |
| `capture` | 11 | Yes | Window/screen capture + the see-and-drive sandbox: `capture_list_windows`, `capture_window`, `capture_browser`, `list_ports`, and `sandbox_start`/`sandbox_attach`/`sandbox_snapshot`/`sandbox_screenshot`/`sandbox_click`/`sandbox_type`/`sandbox_close_window` |
| `n8n` | 22 | No | n8n workflow automation |

`core` + `capture` (16 tools) are always loaded at startup; `memory`, `browser`,
and `n8n` load on demand or via tool profiles.

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
    pub editor: EditorConfig,          // incl. font_size, indent_guides
    pub lsp_servers: HashMap<String, serde_json::Value>,
    pub device_preview: DevicePreviewConfig,
    pub browser: BrowserConfig,        // download_ask_location, download_path
    pub terminal_layout: Option<serde_json::Value>,
}
```

(18 top-level fields — the trailing five were added since this doc was first
written; see the config-schema-drift section of [`AUDIT-TRACKER.md`](AUDIT-TRACKER.md).)

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
| Vim | `vim` | Gruvbox-inspired warm dark, orange accent |
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
| `sandbox.rs` | CDP backend for the see-and-drive App Preview (remote-debugging port, AX tree → `@ref` model) — **Windows** |
| `uia.rs` | UI Automation backend for driving native non-CDP apps (MTA worker thread) — **Windows** |
| `window_follow.rs` | Event-driven window-follow (OS focus hook arbitration: user focus vs AI action) — **Windows** |
| `window_stream.rs` | WGC → MJPEG streaming of a captured window for the preview — **Windows** |
| `output.rs` | Output-panel ring buffers + JSONL log files (`LogFileWriter`) |
| `file_watcher.rs` | Watches project files for changes (notifies frontend of external edits) |
| `inbox_watcher.rs` | Watches inbox directory for new voice messages |
| `input_hook.rs` | Global keyboard/mouse hook for PTT and shortcuts |
| `text_injector.rs` | OS-level text injection (simulates typing) |
| `dev_server.rs` | Dev server detection (Vite, Next.js, Astro, Parcel, Expo, etc.) |
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

### JavaScript Tests (6700+)

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
npm test             # Run JS test suite (6700+ tests)
npm run test:rust    # Run Rust tests (cargo test --bin voice-mirror-mcp)
npm run test:all     # Run both JS and Rust tests
npm run check        # Svelte type checking
```
