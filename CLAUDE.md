# Voice Mirror Electron

**Voice-controlled AI agent overlay for your entire computer.**

## The Vision

Voice Mirror as a floating overlay that gives you Claude Code's power anywhere on your desktop - not locked to an IDE.

```
Claude Code = Terminal + MCP Tools
Voice Mirror = Eyes + Ears + Voice
Combined = Full AI agent for your entire computer
```

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
4. MCP tool ecosystem (n8n, smart home, web, git, etc.)
5. Screen awareness (vision API via desktopCapturer)
6. Cross-platform (Linux first, then Windows/Mac)

## UX States

### State 1: Idle (Floating Orb)
```
                                        ◉ ← 60px draggable orb
                                          (purple gradient, pulses when listening)
```
- Small floating orb
- Draggable anywhere on screen
- Subtle pulse animation when wake word active
- Click to expand or say "Hey Claude"

### State 2: Expanded (Chat Panel)
```
                             ┌────────────────────┐
                             │ ◉ Voice Mirror     │
                             ├────────────────────┤
                             │ You: What's this   │
                             │      error?        │
                             │                    │
                             │ Claude: That's a   │
                             │ null pointer in... │
                             │                    │
                             │ You: Fix it        │
                             │                    │
                             │ Claude: Done. I    │
                             │ added a null check │
                             ├────────────────────┤
                             │ 🎤 Listening...    │
                             └────────────────────┘
```
- 400x500 panel with chat history
- Glass morphism design (dark, blurred)
- Click mini-orb or outside to minimize
- Scrollable conversation

### State 3: System Tray (Hidden)
```
Taskbar                              🔊 📶 ◉ 🕐
```
- Right-click for menu
- Wake word still active
- Click to restore floating orb

### Orb Visual States

| State | Color | Animation |
|-------|-------|-----------|
| Idle/Listening | Purple gradient | Gentle pulse |
| Recording | Pink/Red gradient | Fast pulse |
| Speaking | Blue/Cyan gradient | Wave effect |
| Thinking | Purple | Spin animation |

## Architecture

```
┌─────────────────────────────────────────────────┐
│              ELECTRON OVERLAY                    │
│  (transparent, always-on-top, frameless)        │
├─────────────────────────────────────────────────┤
│  • Orb component (draggable, click-to-expand)   │
│  • Chat panel (conversation history)            │
│  • Screen capture (desktopCapturer)             │
│  • System tray integration                      │
│  • IPC bridge to Python                         │
├──────────────────────┬──────────────────────────┤
│  IPC / WebSocket     │                          │
├──────────────────────▼──────────────────────────┤
│  PYTHON VOICE MIRROR (existing)                 │
│  • Wake word detection (OpenWakeWord)           │
│  • STT (Parakeet/Whisper)                       │
│  • TTS (Kokoro)                                 │
│  • Qwen/Claude routing                          │
│  • MCP tool dispatch                            │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
Voice Mirror Electron/
├── electron/
│   ├── main.js              # Window management, tray, IPC
│   ├── preload.js           # Bridge to renderer
│   ├── config.js            # Cross-platform config management
│   └── overlay.html         # Transparent window UI
├── assets/
│   └── tray-icon.png        # System tray icon
├── python/                  # Symlink or copy of Voice Mirror
│   ├── voice_agent.py
│   ├── qwen_handler.py
│   └── ...
├── launch.sh                # Linux/macOS launcher
├── launch.bat               # Windows launcher
├── package.json
└── CLAUDE.md                # This file
```

## Key Technical Details

### Transparent Overlay Window
```javascript
mainWindow = new BrowserWindow({
    transparent: true,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,  // When floating
    hasShadow: false
});
```

### Screen Capture for Vision
```javascript
const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
});
// Send to Claude's vision API
```

### IPC Bridge to Python
```javascript
// In main.js
const pythonProcess = spawn('python', ['voice_agent.py']);

pythonProcess.stdout.on('data', (data) => {
    // Forward voice events to renderer
    if (data.includes('Wake word detected')) {
        mainWindow.webContents.send('voice-event', { type: 'wake' });
    }
});
```

### Preload API
```javascript
// Exposed to renderer via contextBridge
window.voiceMirror = {
    toggleExpand: () => ipcRenderer.invoke('toggle-expand'),
    captureScreen: () => ipcRenderer.invoke('capture-screen'),
    onVoiceEvent: (callback) => ipcRenderer.on('voice-event', callback),
    config: {
        get: () => ipcRenderer.invoke('get-config'),
        set: (updates) => ipcRenderer.invoke('set-config', updates),
        reset: () => ipcRenderer.invoke('reset-config'),
        getPlatformInfo: () => ipcRenderer.invoke('get-platform-info')
    }
}
```

## Cross-Platform Configuration

Config is stored in platform-appropriate locations:

| Platform | Config Path |
|----------|-------------|
| Linux | `~/.config/voice-mirror-electron/config.json` |
| macOS | `~/Library/Application Support/voice-mirror-electron/config.json` |
| Windows | `%APPDATA%\voice-mirror-electron\config.json` |

### Config Schema
```javascript
{
    wakeWord: { enabled, phrase, sensitivity },
    voice: { ttsVoice, ttsSpeed, sttModel },
    appearance: { orbSize, theme, panelWidth, panelHeight },
    behavior: { startMinimized, startWithSystem, clickToTalk, hotkey },
    window: { orbX, orbY },  // Remembered position
    advanced: { pythonPath, debugMode }
}
```

### Python Virtual Environment Detection
Automatically detects the correct Python path per platform:
- **Linux/macOS:** `.venv/bin/python`
- **Windows:** `.venv\Scripts\python.exe`

## Settings (Future)

```
┌─────────────────────────────────────────┐
│ ⚙️ Voice Mirror Settings               │
├─────────────────────────────────────────┤
│ Wake Word                               │
│ ○ "Hey Claude" (default)                │
│ ○ "Hey Jarvis"                          │
│ ○ "Computer"                            │
│ ○ Custom: [____________]                │
│                                         │
│ Activation                              │
│ ☑ Wake word detection                   │
│ ☑ Click orb to talk                     │
│ ☑ Hotkey: [Ctrl+Shift+V]               │
│ ☐ Always listening (Call mode)          │
│                                         │
│ Voice                                   │
│ TTS Voice: [af_bella ▼]                 │
│ Speed: [1.0x ▼]                         │
│                                         │
│ Appearance                              │
│ Orb size: [60px ▼]                      │
│ Theme: [Dark ▼]                         │
└─────────────────────────────────────────┘
```

## Use Cases

### Developer
- "Hey Claude, what's this error on my screen?" → *captures screen, analyzes*
- "Fix it" → *spawns terminal in background, runs commands*
- "Run the tests" → *executes, reports results via voice*

### General Desktop
- "What app is using all my memory?" → *checks htop, reports*
- "Email that screenshot to John" → *captures, sends via n8n*
- "Search for flights to Paris" → *web search, summarizes results*

### Gaming
- "I'm stuck on this level" → *sees game, searches wiki, tells you*
- "What's the best build?" → *context-aware advice from screen*

### Smart Home
- "Turn off the lights" → *smart home control*
- "Is the PlayStation on?" → *device status check*

## Development

### Running
```bash
# Install dependencies
npm install

# Start Electron (dev mode)
npm run dev

# Build AppImage
npm run build
```

### Python Backend
The Python Voice Mirror runs as a child process. Make sure:
1. Python venv is set up in `python/` folder
2. All dependencies installed (see Voice Mirror requirements.txt)
3. Models downloaded (kokoro, hey_claude_v2.onnx)

## Integration with Claude Code

Voice Mirror Electron can spawn Claude Code CLI in a hidden terminal:
- User speaks → transcribed → sent to Claude Code
- Claude responds → piped to TTS → spoken
- Same subscription, no extra API cost (output is just rendered differently)

The key insight: **Rendering my output in Electron instead of a terminal doesn't cost extra tokens.**

## Compaction Handling

When Claude's context compacts:
1. PreCompact hook writes to MCP inbox
2. Voice Mirror detects notification
3. Speaks "One moment, reorganizing..."
4. Waits for Claude to resume
5. Continues conversation seamlessly

## No Extra API Cost

**Q: Does piping Claude's output to a nicer UI cost double?**

**A: No.** The tokens are spent when Claude generates the response. Displaying that response in Electron instead of a terminal is just rendering - no extra API calls involved.

```
Claude generates response → tokens used once
                ↓
Electron renders it nicely → FREE (just display)
                ↓
Kokoro speaks it → FREE (local TTS)
```

This is exactly how Context Mirror's chat sidebar works - it displays Claude's output without using extra tokens.

## Roadmap

### Phase 1: Basic Overlay ✅
- [x] Transparent Electron window
- [x] Floating orb with states
- [x] Expandable chat panel
- [x] Basic styling
- [x] Cross-platform config system
- [x] Platform-aware Python venv detection
- [x] Windows/macOS/Linux launch scripts

### Phase 2: Python Integration
- [ ] Spawn Python Voice Mirror as child process
- [ ] IPC bridge for voice events
- [ ] Forward transcriptions/responses to UI

### Phase 3: Screen Capture
- [ ] desktopCapturer integration
- [ ] Send screenshots to Claude vision API
- [ ] "What's on my screen?" commands

### Phase 4: Polish
- [x] System tray with menu
- [ ] Settings panel UI
- [ ] Custom wake words
- [ ] Hotkey activation
- [x] Drag-to-position with memory (config.window.orbX/orbY)

### Phase 5: Distribution
- [ ] AppImage for Linux
- [ ] DMG for Mac
- [ ] NSIS for Windows
- [ ] Auto-updates

## Cross-Platform Status

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Primary dev | X11/Wayland tested, AppImage target |
| Windows | Ready | Python venv detection, launch.bat, NSIS target |
| macOS | Ready | Python venv detection, DMG target |

**Note:** Primary development is on Linux, but the codebase is cross-platform ready. Config paths, Python detection, and launch scripts all handle platform differences automatically.

## Python Voice Mirror (Backend)

The Electron app wraps the existing Python Voice Mirror:

### Components
| Component | Purpose |
|-----------|---------|
| OpenWakeWord | "Hey Claude" detection |
| Parakeet STT | Speech-to-text |
| Kokoro TTS | Text-to-speech |
| Qwen Handler | Local LLM routing |
| MCP Inbox | Claude Code communication |

### Tools Available
- **Smart Home**: wake_device, tv_control, device status
- **Web Search**: SearXNG with voice summaries
- **Gmail**: check, read, archive, delete, send
- **n8n**: workflow automation
- **Weather**: Open-Meteo forecasts
- **GitHub CI**: build status

See the main Voice Mirror CLAUDE.md for full documentation.

---

*Created: January 2026*
*Author: Nathan + Claude*
