# Voice Mirror -- Development Guide

Voice Mirror uses **Tauri 2** with a Svelte 5 frontend and Rust backend. This guide covers everything you need for local development.

## Quick Start

```bash
# Install frontend dependencies
npm install

# Run in development mode (rebuilds MCP binary + Vite HMR + Rust auto-rebuild)
npm run dev

# Run JS tests (2818+ tests)
npm test

# Run Rust tests
npm run test:rust

# Run all tests (JS + Rust)
npm run test:all

# Svelte type checking
npm run check

# Verify Rust compiles (fast check, no codegen)
cd src-tauri && cargo check
```

**Important:** Always use `npm run dev` instead of `tauri dev` directly. The npm script rebuilds the `voice-mirror-mcp` binary first, which `tauri dev` does not do. A stale MCP binary silently loses new features due to serde dropping unknown fields.

---

## Project Structure

```
voice-mirror/
├── src-tauri/                          # Rust backend
│   ├── src/
│   │   ├── main.rs                     # App entry, window creation
│   │   ├── lib.rs                      # Tauri plugin + command registration, lens-bridge URI scheme
│   │   ├── commands/                   # 13 Tauri command modules (100 commands)
│   │   │   ├── mod.rs
│   │   │   ├── config.rs               # get_config, set_config, reset_config, get_platform_info, migrate
│   │   │   ├── window.rs               # Window management (11 commands)
│   │   │   ├── voice.rs                # Voice pipeline (12 commands)
│   │   │   ├── ai.rs                   # AI provider lifecycle (13 commands)
│   │   │   ├── chat.rs                 # Chat history (6 commands)
│   │   │   ├── files.rs                # File operations (13 commands)
│   │   │   ├── screenshot.rs           # Screen/window capture (6 commands)
│   │   │   ├── shell.rs                # Shell PTY spawning (5 commands)
│   │   │   ├── lens.rs                 # WebView2 browser preview (10 commands)
│   │   │   ├── lsp.rs                  # Language server protocol (9 commands)
│   │   │   ├── dev_server.rs           # Dev server detection (3 commands)
│   │   │   ├── tools.rs                # CLI tool/dependency management (3 commands)
│   │   │   └── shortcuts.rs            # Global shortcut registration (4 commands)
│   │   ├── config/                     # Config system
│   │   │   ├── mod.rs
│   │   │   ├── schema.rs               # Config struct definitions (AppConfig + 13 sub-structs)
│   │   │   ├── persistence.rs          # File I/O (atomic writes: tmp + rename)
│   │   │   └── migration.rs            # Electron config migration
│   │   ├── providers/                  # AI provider implementations
│   │   │   ├── mod.rs
│   │   │   ├── manager.rs              # Provider lifecycle management
│   │   │   ├── cli.rs                  # CLI agent providers (portable-pty)
│   │   │   ├── api.rs                  # OpenAI-compatible HTTP providers (reqwest)
│   │   │   ├── dictation.rs            # Dictation mode provider
│   │   │   └── tool_calling.rs         # Tool calling for API providers
│   │   ├── voice/                      # Voice pipeline (fully Rust-native)
│   │   │   ├── mod.rs
│   │   │   ├── pipeline.rs             # Pipeline orchestration
│   │   │   ├── stt.rs                  # Speech-to-text (Whisper ONNX)
│   │   │   ├── tts.rs                  # Text-to-speech (Kokoro ONNX / Edge TTS)
│   │   │   └── vad.rs                  # Voice activity detection
│   │   ├── mcp/                        # Native Rust MCP server
│   │   │   ├── mod.rs
│   │   │   ├── server.rs               # stdio JSON-RPC server
│   │   │   ├── tools.rs                # Tool registry (11 groups, dynamic load/unload)
│   │   │   ├── pipe_router.rs          # Concurrent pipe message routing
│   │   │   └── handlers/               # 8 tool handler modules
│   │   │       ├── mod.rs
│   │   │       ├── core.rs             # voice_send, voice_inbox, voice_listen, voice_status
│   │   │       ├── screen.rs           # capture_screen
│   │   │       ├── memory.rs           # search, get, remember, forget, stats, flush
│   │   │       ├── browser.rs          # Browser automation via named pipe to WebView2
│   │   │       ├── n8n.rs              # n8n workflow management
│   │   │       ├── diagnostic.rs       # Pipeline diagnostics
│   │   │       └── facades.rs          # Single-tool facades for voice mode
│   │   ├── ipc/                        # Named pipe IPC (MCP binary <-> Tauri app)
│   │   │   ├── protocol.rs             # McpToApp / AppToMcp message enums
│   │   │   ├── pipe_server.rs          # Named pipe server (Tauri side)
│   │   │   └── pipe_client.rs          # Named pipe client (MCP side)
│   │   ├── services/                   # 8 platform services
│   │   │   ├── mod.rs
│   │   │   ├── browser_bridge.rs       # WebView2 browser bridge (JS eval, screenshot, navigation)
│   │   │   ├── file_watcher.rs         # Project file change watcher
│   │   │   ├── inbox_watcher.rs        # MCP inbox file watcher
│   │   │   ├── input_hook.rs           # Global keyboard/mouse hook (PTT, shortcuts)
│   │   │   ├── text_injector.rs        # OS-level text injection
│   │   │   ├── dev_server.rs           # Dev server detection (Vite, Next.js, Parcel, Expo)
│   │   │   ├── logger.rs               # Structured logging (tracing)
│   │   │   └── platform.rs             # Platform detection and OS utilities
│   │   └── bin/
│   │       └── mcp.rs                  # voice-mirror-mcp binary entry point
│   ├── Cargo.toml                      # Rust dependencies
│   └── tauri.conf.json                 # Tauri window, bundle, plugin config
├── src/                                # Svelte 5 frontend
│   ├── App.svelte                      # Root component
│   ├── main.js                         # Entry point
│   ├── components/                     # 60 UI components across 7 directories
│   │   ├── chat/                       # 7 components: ChatPanel, ChatBubble, ChatInput, etc.
│   │   ├── lens/                       # 16 components: workspace, editor, file tree, preview, etc.
│   │   ├── settings/                   # 13 components (9 top-level + 4 appearance sub-panels)
│   │   ├── sidebar/                    # 4 components: Sidebar, ChatList, SessionPanel, ProjectStrip
│   │   ├── overlay/                    # 2 components: Orb, OverlayPanel
│   │   ├── terminal/                   # 3 components: Terminal, ShellTerminal, TerminalTabs
│   │   └── shared/                     # 15 components: Button, SplitPanel, ResizeEdges, etc.
│   ├── lib/
│   │   ├── api.js                      # 102 invoke() wrappers for all Tauri commands
│   │   ├── utils.js                    # deepMerge, formatTime, uid
│   │   ├── markdown.js                 # marked + DOMPurify
│   │   ├── updater.js                  # Tauri updater integration
│   │   ├── orb-presets.js              # Orb animation presets
│   │   ├── avatar-presets.js           # Avatar preset system
│   │   ├── voice-greeting.js           # Voice greeting text
│   │   ├── voice-adapters.js           # Voice engine adapters
│   │   ├── providers.js                # AI provider definitions
│   │   ├── file-icons.js               # File type icon mapping
│   │   ├── editor-theme.js             # CodeMirror theme (Voice Mirror custom)
│   │   ├── local-llm-instructions.js   # System prompt for API providers
│   │   └── stores/                     # 16 reactive stores (Svelte 5 runes)
│   │       ├── config.svelte.js        # DEFAULT_CONFIG, config state
│   │       ├── theme.svelte.js         # PRESETS, deriveTheme(), theme state
│   │       ├── ai-status.svelte.js     # AI provider status
│   │       ├── chat.svelte.js          # Chat messages + history
│   │       ├── voice.svelte.js         # Voice pipeline state
│   │       ├── navigation.svelte.js    # Page navigation
│   │       ├── shortcuts.svelte.js     # Keyboard shortcuts
│   │       ├── overlay.svelte.js       # Overlay state
│   │       ├── toast.svelte.js         # Toast notifications
│   │       ├── tabs.svelte.js          # Editor tab management
│   │       ├── lens.svelte.js          # Lens navigation state
│   │       ├── project.svelte.js       # Project path + file tree
│   │       ├── terminal-tabs.svelte.js # Terminal tab management
│   │       ├── layout.svelte.js        # Panel layout state
│   │       ├── attachments.svelte.js   # Chat attachment management
│   │       └── dev-server-manager.svelte.js # Dev server detection
│   └── styles/                         # 9 CSS files
│       ├── tokens.css                  # Design tokens (CSS custom properties)
│       ├── base.css                    # Base/reset styles
│       ├── settings.css                # Settings panel styles
│       ├── panel.css                   # Panel layout
│       ├── sidebar.css                 # Sidebar styles
│       ├── terminal.css                # Terminal styles
│       ├── orb.css                     # Orb animation styles
│       ├── notifications.css           # Toast notification styles
│       └── animations.css              # Shared animations
├── test/                               # Frontend tests (2476+)
│   ├── unit/                           # Direct-import tests (.mjs)
│   ├── stores/                         # Source-inspection tests for stores
│   ├── api/                            # API wrapper tests
│   ├── components/                     # Component source-inspection tests
│   └── lib/                            # Library utility tests
├── docs/                               # Documentation
├── .github/workflows/                  # CI, release, CodeQL, Scorecard
├── index.html                          # HTML entry point
├── vite.config.js                      # Vite + Svelte + ghostty WASM plugin
└── package.json                        # Frontend deps + npm scripts
```

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | Builds MCP binary + `tauri dev` | Development mode (Vite HMR + Rust hot-reload) |
| `build` | Builds MCP binary (release) + `tauri build` | Production build |
| `preview` | `vite preview` | Preview production build |
| `check` | `svelte-check` | Svelte type checking |
| `test` | `node --test "test/**/*.test.cjs" "test/**/*.test.mjs"` | Run all JS tests (2818+) |
| `test:rust` | `cd src-tauri && cargo test` | Run Rust tests |
| `test:all` | `npm test && npm run test:rust` | Run both JS and Rust tests |

Additional commands via Cargo:

| Command | Purpose |
|---------|---------|
| `cd src-tauri && cargo check` | Fast Rust compilation check |
| `cd src-tauri && cargo clippy` | Rust linting |
| `cd src-tauri && cargo test --bin voice-mirror-mcp` | MCP binary tests only |

---

## Dependencies

### Rust (Cargo.toml)

| Crate | Purpose |
|-------|---------|
| tauri (v2) | Desktop app framework |
| tauri-plugin-shell | Shell command execution |
| tauri-plugin-updater | Auto-update support |
| tauri-plugin-global-shortcut | Global keyboard shortcuts |
| tauri-plugin-single-instance | Single instance enforcement |
| tauri-plugin-autostart | Launch on system startup |
| tauri-plugin-dialog | Native file dialogs |
| serde / serde_json | Serialization |
| tokio | Async runtime |
| portable-pty | PTY spawning for CLI AI agents |
| reqwest | HTTP client for API providers |
| cpal / rodio | Audio capture and playback |
| whisper-rs (optional) | Speech-to-text (Whisper C++ FFI) |
| ort (optional) | ONNX Runtime for Kokoro TTS |
| tracing / tracing-subscriber | Structured logging |
| notify | File system watching |
| webview2-com / windows | WebView2 COM API (Windows, for browser bridge) |

### Frontend (package.json)

| Package | Purpose |
|---------|---------|
| svelte (v5) | UI framework with runes |
| @sveltejs/vite-plugin-svelte | Svelte Vite integration |
| vite | Build tool + dev server |
| ghostty-web | WASM terminal emulator (WebGL) |
| codemirror + @codemirror/* | Code editor (Lens file editor) |
| marked | Markdown rendering |
| dompurify | HTML sanitization |
| fuzzysort | Fuzzy search (command palette) |
| @tauri-apps/api | Tauri frontend API |
| @tauri-apps/plugin-dialog | File dialog API |
| @tauri-apps/plugin-shell | Shell API |
| @tauri-apps/plugin-updater | Updater API |

### Build Features

The Rust backend has optional features controlled via `Cargo.toml` and `tauri.conf.json`:

| Feature | Crates | Purpose |
|---------|--------|---------|
| `whisper` | whisper-rs | Local STT via Whisper C++ |
| `onnx` | ort, zip, byteorder | Local TTS via Kokoro ONNX |
| `native-ml` | whisper + onnx | Both local ML features |

Development builds enable `native-ml` by default (configured in `tauri.conf.json` under `build.features`).

---

## Testing

### Test Paths

| Path | Type | Pattern |
|------|------|---------|
| `test/unit/` | Pure JS unit tests | Direct import (.mjs) |
| `test/stores/` | Svelte store tests | Source inspection (.cjs) |
| `test/api/` | API wrapper tests | Source inspection (.cjs) |
| `test/components/` | Component tests | Source inspection (.cjs) |
| `test/lib/` | Library tests | Mixed |
| `src-tauri/src/**` | Rust tests | `#[cfg(test)]` inline |

### Running Tests

```bash
# All JS tests (2818+)
npm test

# Single JS test file
node --test test/unit/utils.test.mjs

# All Rust tests
npm run test:rust

# MCP binary tests only
cd src-tauri && cargo test --bin voice-mirror-mcp

# Both JS + Rust
npm run test:all
```

**Note:** `cargo test --lib` fails on Windows due to WebView2 DLL issues in the test harness. Use `cargo check --tests` for compilation verification and `cargo test --bin voice-mirror-mcp` for MCP binary tests.

### Test Patterns

**Direct import** -- for pure JS modules that don't use Svelte runes:
```js
// test/unit/utils.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge } from '../../src/lib/utils.js';

describe('deepMerge', () => {
    it('should merge nested objects', () => {
        const result = deepMerge({ a: { b: 1 } }, { a: { c: 2 } });
        assert.deepStrictEqual(result, { a: { b: 1, c: 2 } });
    });
});
```

**Source inspection** -- for Svelte stores (`.svelte.js`) and components (`.svelte`) that can't be imported in Node.js:
```js
// test/stores/theme.test.cjs
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '../../src/lib/stores/theme.svelte.js'), 'utf-8'
);

describe('theme store', () => {
    it('should export PRESETS', () => {
        assert.ok(src.includes('export const PRESETS'));
    });

    it('should have all required color keys in colorblind preset', () => {
        for (const key of ['bg', 'bgElevated', 'text', 'textStrong', 'muted', 'accent', 'ok', 'warn', 'danger', 'orbCore']) {
            assert.ok(src.includes(key), `missing color key: ${key}`);
        }
    });
});
```

**Rust tests** -- inline in source modules:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = AppConfig::default();
        assert_eq!(config.appearance.theme, "colorblind");
    }
}
```

---

## Debugging & Logging

### Rust Logging

The backend uses `tracing` for structured logging:

```rust
tracing::info!("Provider started: {}", provider_name);
tracing::error!("Failed to load config: {}", err);
tracing::debug!(voice_state = ?state, "Voice pipeline update");
```

Log output goes to:
- **Console** (stderr) during development (`npm run dev`)
- **MCP binary** logs to stderr (stdout is reserved for JSON-RPC)

### Frontend Debugging

- Vite dev server runs on `http://localhost:1420` with HMR
- Open DevTools in the Tauri window (right-click > Inspect, or the Tauri dev menu)
- Svelte DevTools browser extension works with Tauri's WebView

### Common Debug Commands

```bash
# Watch Rust logs during development
npm run dev 2>&1 | grep -E "(INFO|ERROR|WARN)"

# Check Rust compilation without running
cd src-tauri && cargo check

# Run Rust linter
cd src-tauri && cargo clippy

# Verify frontend builds cleanly
npx vite build
```

---

## Architecture Notes

### Tauri Command Pattern

Frontend communicates with the Rust backend via `invoke()`:

```
Svelte Component
  → api.js (invoke wrapper)
    → Tauri IPC bridge
      → #[tauri::command] fn in Rust
        → returns Result<T, String> serialized as JSON
```

All `invoke()` calls are centralized in `src/lib/api.js`. Components never call `invoke()` directly.

Tauri automatically converts camelCase JavaScript argument names to snake_case Rust parameter names.

### Svelte Store Pattern

Reactive state uses Svelte 5 runes in `.svelte.js` files:

```js
// src/lib/stores/config.svelte.js
let config = $state(structuredClone(DEFAULT_CONFIG));

export function getConfig() { return config; }
export function setConfig(patch) {
    config = deepMerge(config, patch);
}
```

Stores are imported by components and api.js. The `.svelte.js` extension is required because Svelte 5 runes (`$state`, `$derived`, `$effect`) are only processed by the Svelte compiler in `.svelte` and `.svelte.js`/`.svelte.ts` files.

### Provider System

Two categories of AI providers:

**CLI Agent Providers** (PTY-based via `portable-pty`):
- Claude Code, OpenCode, Codex, Gemini CLI, Kimi CLI
- Full terminal access with streaming output
- Managed in `src-tauri/src/providers/cli.rs`

**HTTP API Providers** (streaming via `reqwest`):
- Ollama, LM Studio, Jan, OpenAI, Groq
- OpenAI-compatible `/v1/chat/completions` endpoint
- Managed in `src-tauri/src/providers/api.rs`

Provider lifecycle is managed by `src-tauri/src/providers/manager.rs`, which handles starting, stopping, and switching between providers.

### Voice Pipeline

The voice pipeline is fully Rust-native (no separate child process):

| Component | Implementation | Location |
|-----------|---------------|----------|
| Audio capture | cpal | `voice/pipeline.rs` |
| Audio playback | rodio | `voice/tts.rs` |
| STT | whisper-rs (Whisper ONNX) | `voice/stt.rs` |
| TTS | Kokoro ONNX / Edge TTS | `voice/tts.rs` |
| VAD | Energy-based detection | `voice/vad.rs` |

### MCP Server

The MCP server is a native Rust binary (`voice-mirror-mcp`) that communicates via stdio JSON-RPC:

- Entry point: `src-tauri/src/bin/mcp.rs`
- Tool registry: `src-tauri/src/mcp/tools.rs` (11 groups, dynamic load/unload)
- Handlers: `src-tauri/src/mcp/handlers/` (8 handler modules)
- Pipe router: `src-tauri/src/mcp/pipe_router.rs` (concurrent oneshot/mpsc routing)
- Named pipe IPC connects the MCP binary to the running Tauri app for real-time communication

### Config System

Configuration flows through two layers:

1. **Frontend** (`config.svelte.js`): `DEFAULT_CONFIG` provides defaults, `deepMerge(DEFAULT_CONFIG, saved)` fills missing fields
2. **Backend** (`config/`): `schema.rs` defines the Rust struct (13 sub-configs), `persistence.rs` handles file I/O (atomic writes), `migration.rs` handles Electron config migration

Config is stored at:
- Windows: `%APPDATA%/voice-mirror/config.json`
- Linux/macOS: `~/.config/voice-mirror/config.json`

### Theme System

8 built-in theme presets defined in `src/lib/stores/theme.svelte.js`:
- Each preset has 10 required color keys + font definitions
- `deriveTheme()` generates 30+ CSS custom properties from the base colors
- Default theme is `colorblind`

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Gemini API key |
| `GROQ_API_KEY` | Groq API key |
| `TAURI_DEV_HOST` | Custom dev server host (for remote development) |

---

## Troubleshooting

### `npm run dev` fails

- Ensure Tauri CLI is installed: `cargo install tauri-cli`
- Ensure frontend deps are installed: `npm install`
- On Linux, install WebKit and GTK dev headers
- Try `cd src-tauri && cargo check` to isolate Rust vs frontend issues

### Voice pipeline not working

- Ensure the `native-ml` feature is enabled (default in `tauri.conf.json`)
- Check that Whisper ONNX model is downloaded
- Check audio device permissions on your OS

### No audio output

- Verify audio output device is available (`rodio` uses the system default)
- Check Rust console logs for TTS errors

### AI provider not connecting

- For CLI providers: verify the CLI tool is installed and on PATH (e.g., `claude --version`)
- For API providers: verify the server is running (e.g., `ollama list`)
- Check the Tauri console output for error messages

### Tests failing

- JS tests: ensure you're running from the repo root (`npm test`)
- Rust tests: `cargo test --lib` fails on Windows (WebView2 DLL issue) -- use `cargo test --bin voice-mirror-mcp`
- Some tests may require the `native-ml` feature: `cargo test --features native-ml`

### MCP binary stale

- If MCP tools aren't working after code changes, the binary may be stale
- `tauri dev` does NOT rebuild the MCP binary -- always use `npm run dev`
- Serde silently drops unknown fields, so stale binaries lose features without errors
