# Voice Mirror -- Development Guide

Voice Mirror uses **Tauri 2** with a Svelte 5 frontend and Rust backend. This guide covers everything you need for local development.

> **Note:** Legacy Electron code still exists in `electron/` and `mcp-server/` but is not actively developed. All new work happens in `tauri/`.

## Quick Start

```bash
# Install frontend dependencies
cd tauri && npm install

# Run in development mode (Vite HMR + Rust auto-rebuild)
cd tauri && cargo tauri dev

# Verify frontend compiles
cd tauri && npx vite build

# Verify Rust compiles (fast check, no codegen)
cd tauri/src-tauri && cargo check

# Run Rust tests
cd tauri/src-tauri && cargo test

# Run JS tests (from repo root)
npm test

# Run all tests (JS + Rust)
npm run test:all
```

---

## Project Structure

```
voice-mirror-electron/
├── tauri/                              # Tauri 2 app (source of truth)
│   ├── src-tauri/                      # Rust backend
│   │   ├── src/
│   │   │   ├── main.rs                 # App entry, window creation
│   │   │   ├── lib.rs                  # Tauri plugin + command registration
│   │   │   ├── commands/               # Tauri commands exposed to frontend
│   │   │   │   ├── mod.rs              # Command module exports
│   │   │   │   ├── config.rs           # get_config, set_config
│   │   │   │   ├── window.rs           # Window management commands
│   │   │   │   ├── voice.rs            # Voice pipeline commands
│   │   │   │   ├── ai.rs              # AI provider lifecycle commands
│   │   │   │   ├── chat.rs             # Chat history commands
│   │   │   │   ├── tools.rs            # MCP tool management commands
│   │   │   │   └── shortcuts.rs        # Global shortcut commands
│   │   │   ├── config/                 # Config system
│   │   │   │   ├── mod.rs              # Config module entry
│   │   │   │   ├── schema.rs           # Config struct definitions + validation
│   │   │   │   ├── persistence.rs      # File I/O (read/write config.json)
│   │   │   │   └── migration.rs        # Config version migration
│   │   │   ├── providers/              # AI provider implementations
│   │   │   │   ├── mod.rs              # Provider module entry
│   │   │   │   ├── manager.rs          # Provider lifecycle management
│   │   │   │   ├── cli.rs              # CLI agent providers (portable-pty)
│   │   │   │   ├── api.rs              # OpenAI-compatible HTTP providers (reqwest)
│   │   │   │   └── tool_calling.rs     # Tool calling for API providers
│   │   │   ├── voice/                  # Voice pipeline (fully Rust-native)
│   │   │   │   ├── mod.rs              # Voice module entry
│   │   │   │   ├── pipeline.rs         # Pipeline orchestration
│   │   │   │   ├── stt.rs              # Speech-to-text (Whisper ONNX via whisper-rs)
│   │   │   │   ├── tts.rs              # Text-to-speech (Kokoro ONNX / Edge TTS)
│   │   │   │   └── vad.rs              # Voice activity detection
│   │   │   ├── mcp/                    # Built-in MCP server
│   │   │   │   ├── mod.rs              # MCP module entry
│   │   │   │   ├── server.rs           # stdio JSON-RPC server
│   │   │   │   ├── tools.rs            # Tool schema definitions
│   │   │   │   └── handlers/           # Tool handler implementations
│   │   │   │       ├── mod.rs
│   │   │   │       ├── core.rs         # voice_send, voice_inbox, voice_listen, voice_status
│   │   │   │       ├── screen.rs       # capture_screen
│   │   │   │       ├── memory.rs       # search, get, remember, forget, stats
│   │   │   │       ├── browser.rs      # CDP browser automation
│   │   │   │       ├── n8n.rs          # n8n workflow management
│   │   │   │       ├── voice_clone.rs  # Voice cloning
│   │   │   │       ├── diagnostic.rs   # Pipeline diagnostics
│   │   │   │       └── facades.rs      # Single-tool facades
│   │   │   ├── ipc/                    # Named pipe server (MCP <-> app)
│   │   │   ├── services/               # Platform services
│   │   │   │   ├── mod.rs
│   │   │   │   ├── logger.rs           # File logging (tracing-appender)
│   │   │   │   ├── inbox_watcher.rs    # MCP inbox file watcher
│   │   │   │   ├── input_hook.rs       # Global input hooks
│   │   │   │   └── platform.rs         # Platform-specific utilities
│   │   │   └── bin/
│   │   │       └── mcp.rs              # voice-mirror-mcp binary entry
│   │   ├── Cargo.toml                  # Rust dependencies
│   │   └── tauri.conf.json             # Tauri window, bundle, plugin config
│   ├── src/                            # Svelte 5 frontend
│   │   ├── App.svelte                  # Root component
│   │   ├── main.js                     # Entry point
│   │   ├── components/                 # UI components
│   │   │   ├── chat/                   # ChatBubble, ChatInput, ChatPanel, MessageGroup, StreamingCursor, ToolCard
│   │   │   ├── settings/               # SettingsPanel + 6 tab components
│   │   │   │   ├── SettingsPanel.svelte
│   │   │   │   ├── AISettings.svelte
│   │   │   │   ├── VoiceSettings.svelte
│   │   │   │   ├── AppearanceSettings.svelte
│   │   │   │   ├── BehaviorSettings.svelte
│   │   │   │   ├── DependencySettings.svelte
│   │   │   │   └── ToolSettings.svelte
│   │   │   ├── sidebar/                # Sidebar, ChatList
│   │   │   ├── overlay/                # Orb, OverlayPanel
│   │   │   ├── terminal/               # Terminal (ghostty-web)
│   │   │   └── shared/                 # Button, Toggle, TextInput, Select, Slider, TitleBar, Toast, etc.
│   │   ├── lib/
│   │   │   ├── api.js                  # All invoke() wrappers (50+ commands)
│   │   │   ├── utils.js                # deepMerge, formatTime, uid
│   │   │   ├── markdown.js             # marked + DOMPurify
│   │   │   ├── updater.js              # Tauri updater integration
│   │   │   ├── orb-presets.js          # Orb animation presets
│   │   │   ├── voice-greeting.js       # Voice greeting text
│   │   │   ├── local-llm-instructions.js  # System prompt for API providers
│   │   │   └── stores/                 # Reactive stores (Svelte 5 runes)
│   │   │       ├── config.svelte.js    # DEFAULT_CONFIG, config state
│   │   │       ├── theme.svelte.js     # PRESETS, deriveTheme(), theme state
│   │   │       ├── ai-status.svelte.js # AI provider status
│   │   │       ├── chat.svelte.js      # Chat messages + history
│   │   │       ├── voice.svelte.js     # Voice pipeline state
│   │   │       ├── navigation.svelte.js # Page navigation
│   │   │       ├── shortcuts.svelte.js # Keyboard shortcuts
│   │   │       ├── overlay.svelte.js   # Overlay state
│   │   │       └── toast.svelte.js     # Toast notifications
│   │   └── styles/                     # CSS files
│   │       ├── tokens.css              # Design tokens (CSS custom properties)
│   │       ├── base.css                # Base/reset styles
│   │       ├── settings.css            # Settings panel styles
│   │       ├── panel.css               # Panel layout
│   │       ├── sidebar.css             # Sidebar styles
│   │       ├── terminal.css            # Terminal styles
│   │       ├── orb.css                 # Orb animation styles
│   │       ├── notifications.css       # Toast notification styles
│   │       └── animations.css          # Shared animations
│   ├── index.html                      # HTML entry point
│   ├── vite.config.js                  # Vite + Svelte + ghostty WASM plugin
│   └── package.json                    # Frontend deps (svelte, vite, ghostty-web, etc.)
├── test/
│   └── tauri/                          # Frontend tests (1070+)
│       ├── unit/                       # Direct-import tests (.mjs)
│       ├── stores/                     # Source-inspection tests for stores
│       ├── api/                        # API wrapper tests
│       ├── components/                 # Component source-inspection tests
│       └── lib/                        # Library utility tests
├── electron/                           # Legacy Electron app (not actively developed)
├── mcp-server/                         # Legacy Node.js MCP server
├── voice-core/                         # Legacy Rust voice binary
├── cli/                                # CLI tools (setup, doctor)
├── docs/                               # Documentation
└── .github/workflows/                  # CI, build, CodeQL, Scorecard, antivirus
```

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `test` | `node --test "test/tauri/**/*.test.js" "test/tauri/**/*.test.mjs"` | Run all JS tests (1070+) |
| `test:rust` | `cd tauri/src-tauri && cargo test` | Run all Rust tests (167+) |
| `test:all` | `npm test && npm run test:rust` | Run both JS and Rust tests |
| `setup` | `node cli/index.mjs setup` | Interactive onboarding wizard |
| `doctor` | `node cli/index.mjs doctor` | Check system health and dependencies |

Development commands run directly via Cargo/Vite (not npm scripts):

| Command | Purpose |
|---------|---------|
| `cd tauri && cargo tauri dev` | Development mode (Vite HMR + Rust auto-rebuild) |
| `cd tauri && npx vite build` | Build frontend for production |
| `cd tauri && cargo tauri build` | Build distributable installer |
| `cd tauri/src-tauri && cargo check` | Fast Rust compilation check |
| `cd tauri/src-tauri && cargo clippy` | Rust linting |

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
| serde / serde_json | Serialization |
| tokio | Async runtime |
| portable-pty | PTY spawning for CLI AI agents |
| reqwest | HTTP client for API providers |
| cpal / rodio | Audio capture and playback |
| whisper-rs (optional) | Speech-to-text (Whisper C++ FFI) |
| ort (optional) | ONNX Runtime for Kokoro TTS |
| tracing / tracing-subscriber | Structured logging |
| notify | File system watching |

### Frontend (package.json)

| Package | Purpose |
|---------|---------|
| svelte (v5) | UI framework with runes |
| @sveltejs/vite-plugin-svelte | Svelte Vite integration |
| vite | Build tool + dev server |
| ghostty-web | GPU-accelerated terminal (WebGL) |
| marked | Markdown rendering |
| dompurify | HTML sanitization |
| @tauri-apps/api | Tauri frontend API |

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

| Path | Type | Count | Pattern |
|------|------|-------|---------|
| `test/tauri/unit/` | Pure JS unit tests | varies | Direct import (.mjs) |
| `test/tauri/stores/` | Svelte store tests | varies | Source inspection (.js) |
| `test/tauri/api/` | API wrapper tests | varies | Source inspection (.js) |
| `test/tauri/components/` | Component tests | varies | Source inspection (.js) |
| `test/tauri/lib/` | Library tests | varies | Mixed |
| `tauri/src-tauri/src/**` | Rust tests | 167+ | `#[cfg(test)]` inline |

### Running Tests

```bash
# All JS tests
npm test

# Single JS test file
node --test test/tauri/unit/utils.test.mjs

# All Rust tests
cd tauri/src-tauri && cargo test

# Single Rust test by name
cd tauri/src-tauri && cargo test test_config_defaults

# Both JS + Rust
npm run test:all
```

### Test Patterns

**Direct import** -- for pure JS modules that don't use Svelte runes:
```js
// test/tauri/unit/utils.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge } from '../../tauri/src/lib/utils.js';

describe('deepMerge', () => {
    it('should merge nested objects', () => {
        const result = deepMerge({ a: { b: 1 } }, { a: { c: 2 } });
        assert.deepStrictEqual(result, { a: { b: 1, c: 2 } });
    });
});
```

**Source inspection** -- for Svelte stores (`.svelte.js`) and components (`.svelte`) that can't be imported in Node.js:
```js
// test/tauri/stores/theme.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '../../tauri/src/lib/stores/theme.svelte.js'), 'utf-8'
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
        let config = Config::default();
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
- **Console** (stderr) during development (`cargo tauri dev`)
- **Log file** at `%APPDATA%/voice-mirror/data/vmr.log` (Windows) or `~/.config/voice-mirror/data/vmr.log` (Linux/macOS)

### Frontend Debugging

- Vite dev server runs on `http://localhost:1420` with HMR
- Open DevTools in the Tauri window (right-click > Inspect, or the Tauri dev menu)
- Svelte DevTools browser extension works with Tauri's WebView

### Common Debug Commands

```bash
# Watch Rust logs during development
cd tauri && cargo tauri dev 2>&1 | grep -E "(INFO|ERROR|WARN)"

# Check Rust compilation without running
cd tauri/src-tauri && cargo check

# Run Rust linter
cd tauri/src-tauri && cargo clippy

# Verify frontend builds cleanly
cd tauri && npx vite build
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

All `invoke()` calls are centralized in `tauri/src/lib/api.js`. Components never call `invoke()` directly.

Tauri automatically converts camelCase JavaScript argument names to snake_case Rust parameter names.

### Svelte Store Pattern

Reactive state uses Svelte 5 runes in `.svelte.js` files:

```js
// tauri/src/lib/stores/config.svelte.js
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
- Managed in `tauri/src-tauri/src/providers/cli.rs`

**HTTP API Providers** (streaming via `reqwest`):
- Ollama, LM Studio, Jan, OpenAI, Groq
- OpenAI-compatible `/v1/chat/completions` endpoint
- Managed in `tauri/src-tauri/src/providers/api.rs`

Provider lifecycle is managed by `tauri/src-tauri/src/providers/manager.rs`, which handles starting, stopping, and switching between providers.

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

- Entry point: `tauri/src-tauri/src/bin/mcp.rs`
- Tool schemas: `tauri/src-tauri/src/mcp/tools.rs`
- Handlers: `tauri/src-tauri/src/mcp/handlers/`
- Named pipe IPC connects the MCP binary to the running Tauri app for real-time communication

### Config System

Configuration flows through two layers:

1. **Frontend** (`config.svelte.js`): `DEFAULT_CONFIG` provides defaults, `deepMerge(DEFAULT_CONFIG, saved)` fills missing fields
2. **Backend** (`config/`): `schema.rs` defines the Rust struct, `persistence.rs` handles file I/O, `migration.rs` handles version upgrades

Config is stored at:
- Windows: `%APPDATA%/voice-mirror/config.json`
- Linux/macOS: `~/.config/voice-mirror/config.json`

### Theme System

8 built-in theme presets defined in `tauri/src/lib/stores/theme.svelte.js`:
- Each preset has 10 required color keys + font definitions
- `deriveTheme()` generates 20+ CSS custom properties from the base colors
- Default theme is `colorblind`

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SERPER_API_KEY` | Serper.dev API for fast web search |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Gemini API key |
| `GROQ_API_KEY` | Groq API key |
| `TAURI_DEV_HOST` | Custom dev server host (for remote development) |

---

## Troubleshooting

### `cargo tauri dev` fails

- Ensure Tauri CLI is installed: `cargo install tauri-cli`
- Ensure frontend deps are installed: `cd tauri && npm install`
- On Linux, install WebKit and GTK dev headers (see Prerequisites)
- Try `cd tauri/src-tauri && cargo check` to isolate Rust vs frontend issues

### Voice pipeline not working

- Ensure the `native-ml` feature is enabled (default in `tauri.conf.json`)
- Check that Whisper ONNX model is downloaded
- Check audio device permissions on your OS

### No audio output

- Verify audio output device is available (`rodio` uses the system default)
- Check `vmr.log` for TTS errors

### AI provider not connecting

- For CLI providers: verify the CLI tool is installed and on PATH (e.g., `claude --version`)
- For API providers: verify the server is running (e.g., `ollama list`)
- Check the Tauri console output for error messages

### Tests failing

- JS tests: ensure you're running from the repo root (`npm test`)
- Rust tests: ensure you're in `tauri/src-tauri/` (`cargo test`)
- Some tests may require the `native-ml` feature: `cargo test --features native-ml`
