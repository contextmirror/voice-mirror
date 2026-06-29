# Contributing to Voice Mirror

Thanks for your interest in contributing! This guide covers everything you need to get started, write code that fits the project conventions, and get your changes merged.

Voice Mirror is a **voice-native IDE** built on **Tauri 2** (Rust backend, Svelte 5 frontend). The Rust backend lives in `src-tauri/`; the Svelte frontend lives in `src/`. The launch is **Windows-first** — the live App Preview, native-app driving, and push-to-talk target Windows 10/11 for v1.

## Getting Started

### Prerequisites

- **Rust toolchain** (stable) — install via [rustup](https://rustup.rs/)
- **Node.js** 22+ (LTS recommended) — `npm` comes with it
- **Tauri 2 prerequisites** for your OS — see the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/)
- **LLVM/libclang** and **CMake** — required to build the native ML stack (Whisper)
- **Git**
- *(Optional)* **CUDA** toolkit for GPU-accelerated speech-to-text

On Windows, install the [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/); WebView2 ships with Windows 10/11.

On Linux you also need the Tauri system dependencies:
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev  # for audio (cpal/rodio)
```

### Clone and Install

```bash
git clone https://github.com/contextmirror/voice-mirror.git
cd voice-mirror
npm install        # frontend + test-tooling dependencies
```

### Run in Development

```bash
npm run dev        # builds the voice-mirror-mcp binary, then launches `tauri dev`
```

This compiles the native `voice-mirror-mcp` binary first, then starts the Tauri app with Vite HMR for the Svelte frontend. The frontend dev server runs on **port 31420** (moved off the default Tauri port so previewed apps never collide).

> **Heads up:** `tauri dev` watches `src-tauri/`. Editing any `.rs` or `Cargo` file while the app is running triggers a Rust rebuild that **kills the running app** (looks like a crash). Frontend-only changes hot-reload without a rebuild. If you're editing the backend while the app is live, do it in an isolated git worktree and merge once.

### Verify Compilation

```bash
npx vite build                                       # frontend compiles
cargo check --manifest-path src-tauri/Cargo.toml     # Rust backend (fast, no codegen)
cargo check --tests --manifest-path src-tauri/Cargo.toml   # Rust test compilation
cargo build --bin voice-mirror-mcp --manifest-path src-tauri/Cargo.toml  # MCP binary
npm test                                             # JS tests
```

> `cargo test --lib` currently fails on Windows due to a WebView2 DLL load — use `cargo check --tests` to verify test compilation. The MCP binary tests (`cargo test --bin voice-mirror-mcp`) do run.

## Project Structure

```
voice-mirror/
├── src-tauri/                    # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs               # App entry point
│   │   ├── lib.rs                # Plugin/command registration, startup
│   │   ├── commands/             # Tauri commands (config, window, voice, lens, lsp,
│   │   │                         #   dev_server, sandbox, screenshot, terminal, …)
│   │   ├── config/               # Config schema, persistence, migration
│   │   ├── providers/            # AI providers (CLI via PTY, HTTP API, dictation)
│   │   ├── voice/                # Voice pipeline (Whisper STT, Kokoro/Edge TTS, VAD)
│   │   ├── mcp/                  # Built-in MCP server + handlers
│   │   ├── lsp/                  # Language-server integration
│   │   ├── terminal/             # PTY-backed terminal
│   │   ├── services/             # Platform services (sandbox preview, window follow,
│   │   │                         #   output/logs, inbox watcher)
│   │   ├── ipc/                  # Named-pipe IPC (MCP binary <-> app)
│   │   └── bin/mcp.rs            # voice-mirror-mcp binary entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                          # Svelte 5 frontend
│   ├── App.svelte
│   ├── main.js
│   ├── components/               # UI by feature
│   │   ├── chat/                 # Chat bubbles, input, panel, tool cards
│   │   ├── lens/                 # Editor, file tree, App/browser preview, terminal,
│   │   │                         #   command palette, git, dev servers
│   │   ├── settings/             # Settings panels
│   │   ├── overlay/ · shared/    # Orb, title bar, buttons, toasts, etc.
│   ├── lib/
│   │   ├── api.js                # Tauri invoke() wrappers
│   │   ├── health-contracts.js   # Subsystem health contracts (diagnostics)
│   │   └── stores/               # Reactive runes-based stores (.svelte.js)
│   └── styles/
├── test/                         # JS tests (node:test, source-inspection)
│   ├── api/ stores/ components/ lib/ unit/ lsp/ editor/ diagnostics/ styles/ commands/
├── docs/                         # Documentation (see docs/README.md)
├── scripts/ · tools/             # Build + dev tooling
└── .github/workflows/            # CI, build, security scanning
```

## Development Workflow

1. **Fork the repo** (or create a branch if you have write access)
2. **Branch from `dev`** — this is the active development branch. `main` is reserved for releases.
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/my-feature
   ```
3. **Make your changes** in `src-tauri/` (Rust) and/or `src/` (Svelte)
4. **Run tests** — all tests must pass
   ```bash
   npm run test:all    # JS + Rust
   ```
5. **Commit** using conventional commit messages (see below)
6. **Open a PR against `dev`**

> Merges to `main` are for releases only.

## Wiring Checklist — when you add a subsystem

Voice Mirror has a runtime self-diagnostic system. Wire every new subsystem into it so a broken connection is caught automatically:

- Add a **health contract** in `src/lib/health-contracts.js`.
- Register it in the **diagnostics** store's `EXPECTED_SUBSYSTEMS` (`src/lib/stores/diagnostics.svelte.js`) so the meta-check knows it should exist.
- Log key actions at DEBUG with the `[AUDIT]` prefix; runtime errors route to the Frontend log channel.

## Code Conventions

### Frontend (Svelte 5 + Vite)

- **Framework:** Svelte 5 with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Stores:** Reactive state lives in `.svelte.js` files under `src/lib/stores/`. The `.svelte.js` extension is required for rune support.
- **Components:** Organized by feature area under `src/components/`
- **API layer:** All Tauri `invoke()` calls go through `src/lib/api.js` — never call `invoke()` directly from components
- **No raw `console.log`** — use structured logging

### Backend (Rust + Tauri)

- **Commands:** Tauri commands in `src-tauri/src/commands/` use `#[tauri::command]` and are registered in `lib.rs`
- **IPC:** Frontend calls Rust via `invoke('command_name', { args })`. Tauri auto-converts camelCase JS args to snake_case Rust params.
- **Providers:** AI providers live in `src-tauri/src/providers/` — CLI agents use a PTY, HTTP providers use `reqwest`, dictation is its own module
- **Voice:** The voice pipeline (`src-tauri/src/voice/`) is fully Rust-native: Whisper for STT, Kokoro / Edge TTS for synthesis, rodio for playback
- **MCP server:** Built-in as a Rust binary (`voice-mirror-mcp`) in `src-tauri/src/mcp/`, communicating via stdio JSON-RPC
- **Logging:** Use `tracing` macros (`tracing::info!`, `tracing::error!`, …). Log routing to the in-app Output panel is by module path — no manual channel tagging needed.

### Config Changes

- Frontend defaults live in `src/lib/stores/config.svelte.js` (`DEFAULT_CONFIG`)
- Backend schema and validation live in `src-tauri/src/config/`
- New fields get defaults automatically via `deepMerge(DEFAULT_CONFIG, saved)` on the frontend
- Config is persisted by the Rust backend (`get_config` / `set_config` commands)
- Config location: `%APPDATA%\voice-mirror\config.json` (Windows), `~/.config/voice-mirror/config.json` (Linux), `~/Library/Application Support/voice-mirror/config.json` (macOS)

### General

- Keep changes focused — one feature or fix per PR
- Don't introduce new dependencies without justification
- Avoid over-engineering — simple and focused beats clever and abstract

## Testing

### Running Tests

```bash
npm test                                   # All JS tests (node:test)
npm run test:rust                          # Rust tests (cd src-tauri && cargo test)
npm run test:all                           # Both JS + Rust
node --test test/unit/foo.test.mjs         # Single JS test file
```

JS tests use **`node:test`** and **`node:assert/strict`** — no Jest, no Mocha, no external frameworks. Test files are `*.test.cjs` (source-inspection) and `*.test.mjs` (direct import).

### Test Patterns

Two testing approaches based on module type:

**Direct import** (`.test.mjs` for pure JS modules):
```js
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

**Source-inspection** (`.test.cjs` for Svelte stores and components — read the file, assert on patterns):
```js
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
});
```

### Test Paths

| Path | Type | Description |
|------|------|-------------|
| `test/unit/` | Direct import | Pure JS module tests (.mjs) |
| `test/stores/` | Source inspection | Svelte store tests |
| `test/api/` | Source inspection | API wrapper tests |
| `test/components/` | Source inspection | Component structure tests |
| `test/lib/`, `test/lsp/`, `test/editor/`, `test/diagnostics/`, `test/styles/` | Mixed | Feature-area tests |
| `src-tauri/src/` (inline) | Rust | `#[cfg(test)]` modules |

### Adding a New Test

1. Choose the right location under `test/`
2. Use `node:test` (`describe`, `it`) and `node:assert/strict`
3. Choose the right pattern:
   - **Pure JS module?** Direct import in a `.test.mjs` file
   - **Svelte store or component?** Source-inspection in a `.test.cjs` file
   - **Rust?** Add a `#[cfg(test)]` module in the relevant Rust source file
4. Run `npm run test:all` to confirm it passes

## Adding a New AI Provider

1. **Decide the provider type:**
   - **CLI/PTY provider** — spawns a CLI process (e.g. Claude Code, OpenCode, Codex, Gemini CLI, Kimi CLI)
   - **OpenAI-compatible API** — HTTP streaming via `reqwest` (e.g. Ollama, LM Studio, Jan, OpenAI, Groq)

2. **Backend (Rust):**
   - Add the provider logic in `src-tauri/src/providers/` (`cli/` for CLI agents, `api.rs` for HTTP)
   - Register the provider in `manager.rs`
   - Update the config schema under `src-tauri/src/config/`

3. **Frontend (Svelte):**
   - Add provider UI in `src/components/settings/`
   - Update `src/lib/stores/config.svelte.js` if new config fields are needed
   - Add API wrappers in `src/lib/api.js` if new commands are needed

4. **Tests:** Rust tests in the provider module, JS tests under `test/`

## Adding a New MCP Tool

MCP tools are implemented in Rust in `src-tauri/src/mcp/`.

1. **Define the tool schema** in `src-tauri/src/mcp/tools.rs` — name, description, input schema
2. **Implement the handler** in the appropriate file under `src-tauri/src/mcp/handlers/`:
   - `core.rs` — voice send/receive/listen/status
   - `capture.rs` — screen / app-window capture
   - `memory.rs` — persistent memory search/store/forget
   - `browser.rs` — browser automation
   - `sandbox.rs` — driving the live App Preview (the running app)
   - `n8n.rs` — n8n workflow management
3. **Wire the handler** into the dispatch logic (`mcp/mod.rs` / `server.rs`)
4. **Add tests** in the handler module using `#[cfg(test)]`

## Adding a New Theme Preset

Theme presets are defined in `src/lib/stores/theme.svelte.js`.

1. **Add the preset** to the `PRESETS` object (all required color keys + fonts; everything else is derived by `deriveTheme()`).
2. **Add a UI selector** in `src/components/settings/AppearanceSettings.svelte`.
3. **Add tests** in `test/stores/` — verify the preset exists and has all required keys.

## Commit Messages

Use **conventional commit** style:

```
feat: add Gemini provider support
fix: resolve voice pipeline case mismatch
chore: bump version
docs: update browser control reference
refactor: extract tool schema converter
test: add config store edge cases
security: filter PTY environment variables
```

Scope is optional: `fix(ci):`, `feat(tts):`, etc. Add `[skip ci]` for docs- or config-only changes that don't need CI.

## PR Process

1. **Base your PR on `dev`** — the active development branch.
2. **One feature or fix per PR** — keep changes focused and reviewable.
3. **All tests must pass** — `npm run test:all`.
4. **Describe what and why** — explain the change, not just which files were touched.
5. **Link related issues** if applicable.

## Reporting Bugs

- Use [GitHub Issues](https://github.com/contextmirror/voice-mirror/issues)
- Include: steps to reproduce, expected vs actual behavior, and platform (Windows / macOS / Linux)

## Security Vulnerabilities

Do **not** open public issues for security bugs. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
