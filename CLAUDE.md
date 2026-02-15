# Voice Mirror Electron

Voice-controlled AI agent overlay for your desktop. Electron + Python voice backend (STT/TTS/VAD) + MCP server (58 tools across 8 groups).

## Rules

### How to Work With the User

- **You are the expert — act like it.** The user values your knowledge. Always give your recommendations. If you see a better approach, a potential bug, an architectural smell, or a risk — say so proactively. Don't just execute blindly.
- **Propose, don't just ask.** Instead of "what do you want?", say "I'd recommend X because Y. Want me to proceed?"
- **Flag risks before acting.** If a change could break something, explain what and why before proceeding.
- **Use your resources.** The user has high usage limits. When a task benefits from it, spin up teams — dedicated coders, reviewers, testers. Don't be conservative with agent usage. Send a code reviewer to verify changes, a tester to run the suite, an explorer to audit for regressions. Quality matters more than token savings.
- **Think about both sides.** This project spans JS (Electron) and Python (voice backend). Changes often affect both — always consider cross-boundary effects, especially around `inbox.json` which is the shared state bridge.
- **Always run `npm test` after making changes.** 519+ tests catch structural regressions. Don't skip this.

### Git Workflow

- Work on `dev` branch. Only merge to `main` when the user explicitly says to.
- Push to `dev` after commits. Don't push to `main` directly.
- Don't commit `eslint.config.js` — it's gitignored (local-only).
- `main` has a branch ruleset requiring PRs with 1 approving review + 5 required status checks. Owner can bypass when needed.

### CI & GitHub Actions

- **Skip CI for trivial changes.** Add `[skip ci]` to commit messages for docs-only, badge, or config-only changes. Don't waste CI minutes on README edits.
- **Installer tests have path filtering** — they only run when installer-related files change (`install.sh`, `install.ps1`, `cli/`, `package.json`, `python/requirements.txt`).
- **CI tests (`ci.yml`)** run on every push to `main` and every PR. Unit tests on all 3 platforms (Linux, macOS, Windows) with Node 22 + Python 3.12.
- **All GitHub Action versions are pinned to commit SHAs** for supply chain security (OpenSSF Scorecard requirement). When updating actions, pin to the full SHA with a `# vX` comment, e.g. `uses: actions/checkout@de0fac2e... # v6`.
- **Dependabot** is configured for npm (root + mcp-server), pip (python), and GitHub Actions. PRs arrive weekly.
- **Lockfiles are committed.** CI uses `npm ci` for reproducible builds. The installer (`install.sh`) uses `npm ci` when lockfile exists, falls back to `npm install`.
- **Workflow security:** Never use `${{ github.head_ref }}` or other untrusted expressions directly in `run:` blocks — always pass via `env:` to prevent script injection.

### Security Scanning (5 layers)

| Tool | What | Schedule |
|------|------|----------|
| **CodeQL** (`codeql.yml`) | SAST for JavaScript + Python | Weekly + push/PR to main |
| **OpenSSF Scorecard** (`scorecard.yml`) | Supply chain security score | Weekly + push to main |
| **Antivirus** (`antivirus.yml`) | ClamAV (Linux) + Windows Defender | Weekly + push/PR to main |
| **Snyk** (external) | Dependency vulns + SAST | Continuous |
| **Socket.dev** (external) | Supply chain risk | Continuous |

When dismissing code scanning alerts, use documented reasons. Scorecard Pinned-Dependencies alerts for `npm ci` and version-pinned `pip install` are false positives (lockfile provides pinning).

### Technical Rules (Learned from Real Bugs)

- **When moving files, update ALL `__dirname` and relative paths.** CSS `url()` resolves relative to the CSS file, not the HTML. `__dirname` changes when a file moves deeper.
- **Never remove "unused" code without tracing all callers.** Check for dynamic `require()`, `import()`, and string-based references. `node-llama-cpp` is dynamically imported by the embeddings system.
- **Empty string is falsy in JS — use explicit checks.** `if (response)` fails for `''`. Use `response !== null` or `response.length > 0`. This caused Ollama responses to be silently discarded.
- **Race conditions across async boundaries.** When Python sets a flag and JS reads shared state (or vice versa via `inbox.json`), consider the timing gap. The double-speak bug was caused by a flag being cleared before TTS started.
- **Don't be too aggressive with text filtering.** If a function strips content for TTS or display, always add a fallback path so valid input isn't silently lost.

---

## Quick Reference

```bash
npm install          # install dependencies
npm start            # production launch
npm run dev          # development with auto-reload
npm test             # run all tests (node:test + node:assert/strict)
npm run setup        # first-time setup wizard (cli/)
npm run doctor       # diagnose environment issues
```

## Architecture

```
Electron overlay (transparent, always-on-top, frameless)
  │
  ├── Python backend (child process) ── voice I/O (wake word, STT, TTS, VAD)
  │
  ├── AI provider (one of):
  │     Claude Code PTY (node-pty)   ── full terminal + MCP tools
  │     OpenCode PTY (node-pty)      ── alternative CLI provider
  │     OpenAI-compatible API        ── HTTP streaming (Ollama, LM Studio, Jan, etc.)
  │
  ├── MCP Server (stdio) ── 58 tools: voice, memory, browser, screen, n8n, etc.
  │
  └── IPC: file-based inbox (inbox.json) for MCP, PTY for CLI providers
```

### Data Flow: Voice Input → Response

```
User says "Hey Claude" → python/audio/wake_word.py detects
  → STT adapter (parakeet) transcribes → electron_bridge.py sends JSON to Electron
  → python-backend.js writes to inbox.json → MCP claude_listen picks up message
  → Claude Code processes + calls tools → claude_send writes response to inbox
  → python/notifications.py detects → TTS adapter (kokoro) synthesizes
  → Speaker plays audio → Electron chat UI updates
```

### IPC Bridges

| Bridge | Mechanism | Between |
|--------|-----------|---------|
| Electron ↔ Python | JSON over stdin/stdout | `electron/services/python-backend.js` ↔ `python/electron_bridge.py` |
| Claude Code ↔ MCP | MCP stdio protocol | Claude Code CLI ↔ `mcp-server/index.js` |
| MCP ↔ Electron | JSON files (`inbox.json`, `screen_capture_request.json`) | `mcp-server/handlers/` ↔ `electron/services/inbox-watcher.js` |
| Main ↔ Renderer | Electron IPC (contextBridge) | `electron/main.js` ↔ `electron/preload.js` ↔ renderer |

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `electron/main.js` | Electron entry point, orchestrates 15 services |
| `electron/ipc/` | 6 IPC handler modules (ai, config, misc, screen, window, validators) |
| `electron/services/` | 16 services (ai-manager, python-backend, hotkey-manager, inbox-watcher, etc.) |
| `electron/providers/` | AI providers + spawners (claude, cli, openai, base, tui-renderer) |
| `electron/browser/` | CDP browser automation (controller, actions, snapshot, fetch, search) |
| `electron/tools/` | Tool definitions and OpenAI schema conversion for local LLMs |
| `electron/lib/` | Shared utilities (json-file-watcher, safe-path, filtered-env, ollama-launcher) |
| `electron/renderer/` | Renderer modules — 15 JS files + 10 CSS files (terminal, theme, settings, orb) |
| `electron/window/` | Window management and system tray |
| `mcp-server/` | MCP stdio server, 9 handler modules, memory system with embeddings |
| `python/` | Voice pipeline: wake word, STT (7 adapters), TTS (10 adapters), VAD |
| `cli/` | Setup wizard, doctor command, Python/Ollama setup helpers |
| `test/` | Unit tests (45 files) and integration tests |
| `docs/` | ARCHITECTURE.md, PYTHON-BACKEND.md, DEVELOPMENT.md, CONFIGURATION.md |

## Code Patterns

### Services

Factory pattern — `createXxx()` returning `{ start(), stop(), isRunning() }`. See `electron/services/`.

### IPC

Handlers split into 6 modules under `electron/ipc/`, registered via `registerIpcHandlers()`. All return `{ success: boolean, data?: any, error?: string }`. Input validation in `electron/ipc/validators.js` — every IPC channel has a validator returning `{ valid, error?, value? }`.

### MCP Tools

8 handler modules in `mcp-server/handlers/`. Tool groups load/unload dynamically via profiles:
- `voice-assistant` (default): core, meta, screen, memory, browser
- `full-toolbox`: all groups
- `minimal`: core, meta only
- `voice-assistant-lite`: facades for voice mode

### Config

`electron/config.js` reads/writes platform-specific config:
- Linux: `~/.config/voice-mirror-electron/config.json`
- macOS: `~/Library/Application Support/voice-mirror-electron/config.json`
- Windows: `%APPDATA%\voice-mirror-electron\config.json`

Uses atomic writes (temp file → backup → rename) to prevent corruption.

### Module Systems

- **CommonJS (`.js`):** electron/, mcp-server/, test/
- **ESM (`.mjs`):** cli/ (for dynamic imports and top-level await)
- **4-space indentation, semicolons, camelCase** throughout JS
- **4-space indentation, snake_case** throughout Python

### Logging

Structured via `createLogger()` with `info/warn/error/debug('[Tag]', msg)`. No raw `console.log` in Electron. Debug level gated by `VOICE_MIRROR_DEBUG=1`.

## Security Architecture

### Electron Hardening

```javascript
// electron/window/index.js
webPreferences: {
    nodeIntegration: false,     // No require() in renderer
    contextIsolation: true,     // Renderer can't access main process
    webSecurity: true,          // Same-origin policy enforced
    preload: '...'              // Safe IPC bridge via contextBridge
}
```

The renderer NEVER receives raw API keys. `electron/ipc/config.js` masks keys via `maskApiKey()` before sending to renderer, and `isRedactedKey()` strips them on write-back.

### PTY Environment Filtering

`electron/lib/filtered-env.js` uses an allowlist for spawned PTY processes (Claude Code, OpenCode). Only whitelisted env vars pass through (PATH, HOME, SHELL, etc.) plus provider-specific prefixes (`ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*`, `OLLAMA_*`, etc.). Prevents leakage of unrelated secrets to child processes.

### Input Validation

`electron/ipc/validators.js` validates every IPC channel:
- URL scheme blocking (`file:`, `javascript:`, `data:` blocked in `open-external`)
- Config validation (endpoints must be HTTP/HTTPS, keys max 500 chars)
- PTY resize bounds (cols 1-500, rows 1-200)
- Query length limits (max 50000 chars)

### MCP Server Security

- `mcp-server/handlers/voice-clone.js`: SSRF prevention (`validateAudioUrl` blocks private IPs), path traversal prevention (`validateAudioPath`, `validateVoiceName`)
- `mcp-server/handlers/n8n.js` and `mcp-server/lib/memory/embeddings/openai.js`: HTTPS enforced for non-localhost URLs
- `python/shared/paths.py`: `safe_path()` validates all env-var-derived paths stay within allowed directories

### Dependency Security

- npm overrides in `mcp-server/package.json` pin `ajv@8.18.0` and `tar@7.5.7` to fix known CVEs
- Python `requirements.txt` pins `onnxruntime<1.25.0` to avoid symlink escape vulns
- `requirements-optional.txt` pins `aiohttp>=3.9.0`, `anyio>=4.4.0`, `zipp>=3.20.0`

## Testing

```bash
npm test                              # all tests (root + mcp-server)
node --test test/unit/foo.test.js     # single file
```

**Framework:** `node:test` + `node:assert/strict` (Node.js built-in — no jest/mocha).

**Test locations:**
- `test/unit/` — 45 test files for Electron services, IPC, config, providers
- `test/integration/` — end-to-end flows
- `mcp-server/lib/memory/*.test.js` — 8 memory system tests
- `mcp-server/handlers/*.test.js` — handler tests

**Style:** Source-inspection — read source files and assert on structure, exports, and behavior without requiring a running Electron instance.

**Test pattern:**
```javascript
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('module-name', () => {
    it('should do the thing', () => {
        assert.strictEqual(actual, expected);
    });
});
```

**No Python tests exist.** Python code is validated indirectly via CI full-setup tests that import and verify modules.

## Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Instructions for AI agents running inside Voice Mirror via MCP |
| `python/CLAUDE.md` | Instructions for working on the Python backend |
| `SECURITY.md` | Vulnerability reporting policy and security scope |
| `CONTRIBUTING.md` | Contributor guidelines (fork from dev, PR to dev) |
| `docs/ARCHITECTURE.md` | Detailed system architecture |
| `electron/config.js` | App configuration loader (atomic writes) |
| `electron/constants.js` | Shared constants (`CLI_PROVIDERS`, `DEFAULT_ENDPOINTS`) |
| `electron/preload.js` | Security bridge — defines `window.voiceMirror` API surface |
| `electron/ipc/validators.js` | Input validation for all IPC channels |
| `electron/lib/filtered-env.js` | PTY environment allowlist |
| `mcp-server/index.js` | MCP server entry point |
| `mcp-server/tool-groups.js` | Tool group definitions and dynamic loader |

## Dependencies

### Electron App (root)
- **Electron 40** — app shell (contextIsolation, nodeIntegration disabled)
- **node-pty** — PTY for Claude Code / OpenCode CLI embedding
- **ghostty-web** — terminal emulator (Ghostty VT parser compiled to WASM)
- **playwright-core** — CDP browser automation
- **uiohook-napi** — global keyboard/mouse hooks
- **ws** — WebSocket communication
- **marked + dompurify** — markdown rendering in chat panel
- **@clack/prompts + commander** — CLI setup wizard

### MCP Server
- **@modelcontextprotocol/sdk** — MCP protocol
- **better-sqlite3 + sqlite-vec** — memory system with FTS5 + vector search
- **node-llama-cpp** (optional) — local embeddings

### Python Backend
- **onnxruntime** — STT (Parakeet) + TTS (Kokoro) inference
- **kokoro-onnx** — default TTS engine (~311MB model)
- **onnx-asr** — default STT engine (Parakeet)
- **sounddevice** — audio I/O
- **pynput** — global hotkeys (Windows/macOS/X11)
- **openwakeword** — "Hey Claude" wake word detection

## Feature Flags

| Flag | Default | Location | Purpose |
|------|---------|----------|---------|
| `advanced.showDependencies` | `false` | `electron/config.js` | Shows "Dependencies" tab in Settings to check/update ghostty-web and OpenCode versions. Flip to `true` when ready to ship. |
