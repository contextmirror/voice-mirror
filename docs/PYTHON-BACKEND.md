# Voice Mirror Electron - Python Backend

The Electron app spawns the Python backend as a child process. Located in `python/` folder.

## Architecture

```
VoiceMirror class (voice_agent.py)
├── WakeWordProcessor (audio/wake_word.py)
├── TTSAdapter (tts/factory.py → kokoro.py or qwen.py)
├── InboxManager (providers/inbox.py)
├── AudioState (audio/state.py)
└── STTAdapter (stt/factory.py → parakeet.py or whisper.py)
```

## Directory Structure

```
python/
├── voice_agent.py       # Main voice processing engine
├── electron_bridge.py   # JSON IPC bridge to Electron
├── notifications.py     # Background response watcher
├── settings.py          # Voice settings & localization
├── run_mcp.py           # MCP server entry point
├── audio/               # Audio processing
│   ├── state.py         # Thread-safe audio state
│   ├── vad.py           # Voice activity detection
│   └── wake_word.py     # OpenWakeWord detection
├── tts/                 # Text-to-speech adapters
│   ├── base.py          # TTS interface (TTSAdapter)
│   ├── factory.py       # Adapter factory
│   ├── kokoro.py        # Kokoro ONNX (default, lightweight)
│   └── qwen.py          # Qwen3-TTS (voice cloning, GPU)
├── stt/                 # Speech-to-text adapters
│   ├── base.py          # STT interface
│   ├── factory.py       # Adapter factory
│   ├── parakeet.py      # NVIDIA Parakeet (default)
│   └── whisper.py       # OpenAI Whisper
├── providers/           # AI provider config
│   ├── config.py        # Provider detection, activation modes
│   └── inbox.py         # MCP inbox manager
├── voice_mcp/           # MCP server for Claude
│   ├── server.py        # n8n + voice tools
│   └── handlers/        # Tool handlers
└── requirements.txt     # Python dependencies
```

---

## Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Wake Word | OpenWakeWord (ONNX) | "Hey Claude" detection |
| STT (Default) | NVIDIA Parakeet | Fast local transcription |
| STT (Alt) | OpenAI Whisper | More accurate, slower |
| TTS (Default) | Kokoro ONNX (~311MB) | Lightweight local synthesis |
| TTS (Alt) | Qwen3-TTS (~3.4GB) | Voice cloning, GPU-accelerated |
| VAD | Energy-based | Silence timeout detection |
| MCP Inbox | JSON protocol | AI provider communication |

---

## Activation Modes

| Mode | Trigger | Use Case |
|------|---------|----------|
| Wake Word | "Hey Claude" | Hands-free, on-demand |
| Call Mode | Always listening | Continuous conversation |
| Push to Talk | Keyboard/mouse | Manual control |

---

## Electron Bridge Protocol

Python communicates with Electron via JSON over stdout/stdin.

### Events (Python → Electron)

```json
{"event": "wake_word", "data": {"model": "hey_claude", "score": 0.98}}
{"event": "recording_start", "data": {"type": "wake-word"}}
{"event": "recording_stop", "data": {}}
{"event": "transcription", "data": {"text": "user said this"}}
{"event": "response", "data": {"text": "Claude: response here"}}
{"event": "speaking_start", "data": {"text": "what's being said"}}
{"event": "speaking_end", "data": {}}
{"event": "idle", "data": {}}
{"event": "error", "data": {"message": "error details"}}
```

### Commands (Electron → Python)

```json
{"command": "start_recording"}
{"command": "stop_recording"}
{"command": "config_update", "config": {...}}
{"command": "set_mode", "mode": "auto|local|claude"}
{"type": "image", "data": "base64...", "prompt": "describe this"}
```

---

## Key Modules

### voice_agent.py
Main async event loop for voice capture, transcription, and response handling.

**Key responsibilities:**
- Audio stream management (16kHz, mono, float32)
- Wake word detection with conversation window (5s follow-up)
- Silence-based recording timeout (3 seconds)
- STT adapter handling (async model loading)
- MCP inbox communication
- TTS response speaking with callbacks

### electron_bridge.py
Bridges voice_agent with Electron via JSON.

**Key responsibilities:**
- Capture and emit JSON events to stdout
- Parse JSON commands from stdin
- Pattern matching for voice_agent output
- Logging to `~/.config/voice-mirror-electron/data/vmr.log`

### tts/ (Pluggable TTS System)
Factory-based TTS with multiple adapters.

```python
ADAPTERS = {
  "kokoro": KokoroAdapter,    # Lightweight ONNX (default)
  "qwen": QwenTTSAdapter,     # Voice cloning, GPU
}
create_tts_adapter(adapter_name, voice) → TTSAdapter
```

**TTSAdapter base class features:**
- `load()` - Synchronous model loading
- `speak(text, on_start, on_end)` - Async synthesis + playback
- `set_voice(voice)` - Dynamic voice switching
- `strip_markdown()` - Clean text for natural speech
- `available_voices` - List supported voices

**Kokoro adapter (~311MB):**
- 10 voices (af_bella, am_adam, bf_emma, etc.)
- Fast CPU inference via ONNX
- Good for everyday use

**Qwen3-TTS adapter (~3.4GB for 1.7B model):**
- 9 preset speakers + voice cloning
- `set_voice_clone(ref_audio, ref_text)` - Clone any voice from 3s sample
- 10 languages supported
- Requires GPU (CUDA) for good performance
- Supports emotion/style instructions

### audio/wake_word.py
OpenWakeWord detection wrapper.

**Features:**
- Loads ONNX model (models/hey_claude_v2.onnx)
- Processes 80ms audio chunks (1280 samples @ 16kHz)
- Threshold: 0.98 (strict but usable)
- Returns: (detected, model_name, confidence_score)

### audio/state.py
Thread-safe audio state management.

```python
AudioState dataclass:
  ├── is_listening, is_recording, is_processing
  ├── recording_source ("wake_word", "ptt", "call", "follow_up")
  ├── audio_buffer[] (thread-safe via Lock)
  ├── last_speech_time (VAD tracking)
  ├── ptt_active, ptt_last_check (push-to-talk)
  ├── in_conversation, conversation_end_time
  └── Methods: append_audio(), get_and_clear_buffer(), start_recording()
```

### stt/factory.py
Pluggable STT adapter factory.

```python
ADAPTERS = {
  "parakeet": ParakeetAdapter,      # Fast, local (default)
  "whisper": WhisperAdapter,        # Accurate, slower
  "faster-whisper": FasterWhisperAdapter  # Balance
}
create_stt_adapter(adapter_name, model_name) → STTAdapter
```

### providers/inbox.py
MCP inbox protocol manager.

```python
InboxManager:
  ├── send(message) → message_id
  ├── wait_for_response(msg_id, timeout=60s) async → response
  ├── get_latest_ai_message() → (msg_id, text)
  └── cleanup_inbox(max_age_hours=2) → removed_count
```

---

## MCP Tools (via voice_mcp/)

- **n8n**: 20+ workflow automation tools
- **voice_status**: Get Voice Mirror status
- **voice_speak**: Send text to TTS

---

## Dependencies

```
openwakeword>=0.6.0          # Wake word detection
sounddevice>=0.4.6           # Audio capture
numpy>=1.24.0                # Audio processing
onnx-asr>=0.10.0             # Parakeet STT
kokoro-onnx>=0.4.0           # TTS
soundfile>=0.13.0            # WAV file I/O
anthropic>=0.40.0            # Claude API (optional)
psutil                       # Process management
```

---

## Setup

1. Create virtual environment in `python/` folder:
   ```bash
   cd python
   python -m venv .venv
   source .venv/bin/activate  # Linux/macOS
   # or: .venv\Scripts\activate  # Windows
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Download models:
   - Wake word: `models/hey_claude_v2.onnx`
   - Kokoro TTS model (auto-downloaded on first use)

4. Electron auto-detects Python path:
   - Linux/macOS: `python/.venv/bin/python`
   - Windows: `python/.venv/Scripts/python.exe`
