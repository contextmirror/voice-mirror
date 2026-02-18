# Contributing to Voice Mirror

Thanks for your interest in contributing! This guide covers everything you need to get started, write code that fits the project conventions, and get your changes merged.

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Rust toolchain** (for building voice-core) — install via [rustup](https://rustup.rs/)
- **npm** (comes with Node.js)
- **Git**

On Linux you also need ALSA dev headers (`libasound2-dev`) and X11 libraries for screen capture.

### Clone and Install

```bash
git clone https://github.com/contextmirror/voice-mirror-electron.git
cd voice-mirror-electron
npm install
cd mcp-server && npm install && cd ..
```

### Build the Rust Voice Core

```bash
npm run build:voice-core        # release build
npm run build:voice-core:debug  # debug build (faster compile, slower runtime)
```

### Run

```bash
npm start       # production mode
npm run dev     # development mode with auto-reload
```

### First-Time Setup

```bash
npm run setup   # interactive setup wizard
npm run doctor  # diagnose environment issues
```

## Project Structure

```
voice-mirror-electron/
├── electron/               # Electron app (main + renderer)
│   ├── main.js             # Main process entry point
│   ├── overlay.html        # Single-page renderer HTML
│   ├── preload.js          # Context bridge (renderer ↔ main IPC)
│   ├── config.js           # Config management with defaults + deep merge
│   ├── constants.js        # Shared constants
│   ├── ipc/                # IPC handlers (ai, config, misc, screen, voice, window)
│   ├── renderer/           # Frontend ES modules (terminal, chat, settings, themes)
│   ├── services/           # Backend services (ai-manager, voice-backend, inbox-watcher)
│   ├── providers/          # AI provider implementations (Claude, OpenAI-compat, CLI)
│   ├── browser/            # WebView CDP browser automation
│   ├── tools/              # MCP tool group definitions + OpenAI schema converter
│   └── lib/                # Shared utilities (JSON watcher, safe paths, screen capture)
├── voice-core/             # Rust crate — STT, TTS, wake word, VAD
├── mcp-server/             # MCP tool server (55 tools, 8 dynamic groups)
│   ├── index.js            # MCP stdio server entry
│   ├── tool-groups.js      # Tool schemas and group definitions
│   └── handlers/           # Tool handler implementations
├── test/                   # Tests
│   ├── unit/               # Unit tests
│   └── integration/        # Integration tests
├── cli/                    # CLI setup wizard and doctor command
├── docs/                   # Detailed documentation
└── .github/workflows/      # CI, build, CodeQL, Scorecard, antivirus
```

See `docs/` for detailed architecture and configuration docs.

## Development Workflow

1. **Fork the repo** (or create a branch if you have write access)
2. **Branch from `dev`** — never from `main`
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/my-feature
   ```
3. **Make your changes**
4. **Run tests** — all tests must pass
   ```bash
   npm test
   ```
5. **Commit** using conventional commit messages (see below)
6. **Open a PR against `dev`** (not `main`)

## Code Conventions

### No Build Step for JavaScript

- **Renderer code** (`electron/renderer/`) uses raw **ES modules** (`import`/`export`) loaded directly by the browser — no Webpack, no Vite, no bundler.
- **Main process and MCP server** code uses **CommonJS** (`require`/`module.exports`).
- Do not introduce a bundler or transpiler.

### Service Pattern

Backend services use the factory pattern:

```js
function createXxx() {
    return { start(), stop(), isRunning() };
}
```

### IPC Pattern

1. Main process handlers registered in `electron/ipc/*.js`
2. Exposed to renderer via `electron/preload.js` contextBridge
3. Renderer calls via `window.voiceMirror.*` API
4. **All IPC channels validated through `electron/ipc/validators.js`** — add validation for any new channel

### Config Changes

- Config defaults live in `electron/config.js` (`DEFAULT_CONFIG`)
- New fields get defaults automatically via `deepMerge(DEFAULT_CONFIG, saved)`
- Changes must be validated — update `validators.js` if adding new config fields
- Use `updateConfigAsync()` for writes (atomic write with backup)

### MCP Tool Responses

```js
{ ok: boolean, action: string, result?: any, error?: string }
```

### Logging

Use `createLogger()` — no raw `console.log` in Electron code.

### General

- Keep changes focused — one feature or fix per PR
- Don't introduce new dependencies without justification
- Avoid over-engineering — simple and focused beats clever and abstract

## Testing

### Running Tests

```bash
npm test                              # all tests
node --test test/unit/foo.test.js     # single file
```

Tests use **`node:test`** and **`node:assert/strict`**. No Jest, no Mocha, no external test frameworks.

### Source-Inspection Pattern

Renderer code uses ES modules (`export function ...`) which cannot be directly `require()`d in Node.js tests. Instead, tests read the source file as text and assert that expected patterns exist:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '../../electron/renderer/theme-engine.js'), 'utf-8'
);

describe('theme-engine', () => {
    it('should export deriveTheme', () => {
        assert.ok(src.includes('export function deriveTheme'));
    });

    it('should use blend for bg-accent derivation', () => {
        assert.ok(src.includes("'--bg-accent': blend("));
    });
});
```

This lets you verify exports, function signatures, string constants, switch cases, and structural patterns without importing the module.

### CommonJS Modules

Modules that use CommonJS (`require`/`module.exports`) **can** be imported directly in tests:

```js
const { validators } = require('../../electron/ipc/validators');

it('valid numbers pass', () => {
    const r = validators['set-window-position'](100, 200);
    assert.ok(r.valid);
});
```

### Adding a New Test

1. Create `test/unit/your-feature.test.js` (or `test/integration/` for integration tests)
2. Use `node:test` (`describe`, `it`) and `node:assert/strict`
3. Choose the right pattern:
   - **CommonJS module?** Import directly and test functions/exports
   - **ES module (renderer)?** Use source-inspection (read file, assert patterns)
4. Run `npm test` to confirm it passes

## Adding a New AI Provider

Voice Mirror supports multiple AI providers. To add a new one:

1. **Decide the provider type:**
   - **OpenAI-compatible API** (most common) — uses HTTP streaming, works for any provider with a `/v1/chat/completions` endpoint
   - **CLI/PTY provider** — spawns a CLI process and communicates via terminal

2. **For an OpenAI-compatible API provider:**

   a. Add the provider ID to `electron/constants.js` if it needs special handling, or to the `DEFAULT_ENDPOINTS` object if it's a local server.

   b. Add the provider to `electron/services/provider-detector.js`:
      - Local providers: add to `LOCAL_PROVIDERS` with `type`, `name`, `baseUrl`, `modelsEndpoint`, `chatEndpoint`
      - Cloud providers: add to `CLOUD_PROVIDERS` with `type`, `name`, `baseUrl`, `chatEndpoint`

   c. Add any default API key field to `DEFAULT_CONFIG.ai.apiKeys` in `electron/config.js`.

   d. Add the provider to `VALID_PROVIDERS` in `electron/ipc/validators.js`.

   e. Add UI for the provider in `electron/renderer/settings-ai.js`.

   f. Add tests in `test/unit/`.

3. **For a CLI/PTY provider:**

   a. Create a new spawner in `electron/providers/` (see `claude-spawner.js` as a template).

   b. Create a provider class extending `BaseProvider` from `electron/providers/base-provider.js`. Implement: `getDisplayName()`, `spawn()`, `stop()`, `sendInput()`, `sendRawInput()`.

   c. Register the provider in `electron/providers/index.js` (`createProvider` factory).

   d. Add the provider type to `CLI_PROVIDERS` in `electron/constants.js`.

   e. Add the provider to `VALID_PROVIDERS` in `electron/ipc/validators.js`.

   f. Add tests.

## Adding a New MCP Tool

MCP tools are organized into groups defined in `mcp-server/tool-groups.js`.

1. **Choose or create a tool group** in `mcp-server/tool-groups.js`:
   - Add your tool schema (name, description, inputSchema) to an existing group, or
   - Create a new group object with `alwaysLoaded`, `description`, and `tools` array

2. **Implement the handler** in `mcp-server/handlers/`:
   - Add a handler function: `async function handleYourTool(args) { ... }`
   - Return MCP-formatted response: `{ content: [{ type: 'text', text: '...' }] }`
   - Export the handler

3. **Wire the handler** in `mcp-server/index.js`:
   - Import your handler
   - Add a case in the tool dispatch switch/map that calls your handler

4. **Add tests** in `mcp-server/handlers/your-group.test.js` or `test/unit/`

5. **Update tool count** in docs if significantly changed

### Tool Schema Format

```js
{
    name: 'your_tool_name',
    description: 'What the tool does (shown to the AI)',
    inputSchema: {
        type: 'object',
        properties: {
            param1: { type: 'string', description: 'Description' },
            param2: { type: 'number', description: 'Description' }
        },
        required: ['param1']
    }
}
```

## Adding a New Theme Preset

Theme presets are defined in `electron/renderer/theme-engine.js`.

1. **Add the preset** to the `PRESETS` object in `theme-engine.js`:
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

2. **Add the preset name** to the `VALID_THEMES` array in `electron/ipc/validators.js` (inside the `set-config` validator, `appearance.theme` check).

3. **Add a UI selector** entry in `electron/renderer/settings-appearance.js` so users can pick the theme.

4. **Add tests** in `test/unit/theme-engine.test.js` — verify the preset exists and has all required keys (follow the pattern used for existing presets).

## Commit Messages

Use **conventional commit** style:

```
feat: add Gemini provider support
fix: resolve voice pipeline case mismatch
chore: bump version to 0.10.3
docs: update browser control reference
refactor: extract tool schema converter
test: add IPC validator edge cases
```

Prefix meanings:
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance (version bumps, dependency updates, config)
- `docs:` — documentation only
- `refactor:` — code restructuring without behavior change
- `test:` — adding or updating tests
- `security:` — security fixes

Scope is optional: `fix(ci):`, `feat(tts):`, etc.

Add `[skip ci]` to commit messages for docs-only or config-only changes that don't need CI.

## PR Process

1. **Base your PR on `dev`** — not `main`. PRs to `main` will be rejected.
2. **One feature or fix per PR** — keep changes focused and reviewable.
3. **All tests must pass** — CI runs `npm test` on Linux, macOS, and Windows.
4. **Describe what and why** — explain the change, not just what files were touched.
5. **Link related issues** if applicable.

The `dev` branch is merged to `main` for releases by maintainers.

## Reporting Bugs

- Use [GitHub Issues](https://github.com/contextmirror/voice-mirror-electron/issues)
- Include: steps to reproduce, expected vs actual behavior, platform (Linux/macOS/Windows)

## Security Vulnerabilities

Do **not** open public issues for security bugs. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
