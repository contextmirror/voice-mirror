# Changelog

All notable changes to Voice Mirror are documented here.
Format inspired by game dev patch notes — grouped by release, categorized by impact.

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

### Improved

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
