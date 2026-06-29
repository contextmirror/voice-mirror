# Voice Mirror — Configuration

## Config File Locations

Config is stored in platform-appropriate locations:

| Platform | Config Path |
|----------|-------------|
| Linux | `~/.config/voice-mirror/config.json` |
| macOS | `~/Library/Application Support/voice-mirror/config.json` |
| Windows | `%APPDATA%\voice-mirror\config.json` |

---

## Config Schema

```javascript
{
    wakeWord: {
        enabled: true,
        phrase: "hey_claude",      // NOTE: phrase detection is not yet implemented --
        sensitivity: 0.5           // wakeWord mode currently runs always-on VAD recording
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
        sttModel: "whisper-local",    // Legacy alias for sttAdapter (frontend only)
        sttModelSize: "base",      // Whisper model size: "tiny", "base" (default), "small", "large-v3", "large-v3-turbo"
        sttUseGpu: false,          // Use CUDA GPU acceleration for Whisper (requires `cuda` build feature)
        sttApiKey: null,           // API key for cloud STT
        sttEndpoint: null,         // Custom STT endpoint URL
        sttModelName: null,        // Specific model name (e.g. "large-v3")
        inputDevice: null,         // Audio input device name (null = system default)
        outputDevice: null,        // Audio output device name (null = system default)
        announceStartup: true,     // Speak greeting on startup
        announceProviderSwitch: true, // Speak notification on provider switch
        dictionary: []             // Custom dictation word replacements / spellings
    },
    appearance: {
        orbSize: 80,               // 32 - 256
        theme: "colorblind",       // See theme list below
        panelWidth: 500,           // 200 - 4000
        panelHeight: 700,          // 200 - 4000
        colors: null,              // null = use preset from theme, object = custom overrides (see below)
        fonts: null,               // null = use preset defaults, object = { fontFamily, fontMono }
        messageCard: {             // Chat avatar config (default object, not null)
            aiAvatar: "cube",
            userAvatar: "person",
            customAvatars: null
        },
        orb: null                  // null = use defaults, object = { preset, overrides, customPresets }
    },
    behavior: {
        startMinimized: false,
        startWithSystem: false,
        hotkey: "CommandOrControl+Shift+V",    // Toggle panel hotkey
        statsHotkey: "CommandOrControl+Shift+M", // Toggle performance stats bar
        activationMode: "wakeWord",  // "wakeWord", "pushToTalk", "toggle"
        pttKey: "MouseButton4",      // Push-to-talk key: MouseButton4, MouseButton5, or keyboard keys
        dictationKey: "MouseButton5", // Dictation key: hold to record, release to type into focused window
        showToasts: true             // Show toast notifications
    },
    window: {
        orbX: null,                // Orb mode position (null = default)
        orbY: null,
        dashboardX: null,          // Dashboard mode position (null = default)
        dashboardY: null,
        expanded: true,            // true = dashboard mode, false = orb mode
        maximized: false           // Whether the window was maximized when last closed
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
    editor: {
        markdownPreview: true,     // Show markdown preview in Lens editor
        formatOnSave: false,       // Run formatter on save
        fontSize: 14,              // Editor font size (px)
        indentGuides: true         // Show indent guide lines
    },
    devicePreview: {
        customDevices: [],         // User-defined device frames for preview
        lastDevices: [],           // Recently used device frames
        syncEnabled: true,         // Sync scroll/interaction across previews
        orientation: "portrait"    // "portrait" | "landscape"
    },
    browser: {
        downloadAskLocation: false, // Prompt for download location each time
        downloadPath: ""            // Default download directory ("" = OS default)
    },
    lspServers: {},                // Per-language LSP server overrides (keyed by language)
    workspace: {
        showChat: false,           // Show chat panel in lens workspace
        showTerminal: false,       // Show terminal panel in lens workspace
        chatRatio: 0.3,            // Chat panel ratio (0.0 - 1.0)
        terminalRatio: 0.7         // Terminal panel ratio (0.0 - 1.0)
    },
    projects: {
        entries: [],               // Array of { path, name, color } project entries
        activeIndex: 0             // Index of the active project
    },
    user: {
        name: null                 // User's preferred name (null = ask on first launch)
    },
    system: {
        acceptedDisclaimer: false, // Set true after user accepts first-launch disclaimer
        firstLaunchDone: false,    // Set true after first-ever launch greeting
        onboardingCompleted: false, // Set true after the welcome wizard completes
        lastGreetingPeriod: null,  // e.g. "morning-2026-01-29" to avoid repeat greetings
        lastSeenVersion: null      // Tracks app version for "What's New" after updates
    },
    ai: {
        provider: "claude",        // "claude", "opencode", "ollama", "lmstudio", "jan", "dictation"
        autoStart: false,          // Auto-start AI provider on app launch
        autoVoiceLoop: true,       // Auto-inject the voice-loop command on provider startup
        model: null,               // Specific model ID or null (auto-detected for local providers)
        contextLength: 32768,      // Context window size for local models (tokens, 1024 - 1048576)
        autoDetect: true,          // Auto-detect local LLM servers on startup
        systemPrompt: null,        // Custom system prompt / persona (optional)
        toolProfile: "voice-assistant",  // Active tool profile name (CLI agent providers only)
        toolProfiles: {            // Saved tool profiles (which MCP groups to pre-load)
            "voice-assistant":      { groups: ["core", "memory", "browser"] },
            "full-toolbox":         { groups: ["core", "memory", "browser", "n8n"] }
        },
        endpoints: {
            ollama: "http://127.0.0.1:11434",
            lmstudio: "http://127.0.0.1:1234",
            jan: "http://127.0.0.1:1337"
        },
        apiKeys: {                 // API keys for cloud providers (AES-256-GCM encrypted at rest; auto-detected from env on startup)
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
| **AI Provider** | Provider selector (claude, opencode, ollama, lmstudio, jan, dictation), model selector, endpoint/API key, auto-start |
| **Activation Mode** | Wake Word, Push to Talk, Toggle |
| **Keyboard Shortcuts** | Toggle Panel hotkey, Toggle Stats hotkey, PTT key, Dictation key (supports mouse buttons) |
| **Wake Word** | Phrase selection, sensitivity slider |
| **Voice** | TTS adapter, voice, speed, volume, model size (Qwen), STT adapter, STT model size |
| **Audio Devices** | Input/output device selection |
| **Appearance** | Theme presets, color overrides, font selection, custom fonts, orb size/presets, message card avatars |
| **Behavior** | Start minimized, start with system, show toasts |
| **Tool Profiles** | MCP tool group presets (CLI agent providers only) |

---

## Supported AI Providers

| Provider | `ai.provider` value | Type | Auth | Features |
|----------|---------------------|------|------|----------|
| **Claude Code** | `claude` | CLI agent (PTY) | CLI | MCP tools, vision, full terminal |
| **OpenCode** | `opencode` | CLI agent (PTY) | CLI | Alternative CLI agent, MCP tools |
| **Ollama** | `ollama` | Local HTTP | None | Auto-detect, vision |
| **LM Studio** | `lmstudio` | Local HTTP | None | Auto-detect |
| **Jan** | `jan` | Local HTTP | None | Auto-detect |
| **Dictation Only** | `dictation` | Voice input | None | Speech-to-text only, no AI; types into the focused window |

Select the active provider by **right-clicking the "Voice Agent" tab** (or in Settings > AI Provider). Provider metadata lives in `src/lib/providers.js` (`CLI_PROVIDERS`, `LOCAL_PROVIDERS`).

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
| `vim` | Vim | Gruvbox-inspired warm dark theme, orange accent |
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

### Orb Configuration (`appearance.orb`)

When non-null, customizes the orb visual style:

| Key | Type | Description |
|-----|------|-------------|
| `preset` | string | Built-in orb style name (default: `"classic"`) |
| `overrides` | object | Per-field tweaks after picking a preset |
| `customPresets` | array | User-imported orb styles |

### Message Card Configuration (`appearance.messageCard`)

When non-null, customizes chat message avatars:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `aiAvatar` | string | `"cube"` | AI avatar preset name |
| `userAvatar` | string | `"person"` | User avatar preset name |
| `customAvatars` | object | `null` | Custom avatar overrides |

---

## Keyboard Shortcuts

| Shortcut | Config Key | Action |
|----------|-----------|--------|
| `Ctrl+Shift+V` (default) | `behavior.hotkey` | Toggle expand/collapse panel |
| `Ctrl+Shift+M` (default) | `behavior.statsHotkey` | Toggle performance stats bar |
| `MouseButton4` (default) | `behavior.pttKey` | Push-to-talk (hold to record) |
| `MouseButton5` (default) | `behavior.dictationKey` | Dictation (hold to record, release to type into focused window) |
| Drag orb | -- | Move orb position |

The toggle panel and toggle stats shortcuts are registered as global hotkeys via Tauri's global shortcut plugin. All keyboard shortcuts are configurable through the Settings UI using a keybind recorder.

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
| `large-v3` | Highest accuracy; practical with CUDA GPU (`sttUseGpu: true`) |
| `large-v3-turbo` | Near-large accuracy, faster; quantized GGML |

GGML model files auto-download from HuggingFace on first use. Setting `sttUseGpu: true` runs Whisper on an NVIDIA GPU via CUDA (requires the `cuda` build feature, enabled by default), falling back to CPU when no GPU is present.

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
| **voice-assistant** | core, memory, browser | General voice assistant (default) |
| **full-toolbox** | core, memory, browser, n8n | Everything enabled (adds n8n workflow tools) |

These two profiles ship by default. The available MCP tool groups are `core`, `memory`, `browser`, `capture`, and `n8n`. Custom profiles can be created through the Settings UI.

---

## Multi-Project Support

Voice Mirror supports multiple projects via the `projects` config section. Each project entry has:

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Absolute path to the project root |
| `name` | string | Display name |
| `color` | string | Color tag for the project strip |

The `activeIndex` field tracks which project is currently selected. Projects are managed through the sidebar's project strip.

---

## Data Storage

All runtime data stored in the app config directory (e.g., `%APPDATA%/voice-mirror/` on Windows):

| Path | Purpose |
|------|---------|
| `config.json` | Main configuration (API keys stored as `ENC:<base64>`, AES-256-GCM encrypted) |
| `config.json.bak` | Automatic backup of previous config |
| `.vault_key` | AES-256 key for API-key/secret encryption (DPAPI-protected on Windows) |
| `data/inbox.json` | Message queue (max 100 messages) |
| `data/status.json` | Instance presence tracking |
| `data/listener_lock.json` | Exclusive listener mutex |
| `data/images/` | Screenshot storage (keeps last 5) |
| `data/voices/` | Cloned voice metadata |
| `memory/MEMORY.md` | Main memory file (source of truth) |
| `memory/daily/` | Auto-logged conversations by date |
| `memory/index.db` | SQLite with FTS5 + embeddings |

---

## Logging

The Rust backend uses the `tracing` crate for structured logging. The MCP binary logs to stderr (stdout is reserved for JSON-RPC). The frontend uses `console.*`.

---

## Config Persistence

Configuration uses atomic writes with automatic backup:

1. Changes are written to `config.json.tmp`
2. The existing `config.json` is backed up to `config.json.bak`
3. The temp file is renamed to `config.json` (atomic on all platforms)
4. On load, if `config.json` is corrupt, falls back to `config.json.bak`
5. If both are corrupt or missing, defaults are used

### Secret Encryption

API keys (`ai.apiKeys.*`, `voice.ttsApiKey`, `voice.sttApiKey`) are encrypted at rest with **AES-256-GCM** before being written to `config.json`, using a key stored in `.vault_key` (DPAPI-protected on Windows). Encrypted values carry an `ENC:` prefix. When the config is read back through `get_config`, keys are returned **masked** (e.g. `sk-ant-•••••c123`); the Settings UI fetches the plaintext for editing via the separate `get_api_key` command.
