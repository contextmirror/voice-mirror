# Contributing to Voice Mirror

Thanks for your interest in contributing! This guide covers everything you need to get started, write code that fits the project conventions, and get your changes merged.

Voice Mirror has migrated from Electron to **Tauri 2**. The Tauri codebase (`tauri/`) is the source of truth. Legacy Electron code still exists in the repo but is not actively developed.

## Getting Started

### Prerequisites

- **Rust toolchain** (stable) -- install via [rustup](https://rustup.rs/)
- **Node.js** 22+ (LTS recommended)
- **Tauri CLI** -- `cargo install tauri-cli`
- **npm** (comes with Node.js)
- **Git**

On Linux you also need system dependencies for Tauri:
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev  # for audio (cpal/rodio)
```

On Windows, install the [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and WebView2 (pre-installed on Windows 10/11).

### Clone and Install

```bash
git clone https://github.com/contextmirror/voice-mirror-electron.git
cd voice-mirror-electron
npm install           # root dependencies (test tooling, legacy)
cd tauri && npm install  # Svelte + Vite frontend dependencies
```

### Run in Development

```bash
cd tauri
cargo tauri dev       # Starts Vite dev server + Rust backend with HMR
```

This gives you hot module replacement for the Svelte frontend and automatic Rust rebuilds when backend code changes.

### Verify Compilation

```bash
cd tauri && npx vite build             # Verify frontend compiles
cd tauri/src-tauri && cargo check       # Verify Rust compiles (fast, no codegen)
cd tauri/src-tauri && cargo test        # Run Rust tests (167+)
npm test                                # Run JS tests from repo root (1070+)
npm run test:all                        # Both JS + Rust
```

## Project Structure

```
voice-mirror-electron/
├── tauri/                        # Tauri 2 app (source of truth)
│   ├── src-tauri/                # Rust backend
│   │   ├── src/
│   │   │   ├── main.rs           # App entry point
│   │   │   ├── lib.rs            # Tauri plugin/command registration
│   │   │   ├── commands/         # Tauri commands (config, window, voice, ai, chat, tools, shortcuts)
│   │   │   ├── config/           # Config management (schema, persistence, migration)
│   │   │   ├── providers/        # AI providers (CLI via portable-pty, HTTP API)
│   │   │   ├── voice/            # Voice pipeline (STT, TTS, VAD, pipeline orchestration)
│   │   │   ├── mcp/              # Built-in MCP server (Rust native, stdio JSON-RPC)
│   │   │   ├── ipc/              # Named pipe server for MCP <-> app communication
│   │   │   ├── services/         # Platform services (logger, inbox watcher, input hook)
│   │   │   └── bin/              # Additional binaries (voice-mirror-mcp)
│   │   ├── Cargo.toml            # Rust dependencies
│   │   └── tauri.conf.json       # Tauri app configuration
│   ├── src/                      # Svelte 5 frontend
│   │   ├── App.svelte            # Root component
│   │   ├── main.js               # Entry point
│   │   ├── components/           # UI components by feature
│   │   │   ├── chat/             # ChatBubble, ChatInput, ChatPanel, MessageGroup, StreamingCursor, ToolCard
│   │   │   ├── settings/         # SettingsPanel, AISettings, VoiceSettings, AppearanceSettings, BehaviorSettings, DependencySettings, ToolSettings
│   │   │   ├── sidebar/          # Sidebar, ChatList
│   │   │   ├── overlay/          # Orb, OverlayPanel
│   │   │   ├── terminal/         # Terminal (ghostty-web)
│   │   │   └── shared/           # Button, Toggle, TextInput, Select, Slider, TitleBar, Toast, etc.
│   │   ├── lib/
│   │   │   ├── api.js            # All Tauri invoke() wrappers (50+ commands)
│   │   │   ├── utils.js          # deepMerge, formatTime, uid
│   │   │   ├── markdown.js       # marked + DOMPurify
│   │   │   ├── local-llm-instructions.js  # System prompt for API providers
│   │   │   └── stores/           # Reactive stores (.svelte.js files)
│   │   │       ├── config.svelte.js       # App config (DEFAULT_CONFIG + deepMerge)
│   │   │       ├── theme.svelte.js        # Theme presets + deriveTheme()
│   │   │       ├── ai-status.svelte.js    # AI provider status
│   │   │       ├── chat.svelte.js         # Chat state
│   │   │       ├── voice.svelte.js        # Voice state
│   │   │       ├── navigation.svelte.js   # Page navigation
│   │   │       ├── shortcuts.svelte.js    # Keyboard shortcuts
│   │   │       ├── overlay.svelte.js      # Overlay state
│   │   │       └── toast.svelte.js        # Toast notifications
│   │   └── styles/               # CSS (tokens, base, settings, panel, sidebar, etc.)
│   ├── index.html
│   ├── vite.config.js
│   └── package.json              # Frontend dependencies (Svelte, Vite, ghostty-web, etc.)
├── test/
│   └── tauri/                    # Frontend tests (1070+)
│       ├── unit/                 # Direct-import tests (.mjs) for pure JS
│       ├── stores/               # Source-inspection tests for Svelte stores
│       ├── api/                  # API signature tests
│       ├── components/           # Component source-inspection tests
│       └── lib/                  # Library tests
├── electron/                     # Legacy Electron app (not actively developed)
├── mcp-server/                   # Legacy Node.js MCP server
├── voice-core/                   # Legacy Rust voice binary
├── docs/                         # Documentation
└── .github/workflows/            # CI, build, CodeQL, Scorecard, antivirus
```

## Development Workflow

1. **Fork the repo** (or create a branch if you have write access)
2. **Branch from `tauri-migration`** -- this is the active development branch (will become `main`)
   ```bash
   git checkout tauri-migration
   git pull origin tauri-migration
   git checkout -b feat/my-feature
   ```
3. **Make your changes** in `tauri/` (Rust backend and/or Svelte frontend)
4. **Run tests** -- all tests must pass
   ```bash
   npm run test:all    # JS (1070+) + Rust (167+)
   ```
5. **Commit** using conventional commit messages (see below)
6. **Open a PR against `tauri-migration`**

## Code Conventions

### Frontend (Svelte 5 + Vite)

- **Framework:** Svelte 5 with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Bundler:** Vite -- all imports are resolved at build time
- **Stores:** Reactive state lives in `.svelte.js` files under `tauri/src/lib/stores/`. The `.svelte.js` extension is required for rune support.
- **Components:** Organized by feature area under `tauri/src/components/`
- **API layer:** All Tauri `invoke()` calls go through `tauri/src/lib/api.js` -- never call `invoke()` directly from components
- **No raw `console.log`** -- use structured logging

### Backend (Rust + Tauri)

- **Commands:** Tauri commands in `tauri/src-tauri/src/commands/` use `#[tauri::command]` and are registered in `lib.rs`
- **IPC:** Frontend calls Rust via `invoke('command_name', { args })`. Tauri auto-converts camelCase JS args to snake_case Rust params.
- **Providers:** AI providers live in `tauri/src-tauri/src/providers/` -- CLI agents use `portable-pty`, HTTP providers use `reqwest`
- **Voice:** The voice pipeline (`tauri/src-tauri/src/voice/`) is fully Rust-native: Whisper ONNX for STT, Kokoro ONNX / Edge TTS for speech synthesis, rodio for audio playback
- **MCP server:** Built-in as a Rust binary (`voice-mirror-mcp`) in `tauri/src-tauri/src/mcp/`, communicates via stdio JSON-RPC

### Config Changes

- Frontend defaults live in `tauri/src/lib/stores/config.svelte.js` (`DEFAULT_CONFIG`)
- Backend schema and validation live in `tauri/src-tauri/src/config/schema.rs`
- New fields get defaults automatically via `deepMerge(DEFAULT_CONFIG, saved)` on the frontend
- Config is persisted by the Rust backend (`get_config` / `set_config` commands)
- Config location: `%APPDATA%/voice-mirror/config.json` (Windows), `~/.config/voice-mirror/config.json` (Linux/macOS)

### Logging

- **Rust:** Use `tracing` macros (`tracing::info!`, `tracing::error!`, etc.)
- **Frontend:** No raw `console.log` -- use structured logging through the store or API layer

### General

- Keep changes focused -- one feature or fix per PR
- Don't introduce new dependencies without justification
- Avoid over-engineering -- simple and focused beats clever and abstract

## Testing

### Running Tests

```bash
npm test                                   # All JS tests (1070+)
npm run test:rust                          # All Rust tests (167+)
npm run test:all                           # Both JS + Rust
node --test test/tauri/unit/foo.test.mjs   # Single JS test file
cd tauri/src-tauri && cargo test test_name # Single Rust test
```

JS tests use **`node:test`** and **`node:assert/strict`**. No Jest, no Mocha, no external test frameworks.

### Test Patterns

Two testing approaches based on module type:

**Direct import** (`.mjs` files for pure JS modules):
```js
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

**Source-inspection** (`.js` files for Svelte stores and components):
```js
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
});
```

### Test Paths

| Path | Type | Description |
|------|------|-------------|
| `test/tauri/unit/` | Direct import | Pure JS module tests (.mjs) |
| `test/tauri/stores/` | Source inspection | Svelte store tests |
| `test/tauri/api/` | Source inspection | API wrapper tests |
| `test/tauri/components/` | Source inspection | Component structure tests |
| `test/tauri/lib/` | Mixed | Library utility tests |
| `tauri/src-tauri/` (inline) | Rust | `#[cfg(test)]` modules in Rust source |

### Adding a New Test

1. Choose the right location under `test/tauri/`
2. Use `node:test` (`describe`, `it`) and `node:assert/strict`
3. Choose the right pattern:
   - **Pure JS module?** Direct import in a `.mjs` file
   - **Svelte store or component?** Source-inspection in a `.js` file (read file, assert patterns)
   - **Rust?** Add `#[cfg(test)]` module in the relevant Rust source file
4. Run `npm run test:all` to confirm it passes

## Adding a New AI Provider

Voice Mirror supports multiple AI providers. To add a new one:

1. **Decide the provider type:**
   - **CLI/PTY provider** -- spawns a CLI process via `portable-pty` (e.g., Claude Code, OpenCode, Codex, Gemini CLI, Kimi CLI)
   - **OpenAI-compatible API** -- HTTP streaming via `reqwest` (e.g., Ollama, LM Studio, OpenAI, Groq)

2. **Backend (Rust):**
   - Add the provider logic in `tauri/src-tauri/src/providers/`
   - For CLI providers: add spawn/communication logic in `cli.rs`
   - For API providers: add endpoint config in `api.rs`
   - Register the provider in `manager.rs`
   - Update config schema in `tauri/src-tauri/src/config/schema.rs`

3. **Frontend (Svelte):**
   - Add provider UI in `tauri/src/components/settings/AISettings.svelte`
   - Update `tauri/src/lib/stores/config.svelte.js` if new config fields are needed
   - Add API wrappers in `tauri/src/lib/api.js` if new commands are needed

4. **Tests:**
   - Add Rust tests in the provider module
   - Add JS tests in `test/tauri/`

## Adding a New MCP Tool

MCP tools are implemented in Rust in `tauri/src-tauri/src/mcp/`.

1. **Define the tool schema** in `tauri/src-tauri/src/mcp/tools.rs` -- add the tool name, description, and input schema

2. **Implement the handler** in the appropriate file under `tauri/src-tauri/src/mcp/handlers/`:
   - `core.rs` -- voice send/receive/listen/status
   - `screen.rs` -- screen capture
   - `memory.rs` -- memory search/store/forget
   - `browser.rs` -- CDP browser automation
   - `n8n.rs` -- n8n workflow management
   - `voice_clone.rs` -- voice cloning
   - `diagnostic.rs` -- pipeline diagnostics
   - `facades.rs` -- single-tool facades for tool groups

3. **Wire the handler** in `tauri/src-tauri/src/mcp/mod.rs` -- add the tool to the dispatch logic

4. **Add tests** in the handler module using `#[cfg(test)]`

## Adding a New Theme Preset

Theme presets are defined in `tauri/src/lib/stores/theme.svelte.js`.

1. **Add the preset** to the `PRESETS` object:
   ```js
   yourtheme: {
       name: 'Your Theme',
       colors: {
           bg: '#......',
           bgElevated: '#......',
           text: '#......',
           textStrong: '#......',
           muted: '#......',
           accent: '#......',
           ok: '#......',
           warn: '#......',
           danger: '#......',
           orbCore: '#......'
       },
       fonts: {
           fontFamily: "'Inter', sans-serif",
           fontMono: "'JetBrains Mono', monospace"
       }
   }
   ```
   All 10 color keys are required. Everything else (20+ CSS variables, orb gradient colors) is derived automatically by `deriveTheme()`.

2. **Add a UI selector** in `tauri/src/components/settings/AppearanceSettings.svelte` so users can pick the theme.

3. **Add tests** in `test/tauri/stores/` -- verify the preset exists and has all required keys.

## Commit Messages

Use **conventional commit** style:

```
feat: add Gemini provider support
fix: resolve voice pipeline case mismatch
chore: bump version to 0.10.3
docs: update browser control reference
refactor: extract tool schema converter
test: add config store edge cases
```

Prefix meanings:
- `feat:` -- new feature
- `fix:` -- bug fix
- `chore:` -- maintenance (version bumps, dependency updates, config)
- `docs:` -- documentation only
- `refactor:` -- code restructuring without behavior change
- `test:` -- adding or updating tests
- `security:` -- security fixes

Scope is optional: `fix(ci):`, `feat(tts):`, etc.

Add `[skip ci]` to commit messages for docs-only or config-only changes that don't need CI.

## PR Process

1. **Base your PR on `tauri-migration`** -- this is the active development branch.
2. **One feature or fix per PR** -- keep changes focused and reviewable.
3. **All tests must pass** -- CI runs JS and Rust tests on Linux, macOS, and Windows.
4. **Describe what and why** -- explain the change, not just what files were touched.
5. **Link related issues** if applicable.

## Reporting Bugs

- Use [GitHub Issues](https://github.com/contextmirror/voice-mirror-electron/issues)
- Include: steps to reproduce, expected vs actual behavior, platform (Linux/macOS/Windows)

## Security Vulnerabilities

Do **not** open public issues for security bugs. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
