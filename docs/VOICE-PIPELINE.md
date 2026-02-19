# Voice Pipeline

This document describes the full voice pipeline in Voice Mirror Electron: how audio
flows from the microphone through speech recognition, into the AI, and back out as
spoken TTS audio. It covers every component in the chain, the IPC protocol between
them, and the error recovery mechanisms.

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [ASCII Diagram](#ascii-diagram)
3. [voice-core (Rust Binary)](#voice-core-rust-binary)
   - [Audio Capture and Processing](#audio-capture-and-processing)
   - [Voice Activity Detection (VAD)](#voice-activity-detection-vad)
   - [Wake Word Detection (OpenWakeWord)](#wake-word-detection-openwakeword)
   - [Speech-to-Text (STT)](#speech-to-text-stt)
   - [Text-to-Speech (TTS)](#text-to-speech-tts)
   - [Activation Modes](#activation-modes)
   - [Audio State Machine](#audio-state-machine)
   - [Hotkey Listener](#hotkey-listener)
   - [Text Injector (Dictation)](#text-injector-dictation)
   - [JSON IPC Protocol](#json-ipc-protocol)
4. [Inbox System](#inbox-system)
   - [inbox.json Message Queue](#inboxjson-message-queue)
   - [listener_lock.json Mutex](#listener_lockjson-mutex)
   - [status.json Presence Tracking](#statusjson-presence-tracking)
5. [MCP Server Tools](#mcp-server-tools)
   - [claude_listen](#claude_listen)
   - [claude_send](#claude_send)
   - [claude_inbox](#claude_inbox)
   - [claude_status](#claude_status)
6. [Electron Services Layer](#electron-services-layer)
   - [voice-backend.js (voice-core Manager)](#voice-backendjs)
   - [inbox-watcher.js (Inbox Poller)](#inbox-watcherjs)
7. [TTS Response Flow](#tts-response-flow)
8. [Error States and Recovery](#error-states-and-recovery)

---

## Pipeline Overview

The voice pipeline is a round-trip system with five major participants:

1. **voice-core** -- A Rust binary that handles all audio I/O (capture, wake word,
   STT, TTS playback). Runs as a child process of Electron.
2. **Electron main process** -- Spawns voice-core, manages its lifecycle, watches the
   inbox file for new messages, and bridges events to the renderer UI.
3. **inbox.json** -- A flat JSON file on disk that acts as a message queue between
   voice-core, the Electron app, and AI providers.
4. **MCP server** -- A Node.js process that exposes `claude_listen`, `claude_send`,
   `claude_inbox`, and `claude_status` tools for Claude Code to interact with the
   inbox.
5. **AI provider** -- Either Claude Code (via MCP tools) or a local LLM (Ollama,
   LM Studio) that reads voice messages and writes responses to the inbox.

The high-level flow:

```
User speaks -> Microphone -> voice-core captures audio
-> Wake word / PTT / Call mode triggers recording
-> VAD detects end of speech (or key release)
-> STT transcribes audio to text
-> Text written to inbox.json
-> AI reads message (via MCP or inbox-watcher bridge)
-> AI writes response to inbox.json
-> voice-core polls for response, reads it
-> TTS synthesizes response to audio
-> Audio played through speakers
```

---

## ASCII Diagram

```
+----------------------------------------------------------------------+
|                         ELECTRON MAIN PROCESS                         |
|                                                                       |
|  voice-backend.js                    inbox-watcher.js                 |
|  +------------------+               +---------------------+          |
|  | spawn voice-core |               | watch inbox.json    |          |
|  | parse stdout JSON |<-- events -->| detect new messages |          |
|  | write stdin JSON  |              | forward to provider |          |
|  +--------+---------+               +----------+----------+          |
|           |  stdin/stdout                      |                      |
|           |  (JSON lines)                      | file watch           |
+----------------------------------------------------------------------+
            |                                    |
            v                                    v
+--------------------------+       +----------------------------+
|      VOICE-CORE          |       |       inbox.json           |
|      (Rust binary)       |       | +------------------------+ |
|                          | write | | { "messages": [        | |
| +------+   +----------+ | ----> | |   { id, from, message, | |
| | cpal |-->| Ring Buf  | |       | |     timestamp,         | |
| | 16kHz|  | (160k f32)| |       | |     thread_id,         | |
| +------+  +-----+-----+ |       | |     read_by: [] }      | |
|                  |       |       | | ] }                    | |
|                  v       |       | +------------------------+ |
| +-----------------------------+  +--------+-------------------+
| | Audio Processing Loop      |           |
| | 40ms tick, 1280-sample     |           | poll / watch
| | chunks                     |           v
| |                            |  +-----------------------------+
| | [Listening]                |  |      MCP SERVER (Node.js)   |
| |   +-> OpenWakeWord         |  |                             |
| |   |   3-stage ONNX         |  | claude_listen:              |
| |   |   pipeline             |  |   fs.watch inbox.json       |
| |   +-> if detected:        |  |   return new messages       |
| |       start recording     |  |                             |
| |                            |  | claude_send:                |
| | [Recording]                |  |   append to inbox.json      |
| |   +-> accumulate samples  |  |   write trigger file        |
| |   +-> Silero VAD           |  |                             |
| |       (512-sample ONNX)   |  | claude_inbox:               |
| |   +-> silence timeout     |  |   read + filter messages    |
| |       (2.0s) => stop      |  +-------------+---------------+
| |                            |                |
| | [Processing]               |                v
| |   +-> Whisper STT          |  +-----------------------------+
| |       (GGML, local)       |  |     AI PROVIDER             |
| |   +-> text -> inbox.json  |  |                             |
| |   +-> poll for response   |  | Claude Code (via MCP tools) |
| |   +-> response -> TTS     |  |   OR                        |
| |                            |  | Ollama / LM Studio          |
| | [TTS Playback]            |  |   (via inbox-watcher bridge)|
| |   +-> Kokoro ONNX          |  +-----------------------------+
| |       (espeak-ng phonemize)|
| |   +-> rodio Sink           |
| |       (24 kHz PCM)        |
| |   +-> interruptible       |
| +----------------------------+
+--------------------------+

    PTT / Dictation keys (rdev global hooks)
    +------+
    | rdev | ---> HotkeyEvent channel ---> main loop
    +------+    PttDown/PttUp
                DictationDown/DictationUp
```

---

## voice-core (Rust Binary)

Source: `voice-core/src/main.rs` and submodules.

voice-core is an async Rust binary (tokio runtime) that handles all real-time audio
processing. It communicates with Electron exclusively through JSON lines on
stdin (commands from Electron) and stdout (events to Electron). Logs go to
`vmr-rust.log` in the data directory (not stdout).

### Audio Capture and Processing

**Source**: `voice-core/src/audio/capture.rs`, `voice-core/src/audio/ring_buffer.rs`

Audio capture uses the `cpal` crate to open the system default input device (or a
named device from config). The capture pipeline:

1. **cpal callback** receives raw f32 samples at the device's native sample rate
   and channel count.
2. **Down-mix** to mono by averaging channels (if multi-channel).
3. **Resample** to 16 kHz using linear interpolation (if native rate differs).
4. **Chunk** into 1280-sample buffers (80 ms at 16 kHz) -- this matches
   OpenWakeWord's expected input size.
5. **Push** chunks into a lock-free SPSC ring buffer (`ringbuf` crate).

The ring buffer has a default capacity of 160,000 samples (~10 seconds at 16 kHz).
If the consumer falls behind, the oldest audio is silently overwritten. The producer
lives in the cpal audio thread; the consumer lives in the async processing task.

The **audio processing loop** runs as a tokio task, ticking every 40 ms. Each tick
it pops up to 1280 samples from the ring buffer and processes them according to the
current audio state.

### Voice Activity Detection (VAD)

**Source**: `voice-core/src/vad/silero.rs`, `voice-core/src/vad/energy.rs`

VAD determines whether a chunk of audio contains speech. Two implementations exist:

- **Silero VAD** (primary): An ONNX model (`silero_vad.onnx`) that processes
  512-sample windows and outputs a speech probability (0.0 - 1.0). It maintains
  LSTM hidden state (h, c tensors of shape `[2, 1, 128]`) across calls for temporal
  context. The speech threshold is 0.5 for recording mode.

- **Energy-based fallback**: Mean absolute amplitude of the audio chunk. Used when
  the Silero ONNX model is not available. Threshold is 0.01 for recording mode.

VAD is used during recording (after wake word or PTT press) to detect when the user
stops speaking. After 2.0 seconds of continuous silence (no speech detected), the
recording is automatically stopped. PTT and dictation recordings bypass VAD silence
detection -- they are controlled entirely by key release.

### Wake Word Detection (OpenWakeWord)

**Source**: `voice-core/src/wake_word/oww.rs`

OpenWakeWord is a 3-stage ONNX inference pipeline:

1. **Mel spectrogram** (`melspectrogram.onnx`): Converts 1280 raw audio samples into
   mel-frequency features.
2. **Embedding model** (`embedding_model.onnx`): Converts mel features into a compact
   embedding vector.
3. **Wake word classifier** (`hey_claude_v2.onnx`): Takes a sliding window of recent
   embedding vectors and outputs a confidence score (0.0 - 1.0).

The embedding vectors are accumulated in a sliding window (default size 16). The
classifier only runs once enough embeddings have accumulated. When the score exceeds
the detection threshold of **0.98**, a wake word event is emitted and recording
begins.

All three ONNX models are loaded with single intra-thread / single inter-thread
configuration to minimize CPU impact. If any model file is missing, wake word
detection is disabled entirely.

### Speech-to-Text (STT)

**Source**: `voice-core/src/stt/mod.rs`, `voice-core/src/stt/whisper.rs`, `voice-core/src/stt/cloud.rs`

Three STT adapters are available:

| Adapter | Config Name | Description |
|---------|-------------|-------------|
| **Whisper local** | `whisper-local` | Local inference via `whisper-rs` (whisper.cpp). Default. |
| **OpenAI Cloud** | `openai-cloud` | OpenAI Whisper API. Requires API key. |
| **Custom Cloud** | `custom-cloud` | Any OpenAI-compatible STT endpoint. Requires URL. |

**Whisper local** is the default and most commonly used adapter:

- Models are GGML format, auto-downloaded from HuggingFace on first use
  (e.g., `ggml-base.en.bin`).
- Inference runs on a blocking tokio thread (`spawn_blocking`) to avoid stalling the
  async runtime.
- Uses greedy sampling strategy with `best_of: 1`.
- Configured for English-only (`set_language(Some("en"))`).
- Non-speech token suppression is enabled to reduce hallucination on silence.
- Thread count is half the available CPU cores, clamped to 1-8.
- The `WhisperState` is cached after first use to avoid ~200 MB of buffer
  reallocation per transcription.
- Audio shorter than 0.4 seconds (6,400 samples) is silently discarded.

**Cloud adapters** encode the f32 audio as 16-bit PCM WAV and send it as a
multipart form upload.

### Text-to-Speech (TTS)

**Source**: `voice-core/src/tts/mod.rs`, `voice-core/src/tts/kokoro.rs`, `voice-core/src/tts/cloud.rs`, `voice-core/src/tts/playback.rs`

Four TTS adapters are available:

| Adapter | Config Name | Description |
|---------|-------------|-------------|
| **Kokoro** | `kokoro` | Local ONNX synthesis (default). Requires espeak-ng for phonemization. |
| **Edge TTS** | `edge` | Free Microsoft voices via WebSocket. Fallback when Kokoro unavailable. |
| **OpenAI TTS** | `openai-tts` | OpenAI TTS API (`tts-1` model). Requires API key. |
| **ElevenLabs** | `elevenlabs` | ElevenLabs REST API. Requires API key. |

**Kokoro TTS** is the default local engine:

- Uses `kokoro-v1.0.onnx` model with voice embeddings from `voices-v1.0.bin` (NPZ
  format containing per-voice style vectors of shape `[N, 1, 256]`).
- Text is first **phonemized** using `espeak-ng` CLI (converts text to IPA phonemes).
  espeak-ng is located via: PATH > bundled `tools/espeak-ng/` > packaged
  `resources/bin/espeak-ng/`.
- Phonemes are **tokenized** using an 88-entry vocabulary mapping IPA characters to
  token IDs.
- Long sequences are **chunked** at word boundaries (space token) with a maximum of
  510 phoneme tokens per chunk (model context length minus 2 for start/end pads).
- Each chunk is padded with `[0, ...tokens, 0]` and fed through the ONNX model with
  a style embedding (selected by voice name and token count) and speed parameter.
- Output is 24 kHz mono f32 PCM audio.
- Synthesis is **interruptible** via an `AtomicBool` flag checked between chunks.

**Edge TTS** connects via WebSocket to Microsoft's Bing speech synthesis service.
It sends SSML over the WebSocket and receives MP3 audio chunks, which are decoded to
f32 PCM using the Symphonia codec library.

**Playback** uses the `rodio` crate:
- Opens the default audio output device via `OutputStream::try_default()`.
- Creates a `Sink` for queuing and playing audio buffers.
- Supports volume control (0.0 - 1.0).
- The `Sink` handle is shared via `Arc` so that external code (command handler,
  hotkey handler) can call `sink.stop()` to interrupt playback.
- Playback is polled at 50 ms intervals until the sink is empty or cancellation is
  requested.

### Activation Modes

voice-core supports three activation modes, configured via `activation_mode` in
`voice_settings.json`:

#### Wake Word Mode (`wake_word`)

- Audio processing loop starts in **Listening** state automatically.
- OpenWakeWord processes every 1280-sample chunk.
- When "Hey Claude" is detected (score >= 0.98), recording begins.
- Recording stops after 2.0 seconds of silence (VAD-based).
- Transcribed text is sent to inbox; voice-core polls for AI response.

#### Push-to-Talk Mode (`ptt`)

- Hotkey listener captures a configurable key (default: `MouseButton5`).
- **Key down**: Transitions to Recording state; ring buffer is drained to discard
  stale audio; recording buffer is cleared.
- **Key up**: Recording stops; audio is sent to STT; result goes to inbox.
- VAD silence detection is **bypassed** -- recording duration is entirely controlled
  by how long the user holds the key.
- Any in-progress TTS playback is interrupted on key down.

#### Hybrid Mode (`hybrid`)

- Both wake word and PTT are active simultaneously.
- Audio loop starts listening for wake word; PTT key also triggers recording.
- Useful when users want hands-free wake word with a PTT override.

#### Dictation Mode

An additional input mode available alongside PTT. Configured via `dictation_key`:

- **Key down**: Starts dictation recording.
- **Key up**: Audio is transcribed via STT, then the text is **injected** into the
  currently focused application via clipboard paste (Ctrl+V / Cmd+V) rather than
  being sent to the inbox.
- This mode is for direct text input, not for AI conversation.

### Audio State Machine

**Source**: `voice-core/src/audio/state.rs`

A thread-safe state machine using `AtomicU8` for lock-free state transitions shared
between the audio callback thread, the processing task, and the command handler.

```
                  start_listening()
    +---------+  ----------------->  +-----------+
    |  Idle   |                      | Listening |
    +---------+  <-----------------  +-----------+
                     reset()              |
                                          | start_recording(source)
                                          v
                                    +-----------+
                                    | Recording |
                                    +-----------+
                                          |
                                          | stop_recording()
                                          v
                                    +------------+
                                    | Processing |
                                    +------------+
                                          |
                                          | finish_processing()
                                          v
                                    +-----------+
                                    | Listening |
                                    +-----------+
```

Each recording tracks its **source** (`RecordingSource`): `WakeWord`, `Ptt`, or
`Dictation`. The source determines whether VAD silence detection is applied
(wake word only) or whether the recording is key-release controlled (PTT, dictation).

### Hotkey Listener

**Source**: `voice-core/src/hotkey/mod.rs`

Uses the `rdev` crate for cross-platform global key/mouse event capture:

- **Windows**: Win32 low-level hooks
- **Linux**: X11 event capture (with evdev for Wayland)
- **macOS**: Quartz event tap

Supports keyboard keys (F1-F12, A-Z, 0-9, Space, Tab, etc.) and mouse buttons
(MouseButton3/4/5). Includes **debouncing** with a 150 ms minimum hold time to
filter out Windows key-repeat artifacts (rapid KeyPress/KeyRelease cycles at ~80 ms).

Events are sent through a tokio mpsc channel to the main event loop, which handles
them alongside stdin commands via `tokio::select!`.

### Text Injector (Dictation)

**Source**: `voice-core/src/text_injector/mod.rs`

For dictation mode, transcribed text is injected into the focused application:

1. Save current clipboard contents
2. Set clipboard to transcribed text
3. Simulate Ctrl+V (or Cmd+V on macOS) via `rdev::simulate`
4. Restore original clipboard contents

This uses the `arboard` crate for clipboard access.

### JSON IPC Protocol

**Source**: `voice-core/src/ipc/mod.rs`, `voice-core/src/ipc/bridge.rs`

Communication between Electron and voice-core uses newline-delimited JSON on
stdin (Electron to Rust) and stdout (Rust to Electron).

#### Commands (Electron -> voice-core via stdin)

Format: `{"command": "<name>", ...}\n`

| Command | Fields | Description |
|---------|--------|-------------|
| `ping` | -- | Health check; voice-core responds with `pong` event |
| `stop` | -- | Graceful shutdown |
| `stop_speaking` | -- | Interrupt TTS playback (ignored during system speak) |
| `start_recording` | -- | Begin recording manually |
| `stop_recording` | -- | Stop recording manually; triggers STT |
| `set_mode` | `mode` | Change activation mode (listening, idle, wake_word, hybrid) |
| `config_update` | `config` | Hot-reload configuration |
| `list_audio_devices` | -- | Enumerate input devices |
| `list_adapters` | -- | List available STT/TTS adapter names |
| `system_speak` | `text` | Non-interruptible TTS (startup greeting) |
| `query` | `text`, `image?` | Send a text query to the inbox |
| `image` | `data`, `filename?`, `prompt?` | Send base64 image for vision analysis |

#### Events (voice-core -> Electron via stdout)

Format: `{"event": "<name>", "data": {...}}\n`

| Event | Data Fields | Description |
|-------|-------------|-------------|
| `starting` | -- | Process is initializing |
| `loading` | `step` | Loading status message (model download progress, etc.) |
| `ready` | -- | All subsystems initialized |
| `listening` | -- | Entered listening state (waiting for wake word or PTT) |
| `wake_word` | `model`, `score` | Wake word detected |
| `recording_start` | `type` | Recording started (wake_word, ptt, dictation, manual) |
| `recording_stop` | -- | Recording stopped |
| `transcription` | `text` | STT result |
| `sent_to_inbox` | `message`, `msgId` | Message written to inbox.json |
| `response` | `text`, `source`, `msgId` | AI response received from inbox |
| `speaking_start` | `text` | TTS playback starting |
| `speaking_end` | -- | TTS playback finished |
| `ptt_start` | -- | PTT key pressed |
| `ptt_stop` | -- | PTT key released |
| `dictation_start` | -- | Dictation key pressed |
| `dictation_stop` | -- | Dictation key released |
| `dictation_result` | `text`, `success` | Dictation text injected (or failed) |
| `mode_change` | `mode` | Activation mode changed |
| `error` | `message` | Error occurred |
| `stopping` | -- | Graceful shutdown initiated |
| `audio_devices` | `input`, `output` | Audio device enumeration result |
| `adapter_list` | `tts`, `stt` | Available adapter names |
| `config_updated` | `config` | Configuration update acknowledged |
| `image_received` | `path` | Image saved to disk |

---

## Inbox System

The inbox system is the central communication hub. It uses three JSON files in the
data directory (`%APPDATA%/voice-mirror-electron/data/` on Windows).

### inbox.json Message Queue

**Path**: `<data_dir>/inbox.json`

This is the message queue shared by voice-core, the MCP server, the Electron inbox
watcher, and AI providers. All participants read and write to this file.

```json
{
  "messages": [
    {
      "id": "msg-a1b2c3d4e5f6",
      "from": "user",
      "message": "What's the weather like?",
      "timestamp": "2024-01-15T10:30:00.000000",
      "thread_id": "voice-mirror",
      "read_by": []
    },
    {
      "id": "msg-1706789012-abc123",
      "from": "voice-claude",
      "message": "I don't have access to real-time weather data...",
      "timestamp": "2024-01-15T10:30:05.000Z",
      "thread_id": "voice-mirror",
      "read_by": [],
      "reply_to": "msg-a1b2c3d4e5f6"
    }
  ]
}
```

**Message fields**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID. voice-core uses `msg-<hex12>` format; Electron/MCP use `msg-<timestamp>-<random>` |
| `from` | string | Sender name. `"user"` or configured username for voice input; `"voice-claude"` for Claude; provider ID for local LLMs |
| `message` | string | The message text |
| `timestamp` | string | ISO 8601 or Python-style local timestamp |
| `thread_id` | string | Thread grouping. Voice messages use `"voice-mirror"` |
| `read_by` | string[] | Instance IDs that have read this message |
| `reply_to` | string? | ID of the message being replied to (optional) |
| `type` | string? | Message type for system events (optional) |
| `event` | string? | System event name (optional) |
| `image_path` | string? | Path to attached image file (optional) |
| `image_data_url` | string? | Base64 data URL for inline images (optional) |

**Concurrency**: Multiple processes may read/write inbox.json simultaneously.
voice-core uses atomic writes (write to temp file, then rename). The MCP server
and inbox-watcher use direct `fs.writeFileSync`. In practice, message writes are
infrequent enough that conflicts are rare.

**Cleanup**: Messages are automatically cleaned up:
- voice-core removes messages older than 2 hours on startup and periodically
  (every 30 minutes). Maximum 100 messages retained.
- MCP server (`claude_inbox`) removes messages older than 24 hours.
- Deduplication: voice-core hashes the lowercase trimmed message text and skips
  identical messages sent within 2 seconds.

### listener_lock.json Mutex

**Path**: `<data_dir>/listener_lock.json`

Ensures only **one** Claude Code instance can listen for voice messages at a time.
Without this, multiple Claude instances could each respond to the same message.

```json
{
  "instance_id": "voice-claude",
  "acquired_at": 1706789000000,
  "expires_at": 1706789310000
}
```

- Lock timeout: 310 seconds (slightly longer than the default 300s listen timeout).
- Lock is refreshed every 30 seconds during an active listen.
- Lock is released when `claude_listen` returns (message found or timeout).
- Stale locks (expired `expires_at`) are cleaned up on MCP server startup and
  automatically overwritten by new lock acquisitions.

### status.json Presence Tracking

**Path**: `<data_dir>/status.json`

Tracks which Claude instances are active:

```json
{
  "statuses": [
    {
      "instance_id": "voice-claude",
      "status": "active",
      "current_task": "Listening for user",
      "last_heartbeat": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

- Heartbeats are updated on every MCP tool call.
- Instances with heartbeats older than 2 minutes are marked as `[STALE]`.
- Used by `claude_status` to show which instances are alive.

---

## MCP Server Tools

**Source**: `mcp-server/index.js`, `mcp-server/handlers/core.js`

The MCP server is a Node.js process that implements the Model Context Protocol,
exposing tools that Claude Code can call. The core voice tools are always loaded.

### claude_listen

The primary tool for receiving voice input. Blocks until a new message arrives from
the specified sender, or times out.

**Flow**:

1. Acquires exclusive listener lock (prevents duplicate responses from multiple
   Claude instances).
2. Captures the set of existing message IDs in inbox.json.
3. Uses `fs.watch` on the data directory to wake on file changes (with a 5-second
   polling fallback).
4. On each wake, reads inbox.json and checks for new messages from `from_sender`
   that were not in the initial set.
5. When a new message is found, auto-loads relevant MCP tool groups based on keyword
   intent detection (e.g., "search" triggers the browser group).
6. Releases the listener lock and returns the message.
7. On timeout (default 300s, max 600s), releases the lock and returns a timeout
   message.

### claude_send

Writes a response message to inbox.json. This is how Claude Code sends spoken
responses back to the user.

**Flow**:

1. Reads existing messages from inbox.json.
2. Resolves the thread ID: uses `reply_to` message's thread if available; defaults
   to `"voice-mirror"` for the `voice-claude` instance.
3. Appends a new message with the sender set to `instance_id`.
4. Trims to last 100 messages.
5. Writes a `claude_message_trigger.json` file to notify watchers.

### claude_inbox

Reads messages from the inbox, filtered by read status. Supports marking messages
as read. Used for checking messages without blocking. Auto-loads tool groups based
on message content intent.

### claude_status

Updates or lists presence information in status.json. Used for heartbeat tracking
and showing which Claude instances are active.

---

## Electron Services Layer

### voice-backend.js

**Source**: `electron/services/voice-backend.js`

Manages the voice-core Rust binary as a child process.

**Responsibilities**:

- **Binary discovery**: Checks packaged path (`resources/bin/voice-core`), release
  build, then debug build.
- **Process spawning**: Uses `child_process.spawn` with piped stdio. Working
  directory is set to the binary's parent directory (so espeak-ng and model files
  are found relative to the binary).
- **stdout parsing**: Buffers incoming data and splits on newlines. Each complete
  line is parsed as JSON. Events with an `event` field are handled; other output
  is logged.
- **Event mapping**: Maps voice-core event names to UI event objects that the
  renderer understands. For example, `recording_stop` becomes `{type: 'processing'}`,
  `speaking_end` becomes `{type: 'idle'}`.
- **Command sending**: `send(command)` writes JSON + newline to stdin.
- **Auto-restart**: If voice-core exits with a non-zero code, automatically restarts
  up to 3 times with an 8-second delay between attempts. The restart counter resets
  on a successful `ready` event.
- **Graceful shutdown**: Sends `{"command": "stop"}` and waits up to 3 seconds
  before force-killing the process.
- **Config sync**: `syncVoiceSettings(cfg)` writes `voice_settings.json` to the
  data directory before (re)starting voice-core. Maps Electron's camelCase config
  keys to voice-core's snake_case format.
- **Image handling**: Sends base64 images to voice-core via stdin. Falls back to
  writing the image to disk and creating an inbox message if voice-core is not
  running.

### inbox-watcher.js

**Source**: `electron/services/inbox-watcher.js`

Watches inbox.json for new messages and bridges between the inbox and non-Claude
AI providers.

**Responsibilities**:

- **File watching**: Uses a debounced JSON file watcher (100 ms debounce) on
  inbox.json.
- **Message deduplication**: Maintains two Sets:
  - `displayedMessageIds`: Messages already shown in the UI.
  - `processedUserMessageIds`: User messages already forwarded to providers.
  Both sets are seeded from existing messages on startup to prevent replaying
  history.
- **Claude message detection**: Scans for the latest message where `from` contains
  "claude" and `thread_id` is "voice-mirror". New Claude messages trigger
  `onClaudeMessage` and `onVoiceEvent` callbacks.
- **Non-Claude provider bridge**: When Claude is not running but a local provider
  (Ollama, LM Studio) is active, user messages are forwarded to the provider:
  1. Extract the message text from inbox.json.
  2. Call `provider.sendInput(message)` and intercept the provider's output stream.
  3. Wait for the response to stabilize (2+ seconds of no new output).
  4. Extract the speakable response (strip tool JSON, code blocks, system messages,
     URLs, markdown formatting).
  5. Write the cleaned response back to inbox.json so voice-core can read and
     speak it.
- **Response cleanup**: `extractSpeakableResponse()` aggressively filters provider
  output to extract only natural language suitable for TTS. It removes:
  - Tool call/result JSON objects
  - Code blocks (fenced with triple backticks)
  - System messages (`[Executing tool:...]`, `[Tool succeeded]`, etc.)
  - Markdown formatting (bold, italic, headers, links)
  - Raw URLs
  - Blockquoted user echo lines

---

## TTS Response Flow

The complete flow for speaking an AI response:

### When using Claude Code (via MCP)

1. voice-core writes the user's transcription to `inbox.json` and emits
   `sent_to_inbox` with the message ID.
2. voice-core calls `inbox.wait_for_response(message_id)`, which polls inbox.json
   every 100 ms for up to 5 minutes.
3. Meanwhile, Claude Code's `claude_listen` detects the new message and returns it.
4. Claude Code processes the query and calls `claude_send` to write the response to
   inbox.json.
5. voice-core's poll detects the response (a message after the original, from a
   non-user sender, on the `"voice-mirror"` thread).
6. voice-core emits a `response` event and calls `speak_text()`.
7. `speak_text()` takes the TTS engine from `AppState`, calls `engine.speak(text)`,
   stores the `Sink` handle for external interruption, appends audio to the sink,
   and polls until playback finishes or is cancelled.
8. `speaking_start` and `speaking_end` events bracket the playback.

### When using non-Claude providers (Ollama, LM Studio)

1. voice-core writes the transcription to inbox.json (same as above).
2. Electron's inbox-watcher detects the new user message.
3. Since Claude is not running, the inbox-watcher forwards the message to the
   active provider via `captureProviderResponse()`.
4. The provider generates a response (possibly involving tool calls).
5. The inbox-watcher extracts the speakable text and writes it back to inbox.json
   as a response message.
6. voice-core's poll detects the response and speaks it (same as step 5-8 above).

### Interruption

TTS playback can be interrupted by:

- **PTT key press**: Sets `tts_cancel` flag, calls `sink.stop()` and
  `engine.stop()`. Forces state to Listening so recording can begin immediately.
- **Wake word detection**: Same interruption logic as PTT.
- **`stop_speaking` command**: From Electron UI. Sets the cancel flag and stops
  the sink. Does not interrupt non-interruptible system speaks (startup greeting).
- **New user input**: When voice-core detects a wake word or PTT press during
  playback, it interrupts the current TTS to begin recording.

The `system_speaking` flag protects startup greetings from being interrupted.
While `system_speaking` is true, `stop_speaking` commands and wake-word
interruptions are ignored.

---

## Error States and Recovery

### voice-core fails to start

- `voice-backend.js` emits an `error` event: "voice-core binary not found."
- Binary discovery checks packaged, release, and debug paths in order.
- The user sees an error in the Electron UI.

### voice-core crashes

- Electron's `close` handler detects non-zero exit code.
- Auto-restart attempts up to 3 times with 8-second delays.
- Restart counter resets on successful `ready` event.
- After 3 failures, emits `restart_failed` event and stops retrying.
- The user can manually restart via the UI.

### Audio capture fails

- `start_capture()` returns an error; the stream handle is `None`.
- voice-core continues running (STT/TTS still work for text queries).
- An error event is emitted: "Audio capture failed: ..."

### STT engine fails to load

- `create_stt_engine()` returns `Err`; `stt_engine` is `None`.
- voice-core continues running, but recordings are discarded with "No STT engine
  available -- recording discarded".
- Whisper model auto-download: If the model file is missing, voice-core downloads
  it from HuggingFace, emitting `loading` progress events. Download failures are
  reported as errors.

### TTS engine fails to load

- `create_tts_engine()` returns `Err`; `tts_engine` is `None`.
- Kokoro failure triggers automatic fallback to Edge TTS.
- If both fail, speak requests emit "TTS not available" errors.
- The conversation pipeline still works (text transcription and inbox messaging
  continue), but responses are not spoken.

### Wake word models missing

- `OpenWakeWord::load()` returns false; `is_loaded()` returns false.
- All `process()` calls return `(false, 0.0)`.
- In wake word mode, no recording is ever triggered. PTT still works in hybrid mode.

### VAD model missing

- `SileroVad::load()` returns false.
- Falls back to energy-based detection automatically. This is less accurate but
  functional.

### Inbox write failures

- voice-core logs a warning but continues operation.
- The user's speech is transcribed and the transcription event is emitted, but the
  message does not reach the AI.
- The Electron UI still shows the transcription.

### AI response timeout

- voice-core's `wait_for_response()` times out after 5 minutes.
- A warning is logged; the pipeline returns to listening state.
- An error event may be emitted: "Response timed out -- Claude may still be
  processing".

### Listener lock contention

- If another Claude Code instance holds the listener lock, `claude_listen` returns
  an error: "Cannot listen: Another Claude instance is already listening."
- The lock has a 310-second expiry, so stale locks from crashed processes are
  automatically released.

### stdin/stdout pipe closed

- voice-core's stdin reader thread detects EOF and sends `None` through the channel.
- The main loop breaks and voice-core shuts down cleanly.
- This is the normal shutdown path when Electron closes.

---

## Data Directory Paths

All persistent data is stored in the platform-specific data directory:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%/voice-mirror-electron/data/` |
| macOS | `~/Library/Application Support/voice-mirror-electron/data/` |
| Linux | `$XDG_CONFIG_HOME/voice-mirror-electron/data/` (default `~/.config/...`) |

Key files in this directory:

| File | Purpose |
|------|---------|
| `voice_settings.json` | Configuration written by Electron, read by voice-core |
| `inbox.json` | Message queue |
| `status.json` | Instance presence tracking |
| `listener_lock.json` | Exclusive listener mutex |
| `claude_message_trigger.json` | File-change trigger for message notifications |
| `vmr-rust.log` | voice-core debug log |
| `models/ggml-base.en.bin` | Whisper STT model |
| `models/silero_vad.onnx` | Silero VAD model |
| `models/melspectrogram.onnx` | OpenWakeWord stage 1 |
| `models/embedding_model.onnx` | OpenWakeWord stage 2 |
| `models/hey_claude_v2.onnx` | OpenWakeWord stage 3 |
| `models/kokoro/kokoro-v1.0.onnx` | Kokoro TTS model |
| `models/kokoro/voices-v1.0.bin` | Kokoro voice embeddings (NPZ) |
| `images/` | Saved screenshots for vision queries |
