# Voice Mirror Electron

**Voice-controlled AI agent overlay for your entire computer.**

```
Claude Code = Terminal + MCP Tools
Voice Mirror = Eyes + Ears + Voice
Combined = Full AI agent for your entire computer
```

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, MCP tools |
| [PYTHON-BACKEND.md](docs/PYTHON-BACKEND.md) | Voice processing, STT/TTS, protocols |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Config schema, settings, providers |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, building, debugging |
| [ROADMAP.md](docs/ROADMAP.md) | Progress, known issues, future plans |
| [BROWSER-BENCHMARK.md](docs/BROWSER-BENCHMARK.md) | Browser tool benchmark (102 tests, model comparison) |

---

## Quick Start

```bash
npm install
npm start
# Or: ./launch.sh (Linux/macOS) / launch.bat (Windows)
```

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for full setup including Python backend.

---

## Why This Exists

| Existing Product | What's Missing |
|------------------|----------------|
| Siri/Cortana/Alexa | Dumb, can't "see", no real capabilities |
| GitHub Copilot | Code only, no voice, IDE-locked |
| Claude Desktop | Not overlay, Mac-only features, no wake word |
| ChatGPT Desktop | Just a chat window, not an overlay |

**Voice Mirror Electron combines:**
1. Always-on overlay (tiny orb → expandable chat)
2. True voice-first (wake word + conversation mode)
3. Terminal/Claude Code power (actual command execution)
4. MCP tool ecosystem (n8n, memory, screen capture)
5. Screen awareness (vision API via desktopCapturer)
6. Multi-AI provider support (Claude, Ollama, OpenAI, etc.)
7. Cross-platform (Linux first, then Windows/Mac)

---

## UX States

### Floating Orb (Collapsed)
```
                                    ◉ ← 64px draggable orb
                                      (purple gradient, pulses when listening)
```
- **Ctrl+Shift+V** to expand
- Say "Hey Claude" when connected

### Expanded Panel
```
┌──────────────────────────────────────────────────┐
│ ◉ Voice Mirror  │                                │
├─────────────────┤  Chat Page                     │
│ 💬 Chat         │  ┌────────────────────────┐    │
│ >_ Claude Code  │  │ You: What's this error?│    │
│ ⚙️ Settings     │  │ Claude: That's a null  │    │
│                 │  │ pointer in line 42...  │    │
│                 │  └────────────────────────┘    │
│                 │  ┌────────────────────────┐    │
│                 │  │ ⌘ Claude Code [Running]│    │
│                 │  └────────────────────────┘    │
│ [« Collapse]    │  ● Listening...    [📷]       │
└─────────────────┴────────────────────────────────┘
```

### Orb Visual States
| State | Color | Animation |
|-------|-------|-----------|
| Idle/Listening | Purple gradient | Gentle pulse |
| Recording | Pink/Red gradient | Fast pulse |
| Speaking | Blue/Cyan gradient | Wave effect |
| Thinking | Purple | Spin animation |

---

## Project Structure

```
Voice Mirror Electron/
├── electron/
│   ├── main.js              # Window, tray, IPC, process orchestration
│   ├── preload.js           # Security bridge (contextBridge)
│   ├── config.js            # Cross-platform config
│   ├── claude-spawner.js    # Claude Code PTY (node-pty)
│   ├── overlay.html         # Main HTML with 3 pages
│   ├── window/              # Window manager + system tray
│   ├── providers/           # Multi-AI provider system (claude, openai-compat)
│   ├── services/            # 9 service modules (ai-manager, python-backend, etc.)
│   ├── browser/             # Chrome/Chromium automation (16 modules, CDP + Playwright)
│   ├── tools/               # Tool system for local LLMs
│   ├── js/                  # Renderer modules (9 files)
│   └── styles/              # CSS modules (9 files)
├── python/                  # Voice backend (STT, TTS, wake word)
├── mcp-server/              # MCP server (51 tools across 7 dynamic groups)
├── wayland-orb/             # Rust native layer-shell overlay (Linux/Wayland)
├── chrome-extension/        # Browser relay extension (MV3, CDP relay)
├── test/                    # Browser benchmark (102 tests, fixture replay)
├── docs/                    # Documentation
├── assets/                  # Icons (16-256px)
├── launch.sh                # Linux/macOS launcher
├── launch.bat               # Windows launcher
└── package.json
```

---

## AI Providers

| Provider | Type | Features |
|----------|------|----------|
| **Claude Code** | PTY | MCP tools, vision, full terminal |
| **Ollama** | Local API | Auto-detect, vision (llava) |
| **LM Studio** | Local API | Auto-detect |
| **Jan** | Local API | Auto-detect |
| **OpenAI** | Cloud API | Vision (GPT-4o) |
| **Gemini** | Cloud API | Vision |
| **Groq/Grok/Mistral** | Cloud API | Fast inference |
| **OpenRouter/DeepSeek** | Cloud API | Multi-model |

See [CONFIGURATION.md](docs/CONFIGURATION.md) for full provider list (11 total).

---

## Use Cases

**Developer:**
- "Hey Claude, what's this error on my screen?" → *captures screen, analyzes*
- "Fix it" → *spawns terminal, runs commands*
- "Run the tests" → *executes, reports via voice*

**Desktop:**
- "What app is using all my memory?" → *checks htop, reports*
- "Search for flights to Paris" → *web search, summarizes*

**Smart Home:**
- "Turn off the lights" → *smart home control via n8n*

---

## MCP Tool Groups (51 tools, dynamically loaded)

| Group | Tools | Key Capabilities |
|-------|-------|-----------------|
| **core** (4) | claude_send, claude_inbox, claude_listen, claude_status | Voice I/O, presence |
| **meta** (3) | load_tools, unload_tools, list_tool_groups | Dynamic tool loading |
| **screen** (1) | capture_screen | Desktop screenshots |
| **memory** (5) | search, get, remember, forget, stats | Hybrid vector+keyword search, 3 tiers |
| **voice-clone** (3) | clone_voice, clear_voice_clone, list_voice_clones | Voice cloning from audio |
| **browser** (14) | start/stop, navigate, screenshot, snapshot, act, search, fetch... | Full browser automation via CDP |
| **n8n** (22) | workflows CRUD, executions, credentials, nodes, tags, variables | n8n workflow automation |

---

## Key Technical Highlights

- **Standalone:** Spawns Claude Code CLI internally - no external session needed
- **No Extra API Cost:** Rendering in Electron vs terminal is just display
- **Multi-Provider:** Switch between Claude, Ollama, OpenAI without restart
- **Memory System:** Persistent memory via MCP (core/stable/notes tiers)
- **Screen Capture:** desktopCapturer + cosmic-screenshot fallback
- **Browser Automation:** Full CDP control (click, type, screenshot, snapshot, navigate)
- **Wayland Orb:** Native Rust layer-shell overlay for Linux/Wayland
- **n8n Integration:** 22 tools for workflow automation
- **Voice Cloning:** Clone any voice from 3s audio sample (Qwen3-TTS)
- **Browser Benchmark:** 102-test suite evaluating LLM browser tool usage (llama3.1:8b recommended — 98% pass, 9.6/10 avg)

---

---

## Development Rules

### Test-Driven Verification

Every feature, bug fix, or code change MUST include tests that verify the implementation works correctly. When building something:

1. Implement the feature or fix
2. Write tests that exercise the new/changed code
3. Run the tests and confirm they pass before considering the work complete

No change is considered done until it has passing tests. This applies to all parts of the codebase: Electron, Python backend, MCP server, and browser automation.

---

*Created: January 2026*
