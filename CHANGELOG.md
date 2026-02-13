# Changelog

All notable changes to Voice Mirror are documented here.
Format inspired by game dev patch notes — grouped by release, categorized by impact.

---

## v0.8.3 — "Everything in Its Place" (2026-02-13)

Final pass on file organization and path correctness. Moved remaining root-level files into their logical directories and fixed all path regressions from the moves.

### File Moves
- **Spawners to `providers/`**: Moved `claude-spawner.js` and `cli-spawner.js` from `electron/` into `electron/providers/` — colocated with the provider system that consumes them
- **IPC validators to `ipc/`**: Moved `ipc-validators.js` from `electron/` into `electron/ipc/validators.js` — colocated with the IPC handler modules
- All consumer imports updated across 6 files (ai-manager, claude-provider, cli-provider, ipc/index, ipc/misc, test)

### Fixed
- **Claude Code not spawning** — 6 `__dirname` paths in `claude-spawner.js` still pointed one level too shallow after the move to `providers/`; MCP server, python dir, and vendor paths all resolved to `electron/` instead of the project root
- **Provider icons not loading** — 13 CSS `url()` paths in `settings.css` pointed to `../assets/` instead of `../../assets/` after the CSS moved from `electron/styles/` to `electron/renderer/styles/`

### Code Improvements
- **Deduplicated `_getConfigBase()`** in `cli-spawner.js` — replaced with `getDataDir()` from `platform-paths.js`
- **Completed barrel files**: `browser/index.js` now exports all 20+ public APIs; `window/index.js` now exports `createTrayService`
- **Added `isRunning()`** to `diagnostic-watcher.js` — matches standard service lifecycle pattern

### Documentation
- Added `README.md` to `electron/lib/`, `electron/tools/`, `electron/browser/`
- Updated `electron/README.md` structure tree for all file moves
- Fixed stale path references in `docs/ARCHITECTURE.md` and `docs/GHOSTTY-WEB-MIGRATION.md`

### Technical
- 18 files modified, 3 new files created
- 519 tests passing, 0 failures
- Zero root-level source files remain outside their domain directories

---

## v0.8.2 — "World-Class Standards" (2026-02-13)

Comprehensive code quality refactor across 8 phases: architecture decomposition, logging standardisation, error consistency, shared pattern extraction, service lifecycle unification, security hardening, and new tests. Executed by a coordinated team of 10 agents.

### Architecture
- **Split `ipc-handlers.js`** (889 lines) into 6 focused modules under `electron/ipc/`: `window.js`, `config.js`, `screen.js`, `ai.js`, `misc.js`, and `index.js` — each handler group now lives in its own file
- **Extracted `main.js` utilities**: `startOllamaServer()` to `electron/lib/ollama-launcher.js`, `syncVoiceSettingsToFile()` to python-backend service method, `ensureLocalLLMRunning()` to ai-manager service method (main.js reduced by ~160 lines)
- **Created `electron/lib/` directory** with shared utilities: `json-file-watcher.js` (factory for 3 watchers), `windows-screen-capture.js` (deduplicated from 2 files), `ollama-launcher.js`, `safe-path.js`
- **Removed Serper.dev integration**: Deleted `serper-search.js` (152 lines) and all `SERPER_API_KEY` references — web search now uses webview-based Google scraping exclusively, no external API key required

### Logging
- **Structured logger**: Extended `electron/services/logger.js` with level methods — `info()`, `warn()`, `error()`, `debug()` — each accepting a `[Tag]` parameter
- **Full migration**: All 336 `console.log/error/warn` calls replaced with structured logger calls (main process) and `createLog()` wrapper (renderer) — zero raw console calls remain
- **Debug gating**: `debug()` level only emits when `VOICE_MIRROR_DEBUG=1` environment variable is set
- **Renderer logger**: New `electron/renderer/log.js` provides `createLog('[Tag]')` for renderer-side modules
- **ASCII-safe log output**: Replaced all emoji/Unicode icons with ASCII alternatives in both Electron logger and Python bridge — no more mojibake on Windows consoles

### Consistency
- **IPC response format**: All 57 IPC handlers now return `{ success: boolean, data?: any, error?: string }` — no more mixed `{ ok }`, plain values, or `null` returns
- **Browser tool responses**: Unified to `{ ok: boolean, action: string, result?: any, error?: string }` across webview-actions, browser-fetch, and browser-search
- **Service lifecycle**: All services now expose `start()`, `stop()`, `isRunning()` — renamed hotkey-manager's `init()`/`destroy()` and added `isRunning()` to all watchers

### Deduplication
- **`electron/constants.js`**: Shared `CLI_PROVIDERS` and `DEFAULT_ENDPOINTS` — removed duplicate definitions from 6 files
- **`electron/browser/search-utils.js`**: Extracted shared `formatResults()` from browser-search
- **`electron/lib/json-file-watcher.js`**: Factory replaces ~150 lines of duplicate watch-debounce-parse logic in each of the 3 watcher services
- **Platform paths**: Consolidated `getDataDir()` to single source (`platform-paths.js`) — removed duplicate implementations from config.js and claude-spawner.js
- **Trimmed over-exports**: webview-snapshot.js reduced from 8 to 2 exports, webview-actions.js from 17 to 5

### Security
- **Path traversal prevention**: New `electron/lib/safe-path.js` with `ensureWithin(base, userPath)` — applied to 4 chat IPC handlers that accepted user-supplied file IDs
- **API key audit**: Verified no API key values are logged anywhere in the codebase (keys are passed to APIs but never appear in logs)

### Tests
- **42 new tests** across 6 files: `constants.test.js`, `safe-path.test.js`, `logger-levels.test.js`, `search-utils.test.js`, `json-file-watcher.test.js`, `service-lifecycle.test.js`
- **Integration test scaffold**: New `test/integration/` directory with service lifecycle verification
- **Test count**: 477 -> 519 (0 failures, 2 skipped)

### Technical
- 65 files modified, 11 new files created, 2 deleted
- 519 tests passing, 0 failures
- Structured logger calls: 6 -> 338, raw console calls: 336 -> 0
- All log icons ASCII-safe across Electron (JS) and Python backend

---

## v0.8.1 — "Spring Cleaning" (2026-02-13)

Deep codebase audit and cleanup: 7 agents scanned every source file for dead code, unused exports, unreachable paths, and tightening opportunities. A second pass caught cascading dead code created by the first round of removals. Three runtime bugs were also discovered and fixed.

### Fixed
- **Missing `os` import in main.js** — `startOllamaServer()` used `os.homedir()` without importing `os`, causing a crash on macOS/Linux Ollama path discovery
- **Parentless dialogs in ipc-handlers.js** — Theme export/import and font upload dialogs called `ctx.getWindow()` (nonexistent) instead of `ctx.getMainWindow()`, resulting in dialogs with no parent window
- **Broken config access in claude-spawner.js** — `getVoiceSystemPrompt()` called `config.get()` which doesn't exist; fixed to use `loadConfig()` properly

### Removed
- **12 dead files deleted** (~1,840 lines):
  - `python/legacy/` entire folder (8 files) — old tool system with zero imports
  - `electron/browser/browser-utils.js` — Playwright-era leftover, all functions duplicated locally
  - `electron/browser/config.js` — Playwright browser-profile config, unused by webview architecture
  - `electron/tools/handlers/web-search.js` — orphaned handler with no tool definition or wiring
  - `electron/services/push-to-talk.js` — PTT fully handled by Python's GlobalHotkeyListener
  - `mcp-server/lib/memory/SessionManager.js` — never instantiated
  - `mcp-server/lib/memory/sync.js` — MemorySync file watcher, never instantiated
  - `mcp-server/lib/memory/ConversationLogger.js` — never instantiated
  - `mcp-server/lib/memory/session-sync.js` — only consumer was dead `syncSessions()` method
  - `mcp-server/lib/memory/index.js`, `search/index.js` — barrel re-exports never imported
  - Orphaned test files: `sync.test.js`, `session-sync.test.js`
- **~75 dead exports/functions removed** across all modules:
  - Electron core: `sendAIInput`, `isClaudeRunning`, `isClaudeAvailable`, `pttService` lifecycle, `updateCaptureButtonState`, unused window manager methods (`toggle`, `show`, `hide`, `isVisible`, `getPosition`, `setPosition`, `getBounds`, `setBounds`, `send`), unused tray methods (`destroy`, `getTray`, `setTooltip`), 6 dead config exports, dead font-manager test exports
  - Renderer UI: entire tool card system (`addToolCallCard`, `addToolResultCard`, `getToolIcon`, `truncateResult`, `formatToolName`), `destroyOrbCanvas`, `setOrbColors`, `hideTerminal`, `getTerminalLocation`, `clearThemeOverrides`, `PRESET_NAMES`, dead `CLOUD_PROVIDERS_WITH_APIKEY` pathway, dead state properties (`terminalVisible`, `settingsVisible`)
  - Services: `autoSelect`, `clearCache`, `getAllProviderConfigs`, `getDisplayName` from provider-detector; dead methods from inbox-watcher, perf-monitor, push-to-talk, uiohook-shared, logger, diagnostic-collector; dead exports from python-backend
  - Browser: 9 dead re-exports from index.js, `trackError`/`isActive` from browser-controller, `offEvent`/`goBack`/`goForward`/`reload` from webview-cdp, `getStoredRefs`/`cachedRefsMode` from webview-actions
  - Providers: 15 of 16 exports removed from providers/index.js (only `createProvider` kept), 6 dead base-provider methods + legacy callback system, 9 dead subclass overrides (`getType`, `isPTY`, `supportsMCP`), 7 dead openai-provider setter methods, dead claude-provider methods
  - Tools: unused `getTool` import and dead `onToolCall`/`onToolResult`/`maxIterations` fields
  - MCP: `syncSessions` from MemoryManager, `mergeSmallChunks` from Chunker, 5 dead SQLiteIndex methods, `searchVectorBatch`/`findMostSimilar` from vector search, `getRecommendedProvider` and class re-exports from embeddings, `debounce` from utils
- **Dead CSS** (~70 lines): legacy `.message` styles, `.terminal-line` styles, `#terminal-close`, `.stagger-*` animation utilities, `.provider-icon-codex`, `.provider-icon-gemini-cli`
- **Dead IPC channels**: `backend-response` (never sent), `toggle-perf-monitor` (no-op)
- **Dead dependency**: removed `chokidar` from mcp-server/package.json (only used by deleted sync.js)
- **Duplicate eslint entry**: removed duplicate `Notification: "readonly"` in eslint.config.js

### Technical
- 66 files changed, +75/-3,463 lines
- All 477 tests passing after cleanup
- Two-pass audit approach: first pass removed obvious dead code, second pass caught cascading dead code (e.g. push-to-talk.js orphaned after its import was removed)
- Platform-specific code preserved: wayland-orb.js (Linux), input group escalation (Linux), cross-platform path resolution

---

## v0.8.0 — "The Ghost in the Shell" (2026-02-12)

Replaces xterm.js with [ghostty-web](https://github.com/coder/ghostty-web) — Ghostty's VT parser compiled to WASM. The result: better TUI rendering for Claude Code and OpenCode, rock-solid provider switching with 4-layer output gating, and zero xterm.js dependencies. Also fixes the long-standing mouse keybind collision bug (Discord/OBS-style non-suppression), adds tool profile support for OpenCode, and bumps the MCP listen timeout to 5 minutes.

### New Features
- **ghostty-web terminal** — Full terminal emulation via Ghostty's WASM-compiled VT parser. Same API surface as xterm.js (`Terminal`, `FitAddon`) but with superior escape sequence handling and canvas rendering. Async WASM initialization, SGR mouse events for Bubble Tea TUI scroll support, and proper `customKeyEventHandler` semantics (inverted from xterm.js — `true` = "handled/stop")
- **OpenCode tool profiles** — The Tool Profiles settings section (previously Claude Code only) now appears for all MCP CLI providers. OpenCode users get the same profile picker and tool group checkboxes as Claude Code
- **AGENTS.md** — New instruction file for MCP-connected agents (OpenCode, Kimi, etc.). Documents project architecture, MCP tool groups, voice mode workflow, and security rules. Equivalent of `python/CLAUDE.md` for non-Claude providers

### Improved
- **Provider switch stability** — 4-layer output gating prevents old PTY output from bleeding into the new provider's terminal during rapid switching (Claude Code → Ollama → OpenCode → back):
  1. Spawner-level generation counters (`claude-spawner.js`, `cli-spawner.js`) — stale PTY callbacks silently dropped
  2. Main-process `outputGated` flag (`ai-manager.js`) — blocks all non-start events between stop and new provider start
  3. Renderer-side generation check — catches any events that slip through layers 1-2
  4. Aggressive `clearTerminal()` — ANSI clear sequences + explicit canvas wipe + viewport reset
- **Thread-safe TTS playback** — `_play_audio()` uses a local process reference instead of reading `self._playback_process` directly, preventing `NoneType` crashes when another thread interrupts during provider switch
- **Notification watcher provider awareness** — Reseeds `last_seen_message_id` when the AI provider changes, preventing old inbox messages from being spoken aloud on switch
- **Clean TTS handoff** — `stop_speaking()` called before replacing the TTS adapter, ensuring no orphaned ffplay processes
- **MCP listen timeout** — Default `claude_listen` timeout increased from 60s to 300s (5 minutes). Lock timeout updated to match (310s). Reduces premature voice loop disconnections during long pauses

### Fixed
- **Keyboard keys no longer blocked by mouse side button bindings** — When gaming mice firmware-map side buttons to keyboard keys (e.g. "4", "5"), those keys were suppressed system-wide by pynput. Now bound keys pass through to other apps (Discord/OBS-style). Only key-repeat events are suppressed during hold to prevent character flooding
- **Dictation stray character cleanup** — When a printable key (e.g. "5") is bound to dictation, the character that leaks through on keydown is automatically erased by a queued Backspace before the transcribed text is injected
- **pynput implicit None suppression bug** — `_win32_kb_filter` and `_win32_mouse_filter` returned implicit `None` for non-matching events, which pynput treated as "suppress" — blocking ALL keyboard/mouse input system-wide when any key was bound
- **Toggle-panel hotkey save corruption** — Settings save now reads `dataset.rawKey` first, preventing the accelerator string from being mangled by display formatting in `textContent`
- **ghostty-web visual rendering glitch** — Overrode ghostty-web's default partial render loop with full-render (`forceAll: true`) to fix characters appearing shifted during fast streaming output from TUI apps

### Removed
- **xterm.js dependency** — Removed `xterm`, `xterm-addon-fit`, and `xterm-addon-web-links` from package.json (3 packages removed, 1 added)
- **Dead xterm.js CSS** — Removed `.xterm`, `.xterm-viewport`, and related selectors (~54 lines)
- **xterm naming throughout codebase** — Renamed HTML IDs (`xterm-container` → `terminal-mount`), JS variables (`xtermContainer` → `terminalMount`), functions (`initXterm` → `initTerminal`), and updated comments/logs across 13 files

### Technical
- 26 files changed, +628/-183 lines across Electron frontend, Python backend, MCP server, and docs
- ghostty-web loaded via UMD script tag (exposes `window.GhosttyWeb`), WASM initialized before first Terminal instance
- DPI scaling monkey-patch fixes ghostty-web's `Terminal.resize()` overwriting canvas dimensions without DPI scaling
- Window-level wheel scroll handler with coordinate hit-testing: SGR mouse events for TUI apps with mouse tracking, arrow key fallback for TUIs without, viewport scrolling for normal mode
- `selection` → `selectionBackground` in theme objects (ghostty-web API difference)
- `safeFit()` no longer subtracts 1 column — ghostty-web handles subpixel metrics correctly (no more HiDPI hack)
- `clearTerminal()` pipeline: `term.reset()` → `\x1b[2J\x1b[3J\x1b[H` → canvas `fillRect` with identity transform → viewport reset
- Generation counter pattern: monotonic counter bumped on spawn/stop, callbacks capture generation at closure time, `myGen !== spawnGeneration` gates stale events
- `_win32_kb_filter` rewritten: callbacks (`_on_press`/`_on_release`) handle trigger start/stop instead of the filter. Filter only suppresses repeat keydowns
- New `_queue_dictation_backspace()` method sends Backspace via threaded pynput Controller 30ms after keydown
- `LISTENER_LOCK_TIMEOUT_MS` updated from 70s to 310s to match new 300s default listen timeout
- All 490 tests pass

---

## Patch 0.7.1 — "The Streamline" (2026-02-12)

Simplifies the AI provider picker by consolidating redundant options. OpenCode covers 75+ cloud providers with full MCP support, making individual cloud API entries unnecessary. The settings page now offers a clean three-category layout: CLI Agents (Claude Code, OpenCode), Local (Ollama, LM Studio, Jan), done. Also adds auto-install prompting for OpenCode, fixes hardcoded user name in voice prompts, and replaces the placeholder OpenCode icon with the official logo.

### New Features
- **Auto-install OpenCode prompt** — When a user selects OpenCode in the provider dropdown but it's not installed, a toast notification appears with an "Install" button. Clicking it runs `npm install -g opencode-ai` in the background with progress feedback. Works cross-platform (Windows: `npm.cmd`, Unix: `npm`). Falls back to manual install instructions on permission errors
  - New IPC handlers: `check-cli-available` (PATH detection) and `install-cli` (npm global install with allowlist)
  - 2-minute timeout for slow networks; no sudo/elevation required

### Improved
- **Streamlined provider picker** — Removed 11 redundant provider entries (Codex, Gemini CLI, Kimi CLI, OpenAI, Gemini, Grok, Groq, Mistral, OpenRouter, DeepSeek, Kimi API) from the settings dropdown. Cloud model access now goes through OpenCode; local models stay as direct options
- **Official OpenCode icon** — Replaced the generic code brackets placeholder with OpenCode's actual logo (pixel-art terminal window from their favicon), updated the background gradient from orange to their brand dark color
- **Dynamic user name in voice prompts** — The voice assistant system prompt now reads `config.user.name` instead of a hardcoded name. Falls back to "user" if not set. Configurable in Settings > General

### Fixed
- **Hardcoded "nathan" in system prompt** — `claude-spawner.js` had the user name hardcoded in the voice assistant prompt passed to Claude Code / OpenCode
- **Hardcoded "nathan" in ConversationLogger** — `ConversationLogger.js` matched `msg.from === 'nathan'` to identify user messages; now matches any non-assistant sender

### Technical
- 16 files changed across frontend, backend, and MCP server
- Removed provider entries from: `settings-ai.html`, `settings.js`, `providers/index.js`, `ai-manager.js`, `ipc-handlers.js`, `ipc-validators.js`, `main.js`, `js/main.js`
- `CLOUD_PROVIDERS_WITH_APIKEY` and `CLOUD_PROVIDERS` arrays emptied — API key UI hidden for all remaining providers
- `VALID_PROVIDERS` reduced from 16 entries to 5 (`claude`, `opencode`, `ollama`, `lmstudio`, `jan`)
- `cli-spawner.js` retains fallback configs for removed CLI providers in case existing user configs reference them
- New IPC handlers in `ipc-handlers.js`: `check-cli-available` uses `isCLIAvailable()` from cli-spawner; `install-cli` uses allowlist pattern (`{ opencode: 'opencode-ai' }`) to prevent arbitrary npm installs
- `notifications.js` `updateToast()` now removes action buttons on state transitions (prevents stale Install button during loading)
- Roadmap updated: provider simplification, auto-install, and hardcoded name items marked done

---

## Patch 0.7.0 — "The Gateway" (2026-02-12)

Voice Mirror can now talk to **any AI model** — not just Claude. This release adds [OpenCode](https://opencode.ai) as a PTY-based AI provider, unlocking 75+ models (Kimi K2.5 Free, Gemini, GPT-4o, Ollama local models, and more) for voice interaction through a single integration. OpenCode supports MCP natively, so the full Voice Mirror tool suite (screen capture, memory, browser automation, n8n workflows) works out of the box with every model that supports tool calling.

This is the first time Voice Mirror has spoken to a non-Claude model through the MCP voice loop.

### New Features
- **OpenCode AI provider** — Full PTY integration spawns OpenCode's TUI in the xterm.js terminal, identical to the Claude Code experience
  - Appears in Settings > AI Provider under "CLI Agents (Terminal Access)" with an MCP badge
  - Auto-configures `opencode.json` with Voice Mirror's MCP server (tool groups, enabled profiles)
  - Merges with existing OpenCode config to preserve user's other MCP servers
  - TUI renders in the embedded terminal — users see thinking, tool calls, and model output in real time
  - Voice loop: speak > transcribe > inbox > model calls `claude_listen` > responds via `claude_send` > TTS speaks response
- **75+ model support** — Any model available in OpenCode (Kimi K2.5 Free, Claude, Gemini, GPT-4o, Ollama, and more) can be used as a voice assistant with full MCP tool access
- **OpenCode provider icon** — Orange gradient icon with code brackets SVG in the settings dropdown and sidebar

### Improved
- **MCP sender matching** — Python inbox polling now correctly identifies responses from any MCP-based CLI provider (OpenCode, Kimi CLI), not just Claude. All MCP tools use the `voice-claude` sender identity; the new `_sender_matches()` method handles this for all providers
- **CLI model name display** — CLI providers (Claude Code, OpenCode, Kimi CLI) no longer show stale model names from previously selected providers. The display correctly shows "OpenCode" instead of "OpenCode (llama3.1)" when a model field was left over from Ollama
- **Model identity in voice prompt** — OpenCode's voice mode prompt instructs the model to identify by its actual model name (e.g. "I'm Kimi K2.5 Free") instead of claiming to be Claude just because the MCP tools have "claude" in their names
- **Terminal dimension passthrough** — PTY now spawns at the actual xterm.js dimensions instead of hardcoded 120x30 columns. Dimensions flow from the renderer through IPC to the PTY spawn call, reducing first-frame rendering artifacts for TUI apps like OpenCode's Bubble Tea interface
- **Provider prefix stripping** — TTS now strips "OpenCode:" and "Kimi CLI:" prefixes from responses for cleaner speech output
- **Duplicate chat message prevention** — For MCP-based CLI providers, the Python bridge no longer emits a duplicate `response` event (the InboxWatcher already handles chat messages from the MCP inbox)

### Fixed
- **Missing provider validation** — Added `kimi-cli`, `kimi`, and `opencode` to the IPC validator's `VALID_PROVIDERS` array (kimi-cli was missing since its initial addition)

### Technical
- 17 files changed (16 modified, 1 new SVG asset), ~318 lines added
- New `configureOpenCodeMCP()` in `ai-manager.js` — writes `opencode.json` with `type: "local"`, `command: [array]`, `environment: {}`, and `enabled: true` (OpenCode's config format differs from Claude's `.mcp.json`)
- New `startCLIAgent()` / `stopCLIAgent()` in `ai-manager.js` — generic PTY lifecycle for non-Claude CLI agents via `cli-spawner.js`
- `ai-manager.js` resize/interrupt/isRunning/sendInput all route to `cliSpawner` alongside Claude-specific spawner
- `MCP_CLI_PROVIDERS` frozenset in Python's `inbox.py` — shared constant for providers whose MCP tools always identify as "voice-claude"
- `_CLI_MANAGED_MODEL_PROVIDERS` frozenset in Python's `config.py` — prevents stale model names in display
- Provider registered across 8 modules: `cli-spawner.js`, `providers/index.js`, `ai-manager.js`, `ipc-handlers.js`, `ipc-validators.js`, `settings-ai.html`, `settings.js`, `settings.css`
- `opencode.json` added to `.gitignore` (auto-generated MCP config, same as `.mcp.json`)
- All 490 existing tests pass

### Prerequisites
- OpenCode must be installed separately: `npm install -g opencode-ai`
- Only models with tool-calling support will work with the MCP voice loop (same requirement as Claude Code)
- OpenCode model selection is done within OpenCode's own TUI (bottom status bar), not in Voice Mirror settings

---

## Patch 0.6.2 — "Bulletproof" (2026-02-11)

### Improved
- **Python 3.12+ compatibility** — Installer now works with any Python 3.9–3.13+ by eliminating the `tflite-runtime` dependency (no wheels existed for Python 3.12+, Windows, or macOS)
- **Linux audio library detection** — Installer auto-installs `libportaudio2` on Debian/Fedora/Arch if missing (fixes `sounddevice` import failure)
- **onnx-asr dependency conflict resolved** — Removed `[gpu]` extra that pulled `onnxruntime-gpu` conflicting with `onnxruntime`

### Technical
- `openwakeword` installed with `--no-deps` to skip `tflite-runtime`; its real dependencies (tqdm, scipy, scikit-learn, requests, mutagen) listed explicitly in `requirements.txt`
- New `ensure_audio_libs()` in `install.sh` for PortAudio detection and installation on Linux
- Comprehensive installer CI: 6 jobs across Linux, macOS, Windows testing both quick (--skip-setup) and full setup paths
- CI verifies Python venv creation, pip install, 6 key package imports (numpy, onnxruntime, openwakeword, psutil, sounddevice, pynput), doctor health checks, and CLI linking
- Nightly cron schedule catches upstream pip/node-gyp breakage
- Fixed flaky `perf-monitor` test timing on slow CI runners

---

## Patch 0.6.1 — "The Stylist" (2026-02-11)

### New Features
- **Claude Gray theme** — New warm neutral gray preset inspired by the Claude app (amber accent, cream text, true gray backgrounds)
- **Message card customization** — New "Messages" section in Appearance settings with live preview of user + AI bubbles
  - Bubble style presets: Rounded, Square, Pill
  - Font size, padding, and avatar size sliders with real-time preview
  - User and AI bubble color pickers (derives gradients from single color)
  - Show/hide avatars toggle
- **Custom font uploads** — Upload your own .ttf, .otf, .woff, or .woff2 fonts
  - Fonts stored in app data directory with persistent manifest
  - Magic-byte validation rejects non-font files
  - Uploaded fonts appear in both UI and Terminal/Code font dropdowns
  - Font management list with remove buttons
  - 20-font limit, 10 MB max per file

### Technical
- New `font-manager.js` module (~255 lines) — font validation, atomic manifest writes, file copy with random ID prefix
- 10 new `--msg-*` CSS variables in `theme-engine.js` derived from theme colors (user/AI backgrounds, borders, radii, font size, padding, avatar size)
- `applyMessageCardOverrides()` function for applying saved message card settings on startup
- Refactored `chat.css` message styling from hardcoded values to CSS custom properties with fallbacks
- 5 new IPC handlers for font operations (upload, add, remove, list, get-data-url)
- Font injection via base64 data URLs to avoid Electron `file://` security restrictions
- `messageCard` config validation with bounds checking for all numeric fields

---

## Patch 0.6.0 — "The Paintbrush" (2026-02-11)

### New Features
- **Full theme customization** — New Appearance tab in settings with 10 key colors, 2 font families, and orb colors all user-configurable
- **5 preset themes** — Dark, Midnight, Emerald, Rose, and Slate presets with one-click switching
- **Native color picker** — Uses the OS-native color picker (works on Windows, macOS, Linux) for every customizable color
- **Live app-wide preview** — Every color/font change updates the ENTIRE app in real-time — sidebar, chat, settings, orb, everything
- **Live orb preview** — 128×128 animated orb in settings cycles through all 5 states (idle, recording, speaking, thinking, dictating) with your custom colors
- **Theme import/export** — Save and load themes as JSON files for community sharing
- **Font customization** — Choose UI font (System Default, Inter, Roboto, Open Sans, Poppins, Ubuntu) and code font (Cascadia Code, Fira Code, JetBrains Mono, Source Code Pro, Consolas)
- **Color derivation engine** — 10 key colors automatically derive 20+ CSS variables (hover states, borders, shadows, glows)

### Improved
- **Orb color system** — Orb ring, inner gradient, and icon colors now derive from theme accent and orbCore colors (no more hardcoded RGB)
- **Settings reorganization** — Appearance section moved from General tab to its own dedicated tab with icon cards for quick navigation

### Technical
- New `theme-engine.js` module (~300 lines) — color utilities, HSL operations, preset definitions, CSS variable derivation
- IPC validators for theme colors (hex format), font strings, and theme presets
- Theme export/import via Electron file dialogs (`dialog.showSaveDialog` / `dialog.showOpenDialog`)
- Snapshot/revert system — navigating away from settings without saving restores original theme
- 38 new tests for theme engine (presets, color derivation, export/import validation)

---

## Patch 0.5.0 — "The Dashboard" (2026-02-11)

### New Features
- **Smart chat titles** — Chat sidebar auto-names from first user message immediately (no more wall of "New Chat")
- **Right-click rename** — Right-click any chat in sidebar for context menu with Rename and Delete options
- **Inline chat rename** — Click Rename to edit the title in-place; Enter to save, Escape to cancel
- **Chat input bar** — Type messages directly to your AI provider with auto-resizing textarea
- **Sidebar chat history** — Browse, search, and restore past conversations
- **AI activity status bar** — Real-time shimmer text showing what the AI is doing (tool calls, thinking, reading files)
- **Pause Agent button** — Interrupt any AI provider mid-response (Ctrl+C for Claude Code, HTTP abort for API providers)
- **Dictation waveform in orb** — Cyan waveform bars animate inside the collapsed orb during dictation
- **Voice recording waveform** — Scrolling amplitude bars in the chat input during voice recording
- **Scroll navigation buttons** — Jump to top/bottom of chat with floating buttons
- **Clear chat confirmation** — Two-click safety on the clear button to prevent accidents
- **Ministral vision support** — Added to vision model detection list
- **Image + text bundling** — Type a message with a pending screenshot to send both together

### Improved
- **Settings overhaul** — Refactored into template fragments with real provider icons and cleaner sidebar nav
- **STT pre-loaded at startup** — Parakeet model loads eagerly so first dictation/PTT works instantly (no more "no speech detected" on first try)
- **Auto-start Ollama** — Detects Ollama installation on Windows/macOS/Linux and starts the service automatically
- **Status bar parses Claude Code TUI** — Detects thinking spinners, tool calls, MCP activity, and prompt state from raw PTY output
- **Always-visible pause button** — No longer flickers with status changes
- **Windows multi-monitor screenshots** — Native PowerShell GDI+ capture bypasses Electron's desktopCapturer bug that returned the same image for all displays
- **Vision image passthrough** — Screenshots sent to local LLMs now include the actual image data (Ollama native format + OpenAI content blocks)
- **Sidebar widened** — 275px with larger window control buttons for easier clicking

### Fixed
- **Dictation events not reaching UI** — Python bridge now emits `dictation_start`/`dictation_stop` events
- **Voice loop not resuming after interrupt** — Claude Code re-enters `claude_listen` after Ctrl+C
- **Screenshot picker not clickable** — Added `-webkit-app-region: no-drag` to screen picker overlay
- **Image prompt echo** — Duplicate suppression now covers image prompt text in inbox
- **Status bar stuck on "Thinking"** — Clears when Claude returns to prompt (`❯` detection)
- **PTY ANSI parsing** — Accumulates raw data before stripping escape sequences to handle split chunks
- **CI tests** — Updated for settings template refactor
- **Close button** — Changed from hide-to-tray to quit app
- **Capture button** — Always enabled regardless of vision model detection
- **numpy version** — Constrained for kokoro-onnx compatibility

---

## Patch 0.4.0 — "Dictation & Hotkeys" (2026-02-10)

### New Features
- **System-wide dictation mode** — Hold a button to speak, text is transcribed and typed into any focused window
- **Mouse button hotkeys** — All keybind inputs now accept mouse buttons (Razer Naga support)
- **Arrow key hotkeys** — Added arrow key support to hotkey listeners
- **Vision model benchmarks** — Benchmark suite for evaluating Ollama vision models
- **claude-pulse status line** — Bundled with Voice Mirror

### Fixed
- **PTT safety timeout** — No longer kills dictation recordings (separate 120s limit for dictation)
- **Windows installer** — Fixed failing on default execution policy
- **Multi-monitor capture** — Fixed screen capture on Windows with multiple displays

### Removed
- **Call mode** — Removed from voice activation options (was experimental, unused)

---

## Patch 0.3.0 — "Neural Upgrade" (2026-02-09)

### New Features
- **Silero neural VAD** — Replaced energy-based voice detection with neural network model for dramatically better accuracy
- **Native API tool calling** — OpenAI-compatible providers can now use tools natively (not just text-parsing)
- **Voice-mode tool facades** — `claude_listen` and `claude_send` exposed as MCP tools for voice loop

### Fixed
- **macOS test cleanup** — Fixed ENOTEMPTY error in perf-monitor tests

---

## Patch 0.2.0 — "Security & Polish" (2026-02-08)

### New Features
- **Vision support for Ollama** — Tool results with screenshots now sent as images to vision-capable models
- **Prompt injection defenses** — Confirmation gates for destructive tools, input sanitization
- **MIT License** — Project officially open-sourced

### Improved
- **Update notifications** — Moved from chat toast to persistent sidebar banner
- **CI pipeline** — Fresh clone installer test, Linux CI fixes
- **Public release prep** — Scrubbed personal references, added Discord + website links

### Fixed
- **Command injection** — Fixed URL scheme and shell injection vulnerabilities
- **Ollama vision format** — Uses native images format instead of OpenAI content blocks
- **Terminal overflow** — xterm.js canvas properly shrinks after fit
- **node-gyp on Linux** — Installing setuptools for CI builds

---

## Patch 0.1.3 — "Stability" (2026-02-06 – 2026-02-07)

### New Features
- **Dialog handling** — Browser automation now handles JS alerts, confirms, and prompts
- **Cookie & storage management** — Full CRUD for cookies and localStorage via browser tools
- **Snapshot optimization** — `ifChanged` and `maxPageText` options to reduce bandwidth
- **CI workflows** — GitHub Actions for unit tests and installer validation

### Improved
- **Terminal resize** — Stable during window drag-resize with debounce and rAF
- **Log verbosity** — Cleaned up startup and runtime logs

### Fixed
- **Double-speak race** — TTS no longer speaks the same response twice
- **PTT lock** — Push-to-talk properly releases after recording
- **Provider display name** — Shows correct name after switching
- **Update button** — Fixed being unclickable in sidebar banner
- **Multi-monitor bounds** — Window positioning respects all display work areas
- **Evaluate timeout** — Browser evaluate action properly times out

---

## Patch 0.1.2 — "Personalization" (2026-02-03 – 2026-02-05)

### New Features
- **Custom AI personas** — Configurable system prompt in settings
- **Username required** — First-run modal, setup wizard prompt, settings validation
- **Memory management** — `memory_forget` and `memory_clear` tools for the AI
- **Context usage display** — Shows token usage for local LLM providers
- **Date awareness** — AI knows the current date and adjusts responses
- **Configurable stats hotkey** — Customize the perf bar toggle shortcut
- **Browser tools** — Added to voice-assistant tool profile
- **Python auto-restart** — Backend automatically recovers from crashes
- **Kimi provider** — Added Moonshot AI as cloud and CLI provider
- **Toast action buttons** — Notifications can now have clickable actions

### Improved
- **Dashboard mode** — Disables always-on-top when expanded
- **PTT key suppression** — Prevents system beep on Windows when using PTT

### Fixed
- **Hardcoded sender names** — All references use configurable username
- **Orb state transitions** — Fixed incorrect state when events overlap
- **Screen capture** — Fixed display selection and multi-monitor support
- **Toast icons** — Fixed rendering as raw SVG text
- **Restart race condition** — isStarting guard with proper reset timing

---

## Patch 0.1.1 — "Performance" (2026-02-02)

### New Features
- **Canvas orb renderer** — Pixel-perfect 64×64 orb ported from Rust wayland-orb with state-based animations
- **Performance monitor** — Real-time CPU/memory stats bar with CSV logging
- **Multi-monitor capture** — Screen picker overlay when multiple displays detected
- **Auto-detect API keys** — Reads from environment variables on startup
- **Git update checker** — Checks for new commits and shows update notifications
- **Start with system** — Option to launch Voice Mirror on login
- **TTS volume control** — Adjustable text-to-speech volume in settings
- **Audio device selection** — Choose input/output devices in settings

### Improved
- **CPU optimization** — Replaced polling loops with fs.watch + async I/O
- **Provider switching** — Fixed double-restart race, defensive cleanup
- **Config saves** — Fully async to eliminate mouse stutter
- **Settings UX** — Hide embedding models, static theme, better spacing
- **Windows drag** — Cursor polling for reliable orb dragging
- **Security audit** — Hardened IPC, race condition fixes, resource cleanup

### Fixed
- **PTT first launch** — Fixed not working until config_update fired
- **Python pipe deadlock** — Startup pinger unblocks Windows pipe buffering
- **Terminal clear** — Properly deferred until new provider connects
- **Perf bar** — Hidden on collapsed orb, shown by default in panel
- **Mouse lag** — Fire-and-forget IPC during provider switch
- **Ghost window** — Fixed taskbar click on Wayland
- **Audio devices** — WASAPI-only filtering removes duplicates on Windows

---

## Patch 0.1.0 — "First Light" (2026-02-01)

### New Features
- **Electron app** — Desktop overlay with collapsible 64×64 orb and expandable panel
- **Claude Code integration** — Embedded terminal with node-pty running Claude Code CLI
- **OpenAI-compatible providers** — Support for Ollama, LM Studio, Jan, OpenAI, Gemini, Grok, Groq, Mistral, OpenRouter, DeepSeek
- **Voice activation** — Wake word detection and push-to-talk modes
- **Text-to-speech** — Kokoro TTS with natural voice synthesis
- **Speech-to-text** — Parakeet STT with lazy-loaded ONNX model
- **MCP tool server** — Voice Mirror tools (listen, send, screen capture, memory, browser)
- **Setup wizard** — Cross-platform installer for Windows, macOS, Linux
- **Desktop shortcut** — Windows shortcut with hidden console window

### Infrastructure
- **Cross-platform paths** — Fixed ~70 hardcoded paths for Windows/macOS/Linux
- **Python backend** — Async voice agent with WebSocket-like IPC via stdin/stdout
- **Atomic config** — Temp+rename writes with backup recovery
- **HuggingFace CDN** — Faster model downloads with retry logic
- **FFmpeg bundling** — Auto-installed for TTS audio playback
