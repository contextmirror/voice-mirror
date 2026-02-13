# Voice Mirror Electron

<p align="center">
  <img src="assets/icon-128.png" alt="Voice Mirror" width="128">
</p>

<p align="center">
  <strong>Voice-controlled AI agent overlay for your entire computer.</strong>
</p>

<p align="center">
  <a href="https://www.contextmirror.com">Website</a> •
  <a href="https://discord.com/invite/JBpsSFB7EQ">Discord</a> •
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#ai-providers">Providers</a> •
  <a href="CHANGELOG.md">Changelog</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="Alpha">
  <img src="https://img.shields.io/badge/version-0.8.2-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-blue" alt="Platform">
  <img src="https://img.shields.io/badge/electron-28.3.3-47848f" alt="Electron">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933" alt="Node.js">
  <img src="https://img.shields.io/badge/python-%3E%3D3.9-3776ab" alt="Python">
  <img src="https://img.shields.io/badge/MCP_tools-58-blueviolet" alt="MCP Tools">
  <img src="https://img.shields.io/badge/AI_providers-5_(75%2B_via_OpenCode)-orange" alt="AI Providers">
  <img src="https://img.shields.io/badge/tests-519_passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <a href="https://discord.com/invite/JBpsSFB7EQ"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

> **Alpha Release** — Voice Mirror is in active development. Core features work and are tested across all platforms, but expect rough edges. Bug reports and feedback welcome via [GitHub Issues](https://github.com/contextmirror/voice-mirror-electron/issues) or [Discord](https://discord.com/invite/JBpsSFB7EQ).

---

```
Claude Code / OpenCode = Terminal + MCP Tools
Voice Mirror            = Eyes + Ears + Voice
Combined                = Full AI agent for your entire computer
```

## Why Voice Mirror?

| Existing Product | What's Missing |
|------------------|----------------|
| Siri / Cortana / Alexa | No real capabilities, can't "see" your screen |
| GitHub Copilot | Code only, no voice, IDE-locked |
| Claude Desktop | Not an overlay, no wake word, limited platform |
| ChatGPT Desktop | Just a chat window |

Voice Mirror is an always-on overlay that listens, sees your screen, executes commands, and speaks back — across any AI provider.

---

## What Makes This Different

- **Claude Code / OpenCode as PTY-backed brains** — runs Claude Code or OpenCode inside Electron as a real terminal. Full MCP tool access with 75+ models via OpenCode, zero extra API cost beyond the CLI itself.
- **MCP as the agent backbone** — 58 tools across 10 dynamically-loaded groups (including 3 facade tools for voice-mode efficiency). Not a plugin system — a structured tool protocol with schema validation, gating, and hot-loading.
- **Real browser automation** — not "search and summarize." Actual CDP-level click, type, navigate, screenshot, and DOM snapshot. Verified by a 102-test benchmark.
- **Wayland-native overlay** — Rust layer-shell binary for proper always-on-top on Linux/Wayland, where Electron can't do it alone.
- **Unified agent loop** — wake word + screen capture + terminal execution + browser control + persistent memory, all wired together. Most tools pick one; this closes the full Hear → See → Think → Act → Speak → Persist loop.

---

## Features

### Voice Interaction

| Mode | Trigger | Use Case |
|------|---------|----------|
| **Wake Word** | "Hey Claude" | Hands-free, on-demand |
| **Push to Talk** | Mouse button / keyboard | Manual control |
| **Dictation** | Configurable hotkey | Voice-to-text input anywhere |

### Screen Awareness
Capture your screen at any time — the AI sees what you see and can analyze errors, UI, or anything on screen. Multi-monitor support with native Windows PowerShell capture. Images are sent directly to vision-capable LLMs (Ollama, OpenAI, etc.).

### Chat Dashboard
Full chat interface with message history, Slack-style grouped messages, markdown rendering, image paste/drop, and persistent chat sessions. AI activity status bar shows real-time provider state.

### Terminal Power
Claude Code or OpenCode runs inside Voice Mirror with full MCP tool access. Execute commands, manage files, and automate workflows — all by voice. OpenCode unlocks 75+ models (GPT, Gemini, Kimi, local Ollama, and more) through a single integration.

### 58 MCP Tools (10 groups, dynamically loaded)

| Group | Tools | Capabilities |
|-------|-------|-------------|
| **core** | 4 | Voice I/O, presence tracking |
| **memory** | 6 | Semantic search, 3-tier persistent memory |
| **browser** | 16 | Full CDP automation — navigate, click, type, screenshot, cookies, storage |
| **n8n** | 22 | Workflow CRUD, executions, credentials, tags |
| **voice-clone** | 3 | Clone any voice from a 3-second audio sample |
| **screen** | 1 | Desktop screenshot capture |
| **diagnostic** | 1 | Pipeline message tracing |
| **meta** | 3 | Dynamic tool loading/unloading |
| **facades** | 3 | Single-tool wrappers for memory, browser, and n8n (voice-mode efficiency) |

### Speech Recognition

| Engine | Speed | Notes |
|--------|-------|-------|
| **Parakeet** (default) | Fast, ONNX | NVIDIA NeMo Parakeet model |
| **Whisper** | Standard | OpenAI Whisper + Faster-Whisper adapters |

### Voice Synthesis

| Engine | Speed | Voice Cloning | Voices |
|--------|-------|---------------|--------|
| **Kokoro** (default) | Fast, CPU | No | 10 built-in |
| **Qwen3-TTS** | GPU recommended | Yes | 9 presets + custom |

---

## AI Providers

5 built-in providers — 75+ models accessible through OpenCode. Local servers are auto-detected.

| Provider | Type | Key Features |
|----------|------|-------------|
| **Claude Code** | CLI agent | Anthropic's gold-standard CLI. MCP tools, vision, full terminal, `CLAUDE.md` ecosystem |
| **OpenCode** | CLI agent | Universal gateway to 75+ models (GPT, Gemini, Kimi, Grok, Mistral, and more). Full MCP tool support. Auto-install from settings if not found |
| **Ollama** | Local | Auto-detect, vision (llava), run models on your own hardware |
| **LM Studio** | Local | Auto-detect, GUI-based local LLM runner |
| **Jan** | Local | Auto-detect, open source local AI |

**Why only 5?** OpenCode supports 75+ cloud providers (OpenAI, Google, xAI, Groq, Mistral, OpenRouter, DeepSeek, Moonshot, and more) with full MCP tool calling — no need for individual API entries. Claude Code stays as the premium Anthropic experience. Local providers stay for offline / on-hardware inference.

---

## Quick Start

### One-Line Install

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/contextmirror/voice-mirror-electron/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/contextmirror/voice-mirror-electron/main/install.ps1 | iex
```

### Manual Setup

```bash
git clone https://github.com/contextmirror/voice-mirror-electron.git
cd voice-mirror-electron
npm install

# Python backend
cd python
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows
pip install -r requirements.txt
cd ..

# Launch
npm start
```

### Requirements

- **Node.js** 18+
- **Python** 3.9+
- **Claude Code CLI** (for Claude provider) or **OpenCode** (for 75+ models — auto-install available from settings)
- **ffmpeg** (for voice cloning)
- **CUDA** (optional — GPU acceleration for Qwen3-TTS)

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+V` | Toggle panel expand/collapse |
| `Ctrl+Shift+M` | Toggle performance monitor |
| Drag orb | Move orb position |

---

## Configuration

Config is stored per-platform:

| Platform | Path |
|----------|------|
| Linux | `~/.config/voice-mirror-electron/config.json` |
| macOS | `~/Library/Application Support/voice-mirror-electron/config.json` |
| Windows | `%APPDATA%\voice-mirror-electron\config.json` |

Settings are accessible from the in-app Settings page — AI provider, voice, activation mode, audio devices, appearance, and more.

---

## Project Structure

```
voice-mirror-electron/
├── electron/              # Electron app
│   ├── main.js            # Window, tray, service orchestration
│   ├── constants.js       # Shared constants (providers, endpoints, timeouts)
│   ├── ipc/               # IPC handlers (6 modules: window, config, screen, ai, browser, misc)
│   ├── lib/               # Shared utilities (file watcher, screen capture, path safety, ollama)
│   ├── services/          # 15 service modules (standardised lifecycle: start/stop/isRunning)
│   ├── providers/         # Multi-AI provider system (5 providers, 75+ via OpenCode)
│   ├── browser/           # CDP browser automation (9 modules)
│   ├── tools/             # Tool system for local LLMs (4 tools)
│   ├── js/                # Renderer modules (15 files)
│   └── styles/            # CSS modules (10 files)
├── python/                # Voice backend (STT, TTS, wake word)
├── mcp-server/            # MCP server (58 tools, 10 groups)
├── wayland-orb/           # Rust native overlay (Linux/Wayland)
├── chrome-extension/      # Browser relay extension (MV3)
├── cli/                   # Setup wizard + CLI
└── assets/                # Icons
```

---

## Use Cases

**Developer:**
> "Hey Claude, what's this error on my screen?"
> → *captures screen, analyzes code, suggests fix*
>
> "Fix it"
> → *executes commands in terminal*

**Desktop:**
> "What app is using all my memory?"
> → *checks processes, reports findings via voice*

**Voice Cloning:**
> "Clone David Attenborough's voice from this clip"
> → *downloads audio, creates clone — all responses now in that voice*

**Automation:**
> "Create an n8n workflow that emails me when my server goes down"
> → *builds workflow via MCP tools*

---

## Cross-Platform

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Primary | X11/Wayland, AppImage target, native Wayland orb |
| Windows | Supported | NSIS installer, hidden-window desktop shortcut |
| macOS | Supported | DMG target |

---

## Security & Trust

**Voice Mirror runs its own isolated browser environment. It does not attach to or control your existing browser.**

- **Embedded Chromium** — browser automation operates in a controlled instance launched by the app, not your system browser. No access to your existing sessions, cookies, or logged-in accounts unless you explicitly log in inside Voice Mirror.
- **Tool-mediated actions** — every browser action flows through `LLM → tool schema → browser controller → Chromium`. Actions are enumerable, reviewable, and loggable. No arbitrary JS injection.
- **Explicit screen capture** — screenshots are triggered by tool calls or user request, not captured passively. The orb visually indicates capture state.
- **MCP tool gating** — tool groups load on demand. The LLM can only access tools that have been explicitly loaded for the session.

---

## Environment Variables

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Claude Code |

Cloud provider API keys (OpenAI, Google, xAI, etc.) are configured through OpenCode directly — see [OpenCode docs](https://opencode.ai/docs/providers/) for setup.

---

## Testing

```bash
npm test
```

519 tests across 126 suites covering config safety, API key detection, provider detection, settings, startup behavior, cross-platform paths, terminal rendering, MCP memory, browser automation, IPC validation, structured logging, path safety, and more.

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with Electron, Python, and a lot of voice commands.</sub>
</p>
