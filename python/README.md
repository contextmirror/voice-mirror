# Voice Mirror Python Backend

Voice processing engine with wake word detection, speech-to-text, and text-to-speech synthesis.

## Quick Start

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# or: .venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Run standalone (for testing)
python voice_agent.py
```

## Structure

```
python/
├── voice_agent.py          # Main orchestrator (780 lines)
├── electron_bridge.py      # JSON IPC bridge to Electron
├── notifications.py        # Background AI response watcher
├── settings.py             # User settings management
├── run_mcp.py              # MCP server entry point
│
├── audio/                  # Audio processing
│   ├── state.py            # Thread-safe audio state
│   ├── vad.py              # Voice activity detection
│   └── wake_word.py        # OpenWakeWord integration
│
├── stt/                    # Speech-to-Text (pluggable)
│   ├── base.py             # STT adapter interface
│   ├── factory.py          # Adapter factory
│   ├── parakeet.py         # NVIDIA Parakeet (default)
│   └── whisper.py          # OpenAI Whisper + Faster-Whisper
│
├── tts/                    # Text-to-Speech (pluggable)
│   ├── base.py             # TTS adapter interface
│   ├── factory.py          # Adapter factory
│   ├── kokoro.py           # Kokoro ONNX (default)
│   └── qwen.py             # Qwen3-TTS (voice cloning)
│
├── providers/              # AI provider configuration
│   ├── config.py           # Provider detection, activation modes
│   └── inbox.py            # MCP inbox communication
│
├── voice_mcp/              # Python MCP server
│   ├── server.py           # n8n + voice tools
│   └── handlers/           # Tool handlers
│
├── models/                 # Pre-trained models
│   ├── hey_claude_v2.onnx  # Wake word model (1.8MB)
│   ├── embedding_model.onnx
│   └── melspectrogram.onnx
│
├── kokoro-v1.0.onnx        # TTS model (325MB)
├── voices-v1.0.bin         # Voice data (28MB)
└── requirements.txt        # Dependencies
```

## Components

### Wake Word Detection
- **Model**: OpenWakeWord (hey_claude_v2.onnx)
- **Threshold**: 0.98 (strict, low false positives)
- **Chunk size**: 80ms (1280 samples @ 16kHz)
- Can be disabled in Call Mode or PTT Mode

### Speech-to-Text Adapters

| Adapter | Model | Speed | Notes |
|---------|-------|-------|-------|
| **Parakeet** (default) | nemo-parakeet-tdt-0.6b-v2 | Fast | CPU only |
| Whisper | tiny → large | Medium | GPU supported |
| Faster-Whisper | tiny → large-v3 | Fast | CTranslate2 optimized |

### Text-to-Speech Adapters

| Adapter | Voices | Features |
|---------|--------|----------|
| **Kokoro** (default) | 10 | Fast, CPU, ONNX |
| Qwen3-TTS | 9 presets + cloning | GPU, 11 languages |

### Kokoro Voices
- **American**: af_bella (default), af_nicole, af_sarah, af_sky, am_adam, am_michael
- **British**: bf_emma, bf_isabella, bm_george, bm_lewis

### Qwen3-TTS Speakers
Vivian, Serena, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee, Uncle_Fu

## Activation Modes

| Mode | Trigger | Use Case |
|------|---------|----------|
| Wake Word | "Hey Claude" | Hands-free |
| Call Mode | Always listening | Continuous |
| Push to Talk | Key/button hold | Manual |

## Electron Bridge Protocol

### Events (Python → Electron)
```json
{"event": "wake_word", "data": {"model": "hey_claude", "score": 0.98}}
{"event": "recording_start", "data": {"type": "wake-word"}}
{"event": "recording_stop", "data": {}}
{"event": "transcription", "data": {"text": "user said this"}}
{"event": "response", "data": {"text": "Claude: response"}}
{"event": "speaking_start", "data": {"text": "..."}}
{"event": "speaking_end", "data": {}}
```

### Commands (Electron → Python)
```json
{"command": "start_recording"}
{"command": "stop_recording"}
{"command": "config_update", "config": {...}}
{"type": "image", "data": "base64...", "prompt": "describe this"}
```

## Voice Cloning

### MCP Tool Flow
1. Claude calls `clone_voice` with URL or file path
2. MCP server writes `voice_clone_request.json`
3. Python downloads/processes audio (ffmpeg + yt-dlp)
4. Auto-transcribes if transcript not provided
5. Creates voice clone with Qwen3-TTS Base model
6. Writes result to `voice_clone_response.json`

### Audio Processing
- Download from URL (yt-dlp for YouTube/SoundCloud)
- Convert to WAV (16kHz mono)
- Trim to ~5 seconds
- Remove silence, normalize loudness

### Persistence
Cloned voices saved to `~/.config/voice-mirror-electron/data/voices/`

## Dependencies

### Core
```
openwakeword>=0.6.0      # Wake word
sounddevice>=0.4.6       # Audio capture
numpy>=1.24.0            # Audio processing
onnx-asr>=0.10.0         # Parakeet STT
kokoro-onnx>=0.4.0       # Kokoro TTS
soundfile>=0.13.0        # WAV I/O
psutil                   # Process management
```

### Optional
```
openai-whisper           # Whisper STT
faster-whisper           # Faster-Whisper STT
qwen-tts                 # Qwen3-TTS
torch                    # GPU support
scipy                    # Audio resampling
```

### External Tools
- `ffmpeg` - Audio processing
- `yt-dlp` - URL audio download

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.config/voice-mirror-electron/config.json` | Electron config (activation mode) |
| `~/.config/voice-mirror-electron/data/voice_settings.json` | Voice settings (STT/TTS) |
| `~/.config/voice-mirror-electron/data/inbox.json` | MCP messages |
| `~/.config/voice-mirror-electron/data/voice_call.json` | Call mode flag |
| `~/.config/voice-mirror-electron/data/ptt_trigger.json` | PTT trigger |

## Logging

Log file: `~/.config/voice-mirror-electron/data/vmr.log`

```bash
# Monitor in real-time
tail -f ~/.config/voice-mirror-electron/data/vmr.log
```

## Audio Configuration

Edit `devices.json` for custom audio device settings:
```json
{
  "input_device": "Razer Seiren",
  "sample_rate": 16000,
  "channels": 1
}
```

## Troubleshooting

### No audio input
- Check microphone permissions
- Verify device in `devices.json`
- Test with `python -c "import sounddevice; print(sounddevice.query_devices())"`

### Wake word not detecting
- Check model exists: `models/hey_claude_v2.onnx`
- Lower sensitivity in settings
- Check audio levels in logs

### TTS not speaking
- Verify ffplay is installed: `ffplay -version`
- Check TTS model is downloaded
- Try different TTS adapter in settings

### Voice cloning fails
- Install ffmpeg: `sudo apt install ffmpeg`
- Install yt-dlp: `pip install yt-dlp`
- Check GPU memory for Qwen3-TTS (needs ~2-4GB)
