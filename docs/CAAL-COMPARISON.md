# CAAL Comparison — Learnings for Voice Mirror

Analysis of [CAAL](https://github.com/CoreWorxLab/CAAL) (CoreWorxLab AI Assistant, locally-hosted), a self-hosted voice assistant built on LiveKit Agents. Compared architecture, voice pipeline, MCP integration, LLM abstraction, and settings management to identify improvements for Voice Mirror Electron.

## Recommendations

### High Priority

- [x] **1. Neural VAD** — Replaced energy-based VAD (`np.abs(audio).mean() > threshold`) with Silero ONNX model (~2MB). Mode-specific thresholds (call=0.3, recording=0.5, follow_up=0.5), LSTM hidden state between frames, energy fallback if model unavailable. Implemented in `voice-core/src/vad/`.

- [x] **2. Native API tool calling** — Added OpenAI function calling (`tools` parameter) to `OpenAIProvider` alongside existing text-parsing fallback. Cloud providers (OpenAI, Groq, Gemini, Mistral, etc.) now get full tool support. Schema converter in `electron/tools/openai-schema.js`. Streaming `delta.tool_calls` accumulation, `role:"tool"` messages, ~2K token savings on system prompt.

- [x] **3. Tool wrapping for voice mode** — Added facade tool groups (`memory-facade`, `n8n-facade`, `browser-facade`) that collapse 44 tools into 3. New `voice-assistant-lite` profile. ~77% token reduction (9,400 to 2,200). Destructive action confirmation gates replicated inside facades. Implemented in `mcp-server/handlers/facades.js`.

### Medium Priority

- [ ] **4. Wake word gating state machine** — CAAL's `WakeWordGatedSTT` has a clean `LISTENING`/`ACTIVE` state machine with automatic timeout, `set_agent_busy()` to pause timers during LLM/TTS, and separate VAD tracking. Voice Mirror could refactor manual state flags in `audio_callback()` into this pattern for more reliable conversation flow.

- [ ] **5. Normalized LLM response types** — CAAL uses `LLMResponse` and `ToolCall` dataclasses as a single format regardless of provider. Voice Mirror's provider output is scattered across EventEmitter events and raw text. A normalized response type would make the tool pipeline more robust.

- [ ] **6. Provider-specific format methods** — CAAL lets each provider override `format_tool_result()` and `format_tool_call_message()` to handle API quirks (Ollama wants dict args, Groq wants JSON string + `name` field). Adding per-provider overrides to `OpenAIProvider` would prevent breakage when APIs diverge.

- [ ] **7. Pre-flight connection testing in settings UI** — CAAL has `POST /setup/test-*` endpoints that validate connections in real-time (spinner -> checkmark/X). Voice Mirror only tests connections during CLI setup. Adding live connection tests in the running app would improve UX for provider switching.

### Low Priority

- [ ] **8. Tool data caching** — CAAL's `ToolDataCache` preserves structured tool response data and injects it into subsequent LLM calls. Prevents the "lost context" problem where the model forgets tool results after a few turns.

- [ ] **9. Sensitive key protection** — CAAL prevents accidental clearing of API keys when settings save — if a secret field is empty in the update, it's skipped. Voice Mirror could adopt this in `set-config` IPC handler.

- [ ] **10. Prompt file management** — CAAL stores prompts as files (`prompt/en/default.md`, `prompt/custom.md`) with language support. Voice Mirror stores the system prompt as a single string in `config.json`. File-based prompts would enable versioning, language variants, and easier editing.

- [ ] **11. Latency instrumentation** — CAAL tracks round-trip latency (transcription to first audio output). Adding similar tracing to Voice Mirror would help identify bottlenecks in the voice pipeline.

- [ ] **12. MCP namespace prefixing** — CAAL uses `server_name__tool_name` to prevent tool name collisions across multiple MCP servers. Useful if Voice Mirror ever becomes an MCP client.

## Where Voice Mirror is Already Ahead

| Area | Voice Mirror | CAAL |
|------|-------------|------|
| Voice cloning | Qwen3-TTS with reference audio | None |
| Provider breadth | 15 providers | 4 providers |
| Desktop integration | Screen capture, browser control, system tray | Web-only |
| Push-to-talk | uiohook-napi + evdev hardware buttons | None |
| Fully local | No Docker stack needed | Requires 6+ Docker containers |
| Input validation | Per-field type/range/length at IPC boundary | URL-only validation |
| Config persistence | Atomic write + backup | Direct write |
| Hot-reload | Auto-restart providers, re-register hotkeys | Cache invalidation only |

## CAAL Architecture Reference

CAAL is a Docker-based voice assistant with:
- **LiveKit Agents** for WebRTC audio transport
- **Speaches** (Faster-Whisper) for STT, **Kokoro** for TTS
- **Ollama/Groq/OpenRouter** for LLM (provider-agnostic abstraction)
- **MCP** as tool gateway (n8n workflows, Home Assistant)
- **Next.js 15** frontend with React 19
- Wake word detection (OpenWakeWord server-side + Porcupine client-side)
- Silero VAD for voice activity detection
- Tool data caching and conversation sliding window

Source: https://github.com/CoreWorxLab/CAAL
