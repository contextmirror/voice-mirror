# Voice Mirror — Roadmap

The big picture: Voice Mirror starts as a desktop overlay, becomes a server you can access from any device, and eventually lives in your pocket.

---

## Where We Are Now (v0.8.x)

Electron desktop app — transparent overlay with orb, embedded Claude Code terminal, Python voice backend (STT/TTS/VAD), MCP server with 58 tools. Works on Windows, macOS, Linux.

Key architectural advantage: the heavy lifting already runs as **separate processes** (Python backend, AI provider PTY, MCP server). The Electron shell is just the UI and orchestration layer.

---

## Phase 1: Voice Mirror TUI (Local Model Dashboard)

**Goal:** Replace the blank terminal canvas with a proper TUI dashboard when using local models (Ollama, LM Studio, Jan, etc.). Inspired by [Shodh](https://github.com/varun29ankuS/shodh-memory)'s terminal dashboard.

Claude Code has its own TUI. Local models currently dump plain text into ghostty-web, leaving a huge blank area. Voice Mirror deserves its own TUI for these providers.

### Layout

```
╭─ Voice Mirror ──── Ollama (mistral-3) ────── ● Running ─────────╮
│ ┌─ Conversation ───────────────────┐ ┌─ Tool Calls ───────────┐ │
│ │                                  │ │ ✓ browser_search  2s   │ │
│ │  ▸ You                 8:34 PM   │ │   "weather london"     │ │
│ │  What's the weather in London?   │ │                        │ │
│ │                                  │ │ ✓ read_screen     1s   │ │
│ │  ▸ mistral-3           8:34 PM   │ │   captured 1920x1080   │ │
│ │  Let me check that for you.      │ │                        │ │
│ │                                  │ │ ⠋ memory_store         │ │
│ │  [Tool: browser_search]          │ │   saving context...    │ │
│ │                                  │ │                        │ │
│ │  It's currently 12°C in London   │ ├─ Info ─────────────────┤ │
│ │  with partly cloudy skies.       │ │ Model   mistral-3      │ │
│ │  Wind is 15mph from the west.    │ │ Temp    0.7            │ │
│ │                                  │ │ Speed   42 tok/s       │ │
│ │  ▸ You                 8:36 PM   │ │ Tools   12 loaded      │ │
│ │  Thanks!                         │ │                        │ │
│ │                                  │ │ ▶ Speaking...          │ │
│ │  ▸ mistral-3           8:36 PM   │ │                        │ │
│ │  █ (streaming...)                │ │                        │ │
│ └──────────────────────────────────┘ └────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ CTX: 2.1K/32K │ TTS: Edge (Aria) │ STT: Parakeet │ 3 tool calls│
╰───────────────────────────────────────────────────────────────────╯
```

### Panels

| Panel | Content |
|-------|---------|
| **Header** | Model name, status badge (Running/Stopped), connection indicator |
| **Conversation** (left) | Scrollable chat — user/assistant messages with timestamps, streaming cursor, tool call inline markers |
| **Tool Calls** (right top) | Live activity feed — each MCP tool call with status icon (⠋ running, ✓ done, ✗ failed), name, duration, one-line detail. Scrollable. Most recent at top |
| **Info** (right bottom) | Model name, temperature, generation speed (tok/s), tool count, TTS/voice status |
| **Status bar** (bottom) | Context usage bar, TTS engine + voice, STT engine, tool call count |

### Implementation

**No separate process.** The openai-provider already writes to ghostty-web via `emitOutput('stdout', text)`. Instead of plain text, it outputs ANSI escape sequences to render the TUI.

#### 1A: TUI Renderer Module
New `electron/providers/tui-renderer.js`:

- Tracks terminal dimensions (cols × rows), updated on resize
- Maintains state: message history, tool calls, model info, streaming buffer
- `render()` — full screen repaint using ANSI escape codes (cursor positioning, colors, box-drawing characters `╭╮╰╯│─┌┐└┘├┤`)
- `appendMessage(role, text, timestamp)` — adds to chat, triggers partial re-render
- `streamToken(token)` — appends to current streaming message (no full repaint)
- `addToolCall(name, status, detail)` — updates tool calls panel
- `updateInfo(key, value)` — updates info panel fields
- Word-wrapping and scroll offset for both chat and tool panels

#### 1B: Wire into OpenAI Provider
Modify `electron/providers/openai-provider.js`:

- On start: create TUI renderer, do initial full render
- On user input: `tui.appendMessage('user', text)`
- On streaming tokens: `tui.streamToken(token)` (character-by-character)
- On complete response: `tui.appendMessage('assistant', fullText)`
- On tool call: `tui.addToolCall('browser_search', 'running', '"weather london"')`
- On tool result: `tui.updateToolCall('browser_search', 'done', '2s')`
- On resize: `tui.resize(cols, rows)` → full re-render
- Generation speed calculated from token count / elapsed time

#### 1C: Terminal Input Handling
The TUI needs to handle keyboard input from ghostty-web:

- Scroll chat: `j`/`k` or arrow keys
- Switch panel focus: `Tab`
- Scroll tool calls when focused
- All other input passes through to the provider as normal

#### 1D: Theming
Use the existing Voice Mirror color palette (from CSS variables) mapped to ANSI 256-color codes:

- Accent color (`#667eea`) for borders, headers
- Muted colors for timestamps, secondary text
- Green/red/yellow for status indicators
- Background matches the terminal background

### Applies To
All non-PTY providers: Ollama, LM Studio, Jan, OpenAI API, Gemini API, Groq, Mistral, OpenRouter, DeepSeek, Grok — anything that goes through `openai-provider.js`.

Claude Code and OpenCode keep their own TUI (they're PTY-based).

---

## Phase 1.5: Custom Wake Word — "Mirror"

**Goal:** Replace the default "Hey Claude" wake word with a custom **"Mirror"** keyword, giving Voice Mirror its own identity independent of any AI provider.

### Why
The current wake word detection uses [OpenWakeWord](https://github.com/dscripka/openWakeWord) with pre-trained models ("hey_claude", "hey_jarvis", etc.). "Hey Claude" ties the experience to one provider — but Voice Mirror works with Ollama, GPT, Gemini, and others. A custom wake word makes it provider-agnostic and more natural: just say **"Mirror"** and start talking.

### Training a Custom Model

OpenWakeWord supports training custom models. The pipeline:

1. **Collect positive samples** — record ~100+ clips of "Mirror" spoken by different people, accents, distances, background noise levels
2. **Generate synthetic samples** — use TTS engines (Piper, Kokoro, Edge TTS) to generate thousands of synthetic "Mirror" utterances with varied voices, speeds, and pitches
3. **Collect negative samples** — ambient noise, speech that sounds similar ("bitter", "litter", "mere"), general conversation
4. **Train with OpenWakeWord** — fine-tune a small model (~500KB) using the provided training notebook
5. **Validate** — test false positive rate (activations on non-wake-word speech) and false negative rate (missed activations)
6. **Ship** — bundle the `.onnx` model file with Voice Mirror, add "Mirror" to the wake word selector in settings

### Technical Details

- **Model format:** ONNX (same as existing wake word models)
- **Model size:** ~500KB (runs on CPU, <1ms inference)
- **Integration point:** `python/wake_word.py` — already loads `.onnx` models from a configurable path
- **Settings:** Add "Mirror" option to wake word dropdown alongside existing options
- **Fallback:** Keep "Hey Claude", "Hey Jarvis", etc. as alternatives — user picks in settings
- **Threshold tuning:** Expose sensitivity slider in settings (higher = fewer false positives, lower = fewer misses)

### Stretch Goals
- **Custom wake word training UI** — let users record their own wake word samples in-app and train a personal model
- **Multiple wake words** — respond to both "Mirror" and a user-defined phrase
- **Confirmation sound** — play a subtle chime when wake word is detected (before STT starts)

---

## Phase 1.6: Embedded n8n Dashboard

**Goal:** Bring n8n's workflow automation directly into Voice Mirror — visible, live, and voice-controllable. Users see workflows execute in real-time without leaving the app.

### Why This Matters

n8n is the automation backbone that makes Voice Mirror genuinely useful beyond conversation. Through MCP tools, any AI provider (Claude Code, Ollama, GPT, etc.) can trigger n8n workflows via voice:

- *"Build me a workflow that sends a daily email summary of my GitHub PRs"* → Claude Code creates the n8n workflow using MCP tools
- *"Send an email to the team about the deploy"* → triggers a Gmail n8n workflow
- *"When someone stars my repo, post to Slack"* → creates a webhook-driven automation
- *"Check my calendar and read out today's meetings"* → Google Calendar workflow

The power is that **frontier LLMs like Claude can build n8n workflows from scratch** using the MCP n8n tools. Users don't need to know n8n's node editor — they just describe what they want by voice, and the AI builds the automation for them. This turns Voice Mirror into a voice-driven automation platform.

### Layout

The Browser sidebar tab gets a sub-navigation:

```
Sidebar                    Main panel
┌─────────────────┐       ┌────────────────────────────────┐
│ Chat             │       │ ← →  🔄  localhost:5678       │
│ >_ Ollama ●     │       │                                │
│ 🌐 Browser      │       │  ┌─── n8n Workflow Editor ───┐ │
│    ├─ Web       │       │  │                           │ │
│    └─ n8n ●     │       │  │  [Webhook] → [OpenAI]    │ │
│ ⚙ Settings      │       │  │       ↓                   │ │
│                 │       │  │  [Gmail] → [Slack Post]   │ │
│                 │       │  │                           │ │
│                 │       │  └───────────────────────────┘ │
│                 │       │  ✓ Workflow executed (2.3s)     │
└─────────────────┘       └────────────────────────────────┘
```

- **Web** — current browser (Google searches, web pages)
- **n8n** — embedded n8n dashboard on `localhost:5678`
- Green dot when n8n is detected and running
- Auto-switches to n8n view when an n8n MCP tool fires

### User Setup Flow

1. **Install n8n** — Voice Mirror Settings shows an "n8n" section with a one-click install button (`npm install -g n8n`) or detects existing installation
2. **First run** — n8n requires a free account (email signup at n8n.io → activation key emailed)
3. **Configure in Voice Mirror** — paste the n8n API key in Settings; URL defaults to `localhost:5678`
4. **Import templates** — Voice Mirror offers to pre-load starter workflow templates (Gmail, Slack, Calendar, GitHub, etc.)
5. **Done** — n8n dashboard visible in-app, MCP tools connected, ready for voice commands

### Implementation

#### 1.6A: Browser Sub-Navigation
- Add **Web** / **n8n** toggle under the Browser nav item in sidebar
- n8n tab loads `localhost:5678` in the existing webview
- Status indicator: green dot when n8n responds to health check, gray when offline

#### 1.6B: n8n Detection & Auto-Start
- On app launch, ping `localhost:5678/healthz` to detect running n8n
- If not running but `n8n` command is available, offer to start it as a subprocess (same pattern as Python backend)
- Manage n8n lifecycle: start on app launch, stop on app quit
- Settings: n8n URL (default `http://localhost:5678`), API key, auto-start toggle

#### 1.6C: Auto-Navigate on Tool Call
- When an n8n MCP tool fires (e.g., `n8n_execute_workflow`, `n8n_create_workflow`), auto-switch the browser panel to n8n view
- Highlight the active workflow in the embedded dashboard
- After execution completes, show result status in the browser panel header

#### 1.6D: n8n Settings & Setup Wizard
- Settings section: n8n URL, API key, auto-start on/off
- Setup wizard: detects n8n installation, guides through account creation, API key entry
- "Install n8n" button that runs `npm install -g n8n` (with user confirmation)
- "Import Templates" button that loads Voice Mirror starter workflows

#### 1.6E: Starter Workflow Templates
Pre-built n8n workflows optimized for Voice Mirror:

| Template | Trigger | What it does |
|----------|---------|-------------|
| **Gmail Summary** | Schedule/Voice | Fetches unread emails, summarizes via AI, reads aloud |
| **Send Email** | Voice command | Composes and sends email via Gmail API |
| **Calendar Today** | Voice command | Reads today's Google Calendar events |
| **GitHub Notifications** | Webhook/Voice | Checks GitHub notifications, summarizes PRs |
| **Slack Message** | Voice command | Posts a message to a Slack channel |
| **Web Scraper** | Voice command | Fetches and extracts data from a URL |
| **Custom Webhook** | External trigger | Receives webhooks and notifies via Voice Mirror |

These templates are JSON files shipped with Voice Mirror, importable via the n8n API.

### What Makes This Unique

Most n8n users interact through a browser tab. Voice Mirror makes n8n **voice-first**:

1. **Build workflows by voice** — "Create a workflow that monitors my email for invoices and saves them to Google Drive" → Claude Code builds the entire n8n workflow using MCP tools
2. **Trigger workflows by voice** — "Send the weekly report" → executes the workflow
3. **See results in-app** — the n8n dashboard is right there, showing execution history
4. **No context switching** — everything lives inside Voice Mirror

This is the bridge between conversational AI and real-world automation.

---

## Phase 2: Voice Mirror Server

**Goal:** Run Voice Mirror as a Node.js server, access the full dashboard from `localhost:3333` in any browser.

```
npm start          → Electron (orb, overlay, hotkeys — current)
npm run server     → Server mode (browser dashboard on localhost)
```

### 1A: Transport Abstraction Layer
The renderer currently talks to the backend via Electron IPC (`window.voiceMirror.*` → preload.js → ipcMain). Create a transport abstraction so the same API works over both IPC and WebSocket.

```
Renderer code (unchanged)
    ↓
transport.js  →  IPC bridge (Electron mode)
              →  WebSocket bridge (Server mode)
    ↓
Backend services (unchanged)
```

- `electron/transport/ipc-transport.js` — current preload-based IPC (wrap existing)
- `electron/transport/ws-transport.js` — WebSocket client that mirrors the same API
- `electron/transport/index.js` — auto-detects environment and returns the right transport
- Renderer calls `transport.invoke('get-config')` instead of `ipcRenderer.invoke('get-config')`

### 1B: Server Entry Point
New `server/index.js` that replaces `electron/main.js` as the orchestrator:

- Express (or Fastify) serves the renderer HTML/CSS/JS as static files
- WebSocket server handles all `invoke` / `on` / `send` messages
- Starts the same services: Python backend, AI provider, inbox watcher, config
- No Electron dependency — runs on plain Node.js

### 1C: Terminal WebSocket Proxy
The embedded terminal (xterm.js + node-pty) needs a WebSocket bridge in server mode:

- Server spawns PTY (node-pty) and pipes data over WebSocket
- Browser connects xterm.js via `xterm-addon-attach`
- Same terminal experience, different transport

### 1D: Graceful Degradation
Electron-specific features get web alternatives:

| Electron Feature | Browser Alternative |
|---|---|
| Transparent overlay / orb | Disabled — dashboard is the UI |
| uiohook global hotkeys | In-page keyboard shortcuts |
| System tray | Status bar in dashboard header |
| Native file dialogs | `<input type="file">` or text input |
| Screen capture | Browser Screen Capture API (with permission) or disabled |
| Always-on-top | Regular browser window |

### 1E: Settings & Mode Awareness
- Config flag `runtime: "electron" | "server"` detected at startup
- UI conditionally hides/shows features based on runtime
- Server mode shows a top bar with connection status, no orb controls

---

## Phase 3: Remote Access

**Goal:** Access Voice Mirror from any device on your network (or beyond).

### 3A: LAN Access
- Server binds to `0.0.0.0` instead of `127.0.0.1` (opt-in setting)
- Access from phone, tablet, another PC: `http://192.168.x.x:3333`
- Simple auth token or password to prevent unauthorized access

### 3B: Secure Remote Access
- HTTPS with self-signed cert (auto-generated) or user-provided cert
- Optional tunnel integration (Cloudflare Tunnel, ngrok, Tailscale) for internet access
- Auth: API key, basic auth, or OAuth

### 3C: Multi-Client Support
- Multiple browser tabs/devices connected simultaneously
- Real-time state sync via WebSocket broadcast
- Chat history visible on all connected clients
- Only one client can hold the microphone at a time (PTT ownership)

---

## Phase 4: Mobile App

**Goal:** Voice Mirror on your phone — talk to Claude from anywhere.

### Architecture
The mobile app is a **thin client** that connects to the Voice Mirror server running on your desktop/server. It doesn't run Python or node-pty locally — it streams everything.

```
Phone (client)                    Desktop/Server (backend)
┌─────────────┐     WebSocket     ┌──────────────────────┐
│ Voice Mirror │ ←──────────────→ │ Voice Mirror Server  │
│ Mobile App   │                  │  ├── Python backend   │
│              │                  │  ├── AI provider/PTY  │
│ - Microphone │                  │  ├── MCP server       │
│ - Speaker    │                  │  └── Config/Services  │
│ - Chat UI    │                  └──────────────────────┘
│ - Settings   │
└─────────────┘
```

### 4A: Mobile-Optimized Web UI (PWA)
Before building a native app, ship a Progressive Web App:

- Responsive layout of the existing dashboard (chat + settings)
- PWA manifest for "Add to Home Screen"
- Push notifications for AI responses
- MediaRecorder API for voice input (record on phone, stream to server)
- Audio playback for TTS responses streamed from server

This tests the full mobile experience with zero native code.

### 4B: Native Mobile App
If PWA limitations become blockers (background audio, always-on mic, Siri/Google Assistant integration):

- **React Native** or **Expo** — share component logic with web
- Native audio pipeline for better mic/speaker control
- Background voice processing
- Widgets (iOS/Android) for quick voice activation
- Platform-specific wake word detection (on-device)

### 4C: Voice Streaming Protocol
For real-time voice on mobile:

- Client records audio → streams raw PCM/opus over WebSocket → server runs STT
- Server generates TTS → streams audio chunks back → client plays
- Low-latency bidirectional audio streaming (target: <500ms round-trip)
- Fallback: record-then-send for high-latency connections

---

## Phase 5: Cloud Deployment (Optional / Future)

**Goal:** Voice Mirror as a hosted service — no local install needed.

- Docker image: `docker run -p 3333:3333 voice-mirror`
- Cloud deploy (Railway, Fly.io, AWS) with GPU for local STT/TTS models
- User accounts, persistent config, conversation history
- API key management (bring your own Claude/OpenAI keys)

This is the furthest out and depends on demand. The server architecture from Phase 2-3 makes this possible without major changes.

---

## Execution Priority

```
Phase 1 (TUI)            — Immediate visual impact. Fixes the blank terminal problem. ✅ Shipped v0.8.6
Phase 1.5 (Wake word)    — Brand identity. Can develop in parallel with anything.
Phase 1.6 (n8n embed)    — Voice-driven automation. High user value, builds on existing browser.
Phase 2 (Server mode)    — Foundation for cross-platform. Everything after builds on this.
Phase 3A (LAN access)    — Quick win once Phase 2 is done.
Phase 4A (PWA)           — Mobile access with minimal new code.
Phase 3B-C (Remote/Auth) — When users want internet access.
Phase 4B (Native app)    — Only if PWA hits real limitations.
Phase 5 (Cloud)          — If there's demand for hosted Voice Mirror.
```

Phase 1 (TUI) shipped in v0.8.6. Phase 1.5 (wake word) and Phase 1.6 (n8n) are both independent — they can be developed in parallel with each other and with Phase 2. Phase 1.6 is particularly high-value because it turns Voice Mirror from a conversation tool into a voice-driven automation platform: users say what they want built, and the AI creates n8n workflows that connect to real services (Gmail, Slack, GitHub, etc.). Phase 2A (transport abstraction) is the foundation for everything cross-platform.

---

## Non-Goals

- **Replace Electron entirely** — the desktop overlay experience (orb, hotkeys, always-on-top) is a core feature. Server mode is an alternative, not a replacement.
- **Run Python on mobile** — the phone is a thin client. STT/TTS processing stays on the server.
- **Build a general-purpose web framework** — the server is purpose-built for Voice Mirror, not a generic platform.
