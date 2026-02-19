# Changelog

All notable changes to Voice Mirror are documented here.
Format inspired by game dev patch notes — grouped by release, categorized by impact.

---

## v0.11.0 — "Live Wire" (2026-02-18)

Real-time chat streaming, inline tool activity cards, sentence-level TTS, and duplicate message elimination. The chat window now feels as fast as the TUI dashboard.

### New — Real-Time Chat Streaming
- **Token-by-token streaming** — Chat cards now build in real-time as the LLM generates tokens, matching the TUI dashboard speed. Previously cards appeared 2-3 seconds after the response completed
- **30ms token batching** — DOM updates batched at ~33/s instead of per-token, keeping the UI smooth without visible lag
- **Instant scroll** — Chat auto-scrolls with `behavior: 'instant'` during streaming (no 300-600ms smooth animation delay)
- **Streaming cursor** — Blinking block cursor shows the response is actively generating

### New — Inline Tool Activity Cards
- **Tool cards in chat bubbles** — When the LLM calls a tool (memory_search, web_search, etc.), a styled inline card appears showing the tool name and status ("Running" → "Done"/"Failed") with the existing pulse animation
- **Full response preserved** — Tool call JSON is replaced with the card; the natural language response renders below with full markdown (bold, lists, code blocks, headers). Previously `stripToolJson()` aggressively removed content
- **Multiple tool calls** — Each tool call creates its own card; follow-up text sections render independently

### New — Sentence-Level TTS (Rust)
- **Incremental speech** — `speak_text()` now splits text into sentences at `. ! ? \n` boundaries and synthesizes each independently. First sentence starts playing as soon as it's ready; remaining sentences queue via rodio Sink
- **Short fragment merging** — Fragments under 20 characters are merged with neighbors to avoid choppy speech
- **Inter-sentence cancellation** — Cancel flag checked between sentences for responsive interruption

### Fixed — Duplicate Chat Messages
- **Two-source dedup** — Both the inbox-watcher and voice-backend TTS path sent separate `chat-message` IPC events for the same response. Now suppressed via a 10-second `streamingFinalizedAt` window after streaming completes
- **Text mismatch handled** — Inbox-watcher sends cleaned/stripped text while streaming uses raw text; time-based suppression works regardless of text differences

### Fixed — TTS & Chat Polish
- **TTS truncation on long responses** — TTS stopped mid-sentence on long Ollama answers because the stability timer (2s of no tokens) resolved during LLM pauses. Now uses `stream-end` as the definitive done signal instead of polling
- **Stray `}` in chat bubbles** — Nested JSON tool calls left a trailing `}` visible in chat. Replaced regex-based `stripToolJson()` with brace-balanced iterative parsing
- **Tool card stuck on "Running"** — Safety net in `finalizeStreamingMessage()` flips any still-running tool cards to "Done" on stream completion
- **Text doubling in TTS** — Both `stdout` tokens and `response` events were accumulated into the TTS buffer, causing doubled speech. Now only `stdout` is accumulated

### Fixed — OpenCode Voice Loop
- **Voice loop command not sent on provider switch** — The `claude_listen` loop command was swallowed during OpenCode's splash animation. Generic ready patterns (`>`, `What`) triggered too early. Now uses specific patterns (`Ask anything`, `ctrl+p`) with a 2-second post-ready delay
- **Reusable `sendVoiceLoop()`** — Extracted voice loop injection into a single function used by startup, interrupt recovery, and a new `send-voice-loop` IPC channel for manual retry

### Improved
- **Copy button targets answer text** — `copyMessage()` now targets `.markdown-content` instead of the first `div`, preventing accidental copy of tool card text
- **Max-iterations finalization** — `stream-end` now emits when max tool iterations are reached, ensuring streaming cards always get finalized
- **Tool result iteration tracking** — `onToolResult` events now include `iteration` field for precise card identification

---

## v0.10.4 (2026-02-18)

### Fixed — Audio
- **Output device selection** — Output device dropdown was empty (Rust voice-core returned hardcoded empty list). Added `list_output_devices()` and wired device names into the `AudioPlayer` so selecting a specific speaker/headset actually routes audio there
- **Device change takes effect immediately** — Changing input or output device in settings now restarts the voice backend automatically, no manual restart needed
- **System Default normalization** — Switching back to "System Default" from a named device now correctly triggers a restart (null comparison was failing due to empty-string vs null mismatch)
- **Startup greeting suppressed on device change** — Config-triggered voice backend restarts no longer replay the "Good morning" startup greeting

### Fixed — Code Quality (3-round audit)
- **P0 fixes (round 1, 34 files)** — Generation counter for AI manager race conditions, async stop with event listener cleanup, stream error handling with fetch timeout, JSON.parse safety in MCP handlers, atomic file writes, lock file TOCTOU protection, base64 size limits in IPC validators
- **P1/P2 fixes (round 2, 25 files)** — CSS theme variables with fallbacks replacing hardcoded colors, `prefers-reduced-motion` media query support, ARIA labels on interactive buttons, IPC return format consistency, provider empty-response messaging, SSE malformed-line handling, MCP redirect depth limit, n8n cache TTL, message size cap, magic numbers replaced with named constants
- **Accessibility polish (round 3, 10 files)** — Extended `prefers-reduced-motion` to remaining animations, sidebar color consistency, service documentation

### Fixed — Logging
- **Log duplication** — Voice-core stderr lines were appearing twice (once via logger, once via log callback that routed to the same logger). Now uses one path only

---

## v0.10.3 (2026-02-18)

### New — Theme System
- **Colorblind preset** — Replaces the old Dark preset with a colorblind-safe palette (Wong 2011 / IBM Design: blue accent, orange warn, vermillion danger, sky blue highlights)
- **Light preset** — New white/light-gray theme for users who prefer light mode
- **Custom theme persistence** — Imported themes now save as reusable preset cards in the Appearance grid. Each card has a hover-reveal X button to delete. Custom themes persist across restarts via config
- **TUI theme adaptation** — The local provider TUI dashboard (Conversation, Tool Calls, Info panels) now dynamically adapts its colors to the active app theme using 24-bit ANSI codes. Light mode renders a light terminal background with dark text instead of the previous always-dark look

### Fixed — UI
- **Update banner dismiss** — The "Updated to vX.X.X" sidebar banner now has an X dismiss button (post-update banners only, not update/restart prompts)

---

## v0.10.2 (2026-02-17)

### Fixed — Voice Pipeline
- **Claude not responding to voice input** — `claude_listen` used case-sensitive sender matching (`===`) while voice-core lowercases all sender names. When the new `--append-system-prompt` passed the user's name with original casing (e.g. "Nathan"), it never matched the lowercased inbox messages ("nathan"). Fixed with case-insensitive comparison in the MCP handler and normalized name in the system prompt
- **Inbox poll timeout too short** — Rust `wait_for_response()` had a 60-second default timeout, too short for Claude to receive, process, and respond via MCP. Increased to 300 seconds (5 minutes)
- **Silent timeout failures** — Added user-visible error emission (`emit_error`) when inbox polling times out or errors, so the UI shows feedback instead of silently failing

### New — Embedded Claude Instructions
- **`--append-system-prompt` for spawned Claude** — Claude Code instances spawned inside Voice Mirror now receive a dynamic system prompt with Voice Mirror architecture, MCP tool documentation, voice workflow instructions (including 600s timeout), response style guidelines, and prompt injection resistance rules. Previously Claude had no context about Voice Mirror's capabilities
- **Dynamic tool documentation** — System prompt adapts to the active tool profile, only documenting tool groups that are actually enabled

### Fixed — Code Audit
- **Memory leaks** — Fixed blur handler leak in chat-store, context menu listener accumulation, transitionend listener not cleaned up
- **Buffer handling** — Fixed `chunks.join('')` corrupting multi-byte UTF-8 in n8n handler (2 locations), replaced with `Buffer.concat(chunks).toString()`
- **Security** — Removed unnecessary `shell: true` from ollama execFile, fixed HTTPS check ordering in voice-clone handler
- **Cleanup** — Removed dead `aiReadyCheckInterval` code, added webview listener cleanup on destroy, added provider-switch-error notification, null check for welcomeBubble

---

## v0.10.1 (2026-02-17)

### New — "What's New" Post-Update Notification

- **Version change detection** — On startup, compares `lastSeenVersion` in config with the current app version. If they differ (and it's not a fresh install), shows a notification
- **Sidebar banner** — Reuses the existing update banner slot in the sidebar footer with a green "Updated to vX.X.X" message and a "What's New" button
- **Changelog modal** — Clicking "What's New" opens a scrollable modal overlay that renders the relevant CHANGELOG.md section as formatted markdown (using the existing marked.js + DOMPurify stack)
- **CHANGELOG.md bundled** — Added to `extraResources` in electron-builder config so changelog is available in packaged builds

---

## v0.10.0 — "Rust Rising" (2026-02-17)

Complete replacement of the Python voice backend with a native Rust binary (`voice-core`). Eliminates the Python runtime dependency entirely — no more venv, pip, or 600MB+ interpreter overhead. The result: faster startup, lower memory, sub-second STT latency, and interruptible TTS during conversation.

This is the largest architectural change since the project's creation — 14 commits across the `feat/voice-core-rust` branch touching every layer from audio capture to the Electron IPC bridge.

### New — Rust Voice Core

- **Native Rust binary** — New `voice-core/` Rust project replaces the entire `python/` directory. Same JSON stdin/stdout IPC protocol, drop-in replacement for the Electron host
- **Full module structure**:
  - **Audio capture** — cpal-based 16kHz mono f32 with ring buffer
  - **VAD** — Silero ONNX neural voice activity detection with energy fallback
  - **Wake word** — OpenWakeWord 3-stage ONNX pipeline
  - **STT** — whisper.cpp via whisper-rs (local), OpenAI Whisper API (cloud)
  - **TTS** — Kokoro ONNX (local, espeak-ng phonemizer), Edge TTS WebSocket (free cloud)
  - **Hotkeys** — rdev cross-platform global hotkey listener
  - **Text injection** — arboard clipboard + paste simulation for dictation
  - **Inbox manager** — file-based JSON IPC for MCP voice loop
  - **Audio playback** — rodio with shared `Arc<Sink>` for external stop control
- **Legacy adapter fallbacks** — Python-era config values (`parakeet`, `whisper`, `faster-whisper`) auto-map to `whisper-local`; Kokoro gracefully falls back to Edge TTS when native-ml feature is unavailable
- **Feature flags** — `onnx` (default, pre-built binaries) and `whisper` (needs C compiler) split so Kokoro TTS/VAD/wake word work without MSVC toolchain

### New — TTS Interruption

- **Interruptible conversation TTS** — While the AI is speaking a response, press PTT or trigger the wake word to immediately stop playback and start recording. Single action — no need to interrupt then press again
- **Startup greeting protected** — The initial system speak (startup greeting) plays to completion and cannot be interrupted, preventing accidental cuts during app initialization
- **Architecture**: Shared `Arc<AtomicBool>` cancellation token + `Arc<Sink>` handle enable the main event loop to stop both synthesis and playback from any handler. Non-blocking `sink.append()` + 50ms poll loop replaces the old `spawn_blocking(move player)` pattern that blocked all interrupt events

### New — Whisper.cpp STT

- **In-process transcription** — whisper.cpp runs directly in the Rust binary via whisper-rs, replacing the Python Parakeet ONNX subprocess. STT latency drops from ~3-5s to ~0.5-1.5s
- **WhisperState caching** — Reuses the ~200MB whisper state between transcription calls instead of calling `whisper_init_state` on every `transcribe()`. First call creates the state lazily; subsequent calls reuse it
- **Adaptive threading** — Uses half available CPU cores (clamped 1-8) for inference, leaving headroom for audio capture, TTS playback, and the Electron UI
- **Non-speech suppression** — `set_suppress_non_speech_tokens(true)` reduces hallucination on silence
- **Model auto-download** — Downloads whisper models from HuggingFace with progress events to the UI. Settings UI offers tiny/base/small model sizes

### Removed

- **Entire Python backend deleted** — `python/` directory (STT, TTS, wake word, VAD, voice agent, providers, hotkey listener, electron bridge — all gone)
- **Python runtime dependency** — No more venv creation, pip installs, `requirements.txt`, or Python version checks
- **Parakeet STT** — Replaced by whisper.cpp (smaller, faster, no Python subprocess)
- **pynput hotkey listener** — Replaced by Rust rdev (no more GIL contention causing system-wide mouse lag)
- **Python-specific CI/CD** — Removed from dependabot, CodeQL, installer-test workflows
- **stt-worker.py** — Persistent Python STT worker process no longer needed
- **`python-backend.js`** — Replaced by `voice-backend.js` in Electron

### Improved

- **Kokoro TTS prosody** — Phonemizes full text in a single espeak-ng call instead of per-sentence, preserving natural inter-sentence prosody. Only chunks at word boundaries if tokens exceed the 510 limit
- **Kokoro vocab mapping** — Replaced the entire `build_vocab()` with exact mapping from kokoro-onnx's config.json (88 entries). Previous mapping had dozens of wrong token IDs causing German-sounding synthesis
- **Kokoro token limit** — `style_for_len()` now clamps to the last entry instead of erroring when token count equals the entry count (off-by-one fix)
- **TTS speed passthrough** — `tts_speed` from voice settings now flows through to Kokoro's speed tensor (was hardcoded to 1.0)
- **Auto-speak after PTT** — AI responses from inbox are now automatically spoken after push-to-talk transcription (previously only the Query command auto-spoke)
- **PTT recording reliability** — Skip silence timeout for PTT/dictation recordings (only applies to wake-word mode); 150ms minimum hold time debounces Windows key repeat artifacts
- **Main loop stays responsive** — PttUp handler spawns the STT+speak pipeline via `tokio::spawn` instead of awaiting inline, keeping the main `select!` loop free for interrupt events
- **Waveform visualization during interrupt** — Fixed race condition where `SpeakingEnd` arriving after `RecordingStart` would kill the waveform. Idle handler now guards against downgrading from recording/dictating state

### Technical

- **14 commits** on `feat/voice-core-rust` branch
- **Rust binary**: `voice-core/` with Cargo workspace, `onnx` + `whisper` feature flags, `ort` 2.x API (tuple tensors, mutable sessions)
- **IPC refactor**: All `python-*` IPC channels renamed to `voice-*` across Electron main, preload, and renderer. Extracted voice IPC handlers into dedicated `electron/ipc/voice.js`
- **Installer updates**: `install.sh` replaces `ensure_python` with `ensure_voice_core`; `install.ps1` replaces `Ensure-Python` with `Ensure-VoiceCore`; `cli/python-setup.mjs` renamed to `cli/dependency-setup.mjs`
- **Build**: `npm run build:voice-core` script with LLVM detection in installers; `LIBCLANG_PATH` required for whisper-rs
- **espeak-ng discovery**: Checks PATH, then `tools/espeak-ng/` relative to binary, then packaged `resources/bin/`
- **Voice settings sync**: `voice_settings.json` now awaited before spawning voice-core (fixes race condition); synced on config changes (not just startup)
- **AppState fields for TTS interruption**: `tts_cancel: Arc<AtomicBool>`, `tts_sink: Option<Arc<Sink>>`, `system_speaking: bool`
- **AudioPlayer**: New `sink_handle()` method exposes `Arc<Sink>` for external stop; `stop()` and `is_playing()` no longer dead code

---

For older releases (v0.9.x and earlier), see [changelog archive](docs/CHANGELOG-ARCHIVE.md).
