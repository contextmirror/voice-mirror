# Voice Mirror Electron — Polish Plan

Five areas identified for bringing the project to production-grade quality.

---

## 1. End-to-End Tests

**Problem:** Unit tests (536 cases) are solid but use source-inspection — they prove code structure, not runtime behavior. There are no tests that actually start Electron, spawn voice-core, or exercise the IPC pipeline.

**Plan:**

### Phase 1: Electron integration tests (no voice-core)
- Use `electron --test` or Playwright Electron support to launch the app headlessly
- Test IPC round-trips: renderer calls preload API → main process handles → response returns
- Test config read/write cycle through the full IPC chain
- Test window manager: create, resize, tray menu items
- Test provider factory: `createProvider('ollama', {...})` returns correct class

### Phase 2: Provider smoke tests
- Mock a local HTTP server that speaks OpenAI `/v1/chat/completions` streaming format
- Test OpenAI provider: connect, send message, parse streaming response, parse tool calls
- Test CLI provider: spawn `echo` as a fake CLI, verify output capture and TUI rendering
- Test provider-detector: mock `/v1/models` endpoint, verify auto-detection

### Phase 3: MCP server integration
- Spawn MCP server as a child process, send JSON-RPC tool calls via stdin/stdout
- Test `claude_send` → `claude_inbox` round-trip (message appears in inbox.json)
- Test `claude_listen` exclusive lock (second listener gets rejected)
- Test memory CRUD: `memory_remember` → `memory_search` finds it → `memory_forget` removes it

### Phase 4: Voice pipeline smoke test (CI-safe)
- Pre-record a short WAV file with a known phrase
- Feed it to voice-core via `--test-audio` flag (new: add test mode to Rust binary)
- Verify transcription output matches expected text (within Whisper's tolerance)
- Skip TTS playback in CI (no audio device) — just verify audio buffer is generated

**Tooling:** `node:test` (keep existing framework), Playwright for Electron UI tests if needed.

**Estimated scope:** ~15-20 new test files, new `test/e2e/` directory.

---

## 2. ghostty-web Workarounds

**Problem:** ghostty-web is young. We've already hit: `setTheme()` doesn't repaint, `CLEAR_EOL` uses internal default bg, no `onTitleChange` event. More quirks will surface.

**Plan:**

### Workaround registry
Create `electron/renderer/ghostty-compat.js` — a centralized module for all ghostty-web workarounds:

```javascript
// Each workaround is documented with:
// - What the bug/limitation is
// - What the workaround does
// - Link to upstream issue (if filed)
// - Whether it can be removed when ghostty-web fixes it

export function applyThemeSafe(term, theme) {
    // Workaround: setTheme() doesn't repaint existing content
    // We force a full re-render after theme change
    term.renderer.setTheme(theme);
    // Note: TUI background handled separately via 24-bit ANSI in tui-renderer.js
}
```

### Current known workarounds to document:
1. **TUI background color** — Using explicit 24-bit ANSI bg escapes in tui-renderer.js because `CLEAR_EOL` uses terminal's internal default, not theme bg
2. **Theme repaint** — `setTheme()` doesn't trigger repaint of already-rendered content
3. **Resize timing** — Need debounced resize handler because ghostty-web resize can be async

### Upstream engagement
- File issues on ghostty-web GitHub for each limitation
- Tag workarounds with issue URLs so they can be cleaned up when fixed
- Pin ghostty-web to `^0.4.0` to avoid surprise breaking changes

### Testing
- Add `test/unit/ghostty-compat.test.js` — source-inspection tests verifying workaround module exists and covers known issues

---

## 3. Documentation

**Status:** Being built right now by 7 parallel agents. Target doc set:

| Document | Status | Description |
|----------|--------|-------------|
| `docs/ARCHITECTURE.md` | Updating | System overview, component diagram |
| `docs/DEVELOPMENT.md` | Updating | Dev setup, scripts, conventions |
| `docs/CONFIGURATION.md` | Updating | Config schema, all settings |
| `docs/VOICE-PIPELINE.md` | New | Voice flow end-to-end |
| `docs/PROVIDER-SYSTEM.md` | New | Multi-AI provider deep dive |
| `docs/THEME-SYSTEM.md` | New | Theme presets, custom themes, TUI |
| `docs/IPC-PROTOCOL.md` | New | Complete IPC channel reference |
| `CLAUDE.md` | New | Project context for Claude Code |
| `CONTRIBUTING.md` | New | Contributor onboarding |

### Follow-up after initial docs:
- Add `docs/MCP-TOOLS.md` — detailed guide for each tool group with examples
- Add `docs/BROWSER-AUTOMATION.md` — update existing BROWSER-CONTROL-REFERENCE.md
- Add inline JSDoc to key exported functions (theme-engine, config, ai-manager)
- Set up a simple doc linting step (check for broken internal links)

---

## 4. Voice Pipeline Error Recovery

**Problem:** If voice-core crashes or Whisper produces garbage, the pipeline silently stalls. User has to manually restart.

**Plan:**

### Phase 1: Crash detection and auto-restart
In `electron/services/voice-core.js`:
- Detect unexpected exit (exit code !== 0)
- Implement exponential backoff restart: 1s, 2s, 4s, 8s, max 30s
- Cap at 5 restart attempts per 5-minute window (prevent infinite restart loops)
- Show toast notification on crash: "Voice engine restarting..."
- Show persistent warning after max retries: "Voice engine failed — click to retry"

### Phase 2: Transcription validation
In the voice-core Rust binary or MCP handler:
- Reject transcriptions shorter than 2 characters
- Reject transcriptions that are just repeated characters (Whisper hallucination: "......")
- Reject transcriptions that match known Whisper hallucination patterns:
  - "Thank you for watching"
  - "Subscribe to my channel"
  - Repeated phrases (same 3+ words repeated 3+ times)
- Log rejected transcriptions for debugging

### Phase 3: Timeout watchdog
In `electron/services/voice-core.js`:
- If voice-core sends no heartbeat/status for 30s, consider it frozen
- Send SIGTERM, wait 5s, then SIGKILL if still running
- Auto-restart with backoff

### Phase 4: Graceful degradation
- If voice-core can't start (missing models, audio device errors): show clear error in UI with fix instructions
- If TTS fails: fall back to text-only response (still show in chat, just don't speak)
- If STT fails: fall back to text input (auto-focus chat input, show "Voice unavailable" status)

### Phase 5: Health status dashboard
- Add voice pipeline health to the settings or a diagnostic page
- Show: voice-core status, last transcription time, TTS queue depth, current mode
- Accessible via `pipeline_trace` MCP tool (already exists — enhance it)

---

## 5. Telemetry and Crash Reporting

**Problem:** No visibility into how the app behaves in the wild. Crashes are silent. No way to prioritize bugs.

**Plan:**

### Phase 1: Local crash logging (no network, privacy-first)
- Catch uncaught exceptions and unhandled rejections in main process
- Write crash reports to `~/.config/voice-mirror-electron/data/crashes/`
- Include: timestamp, error message, stack trace, app version, OS, provider type
- Auto-cleanup: keep last 20 crash reports
- voice-core crashes: capture stderr output before process exits

### Phase 2: Opt-in crash reporter UI
- Add "Help improve Voice Mirror" toggle in Settings → Advanced
- Default: OFF (privacy-first)
- When ON: upload crash reports to a simple endpoint (GitHub Issues API or Sentry free tier)
- Show exactly what data will be sent before enabling
- Never send: audio, transcriptions, chat messages, API keys, file paths

### Phase 3: Anonymous usage metrics (opt-in only)
- If enabled: track session duration, provider type used, activation mode, crash count
- No PII, no content, no identifiers beyond a random session ID
- Aggregate only — helps prioritize: "80% use Claude Code, 15% Ollama, 5% cloud APIs"
- Use a lightweight analytics service or self-hosted endpoint

### Phase 4: In-app crash report viewer
- Settings → Advanced → "View crash logs"
- Show recent crashes with timestamps and one-line summaries
- "Copy to clipboard" button for easy bug reports
- "Clear all" button

### Implementation priority
Phase 1 is the most important and can be done immediately with zero privacy concerns (all local). Phases 2-3 should wait until there's a user base that would benefit.

---

## Priority Order

| Priority | Area | Effort | Impact |
|----------|------|--------|--------|
| 1 | Documentation | Medium | High — immediately helps contributors and AI assistants |
| 2 | Voice pipeline error recovery | Medium | High — biggest UX pain point |
| 3 | Local crash logging (Phase 1) | Small | Medium — essential debugging aid |
| 4 | End-to-end tests | Large | Medium — prevents regressions, enables confident refactoring |
| 5 | ghostty-web workarounds | Small | Low — current workarounds are working, just need documentation |
| 6 | Opt-in telemetry | Medium | Low — only valuable with a larger user base |
