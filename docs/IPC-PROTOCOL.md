# IPC Protocol Reference

Voice Mirror Electron uses Electron's IPC (Inter-Process Communication) system to
communicate between the renderer process (UI) and the main process (Node.js backend).
This document covers every channel, its parameters, return values, and the security
model that governs them.

---

## Table of Contents

1. [Overview](#overview)
2. [Security Model](#security-model)
3. [Channel Reference](#channel-reference)
   - [AI Provider Channels](#ai-provider-channels)
   - [Voice Backend Channels](#voice-backend-channels)
   - [Config Channels](#config-channels)
   - [Screen Capture Channels](#screen-capture-channels)
   - [Window Management Channels](#window-management-channels)
   - [Browser Channels](#browser-channels)
   - [Chat History Channels](#chat-history-channels)
   - [Misc Channels](#misc-channels)
4. [Event Channels](#event-channels)
5. [Fire-and-Forget Channels](#fire-and-forget-channels)
6. [Validation](#validation)
7. [File-Based IPC](#file-based-ipc)

---

## Overview

Voice Mirror uses a three-layer IPC architecture:

```
Renderer (UI)          Preload (bridge)           Main Process
-----------            ----------------           ------------
window.voiceMirror --> contextBridge API    -->    ipcMain.handle()
   JS calls            ipcRenderer.invoke()        handler functions
                       ipcRenderer.send()           ipcMain.on()
                       ipcRenderer.on()     <--    webContents.send()
```

**Request-response channels** use `ipcMain.handle` / `ipcRenderer.invoke`. The
renderer awaits a promise that resolves with the handler's return value. Every
handle-based channel returns an object with at least `{ success: boolean }`.

**Fire-and-forget channels** use `ipcMain.on` / `ipcRenderer.send`. No return value;
useful for high-frequency operations like window resize or logging.

**Event channels** use `webContents.send` from main to renderer. The preload script
wraps `ipcRenderer.on` into subscribe functions that return an unsubscribe callback.

All IPC handler registrations are organized into domain-specific modules under
`electron/ipc/`:

| Module      | File                      | Domain                        |
|-------------|---------------------------|-------------------------------|
| AI          | `electron/ipc/ai.js`      | AI provider lifecycle, PTY    |
| Voice       | `electron/ipc/voice.js`   | Voice backend (Rust process)  |
| Config      | `electron/ipc/config.js`  | Settings, themes, fonts       |
| Screen      | `electron/ipc/screen.js`  | Screen capture and vision     |
| Window      | `electron/ipc/window.js`  | Window position, drag, resize |
| Misc        | `electron/ipc/misc.js`    | CLI tools, chat history, app  |
| Validators  | `electron/ipc/validators.js` | Input validation schemas   |

Registration is centralized in `electron/ipc/index.js`, which calls each module's
`register*Handlers(ctx, validators)` function. The `ctx` object is the application
context containing references to all services, windows, and state.

---

## Security Model

### Context Isolation

Voice Mirror runs with `contextIsolation: true` and `nodeIntegration: false`. The
renderer process has no direct access to Node.js APIs. All communication goes through
the preload script's `contextBridge`.

### contextBridge API Surface

The preload script (`electron/preload.js`) exposes a single `window.voiceMirror`
object to the renderer. This object contains:

- Namespaced method groups: `config`, `claude`, `voice`, `ai`, `tools`, `chat`,
  `fonts`, `theme`, `overlay`, `browser`
- Top-level convenience methods: `toggleExpand`, `startAll`, `stopAll`, etc.
- Event subscription functions that return unsubscribe callbacks
- Clipboard access (read/write) via Electron's `clipboard` module

Every method in `window.voiceMirror` is a thin wrapper around `ipcRenderer.invoke()`
or `ipcRenderer.send()`. The preload script never passes raw IPC access to the
renderer.

### Input Validation

All channels that accept user-controlled data go through validators defined in
`electron/ipc/validators.js` before any logic executes. Validators sanitize objects
(strip functions), enforce type constraints, and clamp numeric values. See the
[Validation](#validation) section for details.

### URL Filtering

The `open-external` channel blocks dangerous URL schemes (`file:`, `chrome:`,
`javascript:`, `data:`, `vbscript:`) at both the preload boundary (regex check)
and the main process validator. Only `http://` and `https://` URLs are allowed.

### API Key Redaction

The `get-config` channel returns config with all API keys masked (e.g., `sk-...a1b2`).
The `set-config` channel strips redacted/masked key values from updates to prevent
the renderer from accidentally overwriting real keys with masked placeholders.

---

## Channel Reference

All handle-based channels return `{ success: boolean, ... }` unless otherwise noted.

### AI Provider Channels

Registered in `electron/ipc/ai.js`. Manage AI provider lifecycle, terminal I/O,
and provider selection. CLI_PROVIDERS (`claude`, `opencode`) use PTY mode; other
providers (Ollama, LM Studio, Jan) use an API-based TUI renderer.

#### `start-claude`

Start the active AI provider.

| | |
|---|---|
| **Preload** | `voiceMirror.claude.start(cols, rows)` |
| **Parameters** | `cols: number` -- terminal columns; `rows: number` -- terminal rows |
| **Returns** | `{ success: boolean, data?: { started: boolean } }` or `{ success: false, error: 'already running' }` |
| **Validated** | No (non-user-controlled integers) |

#### `stop-claude`

Stop the active AI provider.

| | |
|---|---|
| **Preload** | `voiceMirror.claude.stop()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` or `{ success: false, error: 'not running' }` |

#### `interrupt-ai`

Send an interrupt signal to the AI provider (Ctrl+C for PTY, abort for API).

| | |
|---|---|
| **Preload** | `voiceMirror.claude.interrupt()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` |

#### `get-claude-status`

Get the current AI provider status.

| | |
|---|---|
| **Preload** | `voiceMirror.claude.getStatus()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { running: boolean, mode: 'pty' \| 'api', provider: string } }` |

#### `claude-pty-input`

Send keyboard input to the AI provider's terminal.

| | |
|---|---|
| **Preload** | `voiceMirror.claude.sendInput(data)` |
| **Parameters** | `data: string` -- raw terminal input (keystrokes, escape sequences) |
| **Returns** | `{ success: boolean }` or `{ success: false, error: 'not running' }` |
| **Validated** | Yes -- string, max 10,000 chars |
| **Notes** | For CLI providers, sends raw data to PTY. For API providers, accumulates input in a buffer and sends on Enter. Handles backspace, TUI scroll keys, and character echo. |

#### `claude-pty-resize`

Resize the AI provider's terminal.

| | |
|---|---|
| **Preload** | `voiceMirror.claude.resize(cols, rows)` |
| **Parameters** | `cols: number` -- column count (1--500); `rows: number` -- row count (1--200) |
| **Returns** | `{ success: boolean }` |
| **Validated** | Yes -- both must be integers within range |
| **Notes** | Always updates stored terminal dimensions (used when switching providers). For CLI providers, resizes the PTY. For API providers, forwards to the TUI renderer. |

#### `ai-set-tui-theme`

Update the TUI renderer's theme colors.

| | |
|---|---|
| **Preload** | `voiceMirror.claude.setTuiTheme(colors)` |
| **Parameters** | `colors: Object` -- theme color key-value pairs |
| **Returns** | `{ success: boolean }` or `{ success: false, error: 'no TUI active' }` |

#### `ai-scan-providers`

Scan the system for available AI providers (Ollama, LM Studio, Jan, etc.).

| | |
|---|---|
| **Preload** | `voiceMirror.ai.scanProviders()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Object }` -- scan results per provider |
| **Async** | Yes |

#### `ai-get-providers`

Get cached provider availability (from the last scan).

| | |
|---|---|
| **Preload** | `voiceMirror.ai.getProviders()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Object }` |

#### `ai-set-provider`

Set the active AI provider and optional model.

| | |
|---|---|
| **Preload** | `voiceMirror.ai.setProvider(providerId, model)` |
| **Parameters** | `providerId: string` -- one of `'claude'`, `'opencode'`, `'ollama'`, `'lmstudio'`, `'jan'`; `model: string \| null` -- model name (max 200 chars) or null |
| **Returns** | `{ success: true, provider: string, model: string \| null }` |
| **Validated** | Yes -- providerId must be in the allowed list |
| **Async** | Yes -- updates config file |

#### `ai-get-provider`

Get the currently configured AI provider.

| | |
|---|---|
| **Preload** | `voiceMirror.ai.getProvider()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { provider: string, model: string \| null, autoDetect: boolean } }` |

#### `start-all`

Start both the voice backend and AI provider together.

| | |
|---|---|
| **Preload** | `voiceMirror.startAll()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` |
| **Notes** | Uses last known terminal dimensions for the AI provider. Only starts each service if not already running. |

#### `stop-all`

Stop both the voice backend and AI provider.

| | |
|---|---|
| **Preload** | `voiceMirror.stopAll()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` |

---

### Voice Backend Channels

Registered in `electron/ipc/voice.js`. Control the Rust voice-core subprocess that
handles wake word detection, speech-to-text, and text-to-speech.

#### `get-voice-status`

Get voice backend process status.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.getStatus()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { running: boolean, pid: number \| undefined } }` |

#### `start-voice`

Start the voice backend process.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.start()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` or `{ success: false, error: 'already running' }` |

#### `stop-voice`

Stop the voice backend process.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.stop()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` or `{ success: false, error: 'not running' }` |

#### `voice-restart`

Restart the voice backend (resets retry counter for user-initiated recovery).

| | |
|---|---|
| **Preload** | `voiceMirror.voice.restart()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` |

#### `send-query`

Send a text query (with optional image) to the voice backend.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.sendQuery(query)` |
| **Parameters** | `query: { text: string, image?: string \| null }` -- text max 50,000 chars |
| **Returns** | `{ success: boolean }` |
| **Validated** | Yes -- text must be string, image must be string or null |

#### `set-voice-mode`

Set the voice processing mode.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.setMode(mode)` |
| **Parameters** | `mode: 'auto' \| 'local' \| 'claude'` |
| **Returns** | `{ success: boolean }` |
| **Validated** | Yes -- must be one of the three allowed values |

#### `send-image`

Send an image to the voice backend for vision processing.

| | |
|---|---|
| **Preload** | `voiceMirror.sendImageToBackend(imageData)` |
| **Parameters** | `imageData: { base64: string, filename?: string \| null, prompt?: string \| null }` -- filename max 255 chars, prompt max 5,000 chars |
| **Returns** | `{ success: boolean, data?: Object }` |
| **Validated** | Yes -- base64 must be string, optional fields validated |
| **Async** | Yes |

#### `list-audio-devices`

Enumerate available audio input/output devices.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.listAudioDevices()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Array \| null }` |
| **Async** | Yes |

#### `get-detected-keys`

Detect API keys available in environment variables. Returns provider names only (never
sends actual key values to the renderer).

| | |
|---|---|
| **Preload** | `voiceMirror.voice.getDetectedKeys()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: string[] }` -- array of provider names |

#### `stop-speaking`

Interrupt in-progress TTS playback.

| | |
|---|---|
| **Preload** | `voiceMirror.voice.stopSpeaking()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` |

---

### Config Channels

Registered in `electron/ipc/config.js`. Handle application configuration, themes,
fonts, and platform information.

#### `get-config`

Load the full application config. API keys are redacted for renderer safety.

| | |
|---|---|
| **Preload** | `voiceMirror.config.get()` |
| **Parameters** | None |
| **Returns** | `Object` -- full config with masked API keys (e.g., `sk-...a1b2`) |

#### `set-config`

Update configuration with a partial object. Merges with existing config. Triggers
side effects: provider restart on AI changes, hotkey re-registration, voice backend
sync, login item settings.

| | |
|---|---|
| **Preload** | `voiceMirror.config.set(updates)` |
| **Parameters** | `updates: Object` -- partial config to merge (see Validation section for allowed fields) |
| **Returns** | `Object` -- full updated config with masked API keys |
| **Validated** | Yes -- deep validation of all config fields |
| **Async** | Yes |
| **Side Effects** | Auto-restarts AI provider on provider/model/contextLength change; re-registers global hotkeys; syncs voice backend settings; updates login item settings |

#### `reset-config`

Reset configuration to defaults.

| | |
|---|---|
| **Preload** | `voiceMirror.config.reset()` |
| **Parameters** | None |
| **Returns** | `Object` -- default config with masked API keys |

#### `get-platform-info`

Get platform-specific paths and system info.

| | |
|---|---|
| **Preload** | `voiceMirror.config.getPlatformInfo()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Object }` -- platform paths |

#### `browse-model-file`

Open a native file picker for model files (e.g., Piper .onnx voices).

| | |
|---|---|
| **Preload** | `voiceMirror.config.browseModelFile(fileType)` |
| **Parameters** | `fileType: string` -- file type hint (e.g., `'piper'`) |
| **Returns** | `{ success: boolean, data?: string }` -- selected file path |
| **Async** | Yes |

#### `list-overlay-outputs`

List available display outputs for the Wayland overlay orb.

| | |
|---|---|
| **Preload** | `voiceMirror.overlay.listOutputs()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Array }` -- output list (empty on non-Wayland) |
| **Async** | Yes |

#### `theme-export`

Export a theme to a JSON file via native save dialog.

| | |
|---|---|
| **Preload** | `voiceMirror.theme.export(data)` |
| **Parameters** | `data: Object` -- theme data to export |
| **Returns** | `{ success: boolean, filePath?: string }` |
| **Async** | Yes |

#### `theme-import`

Import a theme from a JSON file via native open dialog.

| | |
|---|---|
| **Preload** | `voiceMirror.theme.import()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean, data?: Object }` -- parsed theme data |
| **Async** | Yes |

#### `font-upload`

Open a native file picker for font files (.ttf, .otf, .woff, .woff2).

| | |
|---|---|
| **Preload** | `voiceMirror.fonts.upload()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean, filePath?: string }` |
| **Async** | Yes |

#### `font-add`

Install a font file for use in the app.

| | |
|---|---|
| **Preload** | `voiceMirror.fonts.add(filePath, type)` |
| **Parameters** | `filePath: string` -- path to font file (max 1,024 chars); `type: 'ui' \| 'mono'` |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

#### `font-remove`

Remove an installed custom font.

| | |
|---|---|
| **Preload** | `voiceMirror.fonts.remove(fontId)` |
| **Parameters** | `fontId: string` -- font identifier (max 20 chars) |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

#### `font-list`

List all installed custom fonts.

| | |
|---|---|
| **Preload** | `voiceMirror.fonts.list()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Array }` -- font metadata objects |

#### `font-get-data-url`

Get a font's data as a base64 data URL for CSS `@font-face` use.

| | |
|---|---|
| **Preload** | `voiceMirror.fonts.getDataUrl(fontId)` |
| **Parameters** | `fontId: string` -- font identifier (max 20 chars) |
| **Returns** | `{ success: boolean, dataUrl?: string, familyName?: string, format?: string }` |
| **Async** | Yes |

---

### Screen Capture Channels

Registered in `electron/ipc/screen.js`. Provide screen enumeration, capture, and
vision capability detection.

#### `get-screens`

List available screens with thumbnails.

| | |
|---|---|
| **Preload** | `voiceMirror.getScreens()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Array<{ id: string, name: string, thumbnail: string }> }` -- thumbnail is a data URL |
| **Async** | Yes |
| **Notes** | On Windows with multiple monitors, uses native PowerShell capture for accurate per-display thumbnails (works around an Electron desktopCapturer bug). |

#### `capture-screen`

Capture a full-resolution screenshot of a specific screen.

| | |
|---|---|
| **Preload** | `voiceMirror.captureScreen(sourceId)` |
| **Parameters** | `sourceId: string` -- screen source ID from `get-screens` (e.g., `'display:0'`) |
| **Returns** | `{ success: boolean, data?: string }` -- data URL of the screenshot |
| **Async** | Yes |

#### `supports-vision`

Check if the current AI provider supports vision/image input.

| | |
|---|---|
| **Preload** | `voiceMirror.supportsVision()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: boolean }` |

---

### Window Management Channels

Registered in `electron/ipc/window.js`. Control window state, position, drag
behavior, and resize for the frameless window.

#### `toggle-expand`

Toggle between orb (collapsed) and panel (expanded) states.

| | |
|---|---|
| **Preload** | `voiceMirror.toggleExpand()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: boolean }` -- true if now expanded |

#### `get-state`

Get the current window expansion state.

| | |
|---|---|
| **Preload** | `voiceMirror.getState()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { expanded: boolean } }` |

#### `minimize-window`

Minimize the application window.

| | |
|---|---|
| **Preload** | `voiceMirror.minimizeWindow()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` |

#### `maximize-window`

Toggle maximize state of the window.

| | |
|---|---|
| **Preload** | `voiceMirror.maximizeWindow()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { maximized: boolean } }` |

#### `get-window-position`

Get the current window position.

| | |
|---|---|
| **Preload** | `voiceMirror.getWindowPosition()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { x: number, y: number } }` |

#### `set-window-position`

Move the window to a new position.

| | |
|---|---|
| **Preload** | `voiceMirror.setWindowPosition(x, y)` |
| **Parameters** | `x: number` -- X coordinate; `y: number` -- Y coordinate |
| **Returns** | `{ success: boolean }` |
| **Validated** | Yes -- both must be finite numbers, clamped to -10,000..50,000 |

#### `get-cursor-position`

Get the current mouse cursor position on screen. Used during drag when the mouse
leaves the small orb window.

| | |
|---|---|
| **Preload** | `voiceMirror.getCursorPosition()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { x: number, y: number } }` |

#### `start-drag-capture`

Begin drag capture mode. Temporarily expands the window to an 800x800 transparent
area to capture mouse events that would otherwise miss the 64x64 orb.

| | |
|---|---|
| **Preload** | `voiceMirror.startDragCapture()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean, originalBounds?: Object }` |
| **Notes** | Only works when in orb (collapsed) mode. |

#### `stop-drag-capture`

End drag capture mode. Restores the orb to its original size at the new position
and saves the position to config.

| | |
|---|---|
| **Preload** | `voiceMirror.stopDragCapture(x, y)` |
| **Parameters** | `x: number` -- new X position; `y: number` -- new Y position |
| **Returns** | `{ success: boolean }` |
| **Validated** | Yes -- both must be finite numbers, clamped to -10,000..50,000 |

#### `get-window-bounds`

Get the current window bounds (position and size).

| | |
|---|---|
| **Preload** | `voiceMirror.getWindowBounds()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean, data?: { x, y, width, height } }` |

#### `save-window-bounds`

Persist the current panel size to config. Called after a resize drag ends.

| | |
|---|---|
| **Preload** | `voiceMirror.saveWindowBounds()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` |
| **Notes** | Only saves when expanded and dimensions exceed orb size. |

---

### Browser Channels

Browser control handlers are registered in `electron/main.js` (not a separate IPC
module). They control the embedded webview used by Claude's browser tools.

#### `browser-get-status`

Get the current browser/webview status.

| | |
|---|---|
| **Preload** | `voiceMirror.browser.getStatus()` |
| **Parameters** | None |
| **Returns** | `Object` -- browser status (url, title, etc.) |
| **Async** | Yes |

#### `browser-pop-out`

Open the current browser URL in the system's default browser.

| | |
|---|---|
| **Preload** | `voiceMirror.browser.popOut()` |
| **Parameters** | None |
| **Returns** | `{ ok: boolean, url?: string, reason?: string }` |
| **Async** | Yes |

---

### Chat History Channels

Registered in `electron/ipc/misc.js`. Persist chat conversations as JSON files in
the `userData/chats/` directory.

#### `chat-list`

List all saved chat conversations (sorted by last update, newest first).

| | |
|---|---|
| **Preload** | `voiceMirror.chat.list()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: Array<{ id, name, created, updated, messageCount }> }` |
| **Async** | Yes |

#### `chat-load`

Load a specific chat by ID.

| | |
|---|---|
| **Preload** | `voiceMirror.chat.load(id)` |
| **Parameters** | `id: string` -- chat identifier |
| **Returns** | `{ success: boolean, data?: Object }` -- full chat object with messages |
| **Async** | Yes |

#### `chat-save`

Save or update a chat conversation.

| | |
|---|---|
| **Preload** | `voiceMirror.chat.save(chat)` |
| **Parameters** | `chat: Object` -- must include `id` field |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

#### `chat-delete`

Delete a saved chat.

| | |
|---|---|
| **Preload** | `voiceMirror.chat.delete(id)` |
| **Parameters** | `id: string` -- chat identifier |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

#### `chat-rename`

Rename a saved chat.

| | |
|---|---|
| **Preload** | `voiceMirror.chat.rename(id, name)` |
| **Parameters** | `id: string` -- chat identifier; `name: string` -- new name |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

---

### Misc Channels

Registered in `electron/ipc/misc.js`. Covers app lifecycle, external URLs, CLI tool
management, dependency updates, and versioning.

#### `toggle-log-viewer`

Toggle the log viewer window.

| | |
|---|---|
| **Preload** | `voiceMirror.toggleLogViewer()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` |

#### `open-external`

Open a URL in the system's default browser.

| | |
|---|---|
| **Preload** | `voiceMirror.openExternal(url)` |
| **Parameters** | `url: string` -- must be `http://` or `https://` (max 2,048 chars) |
| **Returns** | `{ success: boolean }` |
| **Validated** | Yes -- blocked schemes: `file:`, `chrome:`, `javascript:`, `data:`, `vbscript:`. Also validated at preload boundary. |
| **Async** | Yes |

#### `quit-app`

Quit the application.

| | |
|---|---|
| **Preload** | `voiceMirror.quitApp()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` |

#### `check-cli-available`

Check if a CLI tool is available on the system PATH.

| | |
|---|---|
| **Preload** | `voiceMirror.ai.checkCLIAvailable(command)` |
| **Parameters** | `command: string` -- CLI command name (max 50 chars) |
| **Returns** | `{ success: true, data: { available: boolean } }` |

#### `install-cli`

Install a CLI tool via `npm install -g`. Only allows pre-approved packages.

| | |
|---|---|
| **Preload** | `voiceMirror.ai.installCLI(packageName)` |
| **Parameters** | `packageName: string` -- must be `'opencode'` (maps to `opencode-ai` on npm) |
| **Returns** | `{ success: boolean, error?: string, stderr?: string }` |
| **Async** | Yes (up to 120s timeout) |

#### `check-dependency-versions`

Check installed and latest versions of all managed dependencies (ghostty-web,
OpenCode, Claude Code, Node.js, Ollama, ffmpeg).

| | |
|---|---|
| **Preload** | `voiceMirror.ai.checkDependencyVersions()` |
| **Parameters** | None |
| **Returns** | `{ success: true, data: { npm: Object, system: Object } }` |
| **Async** | Yes |

#### `update-dependency`

Update a specific dependency to its latest version.

| | |
|---|---|
| **Preload** | `voiceMirror.ai.updateDependency(depId)` |
| **Parameters** | `depId: string` -- one of `'ghostty-web'`, `'opencode'`, `'claude-code'` |
| **Returns** | `{ success: boolean, error?: string }` |
| **Async** | Yes (up to 180s timeout) |

#### `run-uninstall`

Uninstall Voice Mirror: remove shortcuts, npm global link, and optionally config.

| | |
|---|---|
| **Preload** | `voiceMirror.runUninstall(keepConfig)` |
| **Parameters** | `keepConfig: boolean` -- if true, preserve config directory |
| **Returns** | `{ success: true, removed: string[], errors: string[], installDir: string }` |
| **Async** | Yes |

#### `get-app-version`

Get the application version string.

| | |
|---|---|
| **Preload** | `voiceMirror.getAppVersion()` |
| **Parameters** | None |
| **Returns** | `string` -- version number (e.g., `'1.2.3'`) |

#### `get-changelog`

Get the changelog entry for a specific version from CHANGELOG.md.

| | |
|---|---|
| **Preload** | `voiceMirror.getChangelog(version)` |
| **Parameters** | `version: string` -- version number (max 20 chars) |
| **Returns** | `{ success: boolean, data?: string }` -- markdown content |
| **Async** | Yes |

#### `mark-version-seen`

Mark a version as seen (suppresses "What's New" notification).

| | |
|---|---|
| **Preload** | `voiceMirror.markVersionSeen(version)` |
| **Parameters** | `version: string` -- version number (max 20 chars) |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

#### `apply-update`

Trigger download of an available application update.

| | |
|---|---|
| **Preload** | `voiceMirror.applyUpdate()` |
| **Parameters** | None |
| **Returns** | `{ success: boolean }` |
| **Async** | Yes |

#### `install-update`

Quit the app and install a downloaded update via electron-updater.

| | |
|---|---|
| **Preload** | `voiceMirror.installUpdate()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` (app exits immediately) |

#### `app-relaunch`

Relaunch the application (used after updates).

| | |
|---|---|
| **Preload** | `voiceMirror.relaunch()` |
| **Parameters** | None |
| **Returns** | `{ success: true }` (app exits and restarts) |

---

## Event Channels

Events flow from the main process to the renderer via `webContents.send()`. The
preload script wraps each in a subscribe function that returns an unsubscribe
callback (e.g., `const unsub = voiceMirror.onVoiceEvent(cb); unsub();`).

### `voice-event`

Voice backend state changes and events.

| | |
|---|---|
| **Preload** | `voiceMirror.onVoiceEvent(callback)` |
| **Payload** | `{ type: string, ... }` |
| **Event types** | `'wake'` -- wake word detected; `'recording'` -- recording started; `'speaking'` -- TTS playback started; `'idle'` -- returned to idle; `'claude_message'` -- Claude response via inbox; `'listening'` -- voice backend ready; `'error'` -- error occurred |
| **Sources** | Voice backend process events, inbox watcher, AI manager |

### `state-change`

Window state changes (expand, collapse, maximize).

| | |
|---|---|
| **Preload** | `voiceMirror.onStateChange(callback)` |
| **Payload** | `{ expanded?: boolean, maximized?: boolean }` |
| **Sources** | `electron/window/index.js` -- expand/collapse/maximize operations |

### `chat-message`

Chat messages for the UI conversation display.

| | |
|---|---|
| **Preload** | `voiceMirror.onChatMessage(callback)` |
| **Payload** | `{ role: 'user' \| 'assistant', text: string, source: string, timestamp?: string }` |
| **Sources** | Voice backend (transcriptions), inbox watcher (Claude/provider responses) |

### `claude-terminal`

Raw terminal output from the AI provider (for xterm.js rendering).

| | |
|---|---|
| **Preload** | `voiceMirror.claude.onOutput(callback)` |
| **Payload** | `{ type: 'stdout' \| 'exit', text?: string, code?: number }` |
| **Sources** | AI manager PTY output, API provider TUI output |

### `tool-call`

Notification that the AI provider is invoking a tool.

| | |
|---|---|
| **Preload** | `voiceMirror.tools.onToolCall(callback)` |
| **Payload** | `{ tool: string, args: Object }` |
| **Sources** | OpenAI-compatible provider tool execution |

### `tool-result`

Notification that a tool execution completed.

| | |
|---|---|
| **Preload** | `voiceMirror.tools.onToolResult(callback)` |
| **Payload** | `{ tool: string, success: boolean, result?: any }` |
| **Sources** | OpenAI-compatible provider tool execution |

### `tool-activity`

MCP tool activity from file-based IPC watchers (screen capture, browser, etc.).

| | |
|---|---|
| **Preload** | `voiceMirror.tools.onToolActivity(callback)` |
| **Payload** | `{ tool: string }` -- e.g., `'capture_screen'`, `'browser_search'` |
| **Sources** | Screen capture watcher, browser watcher |

### `context-usage`

AI provider context window usage statistics (parsed from Claude Code output).

| | |
|---|---|
| **Preload** | `voiceMirror.onContextUsage(callback)` |
| **Payload** | `Object` -- parsed context usage JSON |
| **Sources** | AI manager (extracted from terminal output) |

### `perf-stats`

Performance monitoring statistics (CPU, memory, etc.).

| | |
|---|---|
| **Preload** | `voiceMirror.onPerfStats(callback)` |
| **Payload** | `Object` -- performance statistics |
| **Sources** | `electron/services/perf-monitor.js` |

### `open-settings`

Command from the system tray menu to open the settings panel.

| | |
|---|---|
| **Preload** | `voiceMirror.onOpenSettings(callback)` |
| **Payload** | None (callback receives no arguments) |
| **Sources** | Tray menu "Settings" click |

### `toggle-stats-bar`

Toggle the stats bar visibility (triggered by global hotkey).

| | |
|---|---|
| **Preload** | `voiceMirror.onToggleStatsBar(callback)` |
| **Payload** | None (callback receives no arguments) |
| **Sources** | Stats hotkey binding |

### `browser-status`

Browser/webview navigation status updates.

| | |
|---|---|
| **Preload** | `voiceMirror.browser.onStatusChange(callback)` |
| **Payload** | `{ url: string }` |
| **Sources** | Webview navigation events in `electron/main.js` |

### `update-available`

A new application update is available for download.

| | |
|---|---|
| **Preload** | `voiceMirror.onUpdateAvailable(callback)` |
| **Payload** | `{ version: string, releaseNotes?: string }` |
| **Sources** | `electron/services/update-checker.js` |

### `update-status`

Progress and status of an ongoing update download/install.

| | |
|---|---|
| **Preload** | `voiceMirror.onUpdateStatus(callback)` |
| **Payload** | `{ status: string, ... }` -- varies by stage |
| **Sources** | `electron/services/update-checker.js` |

### `provider-switch-error`

Error during automatic AI provider switch (sent from set-config side effect).

| | |
|---|---|
| **Preload** | Not exposed (internal) |
| **Payload** | `{ error: string }` |
| **Sources** | `electron/ipc/config.js` -- async provider restart |

---

## Fire-and-Forget Channels

These use `ipcMain.on` / `ipcRenderer.send` (no return value).

### `set-window-bounds` (renderer -> main)

Set window position and size during drag resize. Sent at approximately 60fps.

| | |
|---|---|
| **Preload** | `voiceMirror.setWindowBounds(x, y, w, h)` |
| **Parameters** | `x: number`, `y: number`, `w: number`, `h: number` -- all must be finite; w and h clamped 200--10,000 |
| **Validated** | Inline (no formal validator -- basic type and range checks) |

### `devlog` (renderer -> main)

Send developer log entries from the renderer to the main process log file.

| | |
|---|---|
| **Preload** | `voiceMirror.devlog(category, action, data)` |
| **Parameters** | `category: string`, `action: string`, `data?: Object` |

### `hotkey-fallback` (renderer -> main)

Renderer-detected hotkey event. Only honored when `globalShortcut` registration
failed for the given binding ID.

| | |
|---|---|
| **Preload** | `voiceMirror.hotkeyFallback(id)` |
| **Parameters** | `id: string` -- hotkey binding identifier (e.g., `'toggle-panel'`) |

### `toggle-perf-monitor` (renderer -> main)

Toggle the performance monitor. Currently a no-op hook in main process; visibility
is handled renderer-side.

| | |
|---|---|
| **Preload** | `voiceMirror.togglePerfMonitor()` |
| **Parameters** | None |

---

## Validation

All validators are defined in `electron/ipc/validators.js`. They follow a consistent
pattern:

```js
validators['channel-name'] = (param1, param2) => {
    if (invalid) return { valid: false, error: 'description' };
    return { valid: true, value: sanitizedValue };
};
```

Handlers call validators before processing and return early on failure:

```js
ipcMain.handle('channel-name', (event, data) => {
    const v = validators['channel-name'](data);
    if (!v.valid) return { success: false, error: v.error };
    data = v.value;  // use sanitized value
    // ... proceed
});
```

### Validator Reference

| Validator | Rules |
|-----------|-------|
| `set-window-position` | x, y must be finite numbers; clamped to -10,000..50,000 and rounded |
| `stop-drag-capture` | newX, newY must be finite numbers; clamped to -10,000..50,000 and rounded |
| `set-config` | Deep validation: `ai.provider` must be in `['claude', 'opencode', 'ollama', 'lmstudio', 'jan']`; `ai.model` max 200 chars; `ai.endpoints.*` must be valid HTTP URLs; `ai.apiKeys.*` max 500 chars; `ai.contextLength` integer 1,024--1,048,576; `behavior.hotkey` max 100 chars; `behavior.activationMode` must be `'wakeWord'` or `'pushToTalk'`; `behavior.pttKey`/`dictationKey` max 50 chars; `appearance.orbSize` integer 32--256; `appearance.panelWidth`/`panelHeight` integer 200--4,000; `appearance.theme` from allowed list or `custom-*` prefix; `appearance.colors.*` must be `#RRGGBB` hex; `appearance.fonts.fontFamily`/`fontMono` must be strings; `appearance.messageCard` validated (fontSize 10--24, lineHeight 1.0--2.5, avatarSize 20--64, bubbleStyle from list, CSS strings max 200 chars); `window.orbX`/`orbY` must be numbers or null. All objects deep-cloned with functions stripped. |
| `open-external` | Must be string, max 2,048 chars; blocked schemes: `file:`, `chrome:`, `javascript:`, `data:`, `vbscript:`; must start with `http://` or `https://` |
| `send-query` | Must be object; `text` must be string max 50,000 chars; `image` must be string or null |
| `set-voice-mode` | Must be `'auto'`, `'local'`, or `'claude'` |
| `claude-pty-input` | Must be string, max 10,000 chars |
| `claude-pty-resize` | `cols` integer 1--500; `rows` integer 1--200 |
| `ai-set-provider` | `providerId` must be in allowed provider list; `model` string max 200 chars or null |
| `send-image` | Must be object; `base64` must be string; `filename` max 255 chars or null; `prompt` max 5,000 chars or null |

### Sanitization

The `sanitizeObject()` utility deep-clones plain data while stripping any function
values. This is applied to the `set-config` payload before field-level validation,
preventing prototype pollution or function injection from the renderer.

---

## File-Based IPC

Voice Mirror uses a file-based request/response pattern for communication between
MCP tools, Claude Code, and the Electron main process. This enables interprocess
communication with processes that cannot use Electron's IPC (like the Rust voice-core
binary or external MCP servers).

### Data Directory

All file-based IPC uses a shared data directory:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%/voice-mirror-electron/` |
| macOS    | `~/Library/Application Support/voice-mirror-electron/` |
| Linux    | `~/.config/voice-mirror-electron/` |

### inbox.json -- Message Bus

The primary communication channel between the voice backend, MCP tools, Claude Code,
and the Electron app. Contains an append-only message array.

**Schema:**
```json
{
    "messages": [
        {
            "id": "msg-1700000000000-abc123",
            "from": "user",
            "message": "What is the weather?",
            "timestamp": "2025-01-01T00:00:00.000Z",
            "read_by": [],
            "thread_id": "voice-mirror",
            "reply_to": "msg-...",
            "image_path": "/path/to/image.png",
            "image_data_url": "data:image/png;base64,..."
        }
    ]
}
```

**Field reference:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique message ID (`msg-{timestamp}-{random}`) |
| `from` | string | Sender: user name, `'claude'`, provider slug, or `'system'` |
| `message` | string | Message text content |
| `timestamp` | string | ISO 8601 timestamp |
| `read_by` | string[] | Array of reader IDs (used by MCP for deduplication) |
| `thread_id` | string | Thread identifier (always `'voice-mirror'`) |
| `reply_to` | string? | ID of the message being replied to |
| `image_path` | string? | Path to an image file (screen captures) |
| `image_data_url` | string? | Base64 data URL of an image |

**Watchers:**

- **InboxWatcher** (`electron/services/inbox-watcher.js`): Watches for new messages
  using `fs.watch` with a 100ms debounce. On each change:
  - Detects new Claude messages (sender includes "claude", thread = "voice-mirror")
    and emits `chat-message` + `voice-event` events to the renderer.
  - When Claude is not running: detects new user messages and forwards them to the
    active non-Claude AI provider (Ollama, LM Studio, etc.), writes the provider's
    response back to inbox, and emits chat/voice events.
  - Maintains deduplication sets (`displayedMessageIds`, `processedUserMessageIds`)
    seeded from existing messages at startup to prevent replaying history.

### status.json -- Application Status

Published by the MCP server for external tools. Contains the current application
state. Referenced by `mcp-server/paths.js` as `CLAUDE_STATUS_PATH`.

### screen_capture_request.json / screen_capture_response.json

Request/response pattern for Claude's MCP screen capture tool.

**Request** (written by MCP tool):
```json
{
    "timestamp": "2025-01-01T00:00:00.000Z",
    "display": "0"
}
```

**Response** (written by Electron):
```json
{
    "success": true,
    "image_path": "/path/to/capture-1700000000000.png",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "width": 1920,
    "height": 1080,
    "displays_available": 2
}
```

**Watcher:** `electron/services/screen-capture-watcher.js` watches for the request
file, captures the screen using native APIs (PowerShell on Windows multi-monitor,
Electron `desktopCapturer` elsewhere), saves the PNG to `data-dir/images/`, writes
the response file, and appends a system message to `inbox.json`. Requests older
than 5 seconds are discarded as stale.

### browser_request.json / browser_response.json

Request/response pattern for Claude's MCP browser tools (search, fetch, navigate,
screenshot, DOM snapshot, cookies, storage).

**Request** (written by MCP tool):
```json
{
    "id": "req-abc123",
    "action": "search",
    "args": { "query": "example" },
    "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**Supported actions:** `search`, `fetch`, `start`, `stop`, `status`, `navigate`,
`screenshot`, `snapshot`, `act`, `tabs`, `open`, `close_tab`, `focus`, `console`,
`cookies`, `storage`

**Response** (written by Electron):
```json
{
    "ok": true,
    "request_id": "req-abc123",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "...": "action-specific fields"
}
```

**Watcher:** `electron/services/browser-watcher.js` uses the JSON file watcher
pattern. Requests older than 5 seconds are discarded. Emits `tool-activity` events
to the renderer.

### diagnostic_request.json / diagnostic_trace_{id}.json

Pipeline diagnostic tracing. An MCP tool writes a diagnostic request; the watcher
injects the message into `inbox.json`, traces the full pipeline (provider forwarding,
response extraction, inbox write-back), and saves the trace to a timestamped file.

**Request:**
```json
{
    "trace_id": "trace-abc123",
    "message": "test message",
    "timeout_seconds": 30,
    "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**Trace output** (saved to `diagnostic_trace_{trace_id}.json`): Contains an array of
stages with timing data, capturing each step of the voice-to-response pipeline.

**Watcher:** `electron/services/diagnostic-watcher.js`. Stale check is 10 seconds.

### listener_lock.json

Lock file used by the MCP server to prevent multiple concurrent listeners. Lock
expires after 310 seconds (slightly longer than the default 300-second listen
timeout). Referenced in `mcp-server/paths.js`.

### Common Pattern: JSON File Watcher

All file-based IPC watchers use a shared utility (`electron/lib/json-file-watcher.js`)
built on `fs.watch` with an automatic polling fallback (2-second interval) when
`fs.watch` is unavailable or errors. The factory accepts:

```js
createJsonFileWatcher({
    watchDir: '/path/to/data-dir',
    filename: 'inbox.json',
    debounceMs: 100,      // optional debounce
    onEvent: callback,     // called when file changes
    label: 'InboxWatcher'  // for log messages
});
```

Returns `{ start(), stop(), isRunning() }`.
