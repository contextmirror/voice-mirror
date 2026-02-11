# Changelog

All notable changes to Voice Mirror are documented here.
Format inspired by game dev patch notes — grouped by release, categorized by impact.

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
