# Changelog Archive

Older release notes for Voice Mirror (v0.9.x and earlier).
For current releases, see [CHANGELOG.md](../CHANGELOG.md).

---

## v0.9.8 — "Polished Chrome" (2026-02-17)

New custom titlebar with full window controls, a complete theme overhaul making all UI areas respond to theme presets, and several persistence fixes.

### Added

- **Custom titlebar with window controls** — Replaced the old sidebar-header window controls with a full-width draggable titlebar containing collapse-to-orb, minimize, maximize, and close buttons with SVG icons. Panel layout restructured: column (titlebar on top, panel-body row below)
- **Maximize/restore window support** — Manual implementation for transparent frameless windows (Electron's native `maximize()` doesn't work with these on Windows). Fills the nearest display's work area; restores to previous bounds on toggle. State persists across app restarts via config
- **`--chrome` CSS variable** — New theme-derived variable (`blend(bg, bgElevated, 0.65)`) for sidebar and titlebar backgrounds, giving consistent chrome styling across all themes
- **6 new derived theme variables** — `--ok-subtle`, `--ok-glow`, `--warn-subtle`, `--danger-subtle`, `--danger-glow` for status indicator backgrounds and glows, all derived from theme colors

### Fixed

- **Maximize button not responding** — The `maximizeWindow()` function was defined in an ES module (`type="module"`) but never assigned to `window.*`, so the HTML `onclick` handler couldn't find it. Other buttons (collapse, minimize, close) worked because they were already exported to `window`
- **Titlebar buttons invisible on Black theme** — `.win-btn` used `var(--text-muted)` which doesn't exist in the theme engine (the variable is `--muted`). Buttons inherited black from the browser default, invisible against dark backgrounds
- **~80 hardcoded colors replaced with theme variables** — All UI areas (titlebar, sidebar, chat, terminal, browser, settings) now respond to theme changes. Replaced hardcoded hex/rgba values across 8 CSS files with theme CSS variables (`--accent`, `--ok`, `--danger`, `--warn`, `--bg-elevated`, etc.)
- **Black theme status indicators were grayscale** — `ok: #c0c0c0`, `warn: #a0a0a0`, `danger: #ffffff` made status dots indistinguishable from text. Changed to `ok: #4ade80` (bright green), `warn: #bfa86f` (muted amber), `danger: #bf6f6f` (muted red)
- **Black theme chrome too gray** — `bgElevated` lowered from `#181818` to `#0e0e0e` so sidebar/titlebar blend to near-black (`~#090909`)
- **Browser view used undefined CSS variables** — `browser.css` referenced `var(--color-surface-elevated)`, `var(--color-text-primary)`, etc. which don't exist. Migrated to standard theme variables (`--bg-elevated`, `--text-strong`, etc.)
- **Font selections not persisting across restarts** — `buildAppearanceSaveData()` only saved fonts when they differed from the active preset (`fontsCustomized ? currentFonts : null`). When `null` was saved, `resolveTheme()` fell back to preset defaults on next launch. Now always saves current font values explicitly

### Technical
- `window/index.js`: `toggleMaximize()` with manual `setBounds()` to work area, `isManualMaximized` state tracking, config persistence via `updateConfig({ window: { maximized } })`
- `theme-engine.js`: `deriveTheme()` now produces 38 CSS variables (was 31). Black theme preset updated with functional semantic colors
- `settings-appearance.js`: Removed `fontsCustomized` gate — fonts always saved explicitly
- 9 files changed across theme overhaul, plus overlay.html restructured for titlebar layout
- 37 theme-engine tests passing

---

## v0.9.7 — "Smooth Startup" (2026-02-17)

Eliminates system-wide mouse cursor lag on startup, removes the uiohook-napi dependency entirely, and fixes several startup-related bugs (Claude Code flash, Parakeet ONNX crash, first-recording freeze).

### Fixed

- **System-wide mouse lag on startup eliminated** — The mouse cursor would stutter/freeze for 1–2 seconds twice during startup. Root cause: pynput's `WH_MOUSE_LL` hook callbacks were blocked by Python GIL contention while Kokoro TTS ran ONNX inference (`model.create`) in `run_in_executor` threads. Fixed by pausing pynput's OS-level hooks during the startup greeting TTS, then resuming after. Hooks stay active during regular responses so PTT can interrupt
- **STT model preload also pauses hooks** — Parakeet ONNX model loading (deferred 5 seconds after startup) now temporarily unhooks pynput during the load to prevent the same GIL contention lag
- **Claude Code terminal flash on startup** — Non-CLI providers (Ollama, LM Studio, Jan) briefly flashed the Claude Code terminal on launch because auto-start spawned the last-used CLI provider before switching. Now checks the configured provider and skips the Claude Code spawn entirely for non-CLI providers
- **Parakeet ONNX crash on Windows** — `onnxruntime` failed to load the Parakeet model due to a path encoding issue on Windows. The adapter now catches the load error gracefully and falls back to lazy-loading on first use instead of crashing the Python backend
- **First recording freeze** — The first voice recording after startup would freeze for 2–5 seconds while the STT model loaded synchronously. STT now preloads in the background 5 seconds after startup (after the greeting finishes), so the model is warm before the user's first recording

### Removed

- **uiohook-napi dependency removed** — The native keyboard/mouse hook module (used as a backup hotkey layer) has been completely removed. Electron's `globalShortcut` (Windows `RegisterHotKey` API) handles all hotkeys with zero mouse impact. PTT and dictation are handled by Python's pynput. This removes a native binary dependency and eliminates a source of input hook overhead
  - Deleted `electron/services/uiohook-shared.js` (153 lines)
  - Rewrote `electron/services/hotkey-manager.js` (411 → 237 lines) — globalShortcut-only with health checks and power monitor recovery
  - Cleaned up references in `main.js`, `ipc/misc.js`, `preload.js`, `renderer/main.js`

### Improved

- **GlobalHotkeyListener pause/resume** — New `pause()` and `resume()` methods on Python's `GlobalHotkeyListener` class. `pause()` removes OS-level hooks while preserving bindings; `resume()` re-creates listeners and re-installs hooks. Used to temporarily unhook during GIL-heavy work (TTS synthesis, ONNX model loading) to prevent mouse lag
- **Process priority management** — Python backend starts at `BELOW_NORMAL_PRIORITY_CLASS` during heavy import/model loading, then restores to `NORMAL_PRIORITY_CLASS` after startup completes
- **Startup timing instrumentation** — 16 timing points added to Electron's `app.whenReady()` for diagnosing future startup performance issues (logged to `vmr.log`)

### Technical
- `global_hotkey.py`: Added `pause()`/`resume()` methods that stop/restart pynput listeners without losing binding state
- `voice_agent.py`: `_startup_phase` flag controls hook pausing — only the first `speak()` call pauses hooks, subsequent calls leave them active for PTT interruption
- `notifications.py`: Notification watcher TTS does not pause hooks (notifications are regular responses that should be interruptible)
- `electron_bridge.py`: Sets `BELOW_NORMAL_PRIORITY_CLASS` via `kernel32.SetPriorityClass` at import time
- `hotkey-manager.js`: Pure `globalShortcut` implementation with 10-second health checks and power monitor recovery (resume/unlock)
- 12 files changed, 189 insertions, 398 deletions (net -209 lines)
- 568 tests passing (566 pass, 2 skipped, 0 failures)

---

## v0.9.6 — "Performance Sweep" (2026-02-16)

Full-stack performance and memory optimization across all 5 subsystems: Electron main process, renderer/UI, MCP server, Python voice backend, and AI providers/browser automation. 49 files changed, 81 issues addressed.

### Performance — Startup

- **STT/TTS models deferred to first use** — Parakeet (~600MB) and Kokoro TTS (~338MB) no longer load at startup. They lazy-load on first transcription/speech, cutting ~940MB from initial memory and saving 5–15 seconds of startup time. Wake word and VAD still load eagerly (needed immediately)
- **uiohook-napi native module deferred** — The native keyboard/mouse hook binary now loads lazily on first use instead of blocking the require chain at startup (saves 50–200ms)
- **Event-driven Python ready detection** — Replaced 300ms polling interval with direct event callback from the Python `ready` event. Eliminates ~15–20 timer callbacks during startup
- **WASM/UMD scripts deferred** — Added `defer` to ghostty-web, marked, and DOMPurify script tags in overlay.html. No longer blocks initial render

### Performance — Runtime

- **Orb canvas pauses when invisible** — The 60fps per-pixel animation loop now stops when the panel is expanded and the orb is hidden. Saves ~240ms/sec of CPU. Resumes automatically when collapsed back to orb
- **MCP embeddings stored as BLOB** — Changed from JSON text (5–10x slower) to Float32Array binary BLOB storage. Includes automatic migration for existing databases
- **Incremental memory re-indexing** — `remember()` and `forget()` now use hash-based diff to only embed new/changed chunks instead of re-chunking and re-embedding the entire MEMORY.md
- **Batch flush operations** — `flushBeforeCompaction()` now collects all items, does a single file read/write, then re-indexes once (was N reads + N writes + N re-indexes)
- **SQLite transaction wrapping** — `upsertChunk()` and `deleteChunksForFile()` now run in explicit transactions, reducing WAL syncs from dozens to one per batch
- **TUI streaming render cache** — `streamToken()` now only re-wraps the last line instead of the entire buffer. Non-stream chat lines are cached and reused
- **CDP load detection** — Replaced hard-coded 2.5–3s `setTimeout` waits after browser navigation with proper `Page.loadEventFired` CDP events + 500ms settle time
- **fs.watch for file-based IPC** — Browser, screen capture, and voice clone handlers now use `fs.watch()` with timeout fallback instead of 200ms polling loops
- **Debounced config saves** — Window position saves during orb drag now debounce at 500ms instead of writing to disk on every frame
- **Async chat persistence** — All 5 chat handlers (list, load, save, delete, rename) converted from synchronous to async file I/O
- **Async inbox writes** — `writeResponseToInbox` and `clearProcessedUserMessageIds` converted to async
- **VAD ring buffer** — Replaced `np.concatenate` on every 80ms audio chunk with list accumulation and single concat when enough data is available
- **Wake word length tracking** — Replaced `sum(len(chunk) for chunk in buffer)` on every audio frame with an incremental counter
- **Audio level computation deferred** — `np.abs().max()` and `.mean()` now only compute every 60th frame (~1/sec) instead of every callback
- **Spinner interval reduced** — TUI tool spinner changed from 80ms to 150ms (still smooth, halves render calls)

### Performance — Memory

- **Base64 images stripped from old messages** — OpenAI provider now replaces `image_url` content in messages beyond the last 4 with `[image]` text. Prevents 20MB+ of base64 accumulating in vision sessions
- **Screenshot buffer deduplication** — `screenshotAction()` now returns only base64 (CDP native format) instead of both base64 AND a redundant Buffer copy
- **AX tree TTL cache** — `getAccessibilityTree()` results are cached for 2 seconds, avoiding redundant full-tree fetches on complex pages
- **DOM growth capped** — Log viewer capped at 2,000 lines, chat messages capped at 200 groups. Oldest entries removed automatically
- **In-memory message array** — `autoSave()` now reads from an in-memory array instead of scraping the DOM with `querySelectorAll` + `innerText` on every message
- **PTY output buffer freed** — Output buffer used for ready detection is now cleared immediately after provider is ready

### Fixed

- **Logger singleton** — `createLogger()` now returns a shared instance. Previously 14+ services each created orphan loggers that never got `init()`, silently losing all file log output
- **Overlay enforcer scope** — The `setAlwaysOnTop` enforcer now runs on all platforms (needed after provider switches on Windows) but the `xdotool` subprocess call is Linux-only and async
- **uiohook lazy-load race** — `getHook()` now triggers the lazy module load, fixing a race where the hotkey health check would force-restart uiohook 10 seconds after startup
- **Chat context menu** — Added missing CSS for the right-click rename context menu (position, z-index, background, shadow). Removed duplicate Delete option (X button is better UX)
- **MCP config caching** — Claude spawner now hashes the MCP config and skips file writes when unchanged between spawns
- **File I/O removed from audio callback** — Push-to-talk and dictation trigger file checks moved from the real-time audio thread to the main async loop
- **Parakeet STT uses BytesIO** — Transcription now tries in-memory WAV via `io.BytesIO` before falling back to temp files
- **Win32 clipboard via ctypes** — Dictation text injection on Windows now uses Win32 API directly instead of spawning a PowerShell process (~200ms → ~1ms)

### Technical

- **Caching improvements** — n8n API key, `toOpenAITools()` result, status line `existsSync` checks, config reads (mtime-based), MCP spawn config hash, AX tree (TTL), fallback vector embeddings (Map)
- **Pre-compiled patterns** — Tool group keywords compiled to single regex, Python regexes moved to module-scope constants, `buildFilteredEnv` prefixes computed once at load
- **Cleanup** — `DESTRUCTIVE_TOOLS` Set moved to module scope, `structuredClone` replaces `JSON.parse(JSON.stringify())`, env spread copy removed from wayland-orb spawn, `mousemove` removed from uiohook canary listeners, PerfMonitor uses buffered writes with deterministic rotation, diagnostic-collector `require` hoisted to module level, preload IPC listeners return unsubscribe functions, inbox.json periodic cleanup + max cap of 100 messages
- **DOM hidden element cap** — Browser fetch `getComputedStyle` scan limited to first 500 elements
- **Console state hysteresis** — Browser console message array only slices when length exceeds 550 (avoids new array on every push)
- 568 tests passing (566 pass, 2 skipped, 0 failures)

---

## v0.9.5 — "Dependency Dashboard" (2026-02-15)

Developer tooling improvements: expanded Dependencies tab, terminal startup polish, and UX fixes.

### New

- **Dependencies tab: 3 sections** — The developer Dependencies tab (gated behind `advanced.showDependencies`) now tracks everything the app depends on:
  - **Packages** — npm cards for ghostty-web, OpenCode, and Claude Code with individual Update buttons and an "Update All" button that runs updates sequentially
  - **System** — Read-only diagnostic cards showing actual version numbers: Node.js (e.g. 24.13.0), Python (3.11.0), Ollama (0.15.6), ffmpeg (8.0.1)
  - **Python Environment** — Shows all outdated pip packages (including transitive deps) in a scrollable table with an "Update All" button
  - All 3 sections check in parallel via `Promise.all` for speed

### Improved

- **Terminal tab hidden until ready** — The terminal sidebar tab is now hidden on startup and revealed only after ghostty-web WASM loads and the terminal mounts. Prevents visual glitches when clicking the tab before rendering completes
- **"Starting..." welcome banner** — Terminal welcome message now shows "Starting Claude Code..." instead of "Click Start" during auto-start, since auto-start is the default behavior

### Fixed

- **Claude Code version detection** — Claude Code installed via the standalone installer (not npm) showed `--` for version. Now falls back to `claude --version` when `npm list -g` returns nothing
- **Pip "Update All" DLL lock on Windows** — onnxruntime and psutil DLLs were locked by the running Python process, causing `Access is denied`. Now auto-stops the Python backend before upgrading and restarts it after
- **Pip "Update All" path with spaces** — `shell: true` split `E:\Projects\Voice Mirror Electron` at the space; removed since `execFile` calls python.exe directly
- **Pip "Update All" only upgraded direct deps** — `pip install -r requirements.txt --upgrade` left transitive deps (filelock, rdflib, setuptools, etc.) untouched. Now queries `pip list --outdated` first and upgrades those specific packages
- **Ollama and ffmpeg showed "Available" instead of version** — Now parses `ollama --version` and `ffmpeg -version` to show actual version numbers (e.g. 0.15.6, 8.0.1)

### Technical
- New IPC: `update-pip-packages` stops Python, queries outdated packages, upgrades them, restarts Python
- `claude-code` added to dependency update allowlist (`@anthropic-ai/claude-code@latest`, global)
- `check-dependency-versions` returns `{ npm, system, pip }` response shape
- `getCLIVersion()` helper: runs `<command> --version` and parses semver from stdout
- New renderer functions: `updateSystemCard()`, `updatePipSection()`, `handleNpmUpdateAll()`, `handlePipUpdateAll()`, `escapeHtml()`
- Pip error messages now surface the actual `ERROR:` line in the UI badge
- 36 new source-inspection tests for Dependencies tab (IPC, preload, HTML, renderer, CSS)
- 568 tests passing (566 pass, 2 skipped, 0 failures)

---

## v0.9.4 — "Lockdown" (2026-02-15)

Security hardening across the entire app and upgrade from Electron 28 to Electron 40.

### New

- **First-launch disclaimer screen** — New users see a full-screen security warning before they can use the app: "This app gives AI agents full terminal access to your computer. It can read, write, and execute anything your user account can." Users must click "I Understand & Accept" to proceed. Declining quits the app. Shows once, acceptance saved to config. Includes GitHub, bug report, and star links
- **Ctrl+C copies selected text** — When text is selected in the terminal, Ctrl+C copies it to the clipboard instead of interrupting the running process. Matches Windows Terminal / VS Code behavior. When nothing is selected, Ctrl+C still sends the interrupt as normal
- **Dashboard mode remembers state** — The app now restores the window mode (orb or dashboard) it was in when closed. Panel size was already saved — now the expanded/collapsed state persists too, so users don't have to re-expand every launch
- **Security badges** — Added OpenSSF Scorecard (GitHub Action, runs weekly), Snyk (dependency vulnerability scanning), and Socket.dev (supply chain attack detection) badges to README
- **Uninstall support** — Three ways to remove Voice Mirror cleanly:
  - `voice-mirror uninstall` CLI command with interactive prompts (@clack/prompts)
  - Standalone `uninstall.sh` (Linux/macOS) and `uninstall.ps1` (Windows) scripts
  - Uninstall button in Settings > General tab with confirmation dialogs
  - Removes desktop shortcuts, npm global link, config (optional), and FFmpeg (Windows)
- **CONTRIBUTING.md** — Contribution guidelines for developers (coding standards, test requirements, PR workflow)
- **OpenSSF Best Practices badge** — Self-assessment completed at 96% passing (project #11950)
- **CodeQL static analysis** — SAST workflow scanning JavaScript/TypeScript and Python on every push to main, weekly schedule

### Security

- **Prompt injection guardrails strengthened** — Added two new defense sections to `CLAUDE.md`: tool-chaining attack prevention (blocks untrusted content from triggering tool call sequences) and memory poisoning defense (prevents attacker-controlled text from being stored as behavioral instructions that replay in future sessions)
- **Content Security Policy** — Both `overlay.html` and `log-viewer.html` now enforce strict CSP rules. Only local scripts, styles, fonts, and images are allowed. No external origins can load resources into the app. The log viewer uses an even tighter `default-src 'none'` policy
- **API keys redacted from renderer** — The `get-config` IPC handler now masks API key values before sending them to the renderer (e.g. `sk-proj-abc...xyz` becomes `sk-p...xyz1`). Full keys stay in the main process only. The settings UI shows masked placeholders — typing a new key saves it, leaving the field empty preserves the existing key
- **PTY environment filtered** — Spawned terminal processes (Claude Code, OpenCode, etc.) no longer inherit the full `process.env`. A new `filtered-env.js` module allowlists only essential variables: PATH, HOME, shell config, temp dirs, and provider API key prefixes (ANTHROPIC_, CLAUDE_, OLLAMA_, OPENAI_, GEMINI_, MISTRAL_, GROQ_, XAI_, OPENROUTER_, DEEPSEEK_, MOONSHOT_)
- **Google Fonts bundled locally** — Replaced CDN links to `fonts.googleapis.com` with 26 locally bundled woff2 font files (~710KB). The app no longer makes any external network requests on startup. 8 font families included: Inter, Roboto, Open Sans, Poppins, Ubuntu, Fira Code, JetBrains Mono, Source Code Pro
- **PowerShell screen capture hardened** — The `displayIndex` parameter is now validated as a non-negative integer, and `outputPath` is properly escaped for PowerShell single-quoted strings, preventing potential injection if values ever came from untrusted input
- **OpenSSF Scorecard improved from 3.1 to 5.1** — Pinned all GitHub Action versions to commit SHAs, added `permissions: read-all` to workflows, fixed script injection vulnerability in installer-test.yml
- **GitHub Actions workflow hardening** — Moved `${{ github.head_ref }}` from `run:` blocks to `env:` blocks to prevent script injection; Dependabot configured for npm, pip, and GitHub Actions
- **CodeQL SAST findings resolved** — Fixed all issues flagged by initial static analysis scan: HTML comment regex used `<!--.*-->` which missed multi-line comments and left partial `<!--` on repeated occurrences (changed to `<!--[\s\S]*?-->/g`); URL validation in voice-clone handler used `string.includes('youtube.com')` which could be bypassed via query params (now parses hostname with `new URL()`); pinned `github/codeql-action` to SHA (v3.32.3) for supply chain security
- **@modelcontextprotocol/sdk** updated from ~1.0.0 to ^1.26.0 — resolves CVE-2025-66414 (DNS rebinding), CVE-2026-0621 (ReDoS), and GHSA-345p-7cg4-v4c7 (cross-client data leak via shared transport reuse)
- **Removed unused optional dependencies** — `openai` and `@google/generative-ai` were listed in mcp-server optionalDependencies but never imported (both embedding providers use raw `https` requests). Removing eliminates unnecessary attack surface and silences Dependabot alerts for packages that weren't in use

### Upgraded

- **Electron 28.3.3 → 40.4.1** — Chromium 120 → 134 (2+ years of browser security patches), Node.js 18 → 22. Only one breaking API change: the `console-message` event now uses an event object instead of positional arguments
- **electron-builder 25 → 26** — Updated to support Electron 40's build headers

### Improved

- **Update system handles major Electron upgrades** — When `npm install` fails during an update (common on Windows where the running Electron binary is locked), the updater writes a `.pending-install` marker. On next app launch, it detects the marker and completes the install automatically. Users see "Restart to finish update" instead of a silent failure. Retries up to 3 times before giving up with a log message
- **Update banner shows install failures** — The `installFailed` flag is now surfaced to the user. Previously the banner showed "Restart to apply" even when npm install had failed, leading to a restart with incomplete dependencies
- **Updater concurrency guard** — Prevents parallel `applyUpdate()` calls if the user double-clicks the Update button. Second call returns immediately instead of racing with git operations
- **Pending-install marker moved to userData** — The retry marker now lives in `%APPDATA%` instead of `node_modules/`, so it survives `npm install` failures, `node_modules` deletion, and `git clean`. Includes migration from the old location for existing users
- **README badges trimmed** — Reduced from 15 to 10 by removing redundant info badges (Electron, Node, Python versions, MCP tools, AI providers)
- **Settings UI cleanup** — Removed icon card grids from all settings tabs (AI & Tools, Voice & Audio, General, Appearance) that duplicated the tab navigation

### Fixed

- **Dashboard window resize restored** — Electron 40's `transparent: true` permanently disables native OS resize handles on frameless windows (documented limitation). Added custom CSS resize edges (8 invisible hit zones at all edges and corners) with a Pointer Capture API–driven resize handler. The renderer captures the pointer on drag start so `pointermove`/`pointerup` events fire even if the cursor leaves the window — no main-process polling intervals, no race conditions. Resize updates are throttled via `requestAnimationFrame` and sent as fire-and-forget IPC for smooth ~60fps resizing. Panel dimensions are saved to config after each resize operation
- **npm commands fail on Node 22 (EINVAL)** — Node 22 (bundled with Electron 40) changed `execFile` behavior on Windows: calling `.cmd` scripts like `npm.cmd` directly now throws `EINVAL`. The v0.9.1 fix of appending `.cmd` to npm commands actually became the problem. Fixed by using `shell: true` instead, which lets the OS resolve npm correctly on all platforms. Affected: dependency checker, dependency updater, CLI installer, and the git-based update system
- **Scorecard badge URL** — Updated from deprecated `securityscorecards.dev` to `scorecard.dev` in README and SECURITY.md
- **Socket badge** — Replaced broken dynamic badge with static shields.io badge

### Technical
- New files: `cli/uninstall.mjs`, `uninstall.sh`, `uninstall.ps1`, `CONTRIBUTING.md`, `.github/workflows/codeql.yml`
- New files: `electron/lib/filtered-env.js`, `electron/renderer/styles/fonts.css`, `electron/assets/fonts/` (26 woff2 files)
- `console-message` event handler updated for Electron 35+ API (event object instead of positional args)
- CSP allows `'wasm-unsafe-eval'` for ghostty-web WASM terminal and `data:` in `connect-src` for embedded WASM binary loading
- `isRedactedKey()` detection prevents masked placeholder values from being saved back to config
- Pending-install marker stores timestamp and retry count, auto-removed after 3 failures
- Node 22 compatibility audit: codebase is clean. One minor note: `crypto.createHash('md5')` in webview-snapshot.js shows a deprecation warning but remains functional
- `writeClipboard()` added to preload contextBridge for terminal copy support
- `config.window.expanded` persists dashboard mode across sessions
- New file: `electron/renderer/resize.js` — Pointer Capture API resize handler for frameless transparent window
- Resize IPC: `get-window-bounds` (invoke), `set-window-bounds` (send, fire-and-forget), `save-window-bounds` (invoke)
- OpenSSF Scorecard GitHub Action: `.github/workflows/scorecard.yml`
- README badges updated: version 0.9.4, Electron 40; added screenshots (dashboard + orb states)
- 568 tests passing (566 pass, 2 skipped, 0 failures)

---

## v0.9.3 — "Flicker Fix" (2026-02-14)

Fix terminal flickering and auto-scroll-to-bottom issue in Claude Code terminal.

### Fixed
- **Terminal flickering during Claude Code output** — The render loop was forcing a full terminal redraw (all rows) on every frame (~60fps) during streaming output. This exposed timing-dependent artifacts when the WASM buffer was partially updated between PTY chunks. Now batches all PTY output and flushes once per render frame, so the buffer is always in a consistent state when rendered. Full redraws reduced to every 250ms (4fps) as a safety net for missed dirty rows
- **Can't scroll up in terminal — auto-snaps to bottom** — ghostty-web's `write()` calls `scrollToBottom()` whenever the viewport isn't at the bottom. Since Claude Code's status bar updates arrive constantly, any attempt to scroll up was immediately undone. Added a scroll lock: when the user scrolls up, auto-scroll-to-bottom is suppressed. The lock auto-releases after 5 seconds of no wheel activity, or when the user scrolls back to the bottom

---

## v0.9.2 — "Self-Healing Updater" (2026-02-14)

Complete rewrite of the update system — it now heals broken git state before updating and verifies success after.

### Changed
- **Self-healing pre-flight checks** — Before updating, the updater now automatically detects and fixes: stale `index.lock` files, stuck merges/rebases/cherry-picks, detached HEAD, wrong branch, and leftover auto-stashes from previously failed updates
- **Hard reset instead of stash/pull/pop** — Replaced the fragile stash → pull → pop workflow with `git reset --hard origin/main`. No more merge conflicts, no more broken repos. End-users don't have local commits to preserve, so this is always safe
- **Always runs npm install** — Previously only ran when `package.json` changed in the diff. Now always runs to catch previously failed installs, corrupted `node_modules`, or missing native rebuilds
- **Post-flight verification** — After updating, verifies HEAD matches the target hash and critical files (`electron/main.js`, `package.json`) exist
- **npm install failure is non-fatal** — If `npm install` fails, the update still reports success (git reset already landed). The app will likely still work if no packages changed
- **npm install timeout increased** — From 180s to 300s (5 minutes) for slow connections
- **Last-resort recovery** — If the update itself fails, tries `git reset --hard HEAD` + `git clean -fd` to leave the repo in a usable state

---

## v0.9.1 — "Update Fix" (2026-02-14)

Fix the in-app update system that was causing blank terminals and broken repos on Windows.

### Fixed
- **Blank terminal after updating on Windows** — `npm install` silently failed because `execFile('npm')` needs `npm.cmd` on Windows. Dependency updates (like ghostty-web) never installed after `git pull`, leaving the terminal blank. Also increased npm install timeout from 30s to 180s
- **Update leaves repo in broken state** — When `git stash pop` hit a merge conflict (e.g., user modified `requirements.txt`), the repo was left with conflict markers blocking all future operations. Now auto-recovers: discards conflicted local changes, keeps upstream version, and drops the stale stash

---

## v0.9.0 — "Scroll Fix" (2026-02-14)

Fix terminal scrolling — mouse wheel now works in Claude Code, vim, and all providers.

### Fixed
- **Cannot scroll in Claude Code terminal** — A custom window-level wheel handler was intercepting all scroll events before ghostty-web's own handler could fire. Removed it and switched to ghostty-web's `attachCustomWheelEventHandler` API. Scrolling now works natively for all modes: viewport scrollback in normal mode, arrow keys to PTY for alternate screen apps (Claude Code, vim), and SGR mouse events for TUI apps with mouse tracking (OpenCode)

---

## v0.8.9 — "Smooth Operator" (2026-02-14)

Performance and reliability fixes — smoother scrolling, bulletproof installer shortcuts.

### Fixed
- **Scroll jank / FPS drops** — `backdrop-filter: blur(20px)` on the main panel forced the GPU to recalculate a gaussian blur across the entire window on every scroll frame. The panel already has a solid background so the blur was invisible — removed it along with a second blur on the chat input bar. Scrolling is now butter smooth
- **Desktop shortcut creation failing on Windows** — Replaced PowerShell-based shortcut creation with VBScript (`cscript`), which can't be blocked by execution policies. Desktop folder is now detected via the Windows registry, handling OneDrive redirection and non-English folder names
- **Desktop shortcut failing on macOS/Linux** — Shortcuts now use absolute `node scripts/launch.js` paths instead of relying on `voice-mirror` being on PATH. Linux shortcuts read `XDG_DESKTOP_DIR` for correct desktop location and are marked as trusted via `gio`
- **Silent shortcut failures** — Installer now reports specific error messages instead of a generic "could not create shortcut"

---

## v0.8.8 — "Under the Hood" (2026-02-14)

Quality-of-life improvements: hidden console on startup, embedded log viewer, and browser tool no longer hijacks your tab.

### New — Embedded Log Viewer
- **Dedicated log viewer window** — Settings > General > Logs opens a terminal-style window (like VS Code DevTools) with live-streaming colored log output, auto-scroll, and a clear button. Replaces the old "open in Notepad" approach
- ANSI color codes rendered as styled HTML — timestamps, log levels, and categories all color-coded
- Logger now supports a listener pattern (`addListener`/`removeListener`) for real-time log broadcasting

### Fixed
- **Console window visible on startup** — Desktop shortcut launched `npm start` directly, showing a CMD window in the taskbar. Now uses `wscript.exe` + `launch-hidden.vbs` to start the app with the console completely hidden
- **Browser tool steals tab focus** — When the AI used `browser_control` (search, navigate), the UI auto-switched from chat to the browser tab mid-conversation. The browser panel now updates silently in the background — stay on chat while the AI browses

### Technical
- New files: `log-viewer.html`, `preload-log-viewer.js`, `services/log-viewer.js`
- Logger service extended with listener array + `addListener()`/`removeListener()` methods
- Removed `navigateTo('browser')` calls from `did-navigate` and `onStatusChange` handlers in `browser-panel.js`
- 519 tests passing

---

## v0.8.7 — "Full Screen" (2026-02-14)

Fix terminal sizing bug that caused all AI providers (Claude Code, Ollama TUI, OpenCode) to render squished in the top-left corner instead of filling the terminal area.

### Fixed
- **Terminal stuck at default size** — `resizeObserver.observe(mountContainer)` referenced an undefined variable (`mountContainer` was never declared), causing a silent crash that prevented the ResizeObserver from ever firing. The terminal never fit itself to the container and stayed at ghostty-web's internal defaults. Fixed to observe `fullscreenMount` — the actual terminal mount point
- **TUI dashboard ignoring terminal dimensions** — `activeProvider.spawn()` was called without passing `cols`/`rows`, so the TUI renderer always defaulted to 120x30 regardless of actual terminal size
- **Auto-start ignoring terminal dimensions** — Initial app startup and `start-all` IPC handler both called `startAIProvider()` without passing the last known terminal dimensions. Now all three startup paths (auto-start, manual start, start-all) use stored dimensions from the renderer's resize events

### Technical
- Root cause: the ResizeObserver crash at line 329 of `terminal.js` was caught by a try-catch in `renderer/main.js`, silently breaking all code after it — including the initial `safeFit()`, the deferred re-fit cycles (1.5s/3s/5s), and the welcome banner
- 4 files changed: `terminal.js` (resize observer fix), `ai-manager.js` (pass dims to spawn), `main.js` (pass stored dims on auto-start), `ipc/ai.js` (pass stored dims on start-all)
- 519 tests passing

---

## v0.8.6 — "Dashboard" (2026-02-13)

TUI dashboard for local models — replaces the blank terminal canvas with a rich ANSI-rendered dashboard when using Ollama, LM Studio, Jan, and other OpenAI-compatible providers.

### New Feature — TUI Dashboard
- **Conversation panel** (left, 65%) — scrollable chat with user/assistant messages, timestamps, and live streaming cursor
- **Tool Calls panel** (right top) — live activity feed with spinner animation for running tools, checkmark/X for completed, tool name and duration
- **Info panel** (right bottom) — model name, generation speed (tok/s), loaded tool count, voice status (Recording/Speaking/Idle)
- **Status bar** (bottom) — context usage gauge (e.g. `CTX: 2.6K/32.8K`), TTS engine, STT engine, tool call count
- **ANSI rendering** — box-drawing characters, 256-color theme (accent blue borders, green/red/yellow status), word wrapping, all rendered via escape sequences into ghostty-web
- **Scroll support** — Arrow Up/Down scrolls chat by 1 line, Page Up/Down by 10 lines
- **Resize handling** — TUI re-renders on terminal resize
- **Generation speed** — real-time tok/s calculated from streaming token count and elapsed time

### Fixed
- **TUI output captured as AI response** — TUI ANSI rendering was emitted as `stdout`, which InboxWatcher captured as the model's response text (causing chat spam and TTS reading box-drawing characters). Added separate `tui` output type for rendering and `response` type for plain text capture
- **Tool call JSON spoken by TTS** — response text was emitted to InboxWatcher before the tool parsing check, so raw JSON like `{"tool": "browser_control", ...}` was captured as the AI response and spoken aloud. Moved response emit to after tool parsing — only non-tool responses reach chat/TTS
- **Tool parse failure on missing braces** — small local models (e.g. ministral-3) sometimes omit trailing `}` from tool call JSON. The brace matcher now auto-closes incomplete JSON before parsing
- **Voice status showing system events** — events like `claude_connected` leaked into the TUI Info panel. Now filters to actual voice states (Idle, Recording, Speaking, Thinking, Processing)

### Technical
- New `electron/providers/tui-renderer.js` (~730 lines) — pure ANSI rendering engine with state model, partial re-render optimization, spinner timer
- Output type separation: `tui` (terminal rendering, ignored by InboxWatcher), `response` (plain text, captured by InboxWatcher), `stdout` (legacy non-TUI path)
- Input echo suppressed when TUI active — TUI renders its own conversation display
- Resize forwarded to API providers (previously only CLI/PTY providers received resize events)
- Voice events forwarded from main process to TUI with human-readable labels
- 8 files changed (1 new, 7 modified), ~900 insertions
- 519 tests passing

---

## v0.8.5 — "Plug & Play" (2026-02-13)

Plug-and-play TTS/STT engine selection with auto-install, 7 TTS engines and 5 STT engines.

### New Feature — TTS/STT Engine Selection
- **7 TTS engines**: Kokoro (local), Qwen3-TTS (local), Piper (local), Edge TTS (free cloud), OpenAI TTS (cloud), ElevenLabs (cloud), Custom API (OpenAI-compatible)
- **5 STT engines**: Parakeet (local), Whisper (local), Faster-Whisper (local), OpenAI Whisper API (cloud), Custom API (OpenAI-compatible)
- **Auto-install pip packages** — selecting an engine that requires a missing Python package prompts the user and installs it automatically
- **Data-driven settings UI** — adapter registry drives conditional fields (API key, endpoint URL, model file picker) per engine
- **Custom local model files** — native file picker for Piper `.onnx` voice files
- **Hot-swap adapters** — switch TTS/STT engines in settings without restarting the app

### Fixed
- **TTS adapter hot-swap stale reference** — NotificationWatcher held a direct reference to the TTS adapter; switching engines in settings didn't affect background notifications. Now uses a getter callback so adapter swaps are always reflected
- **TTS adapter reload after pip install** — adapter with `model=None` (failed load) wasn't rebuilt on settings save; now detects broken adapters and retries
- **Dropdown optgroup white border** — `<optgroup>` labels in select dropdowns had no dark-theme styling, falling back to Chromium's default white background

### Technical
- Refactored TTS/STT factories to `**kwargs` pattern — adding new adapters never requires changing factory signatures
- Added adapter metadata to base classes (`adapter_category`, `pip_package`, `requires_api_key`, etc.)
- 7 new Python adapter files, `requirements-optional.txt` for optional pip packages
- New IPC handlers: `check-pip-package`, `install-pip-package`, `browse-model-file`
- 29 files changed (21 modified, 8 new), ~900 insertions

---

## v0.8.4 — "God-File Guillotine" (2026-02-13)

Split the 4 largest files in the codebase into focused modules and fixed two Ollama voice bugs.

### Architecture — Renderer
- **Split `main.js`** (1,308 → 574 lines): Extracted `image-handler.js` (296), `ai-status.js` (325), `voice-handler.js` (148) — each handles a distinct responsibility
- **Split `settings.js`** (1,964 → 351 lines): Extracted `settings-ai.js` (786), `settings-voice.js` (313), `settings-appearance.js` (664) — one module per settings tab

### Architecture — MCP Server
- **Split `mcp-server/index.js`** (1,100 → 515 lines): Extracted `tool-groups.js` (587) containing all 9 tool group definitions
- **Fixed 7 silent `catch` blocks** in `mcp-server/handlers/core.js` — now log errors with `[MCP Core]` tag
- **Deduplicated file-based IPC** in `mcp-server/handlers/browser.js` — extracted `fileBasedRequest()` helper

### Architecture — Python
- **Extracted `_chunk_text()`** from `kokoro.py` and `qwen.py` into shared `tts/utils.py`
- **Removed debug print** from `voice_agent.py` (`[IMPORT DEBUG] tts done`)

### Fixed
- **Ollama response lost** — `extractSpeakableResponse()` could strip all content from short responses, returning empty string which was falsy and discarded; added fallback pass that preserves lightly-cleaned content when aggressive filtering removes everything
- **Ollama double-speak** — race condition between `voice_agent._wait_and_speak()` and `NotificationWatcher`: `awaiting_response` flag cleared before TTS started, letting the watcher speak the same response; added `speaking_response` flag that stays true until TTS finishes

### Technical
- 5 files modified for bug fixes, 17 files changed total for god-file splits
- 519 tests passing (JS) + 7 Python double-speak tests passing
- Version bump: 0.8.3 → 0.8.4

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
- **12 dead files deleted** (~1,840 lines)
- **~75 dead exports/functions removed** across all modules
- **Dead CSS** (~70 lines): legacy `.message` styles, `.terminal-line` styles, `#terminal-close`, `.stagger-*` animation utilities
- **Dead IPC channels**: `backend-response` (never sent), `toggle-perf-monitor` (no-op)
- **Dead dependency**: removed `chokidar` from mcp-server/package.json

### Technical
- 66 files changed, +75/-3,463 lines
- All 477 tests passing after cleanup

---

## v0.8.0 — "The Ghost in the Shell" (2026-02-12)

Replaces xterm.js with [ghostty-web](https://github.com/coder/ghostty-web) — Ghostty's VT parser compiled to WASM. The result: better TUI rendering for Claude Code and OpenCode, rock-solid provider switching with 4-layer output gating, and zero xterm.js dependencies.

### New Features
- **ghostty-web terminal** — Full terminal emulation via Ghostty's WASM-compiled VT parser
- **OpenCode tool profiles** — The Tool Profiles settings section now appears for all MCP CLI providers
- **AGENTS.md** — New instruction file for MCP-connected agents

### Improved
- **Provider switch stability** — 4-layer output gating prevents old PTY output from bleeding into new provider's terminal
- **Thread-safe TTS playback** — Local process reference prevents `NoneType` crashes during provider switch
- **MCP listen timeout** — Default `claude_listen` timeout increased from 60s to 300s (5 minutes)

### Fixed
- **Keyboard keys no longer blocked by mouse side button bindings** — Discord/OBS-style non-suppression
- **pynput implicit None suppression bug** — Was blocking ALL keyboard/mouse input system-wide

### Removed
- **xterm.js dependency** — Replaced by ghostty-web

### Technical
- 26 files changed, +628/-183 lines
- All 490 tests pass

---

## v0.7.1 — "The Streamline" (2026-02-12)

Streamlined provider picker, auto-install OpenCode, fixed hardcoded user names.

---

## v0.7.0 — "The Gateway" (2026-02-12)

Added OpenCode as PTY-based AI provider, unlocking 75+ models for voice interaction through MCP.

---

## v0.6.2 — "Bulletproof" (2026-02-11)

Python 3.12+ compatibility, Linux audio library detection, onnx dependency conflict fix.

---

## v0.6.1 — "The Stylist" (2026-02-11)

Claude Gray theme, message card customization, custom font uploads.

---

## v0.6.0 — "The Paintbrush" (2026-02-11)

Full theme customization with 10 key colors, 5 preset themes, live preview, import/export.

---

## v0.5.0 — "The Dashboard" (2026-02-11)

Chat input bar, sidebar chat history, AI activity status bar, pause agent, dictation waveform, scroll navigation.

---

## v0.4.0 — "Dictation & Hotkeys" (2026-02-10)

System-wide dictation mode, mouse button hotkeys, arrow key hotkeys.

---

## v0.3.0 — "Neural Upgrade" (2026-02-09)

Silero neural VAD, native API tool calling, voice-mode tool facades.

---

## v0.2.0 — "Security & Polish" (2026-02-08)

Vision support for Ollama, prompt injection defenses, MIT License.

---

## v0.1.3 — "Stability" (2026-02-06 – 2026-02-07)

Dialog handling, cookie & storage management, CI workflows.

---

## v0.1.2 — "Personalization" (2026-02-03 – 2026-02-05)

Custom AI personas, username required, memory management, context usage display.

---

## v0.1.1 — "Performance" (2026-02-02)

Canvas orb renderer, performance monitor, multi-monitor capture, auto-detect API keys, git update checker.

---

## v0.1.0 — "First Light" (2026-02-01)

Initial release. Electron overlay, Claude Code integration, voice activation, TTS/STT, MCP tool server, setup wizard.
