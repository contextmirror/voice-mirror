# Provider System

Multi-AI provider architecture for Voice Mirror Electron. This document covers how Voice Mirror integrates with Claude Code, generic CLI agents (OpenCode, Codex, Gemini CLI, Kimi CLI), and OpenAI-compatible HTTP APIs (Ollama, LM Studio, Jan, OpenAI, Groq, xAI, Mistral, OpenRouter, DeepSeek, Google Gemini, Kimi/Moonshot).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Provider Types](#provider-types)
3. [Provider Lifecycle](#provider-lifecycle)
4. [Provider Factory](#provider-factory)
5. [Claude Code Integration](#claude-code-integration)
6. [Generic CLI Agents](#generic-cli-agents)
7. [OpenAI-Compatible HTTP Providers](#openai-compatible-http-providers)
8. [TUI Renderer](#tui-renderer)
9. [Auto-Detection](#auto-detection)
10. [Provider Events](#provider-events)
11. [AI Manager Orchestration](#ai-manager-orchestration)
12. [Instruction Injection](#instruction-injection)

---

## Architecture Overview

```
+------------------------------------------------------------------+
|                        Voice Mirror Electron                      |
|                                                                   |
|  +-------------------+    +---------------------------------+     |
|  |   AI Manager      |    |   Provider Detector             |     |
|  |  (ai-manager.js)  |    |  (provider-detector.js)         |     |
|  |                    |    |                                 |     |
|  |  start / stop /   |    |  scanAll() -> local LLMs        |     |
|  |  interrupt /      |    |  detectApiKeys() -> cloud keys  |     |
|  |  sendTextInput    |    |  tryStartOllama() -> auto-start |     |
|  +--------+----------+    +---------------------------------+     |
|           |                                                       |
|           v                                                       |
|  +-------------------+                                            |
|  | Provider Factory  |                                            |
|  | (providers/       |                                            |
|  |  index.js)        |                                            |
|  +--------+----------+                                            |
|           |                                                       |
|     +-----+------+----------------+                               |
|     |            |                |                                |
|     v            v                v                                |
|  +--------+  +----------+  +-------------+                        |
|  | Claude |  | CLI      |  | OpenAI      |                        |
|  | Provider| | Provider |  | Provider    |                        |
|  +--------+  +----------+  +-------------+                        |
|     |            |                |                                |
|     v            v                v                                |
|  +--------+  +----------+  +-------------+                        |
|  | Claude |  | CLI      |  | HTTP fetch  |                        |
|  | Spawner|  | Spawner  |  | + streaming |                        |
|  +--------+  +----------+  +------+------+                        |
|     |            |                |                                |
|  node-pty     node-pty      +-----+------+                        |
|  (PTY)        (PTY)         |            |                        |
|     |            |          v            v                         |
|     v            v       Local LLMs   Cloud APIs                  |
|  Claude CLI   OpenCode   (Ollama,     (OpenAI,                    |
|              Codex, etc   LM Studio,   Groq, etc.)                |
|                           Jan)                                    |
+------------------------------------------------------------------+
```

The provider system has three tiers:

1. **AI Manager** -- Top-level orchestrator. Routes `start()`/`stop()` to the correct provider type, manages output gating during provider switches, and exposes a unified API to the rest of the app.
2. **Provider Layer** -- `BaseProvider` subclasses (`ClaudeProvider`, `CLIProvider`, `OpenAIProvider`) that implement a common interface.
3. **Spawner / Transport Layer** -- `claude-spawner.js` and `cli-spawner.js` manage node-pty processes; `OpenAIProvider` uses HTTP fetch directly.

---

## Provider Types

Voice Mirror supports three categories of AI provider, each with different transport mechanisms.

### Category 1: PTY CLI Agent -- Claude Code

| Property | Value |
|---|---|
| Provider class | `ClaudeProvider` |
| Spawner | `claude-spawner.js` |
| Transport | node-pty pseudo-terminal |
| Tool support | MCP server (injected via `mcp_settings.json`) |
| Instruction delivery | `--append-system-prompt` CLI flag |
| Config key | `"claude"` |

Claude Code runs as a full interactive TUI inside a pseudo-terminal. Voice Mirror writes MCP configuration files, injects a system prompt, and spawns the `claude` CLI binary. The user sees the real Claude Code TUI rendered in the xterm.js terminal.

### Category 2: PTY CLI Agent -- Generic

| Property | Value |
|---|---|
| Provider class | `CLIProvider` |
| Spawner | `cli-spawner.js` |
| Transport | node-pty pseudo-terminal |
| Tool support | MCP (OpenCode only, via `opencode.json`) |
| Instruction delivery | `instructions.md` file written to provider config directory |
| Config keys | `"opencode"` |

Generic CLI agents are spawned in a PTY just like Claude Code but use a shared spawner (`cli-spawner.js`) with per-tool configuration. The CLI_CONFIGS map defines command, args, ready-detection patterns, and optional instruction directory for each supported CLI.

**Registered CLI tools:**

| Key | Command | Display Name | Instructions Dir |
|---|---|---|---|
| `codex` | `codex` | OpenAI Codex | -- |
| `gemini-cli` | `gemini` | Gemini CLI | -- |
| `kimi-cli` | `kimi` | Kimi CLI | -- |
| `opencode` | `opencode` | OpenCode | `.opencode/` |

> Note: Only `claude` and `opencode` are in the `CLI_PROVIDERS` constant (defined in `constants.js`). Codex, Gemini CLI, and Kimi CLI have CLI_CONFIGS entries in the spawner but are routed to the OpenAI HTTP provider at the factory level.

### Category 3: OpenAI-Compatible HTTP API

| Property | Value |
|---|---|
| Provider class | `OpenAIProvider` |
| Transport | HTTP streaming (`fetch` with SSE) |
| Tool support | Native function calling (cloud) or text-parsing fallback (local) |
| Instruction delivery | System message in conversation history |
| Config keys | `"ollama"`, `"lmstudio"`, `"jan"`, `"openai"`, `"gemini"`, `"groq"`, `"grok"`, `"mistral"`, `"openrouter"`, `"deepseek"` |

The OpenAI provider communicates via the OpenAI-compatible `/v1/chat/completions` endpoint. It works with both local LLM servers and cloud APIs. Tool calling uses native OpenAI function calling for cloud providers and a text-parsing JSON fallback for local models.

**Supported providers and endpoints:**

| Type | Name | Default Base URL | Default Model |
|---|---|---|---|
| `ollama` | Ollama | `http://127.0.0.1:11434` | Auto-detect |
| `lmstudio` | LM Studio | `http://127.0.0.1:1234` | Auto-detect |
| `jan` | Jan | `http://127.0.0.1:1337` | Auto-detect |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| `gemini` | Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| `grok` | Grok (xAI) | `https://api.x.ai/v1` | `grok-2` |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct` |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |

---

## Provider Lifecycle

All providers follow the same lifecycle defined by `BaseProvider`:

```
                       createProvider()
                            |
                            v
                     +------+------+
                     | Constructed |  running = false
                     +------+------+
                            |
                        spawn(options)
                            |
              +-------------+-------------+
              |                           |
              v                           v
       +------+------+            +------+------+
       |   Running   |            |   Failed    |  (spawn returned false)
       | running=true|            +-------------+
       +------+------+
              |
         +----+----+
         |         |
     stop()    emitExit()
         |         |
         v         v
  +------+------+
  |   Stopped   |  running = false
  +-------------+
```

### BaseProvider Interface

`BaseProvider` extends Node.js `EventEmitter` and defines the contract every provider must implement:

| Method | Description | Required |
|---|---|---|
| `getDisplayName()` | Human-readable name for the UI (e.g., `"Ollama (llama3.2)"`) | Yes |
| `spawn(options)` | Start the provider. Returns `Promise<boolean>`. | Yes |
| `stop()` | Stop the provider. Returns `Promise<void>`. | Yes |
| `sendInput(text)` | Send a user message. Returns `Promise<void>`. | Yes |
| `sendRawInput(data)` | Send raw keyboard data (PTY passthrough). | Yes |
| `isRunning()` | Check if provider is active. Returns `boolean`. | Inherited |
| `resize(cols, rows)` | Resize terminal. Optional (only PTY providers). | Optional |
| `supportsVision()` | Whether provider accepts image input. Returns `boolean`. | Optional |
| `emitOutput(type, text)` | Helper to emit `'output'` event. | Inherited |
| `emitExit(code)` | Helper to emit `'exit'` event and set `running = false`. | Inherited |

### PTY-specific additions

Both `ClaudeProvider` and `CLIProvider` add:

| Method | Description |
|---|---|
| `sendInputWhenReady(text, timeout)` | Queue input until the CLI TUI signals it is ready for input. Returns `Promise<boolean>`. |
| `isReady()` | Whether the TUI has finished loading and is accepting input. |

---

## Provider Factory

The factory (`electron/providers/index.js`) routes a provider type string to the correct class.

```
createProvider(type, config)
        |
        +-- type === "claude"     --> new ClaudeProvider(config)
        |
        +-- type === "opencode"   --> new CLIProvider(type, config)
        |
        +-- (everything else)     --> createOpenAIProvider(type, config)
```

The `PROVIDER_TYPES` constant defines only the types that need special handling:

```js
const PROVIDER_TYPES = {
    CLAUDE: 'claude',
    OPENCODE: 'opencode'
};
```

All other type strings (`"ollama"`, `"openai"`, `"groq"`, etc.) fall through to `createOpenAIProvider()`, which looks up defaults from a built-in provider map and instantiates `OpenAIProvider` with the merged configuration.

### Provider type flow through the system

```
User selects provider in Settings UI
              |
              v
     config.ai.provider = "groq"   (stored in config.json)
              |
              v
     ai-manager.start()
              |
              +-- Is type in CLI_PROVIDERS ["claude", "opencode"]?
              |       |
              |       +-- YES: spawn PTY (startClaudeCode or startCLIAgent)
              |       |
              |       +-- NO:  createProvider(type, config) --> OpenAIProvider
              |                    |
              |                    v
              |               activeProvider.spawn()
              |               activeProvider.on('output', ...)
              |               activeProvider.setToolCallbacks(...)
              v
       Provider is running
```

---

## Claude Code Integration

Claude Code is the primary provider and has the most complex integration path.

### Spawn sequence

```
ai-manager.start("claude")
      |
      v
startClaudeCode(cols, rows)
      |
      v
claude-spawner.spawnClaude(options)
      |
      +-- 1. configureMCPServer(appConfig)
      |       - Reads active tool profile from config
      |       - Builds MCP server entry with command, args, env
      |       - Writes mcp_settings.json and .mcp.json to multiple locations:
      |           * .claude/ (project-level)
      |           * ~/.claude/ (user-level)
      |           * ~/.config/claude-code/ (Linux XDG)
      |           * project-root/.mcp.json
      |       - Uses SHA-256 hash to skip redundant writes
      |
      +-- 2. configureStatusLine()
      |       - Writes claude-pulse status line to ~/.claude/settings.json
      |       - Installs slash commands (pulse.md, setup.md)
      |       - Uses system Python for the status script
      |
      +-- 3. isClaudeAvailable()
      |       - Windows: tries claude.cmd, claude.exe, claude via `where`
      |       - Unix: uses `which claude`
      |       - Caches resolved path for reuse
      |
      +-- 4. buildClaudeInstructions(options)
      |       - Builds system prompt with Voice Mirror context
      |       - Includes architecture description, MCP tool docs,
      |         voice workflow, response style, security rules
      |       - Tool docs generated dynamically from enabled groups
      |
      +-- 5. pty.spawn(claudeCmd, claudeArgs, ptyOptions)
      |       - claudeArgs: ['--dangerously-skip-permissions',
      |                      '--append-system-prompt', instructions]
      |       - TERM=xterm-256color, COLORTERM=truecolor
      |       - cwd = Voice Mirror project root
      |       - env filtered via buildFilteredEnv()
      |
      +-- 6. Ready detection (onData handler)
      |       - Buffers PTY output
      |       - Looks for: ">", "What would you like", "How can I help",
      |         or 500+ bytes of output (fallback)
      |       - When ready: calls all queued readyCallbacks
      |
      +-- 7. sendInputWhenReady(voicePrompt, 20000)
              - Waits for ready, then sends:
                "Use claude_listen to wait for voice input from {user},
                 then reply with claude_send. Loop forever."
              - 500ms delay after ready detection before sending
              - Text written to PTY, then \r sent after 100ms
```

### MCP configuration injection

The MCP server entry looks like this in the written JSON files:

```json
{
  "mcpServers": {
    "voice-mirror-electron": {
      "command": "node",
      "args": ["<path-to>/mcp-server/index.js", "--enabled-groups", "core,meta,screen,memory"],
      "env": {
        "ENABLED_GROUPS": "core,meta,screen,memory"
      },
      "disabled": false
    }
  }
}
```

This is written to all of the following locations for cross-version compatibility:

- `<project>/.claude/mcp_settings.json`
- `<project>/.claude/.mcp.json`
- `~/.claude/mcp_settings.json`
- `~/.claude/.mcp.json`
- `<project>/.mcp.json`
- (Linux only) `~/.config/claude-code/mcp_settings.json` and `.mcp.json`

### Generation counter (stale PTY guard)

The spawner uses a monotonic `spawnGeneration` counter to prevent stale PTY output from leaking across respawn cycles. Every `onData` and `onExit` callback captures `myGen` at spawn time and silently drops events if `myGen !== spawnGeneration`. The generation is bumped on both `spawnClaude()` and `stopClaude()`.

```
spawnGeneration = 0
      |
  spawnClaude()  -->  spawnGeneration++ (now 1)  -->  myGen = 1
      |
  stopClaude()   -->  spawnGeneration++ (now 2)
      |                    |
      |          stale onData callback checks: myGen(1) !== spawnGeneration(2)
      |                    --> DROP
      |
  spawnClaude()  -->  spawnGeneration++ (now 3)  -->  myGen = 3
```

---

## Generic CLI Agents

Generic CLI agents use `CLIProvider` (wrapping `cli-spawner.js`) for PTY management. The spawner is a factory function that returns a closure-based interface.

### CLI_CONFIGS

Each CLI agent is defined in the `CLI_CONFIGS` map:

```js
{
    codex: {
        command: 'codex',
        args: [],
        readyPatterns: ['>', 'What', 'How can'],
        displayName: 'OpenAI Codex'
    },
    'gemini-cli': {
        command: 'gemini',
        args: [],
        readyPatterns: ['>', 'What', 'How can'],
        displayName: 'Gemini CLI'
    },
    'kimi-cli': {
        command: 'kimi',
        args: [],
        readyPatterns: ['>', 'What', 'How can'],
        displayName: 'Kimi CLI'
    },
    opencode: {
        command: 'opencode',
        args: [],
        readyPatterns: ['>', 'What', 'How can', 'help'],
        displayName: 'OpenCode',
        instructionsDir: '.opencode'
    }
}
```

### instructions.md injection

When a CLI config has an `instructionsDir` property, the spawner writes an `instructions.md` file to that directory before spawning the PTY. This is how Voice Mirror injects its context into CLI agents that do not support `--append-system-prompt`:

```
cli-spawner.spawn()
      |
      +-- config.instructionsDir exists?
      |       |
      |       +-- YES: buildGenericInstructions(options)
      |       |        --> write to <cwd>/<instructionsDir>/instructions.md
      |       |
      |       +-- NO:  skip (Codex, Gemini CLI, Kimi CLI)
      |
      +-- pty.spawn(command, args, ptyOptions)
```

For OpenCode specifically, the AI Manager also writes `opencode.json` with MCP server configuration (via `configureOpenCodeMCP()`) so OpenCode's model can use Voice Mirror's MCP tools.

### Ready detection

The generic spawner uses the same pattern as the Claude spawner:

1. Buffer PTY output in `outputBuffer`
2. Check if any `readyPatterns` substring appears in the buffer, or if buffer exceeds 500 bytes
3. When ready: clear buffer, fire all `readyCallbacks`, reset list

### sendInputWhenReady

Both the Claude and generic spawner implement `sendInputWhenReady(text, timeout)`:

```
sendInputWhenReady(text, timeout)
      |
      +-- PTY not running?  --> reject("PTY not running")
      |
      +-- Already ready?    --> sendInput(text), resolve(true)
      |
      +-- Not ready yet:
            |
            +-- Set timeout timer (default 15s)
            |
            +-- Push callback to readyCallbacks[]
            |
            +-- When ready detected:
                  |
                  +-- Clear timeout
                  +-- Wait 500ms (let TUI finish rendering)
                  +-- sendInput(text)
                  +-- resolve(true)
```

The `sendInput()` function writes the text to the PTY, then sends `\r` (Enter) after a 100ms delay to ensure the TUI has processed all characters before submitting.

---

## OpenAI-Compatible HTTP Providers

The `OpenAIProvider` class handles all HTTP-based providers. Unlike PTY providers, it does not spawn a process. Instead, it maintains conversation history in memory and streams responses from a `/v1/chat/completions` endpoint.

### Spawn and request flow

```
openai-provider.spawn(options)
      |
      +-- Mark running = true
      +-- Initialize messages[] with system prompt
      +-- Create TUIRenderer for dashboard display
      +-- Emit 'start' event
      |
      v
openai-provider.sendInput(text)
      |
      +-- Append user message to messages[]
      +-- _limitMessageHistory() (cap at 20 messages)
      +-- Build request body:
      |     { model, messages, stream: true }
      |     + tools/tool_choice (if native tools)
      |     + options.num_ctx (if Ollama)
      |
      +-- POST to baseUrl + chatEndpoint
      |     with AbortController for cancellation
      |
      +-- Stream SSE response:
      |     for each "data: {...}" line:
      |       - Extract delta.content tokens --> streamToken() to TUI
      |       - Accumulate delta.tool_calls (native path)
      |       - Track finish_reason
      |
      +-- After stream ends:
            |
            +-- Has native tool calls?
            |     YES --> execute tools, add role:"tool" messages,
            |             recursively call sendInput('', isToolFollowUp=true)
            |
            +-- Has text-parsed tool call? (local fallback)
            |     YES --> parse JSON from response, execute tool,
            |             inject result as user message with instruction,
            |             recursively call sendInput('', isToolFollowUp=true)
            |
            +-- Neither --> append assistant message, emit 'response'
```

### Tool calling: two paths

```
                      supportsTools()?
                           |
                    +------+------+
                    |             |
               YES (enabled)   NO --> plain chat, no tools
                    |
             supportsNativeTools()?
                    |
             +------+------+
             |             |
            YES           NO
             |             |
   Cloud providers     Local providers
   (openai, gemini,    (ollama, lmstudio,
    groq, grok,         jan)
    mistral,             |
    openrouter,    Text-parsing path:
    deepseek)      - Full tool system prompt
             |       with JSON examples
   Native path:    - Parse JSON tool_call
   - tools[] in      from model output
     request body  - Execute tool
   - tool_choice   - Inject result as
     = "auto"        user message
   - Parse deltas  - Follow-up request
   - Execute tools
   - Add role:"tool"
     messages
   - Follow-up
     request
```

Native tool providers get a lean system prompt (tools are described via the API's `tools` parameter). Text-parsing providers get a full prompt with JSON format examples so the model knows how to emit tool calls as structured text.

### Conversation history management

- Maximum 20 non-system messages (`MAX_HISTORY_MESSAGES`)
- When trimming, system messages are always preserved
- Orphaned `role: "tool"` messages at the trim boundary are skipped (they require a paired assistant message with `tool_calls`)
- Base64 images in older messages are replaced with `[image]` text to save context
- Token usage is estimated at ~4 characters per token

### Vision support

The provider checks the model name against a list of known vision-capable models (LLaVA, Qwen VL, MiniCPM, Gemma 3, etc.). When vision is supported, images can be sent as:

- **Ollama format**: `{ role: "user", content: "text", images: ["<raw-base64>"] }`
- **OpenAI format**: `{ role: "user", content: [{ type: "image_url", ... }, { type: "text", ... }] }`

### Request interruption

The `interrupt()` method aborts the in-flight HTTP request via `AbortController.abort()` without stopping the provider or clearing conversation history. The `sendInput()` catch block handles `AbortError` by emitting `[Cancelled]`.

---

## TUI Renderer

The `TUIRenderer` class (`electron/providers/tui-renderer.js`) draws a rich terminal dashboard for HTTP API providers. Since these providers do not have their own TUI (unlike Claude Code), Voice Mirror renders one using raw ANSI escape sequences.

### Layout

```
+--- Voice Mirror ---- Ollama (llama3.2) ------ * Running --------+
|  +--- Conversation -------------------+  +--- Tool Calls -----+ |
|  |                                    |  |                     | |
|  |   > You                     2:15pm |  |  * search_web       | |
|  |   What is the weather today?       |  |    "weather today"  | |
|  |                                    |  |                     | |
|  |   > llama3.2                2:15pm |  |  + get_weather      | |
|  |   Let me check that for you...     |  |    "location:NYC"   | |
|  |                                    |  |                     | |
|  |                                    |  +--- Info -----------+ |
|  |                                    |  |  Model    llama3.2 | |
|  |                                    |  |  Speed    42 tok/s | |
|  |                                    |  |  Tools    8 loaded | |
|  +------------------------------------+  +--------------------+ |
+-- CTX: 2.1K/32.0K | TTS: piper | STT: whisper | 2 tool calls --+
+------------------------------------------------------------------+
```

The dashboard has four zones:

| Zone | Content |
|---|---|
| **Header** | App name, provider/model, running status |
| **Conversation panel** (left, 65% width) | Scrollable chat with user/assistant messages, streaming cursor |
| **Tool Calls panel** (right top) | List of tool executions with spinner/check/cross status |
| **Info panel** (right bottom) | Model name, generation speed, tool count, voice status |
| **Status bar** | Context usage, TTS/STT engine, tool call count |

### ANSI 24-bit color theming

The TUI supports both a default 256-color theme and full 24-bit (truecolor) theming via `setThemeColors()`:

```js
tui.setThemeColors({
    bg:         '#1a1b26',   // Background
    text:       '#c0caf5',   // Normal text
    textStrong: '#ffffff',   // Bold/emphasized text
    accent:     '#7aa2f7',   // Borders, highlights
    muted:      '#565f89',   // Dim text, timestamps
    ok:         '#9ece6a',   // Success indicators
    warn:       '#e0af68',   // Running tool spinners
    danger:     '#f7768e',   // Error indicators
});
```

Colors are converted to ANSI 24-bit escape codes (`\x1b[38;2;r;g;bm` for foreground, `\x1b[48;2;r;g;bm` for background). After applying theme colors, the renderer computes composite sequences:

- `_resetBg` = `RESET + bgCode + fgCode` (restores background after any ANSI reset)
- `_clearEol` = `bgCode + CLEAR_EOL` (clear-to-end-of-line with background fill)
- `_clearScreen` = `bgCode + CLEAR_SCREEN`

### Render cycle

The TUI uses a mix of full and partial renders for performance:

| Method | When used | Scope |
|---|---|---|
| `render()` | Initial draw, resize, scroll, stream overflow | Full screen repaint |
| `_renderToolPanel()` | Tool added/updated, spinner tick | Right-top panel only |
| `_renderInfoPanel()` | Info value changed | Right-bottom panel only |
| `_renderStatusBarOnly()` | Context updated, tool count changed, TTS/STT changed | Status bar row only |
| `streamToken()` | Each token during streaming | Single line update (optimized) |

**Streaming optimization**: During token streaming, `streamToken()` avoids a full repaint by computing only the last wrapped line of the stream buffer and writing it at the correct cursor position. A full `render()` is triggered only when the stream content overflows the visible area.

**Chat line caching**: Non-stream chat lines are cached in `_cachedChatLinesNoStream` and invalidated only when `appendMessage()` is called or the terminal is resized.

### Spinner

Running tool calls display an animated Braille spinner (`SPINNER = ['...', '...', ...]`) that ticks every 150ms via `setInterval`. The spinner is started by `_ensureSpinner()` when any tool has `status: 'running'` and stopped when all tools complete.

### Box drawing

The layout uses Unicode box-drawing characters:

```
Outer:  +--+--+--+     Inner panels:  +--+--+--+
        | tl  tr |                    |itl  itr|
        |        |                    |        |
        | bl  br |                    |ibr  ibl|
        +--+--+--+                    +--+--+--+
```

---

## Auto-Detection

The `ProviderDetectorService` (`electron/services/provider-detector.js`) scans for available providers at startup and on demand.

### Local provider detection

```
providerDetector.scanAll()
      |
      +-- For each LOCAL_PROVIDER (ollama, lmstudio, jan):
            |
            +-- GET <baseUrl>/v1/models
            |     timeout: 5 seconds
            |
            +-- Online? Parse model list from response
            |     (supports both OpenAI format and legacy Ollama format)
            |
            +-- Offline + type === "ollama"?
                  |
                  +-- tryStartOllama()
                        |
                        +-- Search platform-specific install locations:
                        |     Win: AppData, Program Files, drive roots, PATH
                        |     Mac: /Applications, /usr/local/bin, Homebrew
                        |     Linux: /usr/local/bin, /snap/bin, ~/.local/bin
                        |
                        +-- Start detached process:
                        |     "ollama app.exe" (tray app) or
                        |     "ollama serve" (CLI)
                        |
                        +-- Poll for server startup (up to 10s)
                        |
                        +-- If started: retry detectLocalProvider()
```

### Cloud provider / API key detection

```
detectApiKeys()
      |
      +-- For each CLOUD_PROVIDER:
      |     Check process.env[provider.apiKeyEnv]
      |     (e.g., OPENAI_API_KEY, GROQ_API_KEY, XAI_API_KEY)
      |
      +-- Check Claude CLI credentials:
            ~/.claude/.credentials.json
            --> creds.claudeAiOauth.accessToken
            --> sets _claudeCliAuth = true
```

### Caching

- Results cached in a `Map<type, status>`
- Cache TTL: 30 seconds (`CACHE_TTL`)
- `getAvailable(forceRefresh)` returns cached results if fresh, otherwise rescans
- `getCachedStatus()` returns cached results without any network call

### Provider priority

`getFirstAvailable()` prefers Ollama over LM Studio over Jan when auto-selecting a local provider.

---

## Provider Events

All providers extend `EventEmitter` and emit a standard set of events.

### Output event

Emitted via `emitOutput(type, text)` or `this.emit('output', { type, text })`:

| type | Meaning | Source |
|---|---|---|
| `"stdout"` | Terminal output data (ANSI-encoded for PTY providers, plain text for HTTP) | All providers |
| `"stderr"` | Error messages | All providers |
| `"start"` | Provider has started successfully | All providers |
| `"exit"` | Provider process has exited (PTY only) | PTY providers |
| `"tui"` | TUI dashboard ANSI output (rendered by TUIRenderer) | OpenAI provider |
| `"response"` | Complete assistant response text (for InboxWatcher/TTS) | OpenAI provider |
| `"context-usage"` | JSON string with `{ used, limit }` token estimates | OpenAI provider |

### Exit event

Emitted via `emitExit(code)`:

```js
this.emit('exit', code);   // code = process exit code (PTY) or 0 (API)
```

Sets `this.running = false` before emitting.

### Event flow through the system

```
Provider.emitOutput('stdout', data)
      |
      v
EventEmitter.emit('output', { type: 'stdout', text: data })
      |
      v
ai-manager output handler (set up in start())
      |
      v
sendOutput(type, text)     <-- gated during provider switches
      |
      v
onOutput({ type, text })   <-- callback from main.js
      |
      v
IPC to renderer process --> xterm.js terminal
```

### Output gating

During provider switches, the AI Manager sets `outputGated = true` before stopping the old provider. This prevents stale PTY output (from a dying process still flushing buffers) from reaching the terminal. The gate opens when the new provider emits its first `'start'` event.

---

## AI Manager Orchestration

The `createAIManager()` factory function (`electron/services/ai-manager.js`) returns a service object that orchestrates all provider types behind a unified API.

### Public API

| Method | Description |
|---|---|
| `start(cols, rows)` | Start the configured AI provider |
| `stop()` | Stop whatever provider is currently running |
| `interrupt()` | Cancel current operation (Ctrl+C for PTY, abort for HTTP) |
| `isRunning()` | Check if any provider is active |
| `sendTextInput(text)` | Send text to the active provider |
| `sendRawInputData(data)` | Send raw keystrokes (PTY passthrough) |
| `resize(cols, rows)` | Resize the PTY terminal |
| `getProvider()` | Get the active `OpenAIProvider` instance (or null) |
| `getDisplayName()` | Human-readable name of the active provider |
| `supportsTools()` | Whether the active provider supports tool calling |
| `ensureLocalLLMRunning()` | Auto-start Ollama if needed |

### Provider routing in start()

```
start(cols, rows)
      |
      +-- Read config.ai.provider
      |
      +-- Is CLI_PROVIDERS.includes(type)?
      |       |
      |       +-- type === "claude"
      |       |     --> startClaudeCode(cols, rows)
      |       |         Uses claude-spawner directly (dedicated path)
      |       |
      |       +-- type === "opencode" (or other CLI)
      |             --> startCLIAgent(providerType, cols, rows)
      |                 Uses cli-spawner.createCLISpawner(type)
      |                 For OpenCode: also calls configureOpenCodeMCP()
      |
      +-- Not a CLI provider:
              --> createProvider(type, config) // factory
              --> activeProvider.spawn(options)
              --> Wire up 'output' event handler
              --> Wire up tool callbacks
```

### Defensive cleanup

Before starting a new provider, the manager defensively stops any stale provider from a different category:

- Starting a CLI provider? Kill any leftover HTTP provider.
- Starting an HTTP provider? Kill any leftover Claude PTY and CLI agent PTY.

### Interrupt behavior

| Provider type | Interrupt action | Recovery |
|---|---|---|
| Claude Code | Send `\x03` (Ctrl+C) to PTY | Re-send voice loop command via `sendInputWhenReady` |
| OpenCode | Send `\x03` to PTY | Re-send voice loop command |
| HTTP API | `abortController.abort()` | Emits `[Cancelled]`, ready for next input |

---

## Instruction Injection

Voice Mirror injects instructions into AI providers through different mechanisms depending on the provider type.

### Claude Code: --append-system-prompt

`buildClaudeInstructions()` generates a system prompt that is passed via the `--append-system-prompt` CLI flag. The prompt includes:

- **Architecture context** -- What Voice Mirror is and how it works
- **MCP tool documentation** -- Dynamically built from enabled tool groups
- **Voice workflow** -- Step-by-step listen/respond loop
- **Response style rules** -- Natural speech, no markdown
- **Security rules** -- Prompt injection resistance, instruction hierarchy

Tool group documentation is defined in `TOOL_GROUP_DOCS` and assembled based on the active tool profile:

| Group | Tools | Description |
|---|---|---|
| `core` | 4 | claude_listen, claude_send, claude_inbox, claude_status |
| `meta` | 3 | list_tool_groups, load_tools, unload_tools |
| `screen` | 1 | capture_screen |
| `memory` | 6 | memory_search, memory_get, memory_remember, etc. |
| `browser` | 16 | Full CDP browser automation |
| `n8n` | 22 | n8n workflow automation |
| `voice-clone` | 3 | Voice cloning tools |
| `diagnostic` | 1 | pipeline_trace |
| `facades` | 3 | Single-tool wrappers for memory, browser, n8n |

### Generic CLI agents: instructions.md

`buildGenericInstructions()` generates a markdown file written to the agent's configuration directory (e.g., `.opencode/instructions.md`). Content is similar to the Claude instructions but:

- Tells the agent not to identify as Claude
- References the provider name in the architecture description
- Written as a file rather than passed as a CLI argument

### HTTP API providers: system message

The system prompt is injected as the first message in the conversation history:

```js
this.messages.push({ role: 'system', content: systemPrompt });
```

For native-tools providers (cloud), the prompt is lean (tool descriptions are sent via the API). For text-parsing providers (local), the prompt includes full JSON format examples for tool calling.

### Voice mode initial prompt

After any PTY-based provider is ready, the AI Manager sends an initial voice prompt:

```
Use claude_listen to wait for voice input from {username},
then reply with claude_send. Loop forever.
```

If a custom system prompt is configured (`config.ai.systemPrompt`), it is prepended to this voice prompt. This kicks off the voice listen/respond loop.

---

## Source Files Reference

| File | Role |
|---|---|
| `electron/providers/index.js` | Provider factory (`createProvider`) |
| `electron/providers/base-provider.js` | Abstract base class with EventEmitter |
| `electron/providers/claude-provider.js` | Claude Code PTY provider |
| `electron/providers/claude-spawner.js` | Claude Code PTY spawner (MCP config, ready detection) |
| `electron/providers/cli-provider.js` | Generic CLI provider wrapper |
| `electron/providers/cli-spawner.js` | Generic CLI spawner (OpenCode, Codex, Gemini CLI, Kimi CLI) |
| `electron/providers/openai-provider.js` | OpenAI-compatible HTTP provider |
| `electron/providers/tui-renderer.js` | ANSI terminal dashboard for HTTP providers |
| `electron/providers/claude-instructions.js` | System prompt / instructions builder |
| `electron/services/ai-manager.js` | Top-level provider orchestration |
| `electron/services/provider-detector.js` | Local LLM and API key auto-detection |
| `electron/constants.js` | `CLI_PROVIDERS` list, `DEFAULT_ENDPOINTS` map |
