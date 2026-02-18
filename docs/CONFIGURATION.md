# Voice Mirror Electron - Configuration

## Config File Locations

Config is stored in platform-appropriate locations:

| Platform | Config Path |
|----------|-------------|
| Linux | `~/.config/voice-mirror-electron/config.json` |
| macOS | `~/Library/Application Support/voice-mirror-electron/config.json` |
| Windows | `%APPDATA%\voice-mirror-electron\config.json` |

---

## Config Schema

```javascript
{
    wakeWord: {
        enabled: true,
        phrase: "hey_claude",      // Currently only hey_claude supported
        sensitivity: 0.5           // 0.1 - 0.9 (0.98 threshold internally)
    },
    voice: {
        ttsAdapter: "kokoro",      // "kokoro", "qwen", "piper", "edge", "openai-tts", "elevenlabs", "custom-api"
        ttsVoice: "af_bella",      // Voice ID (adapter-dependent, see voice list below)
        ttsModelSize: "0.6B",      // Qwen3-TTS model: "0.6B" (faster) or "1.7B" (better quality)
        ttsSpeed: 1.0,             // 0.5 - 2.0
        ttsVolume: 1.0,            // Volume multiplier (0.1 - 2.0, 1.0 = 100%)
        ttsApiKey: null,           // API key for cloud TTS adapters
        ttsEndpoint: null,         // Custom endpoint URL for cloud/custom TTS
        ttsModelPath: null,        // Local model file path (Piper)
        sttAdapter: "whisper-local",  // "whisper-local", "openai-whisper-api", "custom-api-stt"
        sttModel: "whisper-local",    // Legacy alias for sttAdapter
        sttModelSize: "base",      // Whisper model size: "tiny", "base" (recommended), "small"
        sttApiKey: null,           // API key for cloud STT
        sttEndpoint: null,         // Custom STT endpoint URL
        sttModelName: null,        // Specific model name (e.g. "large-v3")
        inputDevice: null,         // Audio input device name (null = system default)
        outputDevice: null         // Audio output device name (null = system default)
    },
    appearance: {
        orbSize: 64,               // 32 - 256
        theme: "colorblind",       // See theme list below
        panelWidth: 500,           // 200 - 4000
        panelHeight: 700,          // 200 - 4000
        colors: null,              // null = use preset from theme, object = custom overrides (see below)
        fonts: null,               // null = use preset defaults, object = { fontFamily, fontMono }
        customThemes: [],          // Array of persisted imported themes (see theme system below)
        messageCard: null          // null = use theme defaults, object = message card overrides (see below)
    },
    behavior: {
        startMinimized: false,
        startWithSystem: false,
        hotkey: "CommandOrControl+Shift+V",    // Toggle panel hotkey
        statsHotkey: "CommandOrControl+Shift+M", // Toggle performance stats bar
        activationMode: "wakeWord",  // "wakeWord", "pushToTalk"
        pttKey: "MouseButton4",      // Push-to-talk key: MouseButton4, MouseButton5, or keyboard keys
        dictationKey: "MouseButton5" // Dictation key: hold to record, release to type into focused window
    },
    window: {
        orbX: null,                // Remembered position (null = default bottom-right)
        orbY: null,
        expanded: false            // Whether the dashboard was open when the app last closed
    },
    overlay: {
        outputName: null           // Wayland output/monitor name (null = primary)
    },
    advanced: {
        debugMode: false,
        showDependencies: false    // Hidden flag -- enables Dependencies settings tab
    },
    sidebar: {
        collapsed: false           // Sidebar collapsed state
    },
    user: {
        name: null                 // User's preferred name (null = ask on first launch)
    },
    system: {
        acceptedDisclaimer: false, // Set true after user accepts first-launch disclaimer
        firstLaunchDone: false,    // Set true after first-ever launch greeting
        lastGreetingPeriod: null,  // e.g. "morning-2026-01-29" to avoid repeat greetings
        lastSeenVersion: null      // Tracks app version for "What's New" after updates
    },
    ai: {
        provider: "claude",        // "claude", "opencode", "ollama", "lmstudio", "jan"
        model: null,               // Specific model ID or null (auto-detected for local providers)
        autoDetect: true,          // Auto-detect local LLM servers on startup
        contextLength: 32768,      // Context window size for local models (tokens, 1024 - 1048576)
        systemPrompt: null,        // Custom system prompt / persona (optional)
        toolProfile: "voice-assistant",  // Active tool profile name (Claude Code only)
        toolProfiles: {            // Saved tool profiles (which MCP groups to pre-load)
            "voice-assistant":      { groups: ["core", "meta", "screen", "memory", "browser"] },
            "voice-assistant-lite": { groups: ["core", "meta", "screen", "memory-facade", "browser-facade"] },
            "n8n-workflows":        { groups: ["core", "meta", "n8n"] },
            "web-browser":          { groups: ["core", "meta", "screen", "browser"] },
            "full-toolbox":         { groups: ["core", "meta", "screen", "memory", "voice-clone", "browser", "n8n"] },
            "minimal":              { groups: ["core", "meta"] }
        },
        endpoints: {
            ollama: "http://127.0.0.1:11434",
            lmstudio: "http://127.0.0.1:1234",
            jan: "http://127.0.0.1:1337"
        },
        apiKeys: {                 // API keys for cloud providers (stored locally, auto-detected from env on startup)
            openai: null,
            anthropic: null,
            gemini: null,
            grok: null,
            groq: null,
            mistral: null,
            openrouter: null,
            deepseek: null,
            kimi: null
        }
    }
}
```

---

## Settings UI

Settings is a full page accessible via the sidebar.

| Section | Options |
|---------|---------|
| **AI Provider** | Provider selector (claude, opencode, ollama, lmstudio, jan), model selector, endpoint/API key |
| **Activation Mode** | Wake Word, Push to Talk |
| **Keyboard Shortcuts** | Toggle Panel hotkey, Toggle Stats hotkey, PTT key, Dictation key (supports mouse buttons) |
| **Wake Word** | Phrase selection, sensitivity slider |
| **Voice** | TTS adapter, voice, speed, volume, model size (Qwen), STT adapter, STT model size |
| **Audio Devices** | Input/output device selection |
| **Appearance** | Theme presets, color overrides, font selection, custom fonts, orb size, message card customization |
| **Behavior** | Start minimized, start with system |
| **Tool Profiles** | MCP tool group presets (CLI agent providers only) |

---

## Supported AI Providers

| Provider | Type | Auth | Features |
|----------|------|------|----------|
| **Claude Code** | CLI agent (PTY) | CLI | MCP tools, vision, full terminal |
| **OpenCode** | CLI agent (PTY) | CLI | Alternative CLI agent |
| **Ollama** | Local HTTP | None | Auto-detect, vision |
| **LM Studio** | Local HTTP | None | Auto-detect |
| **Jan** | Local HTTP | None | Auto-detect |

The validator restricts `ai.provider` to: `claude`, `opencode`, `ollama`, `lmstudio`, `jan`.

CLI agent providers (claude, opencode) use PTY mode with full terminal rendering via ghostty-web. Local providers use the OpenAI-compatible `/v1/chat/completions` HTTP API.

---

## Theme System

### Built-in Theme Presets

The default theme is `"colorblind"`. Available built-in themes:

| Theme Key | Display Name | Description |
|-----------|-------------|-------------|
| `colorblind` | Colorblind | Default. Accessible color palette (Okabe-Ito inspired), blue accent |
| `midnight` | Midnight | Deep blue-black, blue accent |
| `emerald` | Emerald | Dark green tones, green accent |
| `rose` | Rose | Dark pink tones, pink accent |
| `slate` | Slate | Neutral dark gray, indigo accent |
| `black` | Black | Pure black background, monochrome accent |
| `gray` | Claude Gray | Warm dark gray, orange accent |
| `light` | Light | Light background, indigo accent |

Validator also accepts `"custom"` and any key prefixed with `"custom-"` for user-imported themes.

### Color Overrides (`appearance.colors`)

When non-null, provides custom hex color overrides. All 10 keys are required when customizing:

| Key | Purpose | Example |
|-----|---------|---------|
| `bg` | Main background | `"#0c0d10"` |
| `bgElevated` | Elevated surface (cards, menus) | `"#14161c"` |
| `text` | Primary text | `"#e4e4e7"` |
| `textStrong` | Emphasized text | `"#fafafa"` |
| `muted` | Secondary/muted text | `"#71717a"` |
| `accent` | Accent color (buttons, links) | `"#56b4e9"` |
| `ok` | Success indicator | `"#0072b2"` |
| `warn` | Warning indicator | `"#e69f00"` |
| `danger` | Error/danger indicator | `"#d55e00"` |
| `orbCore` | Orb center color | `"#1b2e4e"` |

All values must be hex format `#RRGGBB`.

### Font Overrides (`appearance.fonts`)

| Key | Purpose | Default |
|-----|---------|---------|
| `fontFamily` | UI font stack | `"'Segoe UI', system-ui, -apple-system, sans-serif"` |
| `fontMono` | Monospace font stack | `"'Cascadia Code', 'Fira Code', monospace"` |

Custom fonts can be uploaded through the Appearance settings tab and are injected as `@font-face` rules.

### Custom Themes (`appearance.customThemes`)

An array of persisted imported themes. Each entry has:

```javascript
{
    key: "custom-1234567890",   // Unique key (custom- prefix + timestamp)
    name: "My Theme",          // Display name
    colors: { bg: "#...", ... }, // Full 10-key color object
    fonts: { fontFamily: "...", fontMono: "..." }
}
```

Themes can be imported/exported as JSON files via the Appearance settings tab.

### Message Card Overrides (`appearance.messageCard`)

Fine-grained control over chat message bubbles. When non-null:

| Key | Type | Range/Values | Default |
|-----|------|-------------|---------|
| `fontSize` | string | `"10px"` - `"24px"` | `"14px"` |
| `lineHeight` | number | 1.0 - 2.5 | 1.5 |
| `padding` | string | CSS padding value | `"12px 16px"` |
| `avatarSize` | integer | 20 - 64 | 36 |
| `showAvatars` | boolean | true/false | true |
| `bubbleStyle` | string | `"rounded"`, `"square"`, `"pill"` | `"rounded"` |
| `userColor` | string | Hex color | `"#667eea"` |
| `aiColor` | string | Hex color | `"#111318"` |
| `userBg` | string | CSS gradient | (derived from userColor) |
| `userBorder` | string | CSS color | (derived from userColor) |
| `userRadius` | string | CSS border-radius | (derived from bubbleStyle) |
| `aiBg` | string | CSS gradient | (derived from aiColor) |
| `aiBorder` | string | CSS color | (derived from aiColor) |
| `aiRadius` | string | CSS border-radius | (derived from bubbleStyle) |

---

## Keyboard Shortcuts

| Shortcut | Config Key | Action |
|----------|-----------|--------|
| `Ctrl+Shift+V` (default) | `behavior.hotkey` | Toggle expand/collapse panel |
| `Ctrl+Shift+M` (default) | `behavior.statsHotkey` | Toggle performance stats bar |
| `MouseButton4` (default) | `behavior.pttKey` | Push-to-talk (hold to record) |
| `MouseButton5` (default) | `behavior.dictationKey` | Dictation (hold to record, release to type into focused window) |
| Drag orb | -- | Move orb position |

The toggle panel and toggle stats shortcuts are registered as global hotkeys via Electron's `globalShortcut` API, with automatic health-checked re-registration after sleep/unlock. A DOM `keydown` fallback for `Ctrl+Shift+V` fires when the Electron window has focus but global registration has failed.

All keyboard shortcuts are configurable through the Settings UI using a keybind recorder.

---

## Voice Settings

### TTS Adapters

| Adapter | Description |
|---------|-------------|
| `kokoro` | Fast local TTS (default) |
| `qwen` | Qwen3-TTS with voice cloning support |
| `piper` | Piper local TTS (requires model file path) |
| `edge` | Microsoft Edge TTS |
| `openai-tts` | OpenAI TTS API (requires API key) |
| `elevenlabs` | ElevenLabs TTS (requires API key) |
| `custom-api` | Custom TTS endpoint |

### Qwen3-TTS Model Sizes

| Size | Description |
|------|-------------|
| `0.6B` | Faster inference, lower quality (default) |
| `1.7B` | Better quality, slower inference |

### STT Adapters

| Adapter | Description |
|---------|-------------|
| `whisper-local` | Rust-native Whisper (default) |
| `openai-whisper-api` | OpenAI Whisper API (requires API key) |
| `custom-api-stt` | Custom STT endpoint |

### STT Model Sizes (Whisper)

| Size | Description |
|------|-------------|
| `tiny` | Fastest, lowest accuracy |
| `base` | Recommended balance (default) |
| `small` | Better accuracy, slower |

---

## Available Voices

### Kokoro TTS (Default)
| Voice ID | Description |
|----------|-------------|
| af_bella | American Female (default) |
| af_nicole | American Female |
| af_sarah | American Female |
| af_sky | American Female |
| am_adam | American Male |
| am_michael | American Male |
| bf_emma | British Female |
| bf_isabella | British Female |
| bm_george | British Male |
| bm_lewis | British Male |

### Qwen3-TTS (Voice Cloning)
| Voice ID | Description |
|----------|-------------|
| Vivian | Preset speaker |
| Serena | Preset speaker |
| Dylan | Preset speaker |
| Eric | Preset speaker |
| Ryan | Preset speaker |
| Aiden | Preset speaker |
| Ono_Anna | Preset speaker |
| Sohee | Preset speaker |
| Uncle_Fu | Preset speaker |
| custom | Your cloned voice |

---

## Tool Profiles

Tool profiles control which MCP tool groups are pre-loaded when using a CLI agent provider. Profiles are stored in `ai.toolProfiles` and the active profile is set via `ai.toolProfile`.

| Profile | Groups | Use Case |
|---------|--------|----------|
| **voice-assistant** | core, meta, screen, memory, browser | General voice assistant (default) |
| **voice-assistant-lite** | core, meta, screen, memory-facade, browser-facade | Lighter footprint with facade tools |
| **n8n-workflows** | core, meta, n8n | Workflow automation focus |
| **web-browser** | core, meta, screen, browser | Web research focus |
| **full-toolbox** | core, meta, screen, memory, voice-clone, browser, n8n | Everything enabled |
| **minimal** | core, meta | Bare minimum tools |

Custom profiles can be created through the Settings UI.

---

## Data Storage

All runtime data stored in: `~/.config/voice-mirror-electron/`

| Path | Purpose |
|------|---------|
| `config.json` | Main configuration |
| `config.json.bak` | Automatic backup of previous config |
| `data/inbox.json` | Message queue (max 100 messages) |
| `data/status.json` | Instance presence tracking |
| `data/listener_lock.json` | Exclusive listener mutex |
| `data/vmr.log` | Combined Electron + voice-core logs |
| `data/images/` | Screenshot storage (keeps last 5) |
| `data/voices/` | Cloned voice metadata |
| `data/voice_settings.json` | Voice-specific settings |
| `memory/MEMORY.md` | Main memory file (source of truth) |
| `memory/daily/` | Auto-logged conversations by date |
| `memory/index.db` | SQLite with FTS5 + embeddings |

---

## Logging

Electron and voice-core write to a shared log file:

**Location:** `~/.config/voice-mirror-electron/data/vmr.log`

**Log format:**
- Timestamps in ISO format
- Level prefixes: `CONFIG`, `EVENT`, `VOICE`, `APP`, `HOTKEY`, `ERROR`
- Events from both Electron (main process) and voice-core (Rust binary)

The log file is truncated on Electron startup to keep it fresh each session.

**Monitor in real-time:**
```bash
tail -f ~/.config/voice-mirror-electron/data/vmr.log
```

---

## Config Persistence

Configuration uses atomic writes with automatic backup:

1. Changes are written to `config.json.tmp`
2. The existing `config.json` is backed up to `config.json.bak`
3. The temp file is renamed to `config.json` (atomic on all platforms)
4. On load, if `config.json` is corrupt, falls back to `config.json.bak`
5. If both are corrupt or missing, defaults are used

Both synchronous (`updateConfig`) and asynchronous (`updateConfigAsync`) update methods are available.
