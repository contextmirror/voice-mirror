# Voice Pipeline

Voice Mirror is a voice-assisted development environment. The voice pipeline is
the core interaction loop: a developer speaks, the system transcribes their
speech, routes it to an AI agent (Claude Code or an API provider), and speaks
the response back -- all while the developer stays in the Lens workspace editing
code, previewing in the browser, or running terminal commands.

The voice engine is integrated directly into the Tauri 2 Rust backend as a
native module. This document describes how audio flows from the microphone
through speech recognition, into the AI, and back out as spoken TTS audio.

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [ASCII Diagram](#ascii-diagram)
3. [Voice Engine (Rust Module)](#voice-engine-rust-module)
   - [Audio Capture and Processing](#audio-capture-and-processing)
   - [Voice Activity Detection (VAD)](#voice-activity-detection-vad)
   - [Speech-to-Text (STT)](#speech-to-text-stt)
   - [Text-to-Speech (TTS)](#text-to-speech-tts)
   - [Activation Modes](#activation-modes)
   - [Audio State Machine](#audio-state-machine)
4. [Frontend Voice Adapters](#frontend-voice-adapters)
5. [MCP Server Voice Tools](#mcp-server-voice-tools)
6. [TTS Response Flow](#tts-response-flow)
7. [Error States and Recovery](#error-states-and-recovery)

---

## Pipeline Overview

The voice pipeline is integrated directly into the Tauri application:

1. **Voice Engine** -- A Rust module (`src-tauri/src/voice/`) that handles all
   audio I/O (capture, VAD, STT, TTS playback). Runs as native async tasks
   within the Tauri process.
2. **Tauri frontend** -- Svelte 5 components receive voice events and send
   commands via Tauri invoke() calls.
3. **MCP server** -- Exposes voice tools (`voice_listen`, `voice_send`, etc.)
   for Claude Code to interact with voice messages.
4. **AI provider** -- Claude Code (via MCP tools) or API-based providers that
   process voice input and produce responses.

The high-level flow:

```
User speaks -> Microphone -> cpal captures audio
-> PTT / Toggle / WakeWord triggers recording
-> VAD detects end of speech (or key release)
-> STT transcribes audio to text
-> Transcription emitted as Tauri event
-> AI processes text and produces response
-> TTS synthesizes response to audio
-> rodio plays audio through speakers
```

---

## ASCII Diagram

```
+----------------------------------------------------------------------+
|                         TAURI APPLICATION                             |
|                                                                       |
|  Voice Engine (src-tauri/src/voice/)                                  |
|  +--------------------------------------------------------------+    |
|  |                                                                |   |
|  |  +------+   +----------+   +----------+   +----------+       |   |
|  |  | cpal |-->| Ring Buf  |-->| VAD      |-->| STT      |       |   |
|  |  | 16kHz|  | (160k f32)| | (energy)  | | (whisper)  |       |   |
|  |  +------+  +----------+   +----------+   +----------+       |   |
|  |                                                 |              |   |
|  |                                      Transcription event      |   |
|  |                                                 |              |   |
|  |  +----------+   +----------+                   v              |   |
|  |  | rodio    |<--| TTS      |<---- AI response text           |   |
|  |  | playback | | (Edge/    |                                  |   |
|  |  | (speaker)| |  Kokoro)  |                                  |   |
|  |  +----------+   +----------+                                  |   |
|  +--------------------------------------------------------------+    |
|                                                                       |
|  Commands (frontend):                                                 |
|    invoke('voice_start') / invoke('voice_stop')                       |
|    invoke('voice_speak', { text })                                    |
|    invoke('start_recording') / invoke('stop_recording')               |
|                                                                       |
|  Events (to frontend):                                                |
|    voice-event: Starting, Ready, StateChange, RecordingStart,         |
|                 RecordingStop, Transcription, SpeakingStart,          |
|                 SpeakingEnd, AudioLevel, Error, AudioDevices          |
+----------------------------------------------------------------------+
         |                                       |
         | Named pipe IPC                        | Tauri events
         v                                       v
+-----------------------------+       +-----------------------------+
|      MCP SERVER             |       |     SVELTE 5 FRONTEND       |
|      (Rust binary)          |       |                             |
|                             |       | Voice settings UI           |
| voice_listen:               |       | Recording waveform          |
|   wait for transcription    |       | State indicator (orb)       |
|                             |       | TTS/STT adapter config      |
| voice_send:                 |       +-----------------------------+
|   speak response via TTS    |
|                             |
| voice_status:               |
|   pipeline state check      |
+-----------------------------+
```

---

## Voice Engine (Rust Module)

Source: `src-tauri/src/voice/` -- 4 submodules: `pipeline`, `stt`, `tts`, `vad`.

The voice engine is a native Rust module integrated directly into the Tauri
application. It runs audio processing on background tokio tasks and communicates
with the frontend via Tauri events.

### Audio Capture and Processing

**Source**: `src-tauri/src/voice/pipeline/mod.rs`, `src-tauri/src/voice/pipeline/ring_buffer.rs`

Audio capture uses the `cpal` crate to open the system default input device (or a
named device from config). The capture pipeline:

1. **cpal callback** receives raw f32 samples at the device's native sample rate
   and channel count.
2. **Down-mix** to mono by averaging channels (if multi-channel).
3. **Resample** to 16 kHz using linear interpolation (if native rate differs).
4. **Chunk** into 1280-sample buffers (80 ms at 16 kHz).
5. **Push** chunks into a ring buffer.

The ring buffer has a capacity of 160,000 samples (~10 seconds at 16 kHz).
If the consumer falls behind, the oldest audio is silently overwritten. The
producer lives in the cpal audio thread; the consumer lives in the async
processing task.

The **audio processing loop** runs as a tokio task, ticking every 40 ms. Each
tick it pops up to 1280 samples from the ring buffer and processes them
according to the current voice state.

### Voice Activity Detection (VAD)

**Source**: `src-tauri/src/voice/vad.rs`

VAD determines whether a chunk of audio contains speech. The current
implementation is energy-based:

- **Energy-based detection**: Computes mean absolute amplitude of the audio
  chunk. Threshold is configurable (default `0.01`). Speech is detected when
  energy exceeds the threshold.

VAD is used during recording to detect when the user stops speaking. After the
configured silence timeout (default 2.0 seconds), the recording is automatically
stopped. PTT and Toggle recordings are controlled entirely by key press/release
and bypass VAD silence detection.

The `VadProcessor` struct also tracks:
- Running average energy (exponential moving average, alpha=0.01)
- Silence duration since last detected speech
- Per-frame speech/silence state

### Speech-to-Text (STT)

**Source**: `src-tauri/src/voice/stt.rs`

STT provides a trait-based abstraction (`SttEngine`) with implementations:

| Adapter | Config Name | Description |
|---------|-------------|-------------|
| **Whisper local** | `whisper-local` | Local inference via `whisper-rs` (whisper.cpp FFI). Default. |
| **OpenAI Cloud** | `openai-cloud` | Placeholder (falls back to Whisper stub). |
| **Custom Cloud** | `custom-cloud` | Placeholder (falls back to Whisper stub). |

**Whisper local** is the primary STT adapter:

- Models are GGML format, auto-downloaded from HuggingFace on first use
  (e.g., `ggml-base.en.bin`). Download uses atomic writes (temp file + rename).
- Behind the `whisper` feature flag. When disabled, a stub implementation returns
  placeholder text.
- Uses greedy sampling strategy with `best_of: 1`.
- Configured for English-only (`set_language(Some("en"))`).
- Non-speech token suppression is enabled to reduce hallucination on silence.
- Thread count is half the available CPU cores, clamped to 1-8.
- The `WhisperState` is cached after first use to avoid ~200 MB of buffer
  reallocation per transcription.
- Audio shorter than 0.4 seconds (6,400 samples at 16kHz) is silently discarded.
- Inference runs on a blocking tokio thread (`spawn_blocking`) to avoid stalling
  the async runtime.
- Streaming mode accumulates at least 2 seconds of audio before triggering
  transcription.

Available model sizes (configured via frontend):

| Size | File | Approximate Size |
|------|------|-----------------|
| `tiny` | `ggml-tiny.en.bin` | ~77 MB |
| `base` | `ggml-base.en.bin` | ~148 MB (default) |
| `small` | `ggml-small.en.bin` | ~488 MB |

### Text-to-Speech (TTS)

**Source**: `src-tauri/src/voice/tts/mod.rs`, `src-tauri/src/voice/tts/edge_tts.rs`, `src-tauri/src/voice/tts/kokoro_impl.rs`

TTS provides a trait-based abstraction (`TtsEngine`) with implementations:

| Adapter | Config Name | Description |
|---------|-------------|-------------|
| **Kokoro** | `kokoro` | Local ONNX synthesis (default). Behind `onnx` feature flag. |
| **Edge TTS** | `edge` | Free Microsoft voices via HTTP REST. Fallback when Kokoro unavailable. |
| **OpenAI TTS** | `openai-tts` | Placeholder (falls back to Edge TTS). |
| **ElevenLabs** | `elevenlabs` | Placeholder (falls back to Edge TTS). |

**Kokoro TTS** (when the `onnx` feature is enabled):

- Uses `kokoro-v1.0.onnx` model with voice embeddings from `voices-v1.0.bin`.
- Model files loaded from data directory at `models/kokoro/`.
- Output is 22,050 Hz mono f32 PCM audio.
- If Kokoro model files are not available, automatically falls back to Edge TTS.

**Edge TTS**:

- Connects via HTTP to Microsoft's Bing speech synthesis service.
- Sends SSML and receives MP3 audio, decoded to f32 PCM using Symphonia.
- Supports rate adjustment via SSML.
- Output is 24 kHz mono.

**Phrase splitting**: Long text is split into natural phrases (5-8 words) for
incremental synthesis via `split_into_phrases()`. The `TtsStream` struct
provides an iterator over phrase chunks.

**Playback** uses the `rodio` crate:
- Opens the default audio output device via `OutputStream::try_default()`.
- Creates a `Sink` for queuing and playing audio buffers.
- Supports volume control (0.0 - 1.0).
- Playback is interruptible via an `AtomicBool` cancel flag.

### Activation Modes

The voice engine supports three activation modes, configured via the
`behavior.activationMode` config key:

#### Push-to-Talk Mode (`pushToTalk`) -- Default

- Recording starts when PTT key is pressed, stops when released.
- The frontend sends `start_recording` / `stop_recording` commands.
- VAD silence detection is **bypassed** -- recording duration is controlled
  by key hold time.
- Any in-progress TTS playback is interrupted on key press (barge-in).

#### Toggle Mode (`toggle`)

- Press once to start recording, press again to stop.
- Otherwise identical to PTT mode (VAD bypassed, barge-in supported).

#### Wake Word / Continuous Mode (`wakeWord`)

- Audio processing loop starts in **Listening** state automatically.
- VAD monitors audio continuously for speech onset.
- When speech is detected, recording begins automatically.
- Recording stops after the configured silence timeout (default 2.0 seconds).
- After STT, returns to Listening state.

### Audio State Machine

**Source**: `src-tauri/src/voice/pipeline/mod.rs`

A state machine using `AtomicU8` for lock-free state transitions shared
between the capture callback thread, the processing task, and Tauri commands.

```
                  WakeWord mode auto
    +---------+  ----------------->  +-----------+
    |  Idle   |                      | Listening |
    +---------+  <-----------------  +-----------+
                     stop()               |
                                          | speech detected / PTT press
                                          v
                                    +-----------+
                                    | Recording |
                                    +-----------+
                                          |
                                          | silence timeout / key release
                                          v
                                    +------------+
                                    | Processing |
                                    +------------+
                                          |
                                          | STT complete
                                          v
                                    +-----------+       +----------+
                                    | Idle /    |------>| Speaking  |
                                    | Listening |       | (TTS)    |
                                    +-----------+       +----------+
```

States:
- **Idle** (0): Voice engine inactive or waiting for PTT/Toggle key press.
- **Listening** (1): Microphone active, VAD monitoring for speech (WakeWord mode).
- **Recording** (2): Actively capturing user speech.
- **Processing** (3): STT transcription in progress.
- **Speaking** (4): TTS playback in progress.

Barge-in is supported: if the user presses PTT during Speaking, TTS is
cancelled and recording begins immediately.

---

## Frontend Voice Adapters

**Source**: `src/lib/voice-adapters.js`

The frontend maintains adapter registries for TTS and STT configuration UI:

### TTS Adapter Registry

| Adapter | Category | Voices |
|---------|----------|--------|
| **Kokoro** | local | 10 voices (4 US female, 2 US male, 2 British female, 2 British male) |
| **Qwen3-TTS** | local | 9 voices (voice cloning support, multi-language) |
| **Piper** | local | 5 voices (lightweight, ~50MB) |
| **Edge TTS** | cloud-free | 6 voices (Microsoft Neural voices) |
| **OpenAI TTS** | cloud-paid | 6 voices (alloy, echo, fable, onyx, nova, shimmer) |
| **ElevenLabs** | cloud-paid | 6 voices (Rachel, Domi, Bella, Antoni, Josh, Adam) |
| **Custom API** | cloud-custom | OpenAI-compatible endpoint |

Each adapter definition includes: `showModelSize`, `showApiKey`,
`showEndpoint`, `showModelPath` flags for the settings UI.

### STT Adapter Registry

| Adapter | Label | Options |
|---------|-------|---------|
| **whisper-local** | Whisper (Local, default) | Model sizes: tiny.en, base.en, small.en |
| **openai-whisper-api** | OpenAI Whisper API | API key required |
| **custom-api-stt** | Custom API | Endpoint + API key + model name |

### Keybind Helpers

The file also exports keybind display helpers:
- `VKEY_NAMES` -- Windows virtual key code to display name mapping
- `MOUSE_BUTTON_NAMES` -- Mouse button ID to display name
- `formatKeybind(keybind)` -- Formats keybind strings for display (supports
  `kb:VKEY`, `mouse:ID`, legacy `MouseButtonN`, and `Ctrl+Shift+V` formats)

---

## MCP Server Voice Tools

**Source**: `src-tauri/src/mcp/handlers/core.rs`

The MCP server exposes voice-related tools in the `core` group (always loaded):

### voice_listen

Waits for new voice input from the user. Blocks until a message arrives or
times out.

### voice_send

Sends a response message. For voice mode, this triggers TTS playback through
the voice engine.

### voice_status

Reports the current voice pipeline state and configuration.

---

## TTS Response Flow

The complete flow for speaking an AI response:

### Via Tauri Commands

1. Frontend or MCP tool calls `invoke('voice_speak', { text })`.
2. The Tauri command accesses the `VoiceEngine` from managed state.
3. `VoiceEngine::speak()` delegates to `VoicePipeline::speak()`.
4. The pipeline's `playback` module synthesizes audio via the TTS engine.
5. Audio is queued on the rodio `Sink` for playback.
6. `SpeakingStart` and `SpeakingEnd` events bracket the playback.
7. State transitions: current -> Speaking -> previous state.

### Interruption

TTS playback can be interrupted by:

- **PTT key press (barge-in)**: Sets `tts_cancel` flag, transitions directly
  to Recording state so capture begins immediately.
- **`stop_speaking` command**: From frontend UI. Sets the cancel flag.
- The `tts_cancel` flag is checked between phrase synthesis chunks.

---

## Error States and Recovery

### Audio capture fails

- `start_audio_capture()` returns an error; no capture stream is created.
- The pipeline returns an error from `start()`.
- An error event is emitted to the frontend.

### STT engine fails to load

- `create_stt_engine()` returns `Err`; `stt_engine` is `None`.
- The pipeline continues running, but recordings produce no transcription.
- An error event is emitted: "STT not available: ..."
- Whisper model auto-download: If the model file is missing, it can be
  downloaded from HuggingFace via `ensure_model_exists()`. Download failures
  are reported as `SttError::DownloadError`.

### TTS engine fails to load

- `create_tts_engine()` returns `Err`; `tts_engine` is `None`.
- Kokoro failure triggers automatic fallback to Edge TTS in the factory.
- If both fail, speak requests produce error events.
- The pipeline still works for STT (transcription continues, responses are
  not spoken).

### Configuration

The voice engine config (`VoiceEngineConfig`) is built from the app's config
at pipeline start time. Key fields:

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `PushToTalk` | Activation mode |
| `stt_adapter` | `"whisper-local"` | STT engine name |
| `stt_model_size` | `"base"` | Whisper model size |
| `tts_adapter` | `"kokoro"` | TTS engine name |
| `tts_voice` | `"af_bella"` | TTS voice name |
| `tts_speed` | `1.0` | TTS speed multiplier |
| `tts_volume` | `1.0` | Playback volume (0.0-1.0) |
| `input_device` | `None` | Input device name (None = system default) |
| `output_device` | `None` | Output device name (None = system default) |
| `silence_timeout_secs` | `2.0` | Seconds of silence before auto-stop |
| `vad_threshold` | `0.01` | Energy threshold for speech detection |

Changes to the config require a pipeline restart to take effect.
