# Voice Mirror — Roadmap

The big picture: Voice Mirror starts as a desktop overlay, becomes a server you can access from any device, and eventually lives in your pocket.

---

## Where We Are Now (Tauri 2 migration)

Voice Mirror has migrated from Electron to **Tauri 2** on the `tauri-migration` branch. The entire application has been rebuilt:

- **Frontend**: Svelte 5 with Vite HMR (was vanilla JS ES modules)
- **Backend**: Rust via Tauri 2 commands (was Node.js main process)
- **Voice pipeline**: Rust-native STT (Whisper ONNX), TTS (Kokoro ONNX / Edge TTS), VAD, playback via rodio (was Python backend, then Rust child process)
- **MCP server**: Native Rust binary `voice-mirror-mcp` using stdio JSON-RPC (was Node.js)
- **IPC**: `invoke('command', { args })` from Svelte to Rust (was Electron IPC + preload bridge)
- **Config**: `%APPDATA%/voice-mirror/config.json`, managed by Rust with serde (was Node.js JSON watcher)

Key stats: 1070+ JS tests, 167+ Rust tests, 30 Svelte components, 9 reactive stores, 50+ Tauri commands, 10 AI providers supported.

The architectural advantage of Tauri: the heavy lifting (voice, MCP, provider management) runs as **compiled Rust** — no Node.js runtime at all. The Svelte frontend is a thin UI layer that calls into the backend via `invoke()`.

---

## Phase 1: Voice Mirror TUI (Local Model Dashboard) -- SHIPPED

**Status: Shipped in v0.8.6 (Electron era)**

Replaced the blank terminal canvas with a proper TUI dashboard when using local models (Ollama, LM Studio, Jan, etc.). The TUI renderer outputs ANSI escape sequences for a box-drawing layout with conversation panel, tool calls, and info panel.

In the Tauri version, local LLM providers use the chat panel UI directly (Svelte components) rather than the TUI-in-terminal approach. The TUI concept lives on in the terminal view for PTY-based providers.

---

## Phase 1.5: Custom Wake Word — "Mirror"

**Goal:** Replace the default "Hey Claude" wake word with a custom **"Mirror"** keyword, giving Voice Mirror its own identity independent of any AI provider.

### Why
The current wake word detection uses OpenWakeWord with pre-trained models. "Hey Claude" ties the experience to one provider — but Voice Mirror works with Ollama, GPT, Gemini, and others. A custom wake word makes it provider-agnostic and more natural: just say **"Mirror"** and start talking.

### Training a Custom Model

OpenWakeWord supports training custom models. The pipeline:

1. **Collect positive samples** — record ~100+ clips of "Mirror" spoken by different people, accents, distances, background noise levels
2. **Generate synthetic samples** — use TTS engines (Kokoro, Edge TTS) to generate thousands of synthetic "Mirror" utterances with varied voices, speeds, and pitches
3. **Collect negative samples** — ambient noise, speech that sounds similar ("bitter", "litter", "mere"), general conversation
4. **Train with OpenWakeWord** — fine-tune a small model (~500KB) using the provided training notebook
5. **Validate** — test false positive rate (activations on non-wake-word speech) and false negative rate (missed activations)
6. **Ship** — bundle the `.onnx` model file with Voice Mirror, add "Mirror" to the wake word selector in settings

### Technical Details

- **Model format:** ONNX (same as existing wake word models)
- **Model size:** ~500KB (runs on CPU, <1ms inference)
- **Integration point:** `voice/pipeline.rs` — the Rust voice pipeline loads `.onnx` models for wake word detection
- **Settings:** Add "Mirror" option to wake word dropdown in `VoiceSettings.svelte`
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

- *"Build me a workflow that sends a daily email summary of my GitHub PRs"* → AI creates the n8n workflow using MCP tools
- *"Send an email to the team about the deploy"* → triggers a Gmail n8n workflow
- *"When someone stars my repo, post to Slack"* → creates a webhook-driven automation
- *"Check my calendar and read out today's meetings"* → Google Calendar workflow

The power is that **frontier LLMs can build n8n workflows from scratch** using the MCP n8n tools. Users don't need to know n8n's node editor — they just describe what they want by voice, and the AI builds the automation for them. This turns Voice Mirror into a voice-driven automation platform.

### Layout

A dedicated n8n view within the app:

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

1. **Install n8n** — Voice Mirror Settings shows an "n8n" section with a one-click install button or detects existing installation
2. **First run** — n8n requires a free account (email signup at n8n.io → activation key emailed)
3. **Configure in Voice Mirror** — paste the n8n API key in Settings; URL defaults to `localhost:5678`
4. **Import templates** — Voice Mirror offers to pre-load starter workflow templates (Gmail, Slack, Calendar, GitHub, etc.)
5. **Done** — n8n dashboard visible in-app, MCP tools connected, ready for voice commands

### Implementation

#### 1.6A: Browser Sub-Navigation
- Add **Web** / **n8n** toggle under the Browser nav item in sidebar
- n8n tab loads `localhost:5678` in a Tauri WebView or embedded iframe
- Status indicator: green dot when n8n responds to health check, gray when offline

#### 1.6B: n8n Detection & Auto-Start
- On app launch, ping `localhost:5678/healthz` to detect running n8n
- If not running but `n8n` command is available, offer to start it as a subprocess (managed by Rust backend)
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

### n8n as the Task & Reminder Engine

n8n isn't just for automations — it **is** Voice Mirror's built-in task scheduler, reminder system, and recurring job runner. No custom heartbeat or cron system needed.

#### How It Works

```
User: "Wake me up at 8am and tell me about traffic"
    ↓
AI builds n8n workflow via MCP tools:
    [Schedule Trigger: 8:00 AM daily]
        → [Google Maps API: traffic for saved route]
        → [HTTP Request: POST to Voice Mirror webhook]
            Body: { "speak": "Good morning! Traffic on your commute is light, 25 minutes today." }
    ↓
Voice Mirror webhook listener receives callback → TTS speaks the message
```

#### Webhook Listener

A lightweight HTTP endpoint inside Voice Mirror (served by the Rust backend) that receives n8n callbacks:

```
POST /api/webhook  →  { "speak": "...", "notify": true }
Voice Mirror receives it → TTS speaks the text, optionally shows a notification
```

- Runs on `localhost:3334` (configurable)
- Accepts `speak` (text to say aloud), `notify` (show UI notification), `data` (structured payload)
- n8n workflows use the "HTTP Request" node to POST to this endpoint
- Works with any n8n trigger: schedule, webhook, email received, RSS feed, etc.

#### Example Voice-Created Workflows

| Voice Command | n8n Workflow Created |
|---|---|
| *"Wake me up at 8am with the weather"* | Schedule 8:00 → Weather API → webhook `/api/webhook` with forecast text |
| *"Remind me to take meds at 9am and 9pm"* | Two schedule triggers → webhook with reminder message |
| *"Tell me when someone stars my repo"* | GitHub webhook → webhook to Voice Mirror with star count |
| *"Every Friday, summarize my unread emails"* | Schedule Fri 5pm → Gmail API → AI summarize → webhook with summary |
| *"Ping me if my server goes down"* | HTTP poll every 5 min → if status != 200 → webhook with alert |

#### Mobile Integration

This architecture extends naturally to the mobile app (Phase 4):

```
Phone (anywhere)                    Desktop (home)
┌──────────────┐                   ┌──────────────────────┐
│ Voice Mirror  │   WebSocket      │ Voice Mirror Server   │
│ Mobile App    │ ←───────────────→│  ├── n8n (scheduler) │
│               │                  │  ├── Webhook listener │
│ "Remind me to │                  │  ├── Rust TTS/STT     │
│  call mom at  │                  │  └── AI provider      │
│  3pm"         │                  └──────────────────────┘
└──────────────┘                            ↓
                                   n8n creates schedule
                                   trigger → 3pm fires →
                                   webhook → TTS speaks
                                   "Time to call mom!"
                                   (+ push notification
                                    to phone)
```

Users set reminders from their phone by voice, n8n schedules them, and Voice Mirror speaks the reminder — whether the user is at their desktop or gets a push notification on mobile.

### What Makes This Unique

Most n8n users interact through a browser tab. Voice Mirror makes n8n **voice-first**:

1. **Build workflows by voice** — "Create a workflow that monitors my email for invoices and saves them to Google Drive" → AI builds the entire n8n workflow using MCP tools
2. **Trigger workflows by voice** — "Send the weekly report" → executes the workflow
3. **Reminders & scheduling by voice** — "Wake me up at 8am with traffic" → n8n handles the scheduling, Voice Mirror speaks the result
4. **See results in-app** — the n8n dashboard is right there, showing execution history
5. **No context switching** — everything lives inside Voice Mirror
6. **Mobile-ready** — set reminders from your phone, hear them on your desktop (or get push notifications)

This is the bridge between conversational AI and real-world automation. n8n is the scheduler, Voice Mirror is the voice.

---

## Phase 2: Voice Mirror Server

**Goal:** Run Voice Mirror as a standalone server, access the full dashboard from `localhost:3333` in any browser.

Tauri's architecture makes this significantly more tractable than it was under Electron. The Rust backend already encapsulates all business logic (voice, providers, config, MCP) behind clean command interfaces. Extracting a server mode means:

1. Compile the Rust backend as a standalone HTTP server (using `axum` or `actix-web`) instead of a Tauri plugin
2. Serve the Svelte frontend as static files
3. Replace `invoke()` calls with REST/WebSocket endpoints

```
cargo run --bin voice-mirror-server   # Server mode (browser dashboard on localhost)
cargo tauri dev                       # Desktop mode (Tauri WebView — current)
```

### 2A: Transport Abstraction Layer
The Svelte frontend's `api.js` currently calls `invoke()`. Add an abstraction that auto-selects transport:

```
api.js (unchanged interface)
    ↓
transport layer  →  Tauri invoke() (desktop mode)
                 →  WebSocket/REST (server mode)
    ↓
Rust backend (unchanged)
```

### 2B: Server Binary
A second Rust binary (`voice-mirror-server`) that:
- Embeds the same backend logic as the Tauri app
- Serves the Svelte build as static files via an HTTP server
- Exposes WebSocket endpoints matching all Tauri commands
- No Tauri/WebView dependency — runs on headless Linux servers

### 2C: Terminal WebSocket Proxy
For PTY-based providers, the terminal needs a WebSocket bridge in server mode:
- Server spawns PTY (portable-pty) and pipes data over WebSocket
- Browser connects xterm.js via WebSocket attach addon
- Same terminal experience, different transport

### 2D: Graceful Degradation
Tauri-specific features get web alternatives:

| Tauri Feature | Browser Alternative |
|---|---|
| Transparent overlay / orb | Disabled — dashboard is the UI |
| Global shortcuts | In-page keyboard shortcuts |
| System tray | Status bar in dashboard header |
| Native file dialogs | `<input type="file">` |
| Screen capture | Browser Screen Capture API (with permission) or disabled |
| Always-on-top | Regular browser window |

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

**Goal:** Voice Mirror on your phone — talk to your AI from anywhere.

### Architecture
The mobile app is a **thin client** that connects to the Voice Mirror server running on your desktop/server. It doesn't run Rust voice processing locally — it streams everything.

```
Phone (client)                    Desktop/Server (backend)
┌─────────────┐     WebSocket     ┌──────────────────────┐
│ Voice Mirror │ ←──────────────→ │ Voice Mirror Server  │
│ Mobile App   │                  │  ├── Rust voice       │
│              │                  │  ├── AI providers     │
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
- Push notifications for AI responses **and n8n reminders** (Phase 1.6 webhook triggers push)
- MediaRecorder API for voice input (record on phone, stream to server)
- Audio playback for TTS responses streamed from server
- Voice-driven reminders: "Remind me at 3pm to call mom" → server creates n8n workflow → push notification at 3pm

This tests the full mobile experience with zero native code.

### 4B: Native Mobile App
If PWA limitations become blockers (background audio, always-on mic, Siri/Google Assistant integration):

- **Tauri Mobile** (iOS/Android) — share the Rust backend directly
- Native audio pipeline for better mic/speaker control
- Background voice processing
- Widgets (iOS/Android) for quick voice activation
- Platform-specific wake word detection (on-device)

Note: Tauri 2 has experimental mobile support. If it matures, the same Rust backend could power both desktop and mobile apps, with platform-specific Svelte frontends.

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
Tauri migration      — Complete rewrite from Electron to Tauri 2. In progress on tauri-migration branch.
Phase 1 (TUI)            — Shipped in Electron era (v0.8.6). Superseded by Svelte chat UI.
Phase 1.5 (Wake word)    — Brand identity. Can develop in parallel with anything.
Phase 1.6 (n8n embed)    — Voice-driven automation. High user value.
Phase 2 (Server mode)    — Foundation for cross-platform. Easier with Tauri (shared Rust backend).
Phase 3A (LAN access)    — Quick win once Phase 2 is done.
Phase 4A (PWA)           — Mobile access with minimal new code.
Phase 3B-C (Remote/Auth) — When users want internet access.
Phase 4B (Native app)    — Tauri Mobile or PWA, depending on maturity.
Phase 5 (Cloud)          — If there's demand for hosted Voice Mirror.
```

Phase 1.5 (wake word) and Phase 1.6 (n8n) are both independent — they can be developed in parallel with each other and with Phase 2. Phase 1.6 is particularly high-value because it turns Voice Mirror from a conversation tool into a **voice-driven automation and scheduling platform**: users say what they want built, and the AI creates n8n workflows that connect to real services (Gmail, Slack, GitHub, etc.). The webhook listener means n8n can call back into Voice Mirror to speak reminders, alerts, and summaries — making it a true personal assistant with memory and initiative. Combined with Phase 4 (mobile), users can set reminders from their phone and hear them spoken aloud at home.

---

## Non-Goals

- **Run a Node.js runtime** — the Tauri app is pure Rust backend + Svelte frontend. No Node.js at runtime (the Electron architecture is fully retired).
- **Run voice processing on mobile** — the phone is a thin client. STT/TTS processing stays on the server.
- **Build a general-purpose web framework** — the server is purpose-built for Voice Mirror, not a generic platform.
- **Support the Electron codebase** — the `electron/` directory is kept for reference during migration but is no longer the active codebase. `tauri/` is the source of truth.
